const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const Store = require('electron-store');

const SETTINGS_KEY = 'remoteControl';
const DEFAULT_PORT = 42819;
const DEFAULT_HOST = '0.0.0.0';
const TOKEN_BYTES = 24;
const MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;

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

function sanitizeConfig(config) {
    const rawPort = Number.parseInt(config?.port, 10);
    const port = Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535
        ? rawPort
        : DEFAULT_PORT;

    const token = typeof config?.token === 'string' && config.token.trim().length >= 16
        ? config.token.trim()
        : createToken();

    return {
        enabled: config?.enabled !== false,
        port,
        token
    };
}

function jsonResponse(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function parseAuthToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }

    return '';
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
    let config = sanitizeConfig(store.get(SETTINGS_KEY, {}));
    store.set(SETTINGS_KEY, config);

    let server = null;

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

    const setCorsHeaders = (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    };

    const isAuthorized = (req) => {
        const token = parseAuthToken(req);
        return token.length > 0 && token === config.token;
    };

    const getPublicInfo = () => ({
        app: 'LuxClient',
        version: app.getVersion(),
        remoteEnabled: config.enabled,
        port: config.port,
        addresses: getLocalIpv4Addresses(),
        requiresAuth: true,
        timestamp: Date.now()
    });

    const handleRequest = async (req, res) => {
        setCorsHeaders(res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || '/', 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean).map((entry) => decodeURIComponent(entry));

        if (parts[0] !== 'api' || parts[1] !== 'remote') {
            jsonResponse(res, 404, { success: false, error: 'Not found' });
            return;
        }

        if (req.method === 'GET' && (parts[2] === 'ping' || parts[2] === 'info')) {
            jsonResponse(res, 200, { success: true, data: getPublicInfo() });
            return;
        }

        if (!isAuthorized(req)) {
            jsonResponse(res, 401, { success: false, error: 'Unauthorized' });
            return;
        }

        const body = await readJsonBody(req);

        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'session') {
            jsonResponse(res, 200, {
                success: true,
                data: {
                    ...getPublicInfo(),
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
            config = sanitizeConfig({ ...config, enabled: body.enabled !== false });
            store.set(SETTINGS_KEY, config);
            jsonResponse(res, 200, { success: true, data: { enabled: config.enabled } });
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

        server = http.createServer((req, res) => {
            handleRequest(req, res).catch((error) => {
                console.error('[RemoteControl] Request error:', error);
                if (!res.headersSent) {
                    setCorsHeaders(res);
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

        server.listen(config.port, DEFAULT_HOST, () => {
            const addresses = getLocalIpv4Addresses();
            console.log(`[RemoteControl] Listening on ${DEFAULT_HOST}:${config.port}`);
            console.log(`[RemoteControl] Local network addresses: ${addresses.join(', ') || 'none'}`);
            console.log(`[RemoteControl] Pairing token: ${config.token}`);
        });
    };

    const stopServer = () => {
        if (!server) return;
        server.close();
        server = null;
        console.log('[RemoteControl] Remote bridge stopped.');
    };

    startServer();

    app.on('before-quit', () => {
        stopServer();
    });
};
