const path = require('path');
const fs = require('fs-extra');
const nbt = require('prismarine-nbt');
const { resolveInstanceDirByName } = require('../utils/instances-path');
const { pingServer, parseAddress } = require('../utils/serverPing');

// The dashboard refreshes often; don't hammer servers that were just pinged.
const PING_CACHE_TTL_MS = 30 * 1000;
const pingCache = new Map();
const pendingPings = new Map();

async function readSavedServers(instanceName) {
    const instanceDir = resolveInstanceDirByName(instanceName);
    if (!instanceDir) return [];

    const serversPath = path.join(instanceDir, 'servers.dat');
    if (!await fs.pathExists(serversPath)) return [];

    const buffer = await fs.readFile(serversPath);
    const { parsed } = await nbt.parse(buffer);
    const data = nbt.simplify(parsed);
    const entries = Array.isArray(data?.servers) ? data.servers : [];

    return entries
        .filter((entry) => entry && typeof entry.ip === 'string' && entry.ip.trim() && !entry.hidden)
        .map((entry) => ({
            name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.ip,
            address: entry.ip.trim(),
            icon: typeof entry.icon === 'string' && /^[A-Za-z0-9+/=]+$/.test(entry.icon)
                ? `data:image/png;base64,${entry.icon}`
                : null
        }));
}

async function pingCached(address, force) {
    const key = address.toLowerCase();
    const cached = pingCache.get(key);
    if (!force && cached && Date.now() - cached.at < PING_CACHE_TTL_MS) {
        return cached.result;
    }
    if (pendingPings.has(key)) return pendingPings.get(key);

    const request = pingServer(address)
        .then((status) => ({ success: true, status }))
        .catch((err) => ({ success: true, status: { online: false, error: err.code || err.message } }))
        .then((result) => {
            pingCache.set(key, { at: Date.now(), result });
            pendingPings.delete(key);
            return result;
        });

    pendingPings.set(key, request);
    return request;
}

module.exports = (ipcMain) => {
    ipcMain.handle('instance:get-saved-servers', async (_, instanceName) => {
        try {
            return { success: true, servers: await readSavedServers(instanceName) };
        } catch (err) {
            console.warn(`[ServerStatus] Could not read servers.dat for ${instanceName}:`, err.message);
            return { success: false, error: err.message, servers: [] };
        }
    });

    ipcMain.handle('server-status:ping', async (_, address, options = {}) => {
        if (!parseAddress(address)) {
            return { success: false, error: 'Invalid server address' };
        }
        return pingCached(String(address).trim(), Boolean(options?.force));
    });
};

module.exports.readSavedServers = readSavedServers;
