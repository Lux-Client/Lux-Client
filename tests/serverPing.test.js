// Checks the Server List Ping against a tiny fake Minecraft server and the
// servers.dat reader against a real NBT file, without Electron.

const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const nbt = require('prismarine-nbt');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

const { pingServer, parseAddress, writeVarInt, readVarInt } = require('../backend/utils/serverPing');

function frame(id, payload) {
    const body = Buffer.concat([writeVarInt(id), payload]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

// Answers the status request and, optionally, the ping packet.
function startFakeServer(status, { answerPing = true } = {}) {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            let buffer = Buffer.alloc(0);
            let packets = 0;
            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (true) {
                    const len = readVarInt(buffer, 0);
                    if (!len || buffer.length < len.size + len.value) return;
                    const body = buffer.subarray(len.size, len.size + len.value);
                    buffer = buffer.subarray(len.size + len.value);
                    packets += 1;
                    const id = readVarInt(body, 0).value;
                    if (packets === 2 && id === 0x00) {
                        const json = Buffer.from(JSON.stringify(status), 'utf8');
                        socket.write(frame(0x00, Buffer.concat([writeVarInt(json.length), json])));
                    } else if (id === 0x01 && answerPing) {
                        socket.write(frame(0x01, body.subarray(1)));
                    }
                }
            });
            socket.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function run() {
    section('parseAddress');
    check('host only', JSON.stringify(parseAddress('play.example.net')) === JSON.stringify({ host: 'play.example.net', port: null }));
    check('host and port', parseAddress('mc.example.net:25570')?.port === 25570);
    check('bracketed IPv6', parseAddress('[::1]:25566')?.host === '::1');
    check('bare IPv6 keeps host', parseAddress('2001:db8::1')?.host === '2001:db8::1');
    check('rejects bad port', parseAddress('host:99999') === null);
    check('rejects empty', parseAddress('   ') === null);
    check('rejects whitespace in host', parseAddress('bad host') === null);

    section('VarInt');
    for (const n of [0, 1, 127, 128, 25565, 2097151, -1]) {
        const decoded = readVarInt(writeVarInt(n), 0);
        check(`roundtrip ${n}`, decoded && (decoded.value | 0) === n, decoded);
    }

    section('Ping against fake server');
    const status = {
        version: { name: 'Paper 1.21.4', protocol: 769 },
        players: { online: 3, max: 20, sample: [{ name: 'Steve', id: 'x' }, { name: 'Alex', id: 'y' }] },
        description: { text: 'Hello ', extra: [{ text: 'World', color: 'gold' }] },
        favicon: 'data:image/png;base64,AAAA'
    };
    const server = await startFakeServer(status);
    const port = server.address().port;
    const result = await pingServer(`127.0.0.1:${port}`, { timeoutMs: 2000 });
    check('online', result.online === true, result);
    check('version', result.version === 'Paper 1.21.4');
    check('players', result.players.online === 3 && result.players.max === 20);
    check('player sample names', JSON.stringify(result.players.sample) === '["Steve","Alex"]');
    check('motd passed through', result.motd?.extra?.[0]?.color === 'gold');
    check('favicon', result.favicon === status.favicon);
    check('latency is a number', typeof result.latency === 'number' && result.latency >= 0);
    check('no internal fields leak', !('fallbackLatency' in result));
    server.close();

    section('Server that ignores the ping packet');
    const silent = await startFakeServer({ ...status, favicon: 'javascript:alert(1)' }, { answerPing: false });
    const silentResult = await pingServer(`127.0.0.1:${silent.address().port}`, { timeoutMs: 500 });
    check('still online', silentResult.online === true);
    check('falls back to status latency', typeof silentResult.latency === 'number');
    check('rejects non-png favicon', silentResult.favicon === null);
    silent.close();

    section('Offline server');
    const closed = net.createServer();
    await new Promise((r) => closed.listen(0, '127.0.0.1', r));
    const closedPort = closed.address().port;
    await new Promise((r) => closed.close(r));
    let offlineError = null;
    try {
        await pingServer(`127.0.0.1:${closedPort}`, { timeoutMs: 1000 });
    } catch (err) {
        offlineError = err;
    }
    check('rejects when nothing listens', offlineError !== null);

    section('servers.dat reader');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lux-servers-'));
    const instanceDir = path.join(tmp, 'My Instance');
    fs.mkdirSync(instanceDir);
    fs.writeFileSync(path.join(instanceDir, 'instance.json'), '{}');
    const serversNbt = nbt.comp({
        servers: nbt.list(nbt.comp([
            { name: nbt.string('Hypixel'), ip: nbt.string('mc.hypixel.net'), icon: nbt.string('iVBORw0KGgo=') },
            { name: nbt.string('Hidden'), ip: nbt.string('hidden.example'), hidden: nbt.byte(1) },
            { name: nbt.string(''), ip: nbt.string('noname.example:25570') },
            { name: nbt.string('Broken icon'), ip: nbt.string('icon.example'), icon: nbt.string('"><script>') }
        ]))
    });
    fs.writeFileSync(path.join(instanceDir, 'servers.dat'), nbt.writeUncompressed(serversNbt));

    // The handler resolves instance folders through Electron's app paths; point it at the temp dir.
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request === 'electron') return 'electron-stub';
        return originalResolve.call(this, request, ...rest);
    };
    require.cache['electron-stub'] = {
        id: 'electron-stub',
        filename: 'electron-stub',
        loaded: true,
        exports: { app: { getPath: (name) => (name === 'userData' ? path.join(tmp, 'userData') : tmp) } }
    };
    fs.mkdirSync(path.join(tmp, 'userData'));
    fs.writeFileSync(path.join(tmp, 'userData', 'settings.json'), JSON.stringify({ instancesPath: tmp }));

    const { readSavedServers } = require('../backend/handlers/serverStatus');
    const saved = await readSavedServers('My Instance');
    check('hidden entries are skipped', saved.length === 3, saved);
    check('name and address', saved[0].name === 'Hypixel' && saved[0].address === 'mc.hypixel.net');
    check('icon becomes data URI', saved[0].icon === 'data:image/png;base64,iVBORw0KGgo=');
    check('empty name falls back to address', saved[1].name === 'noname.example:25570');
    check('invalid icon is dropped', saved[2].icon === null);
    check('missing instance returns empty list', (await readSavedServers('Nope')).length === 0);

    Module._resolveFilename = originalResolve;
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
