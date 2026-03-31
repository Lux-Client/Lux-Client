const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const axios = require('axios');
const { createWriteStream } = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const { getProcessStats } = require('../utils/process-utils');
const serverProcesses = new Map();
const serverStatsIntervals = new Map();

const serverStartTimes = new Map();

const serverConsoleBuffers = new Map();

function stripAnsi(text) {
    if (!text) return '';

    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    let clean = text.replace(ansiRegex, '');

    clean = clean.replace(/[┌┐└┘─│┤├┬┴┼═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬■●]/g, ' ');
    return clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function sanitizeFileName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

async function downloadServerJar(url, destination, serverName, mainWindow) {
    let writer = null;
    try {
        console.log(`[Servers] Downloading from URL: ${url}`);
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid download URL');
        }
        const parsedUrl = new URL(url);
        console.log(`[Servers] Parsed URL: ${parsedUrl.toString()}`);

        writer = createWriteStream(destination);
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Antigravity/MinecraftLauncher/1.0'
            },
            onDownloadProgress: (progressEvent) => {
                if (progressEvent.total) {
                    const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server:download-progress', {
                            serverName,
                            progress: percent,
                            loaded: progressEvent.loaded,
                            total: progressEvent.total
                        });
                    }
                }
            }
        });

        console.log(`[Servers] Response status: ${response.status}`);
        console.log(`[Servers] Response headers:`, response.headers);

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`[Servers] Download finished for ${serverName}`);
                resolve();
            });
            writer.on('error', (error) => {
                console.error(`[Servers] Write error:`, error);
                reject(error);
            });
        });
    } catch (error) {
        if (writer) {
            writer.close();
        }
        console.error('[Servers] Error in downloadServerJar:', error);
        if (error.response) {
            console.error('[Servers] Error response data:', error.response.data);
            console.error('[Servers] Error response status:', error.response.status);
            console.error('[Servers] Error response headers:', error.response.headers);
        } else if (error.request) {

            console.error('[Servers] Error request:', error.request);
        } else {

            console.error('[Servers] Error message:', error.message);
        }

        throw error;
    }
}
async function downloadPlayitPlugin(serverDir, software, version, serverName, mainWindow) {
    try {
        console.log(`[Servers] Checking Playit plugin for ${software} ${version}`);
        const loaderMap = {
            'paper': 'paper',
            'purpur': 'paper',
            'spigot': 'paper',
            'bukkit': 'paper',
            'folia': 'paper',
            'fabric': 'fabric',
            'forge': 'forge',
            'neoforge': 'neoforge',
            'quilt': 'quilt',
            'vanilla': 'vanilla'
        };

        const softwareLower = software.toLowerCase();
        let loader = loaderMap[softwareLower];
        if (!loader || loader === 'vanilla') {
            return false;
        }

        const projectId = 'og7kbNBC';
        const versionsResponse = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
            headers: { 'User-Agent': 'Antigravity/MinecraftLauncher/1.0' }
        });

        if (!versionsResponse.data || versionsResponse.data.length === 0) {
            console.log('[Servers] No versions found for Playit plugin');
            return false;
        }
        const isPaperLike = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'].includes(softwareLower);
        const targetLoaders = isPaperLike ? ['paper', 'spigot', 'bukkit'] : [loader.toLowerCase()];

        const matchingVersion = versionsResponse.data.find(v => {
            const supportsLoader = v.loaders.some(l =>
                targetLoaders.includes(l.toLowerCase())
            );
            const supportsGameVersion = v.game_versions.some(gv =>
                gv === version
            );

            return supportsLoader && supportsGameVersion;
        });

        if (!matchingVersion) {
            console.log(`[Servers] No Playit plugin version found for ${software} ${version}`);
            const anyLoaderVersion = versionsResponse.data.find(v =>
                v.loaders.some(l => l.toLowerCase() === loader.toLowerCase())
            );

            if (anyLoaderVersion) {
                console.log(`[Servers] Found Playit plugin for ${software} but not for version ${version}. Supported versions: ${anyLoaderVersion.game_versions.join(', ')}`);
            }

            return false;
        }
        const primaryFile = matchingVersion.files.find(f => f.primary) || matchingVersion.files[0];

        if (!primaryFile) {
            console.log('[Servers] No download file found for Playit plugin');
            return false;
        }

        console.log(`[Servers] Downloading Playit plugin v${matchingVersion.version_number} for ${software} ${version}`);
        let pluginDir;
        if (['fabric', 'forge', 'neoforge', 'quilt'].includes(softwareLower)) {

            pluginDir = path.join(serverDir, 'mods');
            console.log(`[Servers] Using mods folder for ${software} (mod loader)`);
        } else {

            pluginDir = path.join(serverDir, 'plugins');
            console.log(`[Servers] Using plugins folder for ${software} (plugin-based)`);
        }

        await fs.ensureDir(pluginDir);

        const pluginPath = path.join(pluginDir, primaryFile.filename);
        if (await fs.pathExists(pluginPath)) {
            console.log(`[Servers] Plugin already exists at ${pluginPath}, skipping download`);
            return true;
        }
        const writer = createWriteStream(pluginPath);
        const response = await axios({
            method: 'get',
            url: primaryFile.url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Antigravity/MinecraftLauncher/1.0'
            }
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log(`[Servers] Playit plugin downloaded successfully: ${primaryFile.filename}`);

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server:console', {
                serverName,
                log: `[INFO] Playit Companion plugin v${matchingVersion.version_number} installed automatically`
            });
        }

        return true;
    } catch (error) {
        console.error('[Servers] Error downloading Playit plugin:', error);
        return false;
    }
}
async function updateServerConfig(serverName, updates) {
    try {
        const serversDir = path.join(app.getPath('userData'), 'servers');
        const safeName = sanitizeFileName(serverName);
        const configPath = path.join(serversDir, safeName, 'server.json');

        if (await fs.pathExists(configPath)) {
            const config = await fs.readJson(configPath);
            Object.assign(config, updates);
            await fs.writeJson(configPath, config, { spaces: 2 });
            return config;
        }
    } catch (error) {
        console.error(`Error updating server config for ${serverName}:`, error);
    }
    return null;
}
async function getServerConfig(serverName) {
    try {
        const serversDir = path.join(app.getPath('userData'), 'servers');
        const safeName = sanitizeFileName(serverName);
        const configPath = path.join(serversDir, safeName, 'server.json');

        if (!await fs.pathExists(configPath)) return null;

        const config = await fs.readJson(configPath);

        const proc = serverProcesses.get(serverName);
        if (proc && !proc.killed) {
            config.status = 'running';
        }

        return config;
    } catch (error) {
        return null;
    }
}
function startServerStatsCollection(serverName, process, mainWindow) {

    if (serverStatsIntervals.has(serverName)) {
        clearInterval(serverStatsIntervals.get(serverName));
    }

    const interval = setInterval(async () => {
        try {
            if (!process || process.killed) {
                return;
            }
            const stats = await getProcessStats(process.pid);
            const startTime = serverStartTimes.get(serverName) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const consoleBuffer = serverConsoleBuffers.get(serverName) || [];
            let players = [];
            for (let i = consoleBuffer.length - 1; i >= 0; i--) {
                const line = consoleBuffer[i];
                if (line.includes('players online:')) {
                    const match = line.match(/(\d+)\/.*players online:/);
                    if (match) {
                        players = Array(parseInt(match[0])).fill('Player').map((p, i) => `${p}${i + 1}`);
                    }
                    break;
                }
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:stats', {
                    serverName,
                    cpu: stats.cpu,
                    memory: stats.memory,
                    uptime: uptime,
                    players: players
                });
            }
        } catch (error) {
            console.error(`Error collecting stats for ${serverName}:`, error);
        }
    }, 2000);

    serverStatsIntervals.set(serverName, interval);
}

