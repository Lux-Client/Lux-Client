const { app, BrowserWindow, ipcMain, protocol, net, Menu, Tray } = require('electron');
const fs = require('fs-extra');
const path = require('path');

// Allow Tray icon support on COSMIC desktop by spoofing Unity for AppIndicator support
if (process.platform === 'linux' && process.env.XDG_CURRENT_DESKTOP === 'COSMIC') {
    process.env.XDG_CURRENT_DESKTOP = 'Unity';
}

// Force WebGL/GPU acceleration on Linux/unsupported systems
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

if (process.platform === 'linux') {
    // Sometimes necessary for WebGL on certain Linux drivers/sandboxes
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    // Forces the use of EGL, which is modern and better supported on Linux/Mesa than 'desktop' override
    app.commandLine.appendSwitch('use-gl', 'egl');
}
app.commandLine.appendSwitch('enable-webgl-draft-extensions');
app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox,CalculateNativeWinOcclusion');

// Legacy Hardware Support (#8)
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

// Redundant requires removed
console.log('NUCLEAR STARTUP CHECK: main.js is running!');
console.log('[DEBUG] CWD:', process.cwd());
console.log('[DEBUG] __dirname:', __dirname);
console.log('[DEBUG] Preload Path:', path.join(__dirname, '../backend/preload.js'));

ipcMain.handle('ping', () => {
    console.log('Ping received!');
    return 'pong';
});

ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
});

// fs handled at top
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
        if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
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

            const REPO = 'MCLC-Client/MCLC-Client';
            const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

            const response = await axios.get(GITHUB_API, {
                headers: { 'User-Agent': 'MCLC-AutoUpdater' }
            });
            const release = response.data;
            const latestVersion = release.tag_name;
            const currentVersion = pkg.version;

            const needsUpdate = compareVersions(currentVersion, latestVersion) === 1;

            if (needsUpdate) {
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
                    const targetPath = path.join(downloadDir, asset.name);

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
                            // VBScript to invisibly wait for the silent installer to finish, then relaunch the app.
                            const updateScript = path.join(downloadDir, 'update.vbs');
                            const exeTarget = process.execPath;
                            const vbsContent = `Set objShell = WScript.CreateObject("WScript.Shell")
WScript.Sleep 2000
objShell.Run """" & WScript.Arguments(0) & """ /S", 1, True
objShell.Run """" & WScript.Arguments(1) & """", 1, False`;
                            fs.writeFileSync(updateScript, vbsContent);
                            spawn('wscript.exe', [updateScript, targetPath, exeTarget], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                        } else if (process.platform === 'linux') {
                            const resolvedTarget = path.resolve(targetPath);
                            const resolvedDownloadDir = path.resolve(downloadDir);
                            if (resolvedTarget.startsWith(resolvedDownloadDir + path.sep) && resolvedTarget.endsWith('.AppImage')) {
                                fs.chmodSync(resolvedTarget, 0o755);
                                spawn(resolvedTarget, [], { detached: true, stdio: 'ignore' }).unref();
                            } else {
                                require('electron').shell.openPath(path.dirname(targetPath));
                            }
                        } else {
                            require('electron').shell.openPath(targetPath);
                        }
                        app.quit();
                    }, 1000);
                    return; // Stop here, don't launch main
                }
            }

            // No update or missing asset
            splashWindow.webContents.send('updater:status', { status: 'Starting' });
            setTimeout(launchMain, 1500);

        } catch (err) {
            console.error('[Main] Update check failed:', err);
            retryCount++;
            if (retryCount <= maxRetries) {
                setTimeout(performCheck, 1000); // Wait 1 second before retry
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
    createWindow();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'MCLC',
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
        // Delay showing main window slightly to allow splash screen to be visible
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
    console.log('[Main] Registering handlers...');
    console.log('[Main] Registering auth handler...');
    require('../backend/handlers/auth')(ipcMain, mainWindow);
    console.log('[Main] Registering instances handler...');
    try {
        require('../backend/handlers/instances')(ipcMain, mainWindow);
        console.log('[Main] ✅ Instances handler registered successfully.');
    } catch (e) {
        console.error('[Main] ❌ CRITICAL: Failed to register instances handler:');
        console.error('Message:', e.message);
        console.error('Stack:', e.stack);
        if (process.env.NODE_ENV === 'development') {
            process.exit(1);
        }
    }
    console.log('[Main] Registering launcher handler...');
    require('../backend/handlers/launcher')(ipcMain, mainWindow);
    require('../backend/handlers/servers')(ipcMain, mainWindow);
    console.log('[Main] Registering Modrinth handler...');
    require('../backend/handlers/modrinth')(ipcMain, mainWindow);
    console.log('[Main] Registering data handler...');
    require('../backend/handlers/data')(ipcMain);
    console.log('[Main] Registering settings handler...');
    require('../backend/handlers/settings')(ipcMain);
    console.log('[Main] Registering skins handler...');
    try {
        require('../backend/handlers/skins')(ipcMain, mainWindow);
        console.log('[Main] Skins handler registered successfully.');
    } catch (e) {
        console.error('[Main] Failed to register skins handler:', e);
    }
    console.log('[Main] Registering modpack code handler...');
    try {
        require('../backend/handlers/modpackCode')(ipcMain, mainWindow);
        console.log('[Main] Modpack code handler registered successfully.');
    } catch (e) {
        console.error('[Main] Failed to register modpack code handler:', e);
    }

    console.log('[Main] Registering extensions handler...');
    try {
        require('../backend/handlers/extensions')(ipcMain, mainWindow);
        console.log('[Main] Extensions handler registered successfully.');
    } catch (e) {
        console.error('[Main] Failed to register extensions handler:', e);
    }

    console.log('[Main] Registering cloud backup handler...');
    try {
        require('../backend/handlers/cloudBackup')(ipcMain, mainWindow);
        console.log('[Main] Cloud backup handler registered successfully.');
    } catch (e) {
        console.error('[Main] Failed to register cloud backup handler:', e);
    }

    require('../backend/handlers/java')(ipcMain);
    require('../backend/handlers/external')(ipcMain);
    const updater = require('../backend/handlers/updater');
    updater(ipcMain, mainWindow);

    ipcMain.on('app:is-packaged', (event) => {
        event.returnValue = app.isPackaged;
    });

    ipcMain.handle('app:get-version', () => {
        try {
            const pkg = require(path.join(__dirname, '../package.json'));
            return pkg.version;
        } catch (e) {
            return app.getVersion();
        }
    });

    const discord = require('../backend/handlers/discord');
    discord.initRPC();
    const backupManager = require('../backend/backupManager');
    backupManager.init(ipcMain);
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
        console.log('[Main] Loading development URL...');
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        console.log(`[Main] Loading production file: ${indexPath}`);

        if (!fs.existsSync(indexPath)) {
            console.error(`[Main] CRITICAL ERROR: Production index.html not found at ${indexPath}`);
        }

        mainWindow.loadFile(indexPath).catch(err => {
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
        tray.setToolTip('MCLC');
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