// Minecraft Server List Ping (1.7+), the same request the multiplayer screen sends.
// Kept dependency-free so it can run in the main process and in plain node tests.

const net = require('net');
const dns = require('dns').promises;

const DEFAULT_PORT = 25565;
const DEFAULT_TIMEOUT_MS = 5000;
// -1 is the conventional "I just want the status" protocol version.
const STATUS_PROTOCOL_VERSION = -1;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function writeVarInt(value) {
    const bytes = [];
    let v = value >>> 0;
    do {
        let byte = v & 0x7f;
        v >>>= 7;
        if (v !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (v !== 0);
    return Buffer.from(bytes);
}

// Returns { value, size } or null when the buffer does not hold a complete VarInt yet.
function readVarInt(buffer, offset = 0) {
    let value = 0;
    let size = 0;
    while (true) {
        if (offset + size >= buffer.length) return null;
        const byte = buffer[offset + size];
        value |= (byte & 0x7f) << (7 * size);
        size += 1;
        if (size > 5) throw new Error('VarInt is too big');
        if ((byte & 0x80) === 0) break;
    }
    return { value, size };
}

function writeString(value) {
    const data = Buffer.from(value, 'utf8');
    return Buffer.concat([writeVarInt(data.length), data]);
}

function packet(id, payload = Buffer.alloc(0)) {
    const body = Buffer.concat([writeVarInt(id), payload]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

// Accepts "host", "host:port", "[v6]:port" and bare IPv6 addresses.
function parseAddress(address) {
    const raw = String(address || '').trim();
    if (!raw) return null;

    let host = raw;
    let port = null;

    const bracketed = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracketed) {
        host = bracketed[1];
        port = bracketed[2] ? Number(bracketed[2]) : null;
    } else if ((raw.match(/:/g) || []).length === 1) {
        const [h, p] = raw.split(':');
        host = h;
        port = p ? Number(p) : null;
    }

    host = host.trim();
    if (!host || /[\s/\\]/.test(host)) return null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;

    return { host, port };
}

// Servers without an explicit port can point to the real host via an SRV record,
// exactly like the vanilla client resolves them.
async function resolveTarget(address) {
    const parsed = parseAddress(address);
    if (!parsed) throw new Error('Invalid server address');

    if (parsed.port === null && net.isIP(parsed.host) === 0) {
        try {
            const records = await dns.resolveSrv(`_minecraft._tcp.${parsed.host}`);
            if (records && records.length > 0) {
                const best = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
                return {
                    host: best.name,
                    port: best.port,
                    handshakeHost: parsed.host,
                    handshakePort: parsed.port || DEFAULT_PORT
                };
            }
        } catch (_) {
            // No SRV record - fall back to the plain host.
        }
    }

    const port = parsed.port || DEFAULT_PORT;
    return { host: parsed.host, port, handshakeHost: parsed.host, handshakePort: port };
}

function pingServer(address, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    return resolveTarget(address).then((target) => new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: target.host, port: target.port });
        let buffer = Buffer.alloc(0);
        let status = null;
        let requestSentAt = 0;
        let settled = false;

        const finish = (err, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            if (err) reject(err);
            else resolve(result);
        };

        const timer = setTimeout(() => {
            // A server that answered the status but ignores the ping packet is still online.
            if (status) finish(null, { ...status, latency: status.fallbackLatency });
            else finish(new Error('Timed out'));
        }, timeoutMs);

        socket.setNoDelay(true);

        socket.on('connect', () => {
            const handshake = packet(0x00, Buffer.concat([
                writeVarInt(STATUS_PROTOCOL_VERSION),
                writeString(target.handshakeHost),
                Buffer.from([(target.handshakePort >> 8) & 0xff, target.handshakePort & 0xff]),
                writeVarInt(1)
            ]));
            requestSentAt = Date.now();
            socket.write(Buffer.concat([handshake, packet(0x00)]));
        });

        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_RESPONSE_BYTES) {
                finish(new Error('Response too large'));
                return;
            }

            try {
                while (true) {
                    const length = readVarInt(buffer, 0);
                    if (!length || buffer.length < length.size + length.value) return;

                    const body = buffer.subarray(length.size, length.size + length.value);
                    buffer = buffer.subarray(length.size + length.value);

                    const id = readVarInt(body, 0);
                    if (!id) throw new Error('Malformed packet');

                    if (id.value === 0x00 && !status) {
                        const strLength = readVarInt(body, id.size);
                        if (!strLength) throw new Error('Malformed status response');
                        const start = id.size + strLength.size;
                        const json = JSON.parse(body.subarray(start, start + strLength.value).toString('utf8'));
                        status = normalizeStatus(json);
                        status.fallbackLatency = Date.now() - requestSentAt;

                        const payload = Buffer.alloc(8);
                        payload.writeBigInt64BE(BigInt(Date.now()));
                        requestSentAt = Date.now();
                        socket.write(packet(0x01, payload));
                    } else if (id.value === 0x01 && status) {
                        finish(null, { ...status, latency: Date.now() - requestSentAt });
                        return;
                    }
                }
            } catch (err) {
                finish(err);
            }
        });

        socket.on('error', (err) => {
            if (status) finish(null, { ...status, latency: status.fallbackLatency });
            else finish(err);
        });

        socket.on('close', () => {
            if (status) finish(null, { ...status, latency: status.fallbackLatency });
            else finish(new Error('Connection closed'));
        });
    })).then(({ fallbackLatency, ...result }) => result);
}

function normalizeStatus(json) {
    const players = json && typeof json.players === 'object' ? json.players : {};
    const favicon = typeof json?.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,')
        ? json.favicon
        : null;

    return {
        online: true,
        version: typeof json?.version?.name === 'string' ? json.version.name : null,
        protocol: Number.isInteger(json?.version?.protocol) ? json.version.protocol : null,
        players: {
            online: Number(players.online) || 0,
            max: Number(players.max) || 0,
            sample: Array.isArray(players.sample)
                ? players.sample
                    .filter((p) => p && typeof p.name === 'string')
                    .slice(0, 12)
                    .map((p) => p.name)
                : []
        },
        // Either a plain string or a chat component - the renderer formats it.
        motd: json?.description ?? '',
        favicon
    };
}

module.exports = {
    pingServer,
    parseAddress,
    resolveTarget,
    writeVarInt,
    readVarInt
};
