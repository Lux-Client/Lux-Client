// @ts-nocheck
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const Store = require('electron-store');

const SETTINGS_KEY = 'remoteControl';
const DEFAULT_PORT = 42819;
const LOOPBACK_HOST = '127.0.0.1';
const ANY_HOST = '0.0.0.0';
const TOKEN_BYTES = 24;
const MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;

// Bumped whenever the stored config needs to be forced back to safe defaults.
// v1 shipped enabled-by-default on 0.0.0.0; those installs get disabled and re-tokened once.
const SECURITY_REVISION = 1;

const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60 * 1000;

function createToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function getLocalIpv4Addresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const infoList of Object.values(interfaces)) {
        for (const info of infoList || []) {
            if (!info) continue;
            if (info.family !== 'IPv4') continue;
            if (info.internal) continue;
            addresses.push(info.address);
        }
    }

    return Array.from(new Set(addresses));
}

function getOwnHostnames() {
    const names = new Set(['localhost', '127.0.0.1', '::1']);
    const interfaces = os.networkInterfaces();

    for (const infoList of Object.values(interfaces)) {
        for (const info of infoList || []) {
            if (!info?.address) continue;
            names.add(String(info.address).toLowerCase().split('%')[0]);
        }
    }

    return names;
}

function sanitizeConfig(config) {
    const rawPort = Number.parseInt(config?.port, 10);
    const port = Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535
        ? rawPort
        : DEFAULT_PORT;

    const token = typeof config?.token === 'string' && config.token.trim().length >= 16
        ? config.token.trim()
        : createToken();

    return {
        // Opt-in: the bridge exposes server consoles and files, so it stays off
        // until the user turns it on for a companion app.
        enabled: config?.enabled === true,
        // Binding beyond loopback is a second, separate decision.
        allowLan: config?.allowLan === true,
        port,
        token,
        securityRevision: SECURITY_REVISION
    };
}

function timingSafeEquals(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function jsonResponse(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(payload));
}

function parseAuthToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }

    return '';
}

function parseHostname(hostHeader) {
    if (!hostHeader) return '';

    if (hostHeader.startsWith('[')) {
        const end = hostHeader.indexOf(']');
        return end === -1 ? '' : hostHeader.slice(1, end).toLowerCase();
    }

    const colon = hostHeader.indexOf(':');
    return (colon === -1 ? hostHeader : hostHeader.slice(0, colon)).toLowerCase();
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            resolve({});
            return;
        }

        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE_BYTES) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }

            try {
                const bodyText = Buffer.concat(chunks).toString('utf8').trim();
                if (!bodyText) {
                    resolve({});
                    return;
                }
                resolve(JSON.parse(bodyText));
            } catch (error) {
                reject(new Error('Invalid JSON body'));
            }
        });

        req.on('error', (error) => reject(error));
    });
}

