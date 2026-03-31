const { app, BrowserWindow, ipcMain, protocol, net, Menu, Tray, nativeImage } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const pkg = require('../package.json');

if (process.platform === 'linux' && process.env.XDG_CURRENT_DESKTOP === 'COSMIC') {
    process.env.XDG_CURRENT_DESKTOP = 'Unity';
}

app.setName(pkg.productName || 'Lux Client');
app.setAboutPanelOptions({
    applicationName: pkg.productName || 'Lux Client',
    applicationVersion: pkg.version
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('use-gl', 'egl');
}
app.commandLine.appendSwitch('enable-webgl-draft-extensions');
app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox,CalculateNativeWinOcclusion');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
try {
    if (fs.existsSync(settingsPath)) {
        const settings = fs.readJsonSync(settingsPath);
        if (settings.legacyGpuSupport) {
            console.log('[Main] Legacy GPU Support enabled: Disabling hardware acceleration and forcing desktop GL');
            app.disableHardwareAcceleration();
            app.commandLine.appendSwitch('use-gl', 'desktop');
        }
    }
} catch (e) {
    console.error('[Main] Failed to read settings for legacy GPU check:', e);
}

const logPath = path.join(app.getPath('userData'), 'startup.log');
function logToFile(msg) {
    const time = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${time}] ${msg}\n`);
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
}

process.on('uncaughtException', (error) => {
    logToFile(`CRITICAL: Uncaught Exception: ${error.message}\nStack: ${error.stack}`);
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logToFile(`CRITICAL: Unhandled Rejection at: ${promise}\nReason: ${reason}`);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

logToFile('NUCLEAR STARTUP CHECK: main.js is running!');
logToFile(`[DEBUG] CWD: ${process.cwd()}`);
logToFile(`[DEBUG] __dirname: ${__dirname}`);
logToFile(`[DEBUG] Preload Path: ${path.join(__dirname, '../backend/preload.js')}`);
logToFile(`[DEBUG] userData: ${app.getPath('userData')}`);

ipcMain.handle('ping', () => {
    console.log('Ping received!');
    return 'pong';
});

ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
});

const { pathToFileURL } = require('url');
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app-media',
        privileges: {
            secure: true,
            standard: true,
            supportFetchAPI: true,
            bypassCSP: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

let mainWindow;
let splashWindow;
let tray = null;
let isQuiting = false;
const isDeveloperMode = process.env.NODE_ENV === 'development';
const updateAttemptStatePath = path.join(app.getPath('userData'), 'update-attempt-state.json');

async function readUpdateAttemptState() {
    try {
        if (!await fs.pathExists(updateAttemptStatePath)) return {};
        const data = await fs.readJson(updateAttemptStatePath);
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        return {};
    }
}

async function writeUpdateAttemptState(nextState = {}) {
    try {
        await fs.writeJson(updateAttemptStatePath, nextState, { spaces: 2 });
    } catch (e) {
        // Non-fatal.
    }
}

async function clearUpdateAttemptState() {
    try {
        if (await fs.pathExists(updateAttemptStatePath)) {
            await fs.remove(updateAttemptStatePath);
        }
    } catch (e) {
        // Non-fatal.
    }
}

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 300,
        height: 350,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        icon: path.join(__dirname, '../resources/icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });

    try {
        const splashPath = path.join(__dirname, '../public/splash.html');
        if (fs.existsSync(splashPath)) {
            splashWindow.loadFile(splashPath);
        } else {
            console.error('[Main] Splash screen file not found:', splashPath);
        }
    } catch (err) {
        console.error('[Main] Failed to load splash screen:', err);
    }
    splashWindow.center();
}

async function checkAndLaunch() {
    createSplashWindow();

    let retryCount = 0;
    const maxRetries = 3;

    const performCheck = async () => {
        if (isDeveloperMode) {
            console.log('[Main] Skipping update check in dev mode.');
            splashWindow.webContents.send('updater:status', { status: 'Searching for updates' });
            setTimeout(() => {
                splashWindow.webContents.send('updater:status', { status: 'Starting' });
                setTimeout(launchMain, 1500);
            }, 1000);
            return;
        }

        splashWindow.webContents.send('updater:status', { status: 'Searching for updates', retryCount });

        try {
            const axios = require('axios');
            const { compareVersions } = require('../backend/utils/version-utils');
            const pkg = require('../package.json');

            const REPO = 'Lux-Client/Lux-Client';
            const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

            const response = await axios.get(GITHUB_API, {
                headers: { 'User-Agent': 'Lux-AutoUpdater' },
                timeout: 10000
            });
            const release = response.data;
            const latestVersion = release.tag_name;
            const currentVersion = pkg.version;

            const needsUpdate = compareVersions(currentVersion, latestVersion) === 1;

            if (needsUpdate) {
                const lastAttempt = await readUpdateAttemptState();
                const sameVersion = String(lastAttempt?.version || '') === String(latestVersion || '');
                const recentFailureWindowMs = 15 * 60 * 1000;
                const wasInstallingRecently = sameVersion
                    && String(lastAttempt?.status || '') === 'installing'
                    && Date.now() - Number(lastAttempt?.ts || 0) < recentFailureWindowMs;

                if (wasInstallingRecently) {
                    splashWindow.webContents.send('updater:status', { status: 'Starting' });
                    setTimeout(launchMain, 1500);
                    return;
                }

                const platform = process.platform;
                let asset = null;
                if (platform === 'win32') {
                    asset = release.assets.find(a => a.name.endsWith('.exe'));
                } else if (platform === 'linux') {
                    asset = release.assets.find(a => a.name.endsWith('.AppImage') || a.name.endsWith('.deb') || a.name.endsWith('.rpm'));
                } else if (platform === 'darwin') {
                    asset = release.assets.find(a => a.name.endsWith('.zip') || a.name.endsWith('.dmg'));
                }

                if (asset) {
                    splashWindow.webContents.send('updater:status', { status: 'Downloading update...', progress: 0 });

                    const downloadDir = path.join(app.getPath('userData'), 'updates');
                    await fs.ensureDir(downloadDir);
                    const safeAssetName = path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_');
                    if (!safeAssetName || safeAssetName.startsWith('.')) {
                        throw new Error('Invalid update asset filename');
                    }

                    await writeUpdateAttemptState({
                        status: 'installing',
                        version: latestVersion,
                        ts: Date.now(),
                        assetName: safeAssetName
                    });

                    const targetPath = path.join(downloadDir, safeAssetName);

                    const downloadRes = await axios({
                        url: asset.browser_download_url,
                        method: 'GET',
                        responseType: 'stream'
                    });

                    const totalLength = downloadRes.headers['content-length'];
                    let downloadedLength = 0;
                    const writer = fs.createWriteStream(targetPath);
                    downloadRes.data.pipe(writer);

                    downloadRes.data.on('data', (chunk) => {
                        downloadedLength += chunk.length;
                        const percent = totalLength ? Math.round((downloadedLength / totalLength) * 100) : 0;
                        splashWindow.webContents.send('updater:status', { status: `Installing Update (${percent}%)`, progress: percent });
                    });

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    splashWindow.webContents.send('updater:status', { status: 'Update downloaded, installing...' });
                    setTimeout(() => {
                        const { spawn } = require('child_process');
                        if (process.platform === 'win32') {
                            const updateScript = path.join(downloadDir, 'update.vbs');
                            const exeTarget = process.execPath;
                            const vbsContent = `Set objShell = WScript.CreateObject("WScript.Shell")
WScript.Sleep 2000
objShell.Run """" & WScript.Arguments(0) & """ /S", 1, True
objShell.Run """" & WScript.Arguments(1) & """", 1, False`;
                            fs.writeFileSync(updateScript, vbsContent);
                            spawn('wscript.exe', [updateScript, targetPath, exeTarget], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                        } else if (process.platform === 'linux') {
                            if (safeAssetName.endsWith('.AppImage')) {
                                const safeUpdatePath = path.join(downloadDir, 'lux-setup.AppImage');
                                fs.renameSync(targetPath, safeUpdatePath);
                                fs.chmodSync(safeUpdatePath, 0o755);
                                spawn(safeUpdatePath, [], { detached: true, stdio: 'ignore' }).unref();
                                app.quit();
                            } else if (safeAssetName.endsWith('.deb')) {
                                spawn('pkexec', ['apt-get', 'install', '-y', targetPath], { detached: true, stdio: 'ignore' }).unref();
                                app.quit();
                            } else if (safeAssetName.endsWith('.rpm')) {
                                spawn('pkexec', ['dnf', 'install', '-y', targetPath], { detached: true, stdio: 'ignore' }).unref();
                                app.quit();
                            } else {
                                require('electron').shell.openPath(path.dirname(targetPath));
                                app.quit();
                            }
                        } else {
                            require('electron').shell.openPath(targetPath);
                            app.quit();
                        }
                    }, 1000);
                    return;
                }
            }

            splashWindow.webContents.send('updater:status', { status: 'Starting' });
            setTimeout(launchMain, 1500);

        } catch (err) {
            console.error('[Main] Update check failed:', err);
            retryCount++;
            if (retryCount <= maxRetries) {
                setTimeout(performCheck, 1000);
            } else {
                splashWindow.webContents.send('updater:status', { status: 'Starting' });
                setTimeout(launchMain, 1500);
            }
        }
    };

    splashWindow.webContents.once('did-finish-load', () => {
        performCheck();
    });
}

