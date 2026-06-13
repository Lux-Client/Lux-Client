const https = require('https');
const http = require('http');

const SERVICES = [
    {
        id: 'session',
        name: 'Minecraft Session',
        description: 'Game session authentication',
        url: 'https://session.minecraft.net/'
    },
    {
        id: 'luxserver',
        name: 'Lux Server',
        description: 'Lux Extensions/Themes/Instance Codes',
        url: 'https://lux.pluginhub.de/'
    },
    {
        id: 'api',
        name: 'Mojang API',
        description: 'Profile and player data',
        url: 'https://api.mojang.com/'
    },
    {
        id: 'textures',
        name: 'Texture Server',
        description: 'Minecraft skins and capes',
        url: 'https://textures.minecraft.net/'
    },
    {
        id: 'services',
        name: 'Minecraft Services',
        description: 'Xbox Live / Microsoft auth',
        url: 'https://api.minecraftservices.com/'
    },
    {
        id: 'sessionserver',
        name: 'Session Server',
        description: 'Multiplayer join verification',
        url: 'https://sessionserver.mojang.com/'
    },
    {
        id: 'launchermeta',
        name: 'Launcher Meta',
        description: 'Version manifests and metadata',
        url: 'https://launchermeta.mojang.com/'
    },
    {
        id: 'libraries',
        name: 'Libraries',
        description: 'Game library downloads',
        url: 'https://libraries.minecraft.net/'
    }
];

function checkService(service) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const TIMEOUT_MS = 8000;

        try {
            const url = new URL(service.url);
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname || '/',
                method: 'HEAD',
                timeout: TIMEOUT_MS,
                headers: { 'User-Agent': 'LuxClient-StatusCheck/1.0' }
            };

            const req = lib.request(options, (res) => {
                const latency = Date.now() - startTime;
                const status = res.statusCode >= 500 ? 'degraded' : 'operational';
                res.resume();
                resolve({ ...service, status, latency, statusCode: res.statusCode });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ...service, status: 'down', latency: TIMEOUT_MS, statusCode: null });
            });

            req.on('error', () => {
                resolve({ ...service, status: 'down', latency: Date.now() - startTime, statusCode: null });
            });

            req.end();
        } catch (e) {
            resolve({ ...service, status: 'down', latency: 0, statusCode: null });
        }
    });
}

module.exports = (ipcMain) => {
    ipcMain.handle('status:check', async () => {
        try {
            const results = await Promise.all(SERVICES.map(checkService));
            return { success: true, services: results, checkedAt: Date.now() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
};