module.exports = (ipcMain, mainWindow) => {
    console.log('[RemoteControl] Registering remote control bridge...');

    const store = new Store();
    const storedConfig = store.get(SETTINGS_KEY, {});

    let config;
    if (storedConfig?.securityRevision !== SECURITY_REVISION) {
        // Pre-hardening installs had the bridge listening on every interface with a
        // token that was printed to the log, so that token is treated as burned.
        config = sanitizeConfig({ port: storedConfig?.port, enabled: false, allowLan: false });
        console.warn('[RemoteControl] Applying security defaults: bridge disabled, pairing token regenerated.');
    } else {
        config = sanitizeConfig(storedConfig);
    }
    store.set(SETTINGS_KEY, config);

    let server = null;
    const authFailures = new Map();

    const clientKey = (req) => req.socket?.remoteAddress || 'unknown';

    const isRateLimited = (req) => {
        const entry = authFailures.get(clientKey(req));
        if (!entry) return false;
        if (Date.now() > entry.resetAt) {
            authFailures.delete(clientKey(req));
            return false;
        }
        return entry.count >= AUTH_FAIL_LIMIT;
    };

    const recordAuthFailure = (req) => {
        const key = clientKey(req);
        const entry = authFailures.get(key);
        if (!entry || Date.now() > entry.resetAt) {
            authFailures.set(key, { count: 1, resetAt: Date.now() + AUTH_FAIL_WINDOW_MS });
            return;
        }
        entry.count += 1;
    };

    const invokeHandler = async (channel, args = []) => {
        const handlers = ipcMain?._invokeHandlers;
        if (!handlers || typeof handlers.get !== 'function' || !handlers.has(channel)) {
            throw new Error(`IPC handler not found: ${channel}`);
        }

        const event = {
            sender: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
        };

        return handlers.get(channel)(event, ...args);
    };

    const sendInvokeResult = (res, result) => {
        if (result && typeof result === 'object' && result.success === false) {
            jsonResponse(res, 400, {
                success: false,
                error: result.error || 'Operation failed',
                data: result
            });
            return;
        }

        jsonResponse(res, 200, {
            success: true,
            data: result
        });
    };

    // Rejects requests that reached us through an attacker-controlled DNS name
    // pointing at 127.0.0.1 (DNS rebinding).
    const isHostAllowed = (req) => {
        const hostname = parseHostname(req.headers.host || '');
        if (!hostname) return false;
        return getOwnHostnames().has(hostname);
    };

    const isAuthorized = (req) => {
        const token = parseAuthToken(req);
        return token.length > 0 && timingSafeEquals(token, config.token);
    };

    // Unauthenticated discovery payload. Deliberately holds nothing that
    // fingerprints the machine - no version, no interface addresses.
    const getDiscoveryInfo = () => ({
        app: 'LuxClient',
        remoteEnabled: config.enabled,
        requiresAuth: true
    });

    const getPrivateInfo = () => ({
        app: 'LuxClient',
        version: app.getVersion(),
        remoteEnabled: config.enabled,
        allowLan: config.allowLan,
        port: config.port,
        addresses: config.allowLan ? getLocalIpv4Addresses() : [],
        requiresAuth: true,
        timestamp: Date.now()
    });

    const handleRequest = async (req, res) => {
        if (req.method === 'OPTIONS') {
            // No CORS headers anywhere: the companion app is a native client and
            // browsers have no business reading these responses.
            jsonResponse(res, 403, { success: false, error: 'Cross-origin requests are not supported' });
            return;
        }

        if (!isHostAllowed(req)) {
            jsonResponse(res, 403, { success: false, error: 'Invalid host' });
            return;
        }

        const url = new URL(req.url || '/', 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean).map((entry) => decodeURIComponent(entry));

        if (parts[0] !== 'api' || parts[1] !== 'remote') {
            jsonResponse(res, 404, { success: false, error: 'Not found' });
            return;
        }

        if (req.method === 'GET' && parts[2] === 'ping') {
            jsonResponse(res, 200, { success: true, data: getDiscoveryInfo() });
            return;
        }

        if (isRateLimited(req)) {
            jsonResponse(res, 429, { success: false, error: 'Too many failed attempts' });
            return;
        }

        if (!isAuthorized(req)) {
            recordAuthFailure(req);
            jsonResponse(res, 401, { success: false, error: 'Unauthorized' });
            return;
        }

        const body = await readJsonBody(req);

        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'info') {
            jsonResponse(res, 200, { success: true, data: getPrivateInfo() });
            return;
        }

        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'session') {
            jsonResponse(res, 200, {
                success: true,
                data: {
                    ...getPrivateInfo(),
                    tokenHint: `${config.token.slice(0, 4)}...${config.token.slice(-4)}`
                }
            });
            return;
        }

        if (req.method === 'POST' && parts.length === 4 && parts[2] === 'session' && parts[3] === 'regenerate-token') {
            config = sanitizeConfig({ ...config, token: createToken() });
            store.set(SETTINGS_KEY, config);
            jsonResponse(res, 200, {
                success: true,
                data: {
                    token: config.token
                }
            });
            return;
        }

        if (req.method === 'PATCH' && parts.length === 4 && parts[2] === 'session' && parts[3] === 'enabled') {
            config = sanitizeConfig({ ...config, enabled: body.enabled === true });
            store.set(SETTINGS_KEY, config);
            jsonResponse(res, 200, { success: true, data: { enabled: config.enabled } });
            if (!config.enabled) {
                setImmediate(stopServer);
            }
            return;
        }

        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'instances') {
            const result = await invokeHandler('instance:get-all');
            sendInvokeResult(res, result);
            return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[2] === 'instances') {
            const result = await invokeHandler('instance:create', [{
                name: body.name,
                version: body.version,
                loader: body.loader,
                loaderVersion: body.loaderVersion,
                icon: body.icon,
                options: body.options
            }]);
            sendInvokeResult(res, result);
            return;
        }

        if (parts.length >= 4 && parts[2] === 'instances') {
            const instanceName = parts[3];

            if (req.method === 'PATCH' && parts.length === 4) {
                const result = await invokeHandler('instance:update', [instanceName, body.config || body]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'DELETE' && parts.length === 4) {
                const result = await invokeHandler('instance:delete', [instanceName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'launch') {
                const result = await invokeHandler('launcher:launch', [instanceName, !!body.quickPlay]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'stop') {
                const result = await invokeHandler('launcher:kill', [instanceName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'mods') {
                const result = await invokeHandler('instance:get-mods', [instanceName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 6 && parts[4] === 'mods' && parts[5] === 'toggle') {
                const fileName = String(body.fileName || '').trim();
                if (!fileName) {
                    jsonResponse(res, 400, { success: false, error: 'fileName is required' });
                    return;
                }
                const result = await invokeHandler('instance:toggle-mod', [instanceName, fileName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'DELETE' && parts.length === 5 && parts[4] === 'mods') {
                const fileName = String(url.searchParams.get('fileName') || body.fileName || '').trim();
                const type = String(url.searchParams.get('type') || body.type || 'mod').trim() || 'mod';
                if (!fileName) {
                    jsonResponse(res, 400, { success: false, error: 'fileName is required' });
                    return;
                }
                const result = await invokeHandler('instance:delete-mod', [instanceName, fileName, type]);
                sendInvokeResult(res, result);
                return;
            }
        }

        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'servers') {
            const result = await invokeHandler('server:get-all');
            sendInvokeResult(res, result);
            return;
        }

        if (parts.length >= 4 && parts[2] === 'servers') {
            const serverName = parts[3];

            if (req.method === 'GET' && parts.length === 4) {
                const result = await invokeHandler('server:get', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'start') {
                const result = await invokeHandler('server:start', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'stop') {
                const result = await invokeHandler('server:stop', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'restart') {
                const result = await invokeHandler('server:restart', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'status') {
                const result = await invokeHandler('server:get-status', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'stats') {
                const result = await invokeHandler('server:get-stats', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'logs') {
                const result = await invokeHandler('server:get-logs', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'command') {
                const command = String(body.command || '').trim();
                if (!command) {
                    jsonResponse(res, 400, { success: false, error: 'command is required' });
                    return;
                }
                const result = await invokeHandler('server:send-command', [serverName, command]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'mods') {
                const result = await invokeHandler('server:get-mods', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'DELETE' && parts.length === 5 && parts[4] === 'mods') {
                const fileName = String(url.searchParams.get('fileName') || body.fileName || '').trim();
                const type = String(url.searchParams.get('type') || body.type || 'mod').trim() || 'mod';
                if (!fileName) {
                    jsonResponse(res, 400, { success: false, error: 'fileName is required' });
                    return;
                }
                const result = await invokeHandler('server:delete-mod', [serverName, fileName, type]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'files') {
                const relativePath = String(url.searchParams.get('path') || body.path || '');
                const result = await invokeHandler('server:list-files', [serverName, relativePath]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'file') {
                const relativePath = String(url.searchParams.get('path') || body.path || '');
                if (!relativePath.trim()) {
                    jsonResponse(res, 400, { success: false, error: 'path is required' });
                    return;
                }
                const result = await invokeHandler('server:read-file', [serverName, relativePath]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'PUT' && parts.length === 5 && parts[4] === 'file') {
                const relativePath = String(body.path || '').trim();
                if (!relativePath) {
                    jsonResponse(res, 400, { success: false, error: 'path is required' });
                    return;
                }
                const result = await invokeHandler('server:write-file', [serverName, relativePath, body.content || '']);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'GET' && parts.length === 5 && parts[4] === 'plugin-configs') {
                const result = await invokeHandler('server:list-plugin-configs', [serverName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 5 && parts[4] === 'plugin-configs') {
                const pluginName = String(body.pluginName || '').trim();
                if (!pluginName) {
                    jsonResponse(res, 400, { success: false, error: 'pluginName is required' });
                    return;
                }
                const result = await invokeHandler('server:create-plugin-config', [serverName, pluginName]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'PUT' && parts.length === 6 && parts[4] === 'plugin-configs') {
                const configFile = parts[5];
                const nextConfig = body.config || body;
                const result = await invokeHandler('server:save-plugin-config', [serverName, configFile, nextConfig]);
                sendInvokeResult(res, result);
                return;
            }

            if (req.method === 'POST' && parts.length === 6 && parts[4] === 'plugins' && parts[5] === 'install-playit') {
                const result = await invokeHandler('server:install-playit', [serverName]);
                sendInvokeResult(res, result);
                return;
            }
        }

        if (req.method === 'POST' && parts.length === 4 && parts[2] === 'modpacks' && parts[3] === 'import-code') {
            const code = String(body.code || '').trim();
            if (!code) {
                jsonResponse(res, 400, { success: false, error: 'code is required' });
                return;
            }
            const result = await invokeHandler('modpack:import-code', [code]);
            sendInvokeResult(res, result);
            return;
        }

        if (req.method === 'POST' && parts.length === 4 && parts[2] === 'modpacks' && parts[3] === 'export-code') {
            const result = await invokeHandler('modpack:export-code', [body]);
            sendInvokeResult(res, result);
            return;
        }

        if (req.method === 'GET' && parts.length === 4 && parts[2] === 'modpacks' && parts[3] === 'codes') {
            const result = await invokeHandler('modpack:list-codes');
            sendInvokeResult(res, result);
            return;
        }

        if (req.method === 'DELETE' && parts.length === 5 && parts[2] === 'modpacks' && parts[3] === 'codes') {
            const code = String(parts[4] || '').trim();
            if (!code) {
                jsonResponse(res, 400, { success: false, error: 'code is required' });
                return;
            }
            const result = await invokeHandler('modpack:delete-code', [code]);
            sendInvokeResult(res, result);
            return;
        }

        if (req.method === 'POST' && parts.length === 4 && parts[2] === 'modpacks' && parts[3] === 'install-code') {
            const instanceName = String(body.instanceName || '').trim();
            const code = String(body.code || '').trim();

            if (!instanceName || !code) {
                jsonResponse(res, 400, { success: false, error: 'instanceName and code are required' });
                return;
            }

            const imported = await invokeHandler('modpack:import-code', [code]);
            if (!imported || imported.success === false || !imported.data) {
                jsonResponse(res, 400, {
                    success: false,
                    error: imported?.error || 'Code import failed',
                    data: imported
                });
                return;
            }

            const installed = await invokeHandler('modpack:install-shared-content', [{
                instanceName,
                modpackData: imported.data
            }]);

            sendInvokeResult(res, installed);
            return;
        }

        if (req.method === 'POST' && parts.length === 4 && parts[2] === 'modpacks' && parts[3] === 'install-payload') {
            const instanceName = String(body.instanceName || '').trim();
            const modpackData = body.modpackData;

            if (!instanceName || !modpackData || typeof modpackData !== 'object') {
                jsonResponse(res, 400, { success: false, error: 'instanceName and modpackData are required' });
                return;
            }

            const installed = await invokeHandler('modpack:install-shared-content', [{
                instanceName,
                modpackData
            }]);

            sendInvokeResult(res, installed);
            return;
        }

        jsonResponse(res, 404, { success: false, error: 'Route not found' });
    };

    const startServer = () => {
        if (server || !config.enabled) {
            return;
        }

        const host = config.allowLan ? ANY_HOST : LOOPBACK_HOST;

        server = http.createServer((req, res) => {
            handleRequest(req, res).catch((error) => {
                console.error('[RemoteControl] Request error:', error);
                if (!res.headersSent) {
                    jsonResponse(res, 500, {
                        success: false,
                        error: error?.message || 'Internal server error'
                    });
                }
            });
        });

        server.on('error', (error) => {
            console.error('[RemoteControl] Server error:', error);
        });

        server.listen(config.port, host, () => {
            console.log(`[RemoteControl] Listening on ${host}:${config.port}`);
            if (config.allowLan) {
                const addresses = getLocalIpv4Addresses();
                console.log(`[RemoteControl] Reachable from the local network: ${addresses.join(', ') || 'none'}`);
            }
            // The token is never logged - it is shown in the settings UI on request.
            console.log('[RemoteControl] Pairing token available in Settings.');
        });
    };

    const stopServer = () => {
        if (!server) return;
        server.close();
        server = null;
        authFailures.clear();
        console.log('[RemoteControl] Remote bridge stopped.');
    };

    const applyConfig = (next) => {
        config = sanitizeConfig(next);
        store.set(SETTINGS_KEY, config);
        stopServer();
        startServer();
        return config;
    };

    ipcMain.handle('remote:get-config', async () => ({
        success: true,
        data: {
            enabled: config.enabled,
            allowLan: config.allowLan,
            port: config.port,
            running: !!server,
            addresses: config.allowLan ? getLocalIpv4Addresses() : []
        }
    }));

    ipcMain.handle('remote:set-config', async (_event, next) => {
        const updated = applyConfig({
            ...config,
            enabled: next?.enabled === true,
            allowLan: next?.allowLan === true,
            port: next?.port
        });

        return {
            success: true,
            data: {
                enabled: updated.enabled,
                allowLan: updated.allowLan,
                port: updated.port,
                running: !!server,
                addresses: updated.allowLan ? getLocalIpv4Addresses() : []
            }
        };
    });

    // Kept separate from get-config so the token is only handed out when the
    // user explicitly asks to see or pair it.
    ipcMain.handle('remote:get-token', async () => ({ success: true, data: { token: config.token } }));

    ipcMain.handle('remote:regenerate-token', async () => {
        const updated = applyConfig({ ...config, token: createToken() });
        return { success: true, data: { token: updated.token } };
    });

    startServer();

    app.on('before-quit', () => {
        stopServer();
    });
};