function launchMain() {
    clearUpdateAttemptState();
    createWindow();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'Lux',
        frame: false,
        icon: path.join(__dirname, '../resources/icon.png'),
        backgroundColor: '#121212',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../backend/preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            v8CacheOptions: 'bypassHeatCheck'
        },
    });

    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow) {
                splashWindow.close();
                splashWindow = null;
            }
            mainWindow.show();
            mainWindow.focus();
        }, 500);
    });

    console.log('[Main] Preload script configured.');
    const handlers = [
        { name: 'auth', path: '../backend/handlers/auth' },
        { name: 'instances', path: '../backend/handlers/instances' },
        { name: 'launcher', path: '../backend/handlers/launcher' },
        { name: 'servers', path: '../backend/handlers/servers' },
        { name: 'modrinth', path: '../backend/handlers/modrinth' },
        { name: 'data', path: '../backend/handlers/data' },
        { name: 'settings', path: '../backend/handlers/settings' },
        { name: 'skins', path: '../backend/handlers/skins' },
        { name: 'modpackCode', path: '../backend/handlers/modpackCode' },
        { name: 'extensions', path: '../backend/handlers/extensions' },
        { name: 'cloudBackup', path: '../backend/handlers/cloudBackup' },
        { name: 'java', path: '../backend/handlers/java' },
        { name: 'external', path: '../backend/handlers/external' },
        { name: 'updater', path: '../backend/handlers/updater' }
    ];

    for (const h of handlers) {
        logToFile(`[Main] Registering ${h.name} handler...`);
        try {
            const handler = require(h.path);
            if (typeof handler === 'function') {
                if (h.name === 'data' || h.name === 'settings' || h.name === 'java' || h.name === 'external') {
                    handler(ipcMain);
                } else {
                    handler(ipcMain, mainWindow);
                }
                logToFile(`[Main] ✅ ${h.name} handler registered.`);
            } else {
                logToFile(`[Main] ⚠️ ${h.name} handler is not a function.`);
            }
        } catch (e) {
            logToFile(`[Main] ❌ CRITICAL: Failed to register ${h.name} handler: ${e.message}\n${e.stack}`);
            console.error(`[Main] Failed to register ${h.name} handler:`, e);
        }
    }

    ipcMain.on('app:is-packaged', (event) => {
        event.returnValue = app.isPackaged;
    });

    ipcMain.on('app:is-developer-mode', (event) => {
        event.returnValue = isDeveloperMode;
    });

    ipcMain.handle('app:get-version', () => {
        try {
            const pkg = require(path.join(__dirname, '../package.json'));
            return pkg.version;
        } catch (e) {
            return app.getVersion();
        }
    });

    try {
        logToFile('[Main] Initializing Discord RPC...');
        const discord = require('../backend/handlers/discord');
        discord.initRPC();
        logToFile('[Main] ✅ Discord RPC initialized.');
    } catch (e) {
        logToFile(`[Main] ❌ Failed to initialize Discord RPC: ${e.message}`);
    }

    try {
        logToFile('[Main] Initializing Backup Manager...');
        const backupManager = require('../backend/backupManager');
        backupManager.init(ipcMain);
        logToFile('[Main] ✅ Backup Manager initialized.');
    } catch (e) {
        logToFile(`[Main] ❌ Failed to initialize Backup Manager: ${e.message}`);
    }
    if (isDeveloperMode) {
        logToFile('[Main] Loading development URL...');
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        logToFile(`[Main] Loading production file: ${indexPath}`);

        if (!fs.existsSync(indexPath)) {
            logToFile(`[Main] CRITICAL ERROR: Production index.html not found at ${indexPath}`);
            console.error(`[Main] CRITICAL ERROR: Production index.html not found at ${indexPath}`);
        }

        mainWindow.loadFile(indexPath).catch(err => {
            logToFile(`[Main] Failed to load production file: ${err.message}\n${err.stack}`);
            console.error('[Main] Failed to load production file:', err);
        });
    }
    ipcMain.on('window-minimize', () => {
        try {
            const settingsPath = path.join(app.getPath('userData'), 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const settings = fs.readJsonSync(settingsPath, { throws: false }) || {};
                if (settings.minimizeToTray) {
                    mainWindow.hide();
                    return;
                }
            }
        } catch (e) { }
        mainWindow.minimize();
    });

    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });

    ipcMain.on('window-close', () => {
        try {
            const settingsPath = path.join(app.getPath('userData'), 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const settings = fs.readJsonSync(settingsPath, { throws: false }) || {};
                if (settings.minimizeToTray && !isQuiting) {
                    mainWindow.hide();
                    return;
                }
            }
        } catch (e) { }
        mainWindow.close();
    });

    mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', false));

    mainWindow.on('close', (event) => {
        if (!isQuiting) {
            try {
                const settingsPath = path.join(app.getPath('userData'), 'settings.json');
                if (fs.existsSync(settingsPath)) {
                    const settings = fs.readJsonSync(settingsPath, { throws: false }) || {};
                    if (settings.minimizeToTray) {
                        event.preventDefault();
                        mainWindow.hide();
                    }
                }
            } catch (e) { }
        }
    });
}