module.exports = (ipcMain, mainWindow) => {
    console.log('[Servers] Setting up server handlers...');

    const PLUGIN_CONFIG_DIR = 'plugin-configs';
    const MOD_CONFIG_DIR = 'mod-configs';
    const MOD_CONFIG_SOFTWARE = new Set([
        'forge',
        'neoforge',
        'fabric',
        'quilt',
        'magma',
        'mohist',
        'arclight',
        'ketting',
        'spongeforge',
        'catserver'
    ]);

    function normalizePluginName(name) {
        return String(name || '')
            .replace(/\.jar$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    function sanitizePluginConfigFileName(name) {
        return String(name || '')
            .replace(/\.jar$/i, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase() || 'plugin';
    }

    function escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function toInlineYamlValue(value) {
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        if (value === null || value === undefined) {
            return '""';
        }

        const textValue = String(value);
        if (textValue.length === 0) {
            return '""';
        }

        if (/^[a-zA-Z0-9_.-]+$/.test(textValue)) {
            return textValue;
        }

        return JSON.stringify(textValue);
    }

    function applyFieldsToYaml(yamlText, fields) {
        const normalizedText = String(yamlText || '').replace(/\r\n/g, '\n');
        let updatedText = normalizedText;

        for (const field of fields) {
            if (!field || typeof field.key !== 'string' || field.key.trim().length === 0) {
                continue;
            }

            const key = field.key.trim();
            const nextValue = toInlineYamlValue(field.value);
            const keyPattern = new RegExp(`^(\\s*${escapeRegex(key)}\\s*:\\s*)([^#\\n]*)(\\s*(?:#.*)?)$`, 'm');

            if (keyPattern.test(updatedText)) {
                updatedText = updatedText.replace(keyPattern, (_, prefix, __oldValue, suffix = '') => `${prefix}${nextValue}${suffix}`);
            } else {
                updatedText += `${updatedText.endsWith('\n') ? '' : '\n'}${key}: ${nextValue}\n`;
            }
        }

        return updatedText;
    }

    async function resolveConfigTarget(serverDir) {
        const configPath = path.join(serverDir, 'server.json');
        let software = 'vanilla';

        try {
            if (await fs.pathExists(configPath)) {
                const serverConfig = await fs.readJson(configPath);
                software = String(serverConfig?.software || 'vanilla').toLowerCase();
            }
        } catch (_) {
            software = 'vanilla';
        }

        const isModServer = MOD_CONFIG_SOFTWARE.has(software);
        return {
            type: isModServer ? 'mod' : 'plugin',
            sourceDir: path.join(serverDir, isModServer ? 'mods' : 'plugins'),
            configDir: path.join(serverDir, isModServer ? MOD_CONFIG_DIR : PLUGIN_CONFIG_DIR)
        };
    }

    async function resolveBundledConfigSchemaDir() {
        const candidates = [
            path.join(process.cwd(), 'src', 'data'),
            path.join(__dirname, '..', '..', 'src', 'data'),
            path.join(app.getAppPath(), 'src', 'data'),
            path.join(app.getAppPath(), 'dist', 'data')
        ];

        for (const candidate of candidates) {
            if (await fs.pathExists(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    function buildDefaultPluginConfig(pluginName) {
        return {
            pluginName,
            displayName: pluginName,
            fields: [
                {
                    key: 'example_number',
                    label: 'Example Number',
                    type: 'number',
                    value: 1
                },
                {
                    key: 'example_text',
                    label: 'Example Text',
                    type: 'text',
                    value: ''
                },
                {
                    key: 'example_mode',
                    label: 'Example Mode',
                    type: 'select',
                    options: ['option_a', 'option_b'],
                    value: 'option_a'
                }
            ]
        };
    }

    function validatePluginConfig(config) {
        if (!config || typeof config !== 'object') {
            return { valid: false, error: 'Invalid config payload' };
        }
        if (!Array.isArray(config.fields)) {
            return { valid: false, error: 'Config must contain a fields array' };
        }

        for (const field of config.fields) {
            if (!field || typeof field !== 'object') {
                return { valid: false, error: 'Each field must be an object' };
            }
            if (!field.key || !field.label || !field.type) {
                return { valid: false, error: 'Each field requires key, label and type' };
            }
            if (!['text', 'number', 'select', 'boolean'].includes(field.type)) {
                return { valid: false, error: `Unsupported field type: ${field.type}` };
            }
            if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0)) {
                return { valid: false, error: `Select field ${field.key} requires options` };
            }
        }

        return { valid: true };
    }

    ipcMain.handle('server:check-eula', async (event, serverName) => {
        try {
            console.log(`[Servers] Checking EULA for ${serverName}`);

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const eulaPath = path.join(serverDir, 'eula.txt');

            if (!await fs.pathExists(eulaPath)) {
                console.log(`[Servers] eula.txt not found for ${serverName}`);
                return false;
            }

            const eulaContent = await fs.readFile(eulaPath, 'utf-8');
            const eulaAccepted = eulaContent.includes('eula=true');

            console.log(`[Servers] EULA for ${serverName} is ${eulaAccepted ? 'accepted' : 'not accepted'}`);

            return eulaAccepted;
        } catch (error) {
            console.error(`[Servers] Error checking EULA for ${serverName}:`, error);
            return false;
        }
    });

    ipcMain.handle('server:accept-eula', async (event, serverName) => {
        try {
            console.log(`[Servers] Accepting EULA for ${serverName}`);

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const eulaPath = path.join(serverDir, 'eula.txt');

            const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
#${new Date().toISOString()}
eula=true
`;
            await fs.writeFile(eulaPath, eulaContent);

            console.log(`[Servers] EULA accepted for ${serverName}`);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:console', {
                    serverName,
                    log: '[INFO] Minecraft EULA accepted'
                });
            }

            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error accepting EULA for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:get-all', async () => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            await fs.ensureDir(serversDir);

            const dirs = await fs.readdir(serversDir);
            const servers = [];

            for (const dir of dirs) {
                const configPath = path.join(serversDir, dir, 'server.json');
                if (await fs.pathExists(configPath)) {
                    try {
                        let config = await fs.readJson(configPath);
                        let needsUpdate = false;
                        const activeProc = serverProcesses.get(config.name);
                        if (activeProc && !activeProc.killed) {
                            if (config.status !== 'running') {
                                config.status = 'running';
                                needsUpdate = true;
                            }
                        } else {
                            if (config.status !== 'downloading' && config.status !== 'installing') {
                                if (config.status !== 'stopped') {
                                    config.status = 'stopped';
                                    needsUpdate = true;
                                }
                            }
                            config.pid = null;
                        }
                        if (needsUpdate) {
                            await fs.writeJson(configPath, config, { spaces: 4 });
                        }

                        servers.push(config);
                    } catch (err) {
                        console.error(`Error reading/updating server config for ${dir}:`, err);
                    }
                }
            }

            return servers;
        } catch (error) {
            console.error('Error getting servers:', error);
            return [];
        }
    });

    app.on('before-quit', (e) => {
        console.log('[Servers] App quitting, cleaning up processes...');

        for (const [name, proc] of serverProcesses.entries()) {
            if (proc && !proc.killed) {
                console.log(`[Servers] Force killing server ${name} before quit`);
                if (process.platform === 'win32') {

                    try {
                        require('child_process').execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
                    } catch (err) {
                        console.error(`Failed to kill process ${proc.pid}:`, err);
                    }
                } else {
                    proc.kill('SIGKILL');
                }
            }
        }
    });
    ipcMain.handle('server:get-console', async (event, serverName) => {
        try {

            const buffer = serverConsoleBuffers.get(serverName) || [];
            if (buffer.length > 0) {
                return buffer;
            }
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const logPath = path.join(serverDir, 'logs', 'latest.log');

            if (await fs.pathExists(logPath)) {
                const log = await fs.readFile(logPath, 'utf-8');
                const lines = log.split('\n').filter(line => line.trim()).slice(-100);
                serverConsoleBuffers.set(serverName, lines);

                return lines;
            }

            return [];
        } catch (error) {
            console.error('[Servers] Error getting console:', error);
            return [];
        }
    });
    ipcMain.handle('server:get-logs', async (event, serverName) => {
        try {
            const buffer = serverConsoleBuffers.get(serverName) || [];
            if (buffer.length > 0) return buffer;

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const logPath = path.join(serversDir, safeName, 'logs', 'latest.log');

            if (await fs.pathExists(logPath)) {
                const log = await fs.readFile(logPath, 'utf-8');
                const lines = log.split('\n').filter(line => line.trim()).slice(-100);
                serverConsoleBuffers.set(serverName, lines);
                return lines;
            }
            return [];
        } catch (error) {
            console.error('[Servers] Error getting logs:', error);
            return [];
        }
    });
    ipcMain.handle('server:get-stats', async (event, serverName) => {
        try {
            const process = serverProcesses.get(serverName);
            if (!process || process.killed) {
                return {
                    cpu: 0,
                    memory: 0,
                    uptime: 0,
                    players: []
                };
            }

            const stats = await getProcessStats(process.pid);
            const startTime = serverStartTimes.get(serverName) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);

            return {
                cpu: stats.cpu,
                memory: stats.memory,
                uptime: uptime,
                players: []
            };
        } catch (error) {
            console.error('[Servers] Error getting stats:', error);
            return {
                cpu: 0,
                memory: 0,
                uptime: 0,
                players: []
            };
        }
    });
    ipcMain.handle('server:send-command', async (event, serverName, command) => {
        try {
            const process = serverProcesses.get(serverName);
            if (!process || !process.stdin) {
                throw new Error('Server is not running');
            }
            const cleanCommand = command.startsWith('/') ? command.substring(1) : command;
            process.stdin.write(cleanCommand + '\n');
            const buffer = serverConsoleBuffers.get(serverName) || [];
            buffer.push(`> ${command}`);
            if (buffer.length > 500) buffer.shift();
            serverConsoleBuffers.set(serverName, buffer);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:console', {
                    serverName,
                    log: `> ${command}`
                });
            }

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error sending command:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:save-logs', async (event, serverName, logs) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(serverDir, 'logs', `export-${timestamp}.log`);

            await fs.ensureDir(path.join(serverDir, 'logs'));

            const logText = logs.join('\n');
            await fs.writeFile(logPath, logText);

            return { success: true, path: logPath };
        } catch (error) {
            console.error('[Servers] Error saving logs:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:create', async (event, data) => {
        let serverDir = null;
        try {
            console.log('[Servers] Received server data:', JSON.stringify(data, null, 2));

            if (!data || typeof data !== 'object') {
                throw new Error('Invalid server data');
            }

            const {
                name,
                version,
                software,
                port,
                maxPlayers,
                memory,
                icon,
                downloadUrl
            } = data;

            if (!name || !version || !software) {
                throw new Error('Missing required fields: name, version, or software');
            }

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = data && data.safeName ? sanitizeFileName(data.safeName) : sanitizeFileName(name);
            serverDir = path.join(serversDir, safeName);

            const isProxy = software === 'bungeecord' || software === 'velocity';

            await fs.ensureDir(serverDir);
            await fs.ensureDir(path.join(serverDir, 'logs'));
            await fs.ensureDir(path.join(serverDir, 'plugins'));

            if (!isProxy) {
                await fs.ensureDir(path.join(serverDir, 'mods'));
            }

            const serverConfig = {
                name: name,
                safeName: safeName,
                version: version,
                software: software,
                port: parseInt(port) || 25565,
                maxPlayers: parseInt(maxPlayers) || 20,
                memory: parseInt(memory) || 1024,
                icon: icon || null,
                created: new Date().toISOString(),
                status: 'stopped',
                pid: null,
                path: serverDir,
                playitPluginInstalled: false
            };

            await fs.writeJson(path.join(serverDir, 'server.json'), serverConfig, { spaces: 2 });

            if (!isProxy) {
                const serverProperties = `#Minecraft server properties
#${new Date().toISOString()}
server-port=${port || 25565}
max-players=${maxPlayers || 20}
motd=A Minecraft Server
online-mode=true
`;

                await fs.writeFile(path.join(serverDir, 'server.properties'), serverProperties);

                const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
#${new Date().toISOString()}
eula=false
`;
                await fs.writeFile(path.join(serverDir, 'eula.txt'), eulaContent);
            } else if (software === 'bungeecord') {
                const bungeecordConfig = `
groups:
  md_5:
  - admin
stats: ${require('crypto').randomBytes(16).toString('hex')}
permissions:
  default:
  - bungeecord.command.server
  - bungeecord.command.list
  admin:
  - bungeecord.command.alert
  - bungeecord.command.end
  - bungeecord.command.ip
  - bungeecord.command.reload
listeners:
- query_port: ${port || 25577}
  motd: '&1Another BungeeCord Server'
  tab_list: GLOBAL_PING
  query_enabled: false
  proxy_protocol: false
  forced_hosts:
    pvp.md-5.net: pvp
  ping_passthrough: false
  priorities:
  - lobby
  bind_local_address: true
  host: 0.0.0.0:${port || 25577}
  max_players: ${maxPlayers || 20}
  tab_size: 60
  force_default_server: false
prevent_proxy_connections: false
timeout: 30000
connection_throttle: 4000
connection_throttle_limit: 3
servers:
  lobby:
    motd: '&1Example Lobby Server'
    address: localhost:25565
    restricted: false
ip_forward: false
online_mode: true
log_commands: false
disabled_commands:
- disabledcommandhere
log_pings: true
`;
                await fs.writeFile(path.join(serverDir, 'config.yml'), bungeecordConfig);
            } else if (software === 'velocity') {
                const velocityConfig = `# Config version. Do not change this.
config-version = "1.0"

[server]
# What port should the proxy be bound to? By default, we'll use 25577.
bind = "0.0.0.0:${port || 25577}"

# What should be display name for this proxy?
motd = "&bA Velocity Server"

# What is the maximum number of players the proxy can hold?
show-max-players = ${maxPlayers || new Date().getFullYear()}

# Should we authenticate players with Mojang?
online-mode = true

# Should we forward the player's IP address and UUID to the backend server?
# IMPORTANT: This requires the backend server to be configured for Velocity's forwarding protocol!
# See https://docs.papermc.io/velocity/security for more information.
force-key-authentication = true

# If a server has an issue, can players retry?
retry-attempts = 3
retry-delay = "2s"

# Enable the messages defined in messages.toml
enable-messages = false

# The fallback server that players will be connected to if no server in the player's priority list is available.
# If this is not specified, the player will be disconnected if no servers are available.
fallback-server = "lobby"

# How large the player list can be at any time.
# max-players is used for the initial handshake, so players beyond this limit will still be able to join if Mojang is down.
# However, if the server is full and Mojang is also down, players will be disconnected.
# Set this to the number of players you want on the proxy at any time.
# Setting this to 0 will display the player's player count as the player's online count (default Velocity behavior).
# By setting this to a non-zero value, Velocity will show this as the proxy's player count.
player-info-forwarding-mode = "LEGACY"
# Supports "NONE", "LEGACY", "BUNGEEGUARD", "MODERN", "VELOCITY_1_19_4" and "HYBRID"
# See https://docs.papermc.io/velocity/security for more information.

# What should we do with Minecraft protocol compatible clients?
# Supports "LIMIT", "LOG", "KICK"
minecraft-forwarding-mode = "NONE"

# Enable the built-in commands
commands {
    enabled = true
}

[servers]
# Configure your servers here.
# You MUST define at least one server here.
# Format: server_name = ip:port
lobby = "127.0.0.1:25565"

[forced-hosts]
# Configure forced hosts here.
# Format: domain = server_name
# Example: pvp.example.com = "pvp"

[advanced]
# How large the player list can be at any time.
compression = "automatic"
# How the compression threshold should be applied.
read-timeout = "30s"
# The read timeout for connections.
write-timeout = "30s"
# The write timeout for connections.
# The connection timeout for connections.
# Specify a custom Java runtime path here.
# jvm-path = "java"
# Additional JVM arguments to pass to the proxy.
# jvm-args = "-Xmx4G -Xms4G"

[query]
# Whether to enable Gamedig-compatible query.
enabled = false
port = ${port || 25577}
map = "Velocity"
show-plugins = false
`;
                await fs.writeFile(path.join(serverDir, 'velocity.toml'), velocityConfig);
            }
            if (downloadUrl) {
                const jarPath = path.join(serverDir, 'server.jar');

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:status', {
                        serverName: name,
                        status: 'downloading'
                    });
                }

                console.log(`[Servers] Downloading server jar from: ${downloadUrl}`);

                try {
                    await downloadServerJar(downloadUrl, jarPath, name, mainWindow);
                    console.log(`[Servers] Server jar downloaded successfully for ${name}`);
                } catch (downloadError) {
                    console.error(`[Servers] Failed to download server jar:`, downloadError);

                    if (await fs.pathExists(serverDir)) {
                        console.log(`[Servers] Cleaning up failed server installation at ${serverDir}`);
                        await fs.remove(serverDir);
                    }

                    throw new Error(`Failed to download server jar: ${downloadError.message}`);
                }
                try {
                    const pluginInstalled = await downloadPlayitPlugin(serverDir, software, version, name, mainWindow);
                    if (pluginInstalled) {
                        serverConfig.playitPluginInstalled = true;
                        await fs.writeJson(path.join(serverDir, 'server.json'), serverConfig, { spaces: 2 });

                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('server:console', {
                                serverName: name,
                                log: '[INFO] Playit Companion plugin installed successfully'
                            });
                        }
                    }
                } catch (pluginError) {

                }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:status', {
                        serverName: name,
                        status: 'ready'
                    });
                }
            } else {
                console.warn(`[Servers] No downloadUrl provided for ${software} ${version}`);
            }

            return { success: true, serverName: name };
        } catch (error) {
            console.error('[Servers] Error creating server:', error);
            console.error('[Servers] Error stack:', error.stack);

            if (serverDir && await fs.pathExists(serverDir)) {
                console.log(`[Servers] Cleaning up failed server installation at ${serverDir}`);
                try {
                    await fs.remove(serverDir);
                } catch (cleanupError) {
                    console.error('[Servers] Failed to clean up server directory:', cleanupError);
                }
            }

            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:delete', async (event, name) => {
        try {
            const process = serverProcesses.get(name);
            if (process && !process.killed) {
                process.kill();
                serverProcesses.delete(name);
                serverStartTimes.delete(name);
                serverConsoleBuffers.delete(name);
            }

            if (serverStatsIntervals.has(name)) {
                clearInterval(serverStatsIntervals.get(name));
                serverStatsIntervals.delete(name);
            }

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(name);
            const serverDir = path.join(serversDir, safeName);

            if (await fs.pathExists(serverDir)) {
                await fs.remove(serverDir);
            }
            return { success: true };
        } catch (error) {
            console.error('[Servers] Error deleting server:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:start', async (event, name) => {
        return await startServerInternal(name, mainWindow);
    });

    async function startServerInternal(name, mainWindow) {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(name);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');
            const jarPath = path.join(serverDir, 'server.jar');
            const eulaPath = path.join(serverDir, 'eula.txt');

            if (!await fs.pathExists(configPath)) {
                throw new Error('Server configuration not found');
            }

            if (!await fs.pathExists(jarPath)) {
                throw new Error('Server jar not found');
            }
            if (await fs.pathExists(eulaPath)) {
                const eulaContent = await fs.readFile(eulaPath, 'utf-8');
                if (!eulaContent.includes('eula=true')) {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server:eula-required', { serverName: name });
                    }
                    throw new Error('EULA not accepted');
                }
            } else {
                const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
#${new Date().toISOString()}
eula=false
`;
                await fs.writeFile(eulaPath, eulaContent);

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:eula-required', { serverName: name });
                }
                throw new Error('EULA not accepted');
            }

            const config = await fs.readJson(configPath);

            if (serverProcesses.has(name) && !serverProcesses.get(name).killed) {
                throw new Error('Server is already running');
            }
            serverConsoleBuffers.set(name, []);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:status', { serverName: name, status: 'starting' });
            }

            config.status = 'starting';
            await fs.writeJson(configPath, config, { spaces: 2 });

            const javaPath = 'java';
            const javaArgs = [
                `-Xms${config.memory}M`,
                `-Xmx${config.memory}M`,
                '-jar',
                'server.jar',
                'nogui'
            ];

            console.log(`[Servers] Starting server ${name} with: ${javaPath} ${javaArgs.join(' ')}`);

            const serverProcess = spawn(javaPath, javaArgs, {
                cwd: serverDir,
                detached: false,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            serverProcesses.set(name, serverProcess);
            serverStartTimes.set(name, Date.now());

            const rl = readline.createInterface({
                input: serverProcess.stdout,
                output: null
            });

            rl.on('line', (line) => {
                console.log(`[${name}] ${line}`);
                const buffer = serverConsoleBuffers.get(name) || [];
                buffer.push(line);
                if (buffer.length > 500) buffer.shift();
                serverConsoleBuffers.set(name, buffer);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:console', {
                        serverName: name,
                        log: line
                    });
                }
                if ((line.includes('Done') && line.includes('For help, type "help"')) ||
                    line.includes('Listening on /0.0.0.0:') ||
                    line.includes('Enabled BungeeCord version')) {
                    updateServerConfig(name, { status: 'running' }).then(updatedConfig => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('server:status', {
                                serverName: name,
                                status: 'running',
                                server: updatedConfig
                            });
                        }
                    });
                }
            });

            serverProcess.stderr.on('data', (data) => {
                const line = data.toString();
                console.error(`[${name} ERROR] ${line}`);

                const buffer = serverConsoleBuffers.get(name) || [];
                buffer.push(`[ERROR] ${line}`);
                if (buffer.length > 500) buffer.shift();
                serverConsoleBuffers.set(name, buffer);

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:console', {
                        serverName: name,
                        log: `[ERROR] ${line}`
                    });
                }
            });

            serverProcess.on('exit', async (code, signal) => {
                console.log(`[Servers] Server ${name} exited with code ${code}, signal ${signal}`);

                serverProcesses.delete(name);
                serverStartTimes.delete(name);

                if (serverStatsIntervals.has(name)) {
                    clearInterval(serverStatsIntervals.get(name));
                    serverStatsIntervals.delete(name);
                }
                const buffer = serverConsoleBuffers.get(name) || [];
                buffer.push(`[INFO] Server stopped (exit code: ${code})`);
                serverConsoleBuffers.set(name, buffer);

                const updatedConfig = await updateServerConfig(name, { status: 'stopped', pid: null });
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:status', {
                        serverName: name,
                        status: 'stopped',
                        server: updatedConfig
                    });
                    mainWindow.webContents.send('server:console', {
                        serverName: name,
                        log: '[INFO] Server stopped'
                    });
                }
            });

            serverProcess.on('error', async (err) => {
                console.error(`[Servers] Error starting server ${name}:`, err);

                serverProcesses.delete(name);
                serverStartTimes.delete(name);

                if (serverStatsIntervals.has(name)) {
                    clearInterval(serverStatsIntervals.get(name));
                    serverStatsIntervals.delete(name);
                }

                const buffer = serverConsoleBuffers.get(name) || [];
                buffer.push(`[ERROR] ${err.message}`);
                serverConsoleBuffers.set(name, buffer);

                updateServerConfig(name, { status: 'stopped', pid: null });

                if (mainWindow && !mainWindow.isDestroyed()) {
                    const serverObj = await getServerConfig(name);
                    mainWindow.webContents.send('server:status', {
                        serverName: name,
                        status: 'error',
                        error: err.message,
                        server: serverObj
                    });
                }
            });

            startServerStatsCollection(name, serverProcess, mainWindow);
            return { success: true };
        } catch (error) {
            console.error('[Servers] Error starting server:', error);

            try {
                await updateServerConfig(name, { status: 'stopped' });
            } catch (e) {
                console.error('Error updating config after failed start:', e);
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                const serverObj = await getServerConfig(name);
                mainWindow.webContents.send('server:status', {
                    serverName: name,
                    status: 'error',
                    error: error.message,
                    server: serverObj
                });
            }
            return { success: false, error: error.message };
        }
    }
    ipcMain.handle('server:stop', async (event, name) => {
        return await stopServerInternal(name, mainWindow);
    });

    async function stopServerInternal(name, mainWindow) {
        try {
            const process = serverProcesses.get(name);

            if (!process || process.killed) {
                const configPath = path.join(app.getPath('userData'), 'servers', sanitizeFileName(name), 'server.json');
                if (await fs.pathExists(configPath)) {
                    await updateServerConfig(name, { status: 'stopped', pid: null });
                }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server:status', {
                        serverName: name,
                        status: 'stopped'
                    });
                }

                return { success: true, message: 'Server not running' };
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:status', { serverName: name, status: 'stopping' });
            }

            const buffer = serverConsoleBuffers.get(name) || [];
            buffer.push('[INFO] Stopping server...');
            serverConsoleBuffers.set(name, buffer);

            if (process.stdin) {
                process.stdin.write('stop\n');

                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        if (serverProcesses.has(name) && !serverProcesses.get(name).killed) {
                            console.log(`[Servers] Force killing ${name} (timed out)`);
                            if (require('os').platform() === 'win32') {
                                try {
                                    require('child_process').execSync(`taskkill /F /T /PID ${process.pid}`);
                                } catch (e) { }
                            } else {
                                process.kill('SIGKILL');
                            }
                        }
                        resolve();
                    }, 10000);

                    process.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            } else {
                if (require('os').platform() === 'win32') {
                    try {
                        require('child_process').execSync(`taskkill /F /T /PID ${process.pid}`);
                    } catch (e) { }
                } else {
                    process.kill('SIGKILL');
                }
            }

            if (serverStatsIntervals.has(name)) {
                clearInterval(serverStatsIntervals.get(name));
                serverStatsIntervals.delete(name);
            }
            await updateServerConfig(name, { status: 'stopped', pid: null });

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:status', {
                    serverName: name,
                    status: 'stopped'
                });
            }

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error stopping server:', error);
            return { success: false, error: error.message };
        }
    }
    ipcMain.handle('server:restart', async (event, name) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:status', { serverName: name, status: 'restarting' });
            }

            const buffer = serverConsoleBuffers.get(name) || [];
            buffer.push('[INFO] Restarting server...');
            serverConsoleBuffers.set(name, buffer);
            await stopServerInternal(name, mainWindow);

            await new Promise(resolve => setTimeout(resolve, 2000));
            return await startServerInternal(name, mainWindow);
        } catch (error) {
            console.error('[Servers] Error restarting server:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:open-folder', async (event, name) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(name);
            const serverDir = path.join(serversDir, safeName);

            if (await fs.pathExists(serverDir)) {
                const { shell } = require('electron');
                shell.openPath(serverDir);
            }

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error opening server folder:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:import', async () => {
        try {
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                title: 'Select Server Folder'
            });

            if (result.canceled) {
                return { success: false, error: 'Cancelled' };
            }

            const serverPath = result.filePaths[0];
            const serverName = path.basename(serverPath);

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const destPath = path.join(serversDir, safeName);

            await fs.copy(serverPath, destPath);

            const configPath = path.join(destPath, 'server.json');
            if (!await fs.pathExists(configPath)) {
                const serverConfig = {
                    name: serverName,
                    safeName: safeName,
                    version: 'unknown',
                    software: 'unknown',
                    port: 25565,
                    maxPlayers: 20,
                    memory: 1024,
                    icon: null,
                    created: new Date().toISOString(),
                    status: 'stopped',
                    pid: null,
                    path: destPath,
                    playitPluginInstalled: false
                };
                await fs.writeJson(configPath, serverConfig, { spaces: 2 });
            }

            return { success: true, serverName: serverName };
        } catch (error) {
            console.error('[Servers] Error importing server:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:duplicate', async (event, name) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(name);
            const sourceDir = path.join(serversDir, safeName);

            if (!await fs.pathExists(sourceDir)) {
                throw new Error('Source server not found');
            }

            let newName = `${name} Copy`;
            let newSafeName = sanitizeFileName(newName);
            let counter = 1;

            while (await fs.pathExists(path.join(serversDir, newSafeName))) {
                counter++;
                newName = `${name} Copy ${counter}`;
                newSafeName = sanitizeFileName(newName);
            }

            const destDir = path.join(serversDir, newSafeName);
            await fs.copy(sourceDir, destDir);

            const configPath = path.join(destDir, 'server.json');
            if (await fs.pathExists(configPath)) {
                const config = await fs.readJson(configPath);
                config.name = newName;
                config.safeName = newSafeName;
                config.created = new Date().toISOString();
                config.status = 'stopped';
                config.pid = null;
                await fs.writeJson(configPath, config, { spaces: 2 });
            }

            return { success: true, serverName: newName };
        } catch (error) {
            console.error('[Servers] Error duplicating server:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:backup', async (event, name) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(name);
            const serverDir = path.join(serversDir, safeName);

            if (!await fs.pathExists(serverDir)) {
                throw new Error('Server not found');
            }

            const backupsDir = path.join(app.getPath('userData'), 'backups', 'servers', safeName);
            await fs.ensureDir(backupsDir);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `${name}-${timestamp}`;
            const backupPath = path.join(backupsDir, backupName);

            await fs.copy(serverDir, backupPath);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:backup-progress', {
                    serverName: name,
                    progress: 100,
                    complete: true
                });
            }

            return { success: true, path: backupPath };
        } catch (error) {
            console.error('[Servers] Error backing up server:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:download-software', async (event, data) => {
        try {
            const { platform, version, downloadUrl } = data;

            const downloadsDir = app.getPath('downloads');
            const jarPath = path.join(downloadsDir, `${platform}-${version}.jar`);

            await downloadServerJar(downloadUrl, jarPath, `${platform} ${version}`, mainWindow);

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error downloading software:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:clear-console', async (event, serverName) => {
        try {
            serverConsoleBuffers.set(serverName, []);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:console-cleared', { serverName });
            }

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error clearing console:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:check-playit-available', async (event, software, version) => {
        try {
            const loaderMap = {
                'paper': 'paper',
                'purpur': 'paper',
                'spigot': 'paper',
                'bukkit': 'paper',
                'folia': 'paper',
                'fabric': 'fabric',
                'forge': 'forge',
                'neoforge': 'neoforge',
                'quilt': 'quilt',
                'vanilla': null
            };

            const loader = loaderMap[software.toLowerCase()];

            if (!loader || loader === 'vanilla') {
                return { available: false, reason: 'Software does not support plugins' };
            }

            const projectId = 'og7kbNBC';
            const versionsResponse = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
                headers: {
                    'User-Agent': 'Antigravity/MinecraftLauncher/1.0'
                }
            });

            if (!versionsResponse.data || versionsResponse.data.length === 0) {
                return { available: false, reason: 'No versions found' };
            }

            const matchingVersion = versionsResponse.data.find(v => {
                const supportsLoader = v.loaders.some(l =>
                    l.toLowerCase() === loader.toLowerCase()
                );
                const supportsGameVersion = v.game_versions.some(gv =>
                    gv === version
                );
                return supportsLoader && supportsGameVersion;
            });

            if (matchingVersion) {
                return {
                    available: true,
                    version: matchingVersion.version_number,
                    supportedVersions: matchingVersion.game_versions
                };
            }
            const anyLoaderVersion = versionsResponse.data.find(v =>
                v.loaders.some(l => l.toLowerCase() === loader.toLowerCase())
            );

            if (anyLoaderVersion) {
                return {
                    available: false,
                    reason: `No version for ${version}. Supported: ${anyLoaderVersion.game_versions.join(', ')}`,
                    supportedVersions: anyLoaderVersion.game_versions
                };
            }

            return { available: false, reason: `No version found for ${software}` };
        } catch (error) {
            console.error('[Servers] Error checking Playit availability:', error);
            return { available: false, reason: error.message };
        }
    });
    ipcMain.handle('server:update-config', async (event, serverName, updates) => {
        try {
            console.log(`[Servers] Updating config for ${serverName}:`, updates);
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const configPath = path.join(serversDir, safeName, 'server.json');
            if (!await fs.pathExists(configPath)) {
                throw new Error('Server configuration not found');
            }

            const config = await fs.readJson(configPath);
            const newConfig = { ...config, ...updates };
            await fs.writeJson(configPath, newConfig, { spaces: 4 });

            return { success: true, config: newConfig };
        } catch (error) {
            console.error(`[Servers] Error updating config for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:get', async (event, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const configPath = path.join(serversDir, safeName, 'server.json');

            if (!await fs.pathExists(configPath)) return null;

            const config = await fs.readJson(configPath);

            const process = serverProcesses.get(serverName);
            if (process && !process.killed) {
                if (config.status !== 'starting' && config.status !== 'stopping' && config.status !== 'restarting') {
                    config.status = 'running';
                }
            }

            return config;
        } catch (error) {
            console.error(`[Servers] Error getting server ${serverName}:`, error);
            return null;
        }
    });

    ipcMain.handle('server:get-status', async (event, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const configPath = path.join(serversDir, safeName, 'server.json');

            if (!await fs.pathExists(configPath)) return 'stopped';

            const config = await fs.readJson(configPath);
            const process = serverProcesses.get(serverName);

            if (process && !process.killed) {
                if (config.status !== 'starting' && config.status !== 'stopping' && config.status !== 'restarting') {
                    return 'running';
                }
                return config.status;
            }

            return config.status === 'error' ? 'error' : 'stopped';
        } catch (error) {
            console.error(`[Servers] Error getting server status ${serverName}:`, error);
            return 'error';
        }
    });
    ipcMain.handle('server:install-playit', async (event, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');

            if (!await fs.pathExists(configPath)) {
                throw new Error('Server not found');
            }

            const config = await fs.readJson(configPath);

            if (config.playitPluginInstalled) {
                return { success: true, message: 'Plugin already installed' };
            }

            const pluginInstalled = await downloadPlayitPlugin(serverDir, config.software, config.version, serverName, mainWindow);

            if (pluginInstalled) {
                config.playitPluginInstalled = true;
                await fs.writeJson(configPath, config, { spaces: 2 });
                return { success: true, message: 'Plugin installed successfully' };
            } else {
                return { success: false, message: 'Plugin not available for this software/version.' };
            }
        } catch (error) {
            console.error('[Servers] Error installing Playit plugin:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('server:remove-playit', async (event, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');

            if (!await fs.pathExists(configPath)) {
                throw new Error('Server not found');
            }

            const config = await fs.readJson(configPath);
            const searchDirs = [path.join(serverDir, 'plugins'), path.join(serverDir, 'mods')];
            for (const dir of searchDirs) {
                if (await fs.pathExists(dir)) {
                    const files = await fs.readdir(dir);
                    const playitJar = files.find(f => f.toLowerCase().includes('playit') && f.endsWith('.jar'));
                    if (playitJar) {
                        await fs.remove(path.join(dir, playitJar));
                        console.log(`[Servers] Removed Playit plugin: ${playitJar} from ${dir}`);
                    }
                }
            }

            config.playitPluginInstalled = false;
            await fs.writeJson(configPath, config, { spaces: 2 });

            return { success: true };
        } catch (error) {
            console.error('[Servers] Error removing Playit plugin:', error);
            return { success: false, error: error.message };
        }
    });
    const serverSettingsPath = path.join(app.getPath('userData'), 'serverSettings.json');

    const defaultServerSettings = {
        serverPath: '',
        backupPath: '',
        autoBackup: false,
        backupInterval: 24,
        maxBackups: 5,
        defaultMemory: '4096',
        defaultPort: '25565',
        defaultMaxPlayers: '20',
        autoop: false
    };

    ipcMain.handle('server:get-settings', async () => {
        try {
            if (await fs.pathExists(serverSettingsPath)) {
                const settings = await fs.readJson(serverSettingsPath);
                return { success: true, settings: { ...defaultServerSettings, ...settings } };
            }
            return { success: true, settings: defaultServerSettings };
        } catch (error) {
            console.error('[Servers] Failed to get server settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:save-settings', async (_, newSettings) => {
        try {
            await fs.writeJson(serverSettingsPath, newSettings, { spaces: 2 });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:settings-updated', newSettings);
            }
            return { success: true };
        } catch (error) {
            console.error('[Servers] Failed to save server settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('dialog:select-folder', async () => {
        const { dialog } = require('electron');
        try {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory']
            });
            return result;
        } catch (error) {
            console.error('[Servers] Error in folder selection:', error);
            return { success: false, error: error.message };
        }
    });


    function parsePropertiesFile(content) {
        const properties = {};
        const lines = content.split('\n');
        let header = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            if (trimmed.startsWith('#') && !header) {
                header += (header ? '\n' : '') + line;
                continue;
            }
            if (trimmed.startsWith('#')) {
                continue;
            }
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0) {
                const key = line.substring(0, eqIndex).trim();
                const value = line.substring(eqIndex + 1).trim();
                properties[key] = value;
            }
        }

        return { properties, header };
    }


    function stringifyPropertiesFile(properties, header) {
        let content = header ? header + '\n' : '';
        const keys = Object.keys(properties).sort();

        for (const key of keys) {
            const value = (properties[key] || '').toString().trim();
            content += `${key}=${value}\n`;
        }

        return content;
    }

    ipcMain.handle('server:get-properties', async (event, serverName) => {
        try {
            console.log(`[Servers] Getting properties for ${serverName}`);

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');
            const config = await fs.pathExists(configPath) ? await fs.readJson(configPath) : null;

            if (config && config.software.toLowerCase() === 'velocity') {
                const tomlPath = path.join(serverDir, 'velocity.toml');
                if (await fs.pathExists(tomlPath)) {
                    const content = await fs.readFile(tomlPath, 'utf-8');
                    const motdMatch = content.match(/motd\s*=\s*(["']?)(.*?)\1(?:\r?\n|$)/);
                    const bindMatch = content.match(/bind\s*=\s*(["']?)([^:]*):(\d+)\1(?:\r?\n|$)/);
                    const playersMatch = content.match(/show-max-players\s*=\s*(\d+)/);
                    return {
                        'motd': motdMatch ? motdMatch[2] : 'A Velocity Server',
                        'server-port': bindMatch ? bindMatch[3] : '25577',
                        'max-players': playersMatch ? playersMatch[1] : '500'
                    };
                }
                return {};
            } else if (config && config.software.toLowerCase() === 'bungeecord') {
                const yamlPath = path.join(serverDir, 'config.yml');
                if (await fs.pathExists(yamlPath)) {
                    const content = await fs.readFile(yamlPath, 'utf-8');
                    const motdMatch = content.match(/motd:\s*(["']?)(.*?)\1(?:\r?\n|$)/);
                    const hostMatch = content.match(/host:\s*(["']?)([^:]*):(\d+)\1(?:\r?\n|$)/);
                    const playersMatch = content.match(/max_players:\s*(\d+)/);
                    return {
                        'motd': motdMatch ? motdMatch[2] : 'A BungeeCord Server',
                        'server-port': hostMatch ? hostMatch[3] : '25577',
                        'max-players': playersMatch ? playersMatch[1] : '1'
                    };
                }
                return {};
            }

            const propertiesPath = path.join(serverDir, 'server.properties');

            if (!await fs.pathExists(propertiesPath)) {
                console.log(`[Servers] server.properties not found for ${serverName}`);
                return {};
            }

            const content = await fs.readFile(propertiesPath, 'utf-8');
            const { properties } = parsePropertiesFile(content);

            console.log(`[Servers] Loaded ${Object.keys(properties).length} properties for ${serverName}`);

            return properties;
        } catch (error) {
            console.error(`[Servers] Error getting properties for ${serverName}:`, error);
            return {};
        }
    });

    ipcMain.handle('server:save-properties', async (event, serverName, properties) => {
        try {
            console.log(`[Servers] Saving properties for ${serverName}`);

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');
            const config = await fs.pathExists(configPath) ? await fs.readJson(configPath) : null;

            if (config && config.software.toLowerCase() === 'velocity') {
                const tomlPath = path.join(serverDir, 'velocity.toml');
                if (await fs.pathExists(tomlPath)) {
                    let content = await fs.readFile(tomlPath, 'utf-8');
                    if (properties['motd'] !== undefined) {
                        const safeMotd = properties['motd'].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        content = content.replace(/(motd\s*=\s*)(["']?)(.*?)\2(\r?\n|$)/, `$1"${safeMotd}"$4`);
                    }
                    if (properties['server-port'] !== undefined) {
                        content = content.replace(/(bind\s*=\s*)(["']?)([^:]*):(\d+)\2(\r?\n|$)/, `$1"$3:${properties['server-port']}"$5`);
                    }
                    if (properties['max-players'] !== undefined) {
                        content = content.replace(/(show-max-players\s*=\s*)(\d+)(\r?\n|$)/, `$1${properties['max-players']}$3`);
                    }
                    await fs.writeFile(tomlPath, content, 'utf-8');
                    console.log(`[Servers] Velocity properties saved for ${serverName}.`);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server:console', { serverName, log: `[INFO] Server properties updated` });
                    }
                    return { success: true };
                }
                return { success: false, error: 'velocity.toml not found' };
            } else if (config && config.software.toLowerCase() === 'bungeecord') {
                const yamlPath = path.join(serverDir, 'config.yml');
                if (await fs.pathExists(yamlPath)) {
                    let content = await fs.readFile(yamlPath, 'utf-8');
                    if (properties['motd'] !== undefined) {
                        const safeMotd = properties['motd'].replace(/'/g, "''");
                        content = content.replace(/(motd:\s*)(["']?)(.*?)\2(\r?\n|$)/, `$1'${safeMotd}'$4`);
                    }
                    if (properties['server-port'] !== undefined) {
                        content = content.replace(/(host:\s*)(["']?)([^:]*):(\d+)\2(\r?\n|$)/, `$1$3:${properties['server-port']}$5`);
                    }
                    if (properties['max-players'] !== undefined) {
                        content = content.replace(/(max_players:\s*)(\d+)(\r?\n|$)/, `$1${properties['max-players']}$3`);
                    }
                    await fs.writeFile(yamlPath, content, 'utf-8');
                    console.log(`[Servers] BungeeCord properties saved for ${serverName}.`);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server:console', { serverName, log: `[INFO] Server properties updated` });
                    }
                    return { success: true };
                }
                return { success: false, error: 'config.yml not found' };
            }

            const propertiesPath = path.join(serverDir, 'server.properties');

            if (!await fs.pathExists(propertiesPath)) {
                console.log(`[Servers] server.properties not found for ${serverName}`);
                return { success: false, error: 'server.properties file not found' };
            }
            const currentContent = await fs.readFile(propertiesPath, 'utf-8');
            const { properties: currentProperties, header } = parsePropertiesFile(currentContent);
            const mergedProperties = { ...currentProperties, ...properties };
            const newContent = stringifyPropertiesFile(mergedProperties, header);
            await fs.writeFile(propertiesPath, newContent);

            console.log(`[Servers] Properties saved for ${serverName}. Updated ${Object.keys(properties).length} properties, total ${Object.keys(mergedProperties).length}`);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server:console', {
                    serverName,
                    log: `[INFO] Server properties updated (${Object.keys(properties).length} changes)`
                });
            }

            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error saving properties for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:list-files', async (event, serverName, relativePath = '') => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const targetDir = path.normalize(path.join(serverDir, relativePath));

            if (!targetDir.startsWith(serverDir)) {
                return { success: false, error: 'Access denied' };
            }

            if (!await fs.pathExists(targetDir)) {
                return { success: false, error: 'Directory not found' };
            }

            const files = await fs.readdir(targetDir);
            const items = await Promise.all(files.map(async (file) => {
                const filePath = path.join(targetDir, file);
                const stats = await fs.stat(filePath);
                return {
                    name: file,
                    isDirectory: stats.isDirectory(),
                    size: stats.size,
                    mtime: stats.mtime
                };
            }));

            return { success: true, files: items };
        } catch (error) {
            console.error(`[Servers] Error listing files for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:read-file', async (event, serverName, relativePath) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const filePath = path.normalize(path.join(serverDir, relativePath));

            if (!filePath.startsWith(serverDir)) {
                return { success: false, error: 'Access denied' };
            }

            if (!await fs.pathExists(filePath)) {
                return { success: false, error: 'File not found' };
            }

            const content = await fs.readFile(filePath, 'utf-8');
            return { success: true, content };
        } catch (error) {
            console.error(`[Servers] Error reading file for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:write-file', async (event, serverName, relativePath, content) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const filePath = path.normalize(path.join(serverDir, relativePath));

            if (!filePath.startsWith(serverDir)) {
                return { success: false, error: 'Access denied' };
            }

            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error writing file for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:upload-file', async (event, serverName, relativePath, sourcePath) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const destPath = path.normalize(path.join(serverDir, relativePath));

            if (!destPath.startsWith(serverDir)) {
                return { success: false, error: 'Access denied' };
            }

            if (sourcePath && typeof sourcePath === 'object' && sourcePath.path) {
                await fs.copy(sourcePath.path, destPath);
            } else if (typeof sourcePath === 'string') {
                const sourceExists = await fs.pathExists(sourcePath);
                if (!sourceExists) {
                    return { success: false, error: 'Source file not found' };
                }
                await fs.copy(sourcePath, destPath);
            } else {
                return { success: false, error: 'Invalid source path' };
            }

            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error uploading file for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:delete-file', async (event, serverName, relativePath) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const filePath = path.normalize(path.join(serverDir, relativePath));

            if (!filePath.startsWith(serverDir) || filePath === serverDir) {
                return { success: false, error: 'Access denied' };
            }

            await fs.remove(filePath);
            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error deleting file for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:create-directory', async (event, serverName, relativePath) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const dirPath = path.normalize(path.join(serverDir, relativePath));

            if (!dirPath.startsWith(serverDir)) {
                return { success: false, error: 'Access denied' };
            }

            await fs.ensureDir(dirPath);
            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error creating directory for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:rename-file', async (event, serverName, oldRelativePath, newRelativePath) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const oldPath = path.normalize(path.join(serverDir, oldRelativePath));
            const newPath = path.normalize(path.join(serverDir, newRelativePath));

            if (!oldPath.startsWith(serverDir) || !newPath.startsWith(serverDir) || oldPath === serverDir) {
                return { success: false, error: 'Access denied' };
            }

            await fs.move(oldPath, newPath);
            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error renaming file for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:get-mods', async (_, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const configPath = path.join(serverDir, 'server.json');

            if (!await fs.pathExists(configPath)) return { success: false, error: 'Server not found' };
            const config = await fs.readJson(configPath);
            const modsDir = path.join(serverDir, 'mods');
            const pluginsDir = path.join(serverDir, 'plugins');

            let files = [];
            if (await fs.pathExists(modsDir)) {
                const modFiles = await fs.readdir(modsDir);
                files = files.concat(modFiles.filter(f => f.endsWith('.jar')).map(f => ({ name: f, path: path.join(modsDir, f), type: 'mod' })));
            }
            if (await fs.pathExists(pluginsDir)) {
                const pluginFiles = await fs.readdir(pluginsDir);
                files = files.concat(pluginFiles.filter(f => f.endsWith('.jar')).map(f => ({ name: f, path: path.join(pluginsDir, f), type: 'plugin' })));
            }

            const modCachePath = path.join(app.getPath('userData'), 'mod_cache.json');
            let modCache = {};
            try {
                if (await fs.pathExists(modCachePath)) modCache = await fs.readJson(modCachePath);
            } catch (e) { }

            const modObjects = await Promise.all(files.map(async (file) => {
                const stats = await fs.stat(file.path);
                const cacheKey = `${file.name}-${stats.size}`;

                return {
                    name: file.name,
                    projectId: modCache[cacheKey]?.projectId,
                    versionId: modCache[cacheKey]?.versionId,
                    source: modCache[cacheKey]?.source || 'modrinth',
                    title: modCache[cacheKey]?.title || file.name,
                    type: file.type
                };
            }));

            return { success: true, mods: modObjects };
        } catch (e) {
            console.error('Failed to get server mods:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:delete-mod', async (_, serverName, fileName, type = 'mod') => {
        try {
            if (!fileName || typeof fileName !== 'string') {
                return { success: false, error: 'File name is required' };
            }

            const targetType = type === 'plugin' ? 'plugin' : 'mod';
            const folder = targetType === 'plugin' ? 'plugins' : 'mods';

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const safeFileName = path.basename(fileName);
            const targetPath = path.join(serverDir, folder, safeFileName);

            if (!targetPath.startsWith(path.join(serverDir, folder))) {
                return { success: false, error: 'Access denied' };
            }

            if (!await fs.pathExists(targetPath)) {
                return { success: false, error: `${targetType} file not found` };
            }

            await fs.remove(targetPath);
            return { success: true };
        } catch (error) {
            console.error(`[Servers] Failed to delete server ${type}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:list-plugin-configs', async (_, serverName) => {
        try {
            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const target = await resolveConfigTarget(serverDir);
            const sourceDir = target.sourceDir;
            const pluginConfigDir = target.configDir;

            const pluginDirectoryEntries = await fs.pathExists(sourceDir)
                ? await fs.readdir(sourceDir, { withFileTypes: true })
                : [];

            const pluginFolderNames = [];
            for (const entry of pluginDirectoryEntries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const pluginFolderName = entry.name;
                const pluginConfigPath = path.join(sourceDir, pluginFolderName, 'config.yml');
                if (await fs.pathExists(pluginConfigPath)) {
                    pluginFolderNames.push(pluginFolderName);
                }
            }

            const configuredFiles = await fs.pathExists(pluginConfigDir)
                ? (await fs.readdir(pluginConfigDir)).filter(file => file.toLowerCase().endsWith('.json'))
                : [];

            const configuredEntriesMap = new Map();

            const addConfiguredEntry = (entry) => {
                if (!entry?.configBaseName) {
                    return;
                }
                configuredEntriesMap.set(entry.configBaseName.toLowerCase(), entry);
            };

            for (const configFile of configuredFiles) {
                const configBaseName = configFile.replace(/\.json$/i, '');
                const pluginConfigPath = path.join(sourceDir, configBaseName, 'config.yml');
                if (!await fs.pathExists(pluginConfigPath)) {
                    continue;
                }

                const fullPath = path.join(pluginConfigDir, configFile);
                try {
                    const config = await fs.readJson(fullPath);
                    const rawName = config.pluginName || config.modName || config.displayName || configBaseName;
                    addConfiguredEntry({
                        configFile,
                        configBaseName,
                        pluginName: rawName,
                        config
                    });
                } catch (error) {
                    console.warn(`[Servers] Skipping invalid plugin config ${configFile}: ${error.message}`);
                }
            }

            const bundledConfigSchemaDir = await resolveBundledConfigSchemaDir();
            if (bundledConfigSchemaDir) {
                const bundledConfigFiles = (await fs.readdir(bundledConfigSchemaDir))
                    .filter(file => file.toLowerCase().endsWith('.json'));

                for (const configFile of bundledConfigFiles) {
                    const configBaseName = configFile.replace(/\.json$/i, '');
                    const mapKey = configBaseName.toLowerCase();
                    if (configuredEntriesMap.has(mapKey)) {
                        continue;
                    }

                    const pluginConfigPath = path.join(sourceDir, configBaseName, 'config.yml');
                    if (!await fs.pathExists(pluginConfigPath)) {
                        continue;
                    }

                    const fullPath = path.join(bundledConfigSchemaDir, configFile);
                    try {
                        const config = await fs.readJson(fullPath);
                        const rawName = config.pluginName || config.modName || config.displayName || configBaseName;
                        addConfiguredEntry({
                            configFile,
                            configBaseName,
                            pluginName: rawName,
                            config
                        });
                    } catch (error) {
                        console.warn(`[Servers] Skipping invalid bundled plugin config ${configFile}: ${error.message}`);
                    }
                }
            }

            const configuredEntries = Array.from(configuredEntriesMap.values());

            const configuredPlugins = configuredEntries.map((entry) => ({
                jarName: entry.configBaseName,
                pluginName: entry.pluginName,
                configFile: entry.configFile,
                config: entry.config
            }));

            const configuredFolderNames = new Set(configuredEntries.map(entry => String(entry.configBaseName || '').toLowerCase()));
            const unconfiguredPlugins = pluginFolderNames
                .filter(folderName => !configuredFolderNames.has(String(folderName || '').toLowerCase()))
                .map(folderName => ({
                    jarName: folderName,
                    pluginName: folderName
                }));

            return {
                success: true,
                itemType: target.type,
                configuredPlugins,
                unconfiguredPlugins
            };
        } catch (error) {
            console.error(`[Servers] Error listing plugin configs for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:create-plugin-config', async (_, serverName, pluginName) => {
        try {
            if (!pluginName || typeof pluginName !== 'string') {
                return { success: false, error: 'Plugin name is required' };
            }

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const target = await resolveConfigTarget(serverDir);
            const pluginConfigDir = target.configDir;
            await fs.ensureDir(pluginConfigDir);

            const configFile = `${sanitizePluginConfigFileName(pluginName)}.json`;
            const configPath = path.join(pluginConfigDir, configFile);

            if (!await fs.pathExists(configPath)) {
                const defaultConfig = buildDefaultPluginConfig(pluginName);
                if (target.type === 'mod') {
                    defaultConfig.modName = pluginName;
                    delete defaultConfig.pluginName;
                }
                await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
            }

            const config = await fs.readJson(configPath);
            return { success: true, configFile, config };
        } catch (error) {
            console.error(`[Servers] Error creating plugin config for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('server:save-plugin-config', async (_, serverName, configFile, config) => {
        try {
            if (!configFile || typeof configFile !== 'string' || !configFile.toLowerCase().endsWith('.json')) {
                return { success: false, error: 'Invalid config file name' };
            }

            const validation = validatePluginConfig(config);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            const serversDir = path.join(app.getPath('userData'), 'servers');
            const safeName = sanitizeFileName(serverName);
            const serverDir = path.join(serversDir, safeName);
            const target = await resolveConfigTarget(serverDir);
            const pluginConfigDir = target.configDir;
            const sourceDir = target.sourceDir;
            const safeConfigFile = path.basename(configFile);
            const configPath = path.join(pluginConfigDir, safeConfigFile);

            await fs.ensureDir(pluginConfigDir);
            await fs.writeJson(configPath, config, { spaces: 2 });

            const configBaseName = safeConfigFile.replace(/\.json$/i, '');
            const pluginConfigYmlPath = path.join(sourceDir, configBaseName, 'config.yml');

            if (!await fs.pathExists(pluginConfigYmlPath)) {
                return {
                    success: false,
                    error: `Missing plugin config.yml at ${path.join(path.basename(sourceDir), configBaseName, 'config.yml')}`
                };
            }

            const fields = Array.isArray(config?.fields) ? config.fields : [];
            const yamlContent = await fs.readFile(pluginConfigYmlPath, 'utf8');
            const nextYamlContent = applyFieldsToYaml(yamlContent, fields);
            await fs.writeFile(pluginConfigYmlPath, nextYamlContent, 'utf8');

            return { success: true };
        } catch (error) {
            console.error(`[Servers] Error saving plugin config for ${serverName}:`, error);
            return { success: false, error: error.message };
        }
    });

    console.log('[Servers] Server handlers setup complete.');
};