function setupAppMediaProtocol() {
    protocol.handle('app-media', (request) => {
        try {
            const url = new URL(request.url);
            let decodedPath = decodeURIComponent(url.pathname);

            if (process.platform === 'win32') {
                if (decodedPath.startsWith('/')) {
                    decodedPath = decodedPath.substring(1);
                }
                if (decodedPath.startsWith(':')) {
                    decodedPath = decodedPath.substring(1);
                }

                if (url.host) {
                    const host = decodeURIComponent(url.host);
                    if (host.endsWith(':')) {
                        decodedPath = host + (decodedPath.startsWith('/') ? '' : '/') + decodedPath;
                    } else {
                        decodedPath = host + ':/' + (decodedPath.startsWith('/') ? '' : '/') + decodedPath;
                    }
                } else {
                    if (decodedPath.length > 1 && /^[a-zA-Z]$/.test(decodedPath[0]) && (decodedPath[1] === '/' || decodedPath[1] === '\\' || decodedPath[1] === ':')) {
                        if (decodedPath[1] !== ':') {
                            decodedPath = decodedPath[0] + ':' + decodedPath.substring(1);
                        }
                    }
                }
            } else {
                decodedPath = decodeURIComponent(url.host + url.pathname);
                if (!decodedPath.startsWith('/')) {
                    decodedPath = '/' + decodedPath;
                }
            }

            console.log(`[Main] app-media request: ${request.url} -> decodedPath: ${decodedPath}`);

            const resolvedPath = path.resolve(decodedPath);

            const userDataPath = app.getPath('userData');
            const isInside = process.platform === 'win32'
                ? resolvedPath.toLowerCase().startsWith(userDataPath.toLowerCase())
                : resolvedPath.startsWith(userDataPath);

            if (!isInside) {
                console.error(`[Main] Blocked app-media attempt to access path outside userData: ${resolvedPath}`);
                return new Response('Access Denied', { status: 403 });
            }

            return net.fetch(pathToFileURL(resolvedPath).toString());
        } catch (e) {
            console.error('Protocol error:', e);
            return new Response(null, { status: 404 });
        }
    });

    const template = [
        ...(process.platform === 'darwin' ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            role: 'window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
                { type: 'separator' },
                { role: 'window' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

const handleDeepLink = (argv) => {
    const file = argv.find(arg => arg.endsWith('.mcextension'));
    if (file) {
        console.log('[Main] file opened:', file);

        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
            mainWindow.webContents.send('extension:open-file', file);
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        } else if (mainWindow) {
            mainWindow.once('ready-to-show', () => {
                mainWindow.webContents.send('extension:open-file', file);
            });
        }
    }
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            handleDeepLink(commandLine);
        } else if (splashWindow) {
            splashWindow.focus();
        }
    });
}

app.whenReady().then(() => {
    if (process.platform === 'darwin') {
        const dockIconPath = path.join(__dirname, '../resources/icon-mac.png');
        if (fs.existsSync(dockIconPath)) {
            app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
        }
    }

    setupAppMediaProtocol();
    checkAndLaunch();
    handleDeepLink(process.argv);

    try {
        let iconPath = path.join(__dirname, '../resources/icon.png');
        if (process.platform === 'win32') {
            const icoIcon = path.join(__dirname, '../resources/icon.ico');
            if (fs.existsSync(icoIcon)) iconPath = icoIcon;
        } else if (process.platform === 'linux') {
            const pngIcon = path.join(__dirname, '../resources/icon.png');
            if (fs.existsSync(pngIcon)) iconPath = pngIcon;
        }
        tray = new Tray(iconPath);
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show App', click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            {
                label: 'Quit', click: () => {
                    isQuiting = true;
                    app.quit();
                }
            }
        ]);
        tray.setToolTip('Lux');
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });
        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (err) {
        console.error('Failed to create tray icon', err);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (mainWindow) {
                mainWindow.show();
            } else {
                checkAndLaunch();
            }
        }
    });

});

app.on('open-file', (event, path) => {
    event.preventDefault();
    console.log('[Main] macOS open-file:', path);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('open-file', (event, path) => {
    event.preventDefault();
    console.log('[Main] macOS open-file:', path);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
