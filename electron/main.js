const { app, BrowserWindow, ipcMain, protocol, net, Menu, Tray, nativeImage, screen, shell } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
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
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('enable-webgl');
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

ipcMain.handle('app:uninstall', async () => {
    try {
        if (!app.isPackaged) {
            return { success: false, error: 'Uninstall is only available in packaged builds.' };
        }

        if (process.platform === 'win32') {
            const { spawn } = require('child_process');
            const installDir = path.dirname(process.execPath);
            const candidates = [
                path.join(installDir, `Uninstall ${app.getName()}.exe`),
                path.join(installDir, 'Uninstall Lux.exe'),
                path.join(installDir, 'uninstall.exe')
            ];

            const uninstallPath = candidates.find((candidate) => fs.existsSync(candidate));
            if (!uninstallPath) {
                return { success: false, error: 'Could not locate uninstaller executable.' };
            }

            spawn(uninstallPath, [], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false
            }).unref();

            app.quit();
            return { success: true };
        }

        if (process.platform === 'darwin') {
            let appBundlePath = app.getPath('exe');
            while (appBundlePath && !appBundlePath.endsWith('.app')) {
                const parent = path.dirname(appBundlePath);
                if (parent === appBundlePath) break;
                appBundlePath = parent;
            }

            if (!appBundlePath || !appBundlePath.endsWith('.app') || !fs.existsSync(appBundlePath)) {
                return { success: false, error: 'Could not locate application bundle for uninstall.' };
            }

            await shell.trashItem(appBundlePath);
            app.quit();
            return { success: true };
        }

        if (process.platform === 'linux') {
            const appImagePath = process.env.APPIMAGE;
            if (appImagePath && fs.existsSync(appImagePath)) {
                await shell.trashItem(appImagePath);
                app.quit();
                return { success: true };
            }

            const execPath = process.execPath;
            if (execPath && fs.existsSync(execPath)) {
                await shell.trashItem(execPath);
                app.quit();
                return { success: true };
            }

            return { success: false, error: 'Could not determine removable launcher binary on Linux.' };
        }

        return { success: false, error: 'Uninstall is not supported on this platform.' };
    } catch (error) {
        return { success: false, error: error?.message || String(error) };
    }
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

function sendSplashStatus(payload = {}) {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.webContents.send('updater:status', payload);
}

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

async function calculateFileSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function parseSha256FromText(content, targetFileName) {
    const normalizedTarget = String(targetFileName || '').trim().toLowerCase();
    const lines = String(content || '').split(/\r?\n/);

    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        const directHash = line.match(/^([a-f0-9]{64})$/i);
        if (directHash) return directHash[1].toLowerCase();

        const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        if (!match) continue;

        const fileNameInLine = path.basename(match[2].trim()).toLowerCase();
        if (fileNameInLine === normalizedTarget) {
            return match[1].toLowerCase();
        }
    }

    return null;
}

async function resolveExpectedReleaseSha256(axios, release, assetName) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const targetName = String(assetName || '').trim().toLowerCase();

    const sidecarAsset = assets.find((a) => {
        const name = String(a?.name || '').toLowerCase();
        return name === `${targetName}.sha256` || name === `${targetName}.sha256.txt`;
    });

    if (sidecarAsset?.browser_download_url) {
        const response = await axios.get(sidecarAsset.browser_download_url, { timeout: 10000, responseType: 'text' });
        const hash = parseSha256FromText(response.data, assetName);
        if (hash) return hash;
    }

    const checksumsAsset = assets.find((a) => /sha256sums(\.txt)?$/i.test(String(a?.name || '')) || /checksums?(\.txt)?$/i.test(String(a?.name || '')));
    if (checksumsAsset?.browser_download_url) {
        const response = await axios.get(checksumsAsset.browser_download_url, { timeout: 10000, responseType: 'text' });
        const hash = parseSha256FromText(response.data, assetName);
        if (hash) return hash;
    }

    return null;
}

function createSplashWindow() {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const workArea = display.workArea;

    const splashWidth = 300;
    const splashHeight = 350;
    const splashX = Math.round(workArea.x + (workArea.width - splashWidth) / 2);
    const splashY = Math.round(workArea.y + (workArea.height - splashHeight) / 2);

    splashWindow = new BrowserWindow({
        width: splashWidth,
        height: splashHeight,
        x: splashX,
        y: splashY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        icon: path.join(__dirname, '../resources/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '../backend/splashPreload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splashWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
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
}

async function checkAndLaunch() {
    createSplashWindow();

    let retryCount = 0;
    const maxRetries = 3;

    const performCheck = async () => {
        if (isDeveloperMode) {
            console.log('[Main] Skipping update check in dev mode.');
            sendSplashStatus({ status: 'Searching for updates', detail: 'Developer mode active. Skipping remote update check.' });
            setTimeout(() => {
                sendSplashStatus({ status: 'Starting', detail: 'Initializing launcher window...' });
                setTimeout(launchMain, 1500);
            }, 1000);
            return;
        }

        sendSplashStatus({
            status: 'Searching for updates',
            detail: 'Checking latest release metadata from GitHub...',
            retryCount
        });

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
                    sendSplashStatus({ status: 'Starting', detail: 'Recent update attempt detected. Launching app...' });
                    setTimeout(launchMain, 1500);
                    return;
                }

                const platform = process.platform;
                let asset = null;
                if (platform === 'win32') {
                    asset = release.assets.find(a => a.name.endsWith('.exe'));
                } else if (platform === 'linux') {
                    if (process.env.APPIMAGE) {
                        asset = release.assets.find(a => a.name.endsWith('.AppImage'));
                    } else if (fs.existsSync('/usr/bin/apt-get') || fs.existsSync('/usr/bin/dpkg')) {
                        asset = release.assets.find(a => a.name.endsWith('.deb'));
                    } else if (fs.existsSync('/usr/bin/rpm') || fs.existsSync('/usr/bin/dnf')) {
                        asset = release.assets.find(a => a.name.endsWith('.rpm'));
                    } else {
                        asset = release.assets.find(a => a.name.endsWith('.AppImage') || a.name.endsWith('.deb') || a.name.endsWith('.rpm'));
                    }
                } else if (platform === 'darwin') {
                    asset = release.assets.find(a => a.name.endsWith('.zip') || a.name.endsWith('.dmg'));
                }

                if (asset) {
                    sendSplashStatus({ status: 'Downloading update...', detail: `Downloading ${asset.name}...`, progress: 0 });

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
                        sendSplashStatus({ status: `Installing Update (${percent}%)`, detail: 'Verifying and preparing update package...', progress: percent });
                    });

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    const expectedSha256 = await resolveExpectedReleaseSha256(axios, release, asset.name);
                    if (expectedSha256) {
                        const actualSha256 = await calculateFileSha256(targetPath);
                        if (actualSha256 !== expectedSha256) {
                            await fs.remove(targetPath);
                            throw new Error('Update verification failed: checksum mismatch');
                        }
                    } else {
                        console.warn('[Updater] No checksum file found for this release – skipping SHA256 verification.');
                    }

                    sendSplashStatus({ status: 'Update downloaded, installing...', detail: 'Starting installer...' });
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
                            app.quit();
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

            sendSplashStatus({ status: 'Starting', detail: 'No update required. Launching Lux...' });
            setTimeout(launchMain, 1500);

        } catch (err) {
            console.error('[Main] Update check failed:', err);
            retryCount++;
            if (retryCount <= maxRetries) {
                setTimeout(performCheck, 1000);
            } else {
                sendSplashStatus({ status: 'Starting', detail: 'Update check failed after retries. Launching app...' });
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
    sendSplashStatus({ status: 'Starting', detail: 'Creating main application window...' });
    createWindow();
}

function getSplashDisplayWorkArea() {
    if (!splashWindow || splashWindow.isDestroyed()) return null;

    const splashBounds = splashWindow.getBounds();
    const splashCenter = {
        x: Math.round(splashBounds.x + (splashBounds.width / 2)),
        y: Math.round(splashBounds.y + (splashBounds.height / 2))
    };
    const display = screen.getDisplayNearestPoint(splashCenter);
    return display?.workArea || null;
}

function createWindow() {
    sendSplashStatus({ status: 'Starting', detail: 'Configuring window options...' });

    const windowOptions = {
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
    };

    const splashWorkArea = getSplashDisplayWorkArea();
    if (splashWorkArea) {
        let windowWidth = windowOptions.width;
        let windowHeight = windowOptions.height;

        if (windowWidth > splashWorkArea.width) windowWidth = splashWorkArea.width;
        if (windowHeight > splashWorkArea.height) windowHeight = splashWorkArea.height;

        windowOptions.width = windowWidth;
        windowOptions.height = windowHeight;

        const centeredX = Math.round(splashWorkArea.x + ((splashWorkArea.width - windowWidth) / 2));
        const centeredY = Math.round(splashWorkArea.y + ((splashWorkArea.height - windowHeight) / 2));
        windowOptions.x = centeredX;
        windowOptions.y = centeredY;
    }

    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.once('ready-to-show', () => {
        sendSplashStatus({ status: 'Starting', detail: 'Finalizing interface...' });
        
        // Recalculate bounds right before showing in case the user dragged the splash screen while loading
        if (splashWindow && !splashWindow.isDestroyed()) {
            const currentSplashBounds = splashWindow.getBounds();
            const splashCenter = {
                x: Math.round(currentSplashBounds.x + (currentSplashBounds.width / 2)),
                y: Math.round(currentSplashBounds.y + (currentSplashBounds.height / 2))
            };
            const display = screen.getDisplayNearestPoint(splashCenter);
            if (display && display.workArea) {
                const wa = display.workArea;
                let currentBounds = mainWindow.getBounds();
                let nw = currentBounds.width;
                let nh = currentBounds.height;
                if (nw > wa.width) nw = wa.width;
                if (nh > wa.height) nh = wa.height;
                const nx = Math.round(wa.x + (wa.width - nw) / 2);
                const ny = Math.round(wa.y + (wa.height - nh) / 2);
                mainWindow.setBounds({ x: nx, y: ny, width: nw, height: nh });
            }
        }

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
    sendSplashStatus({ status: 'Starting', detail: 'Registering backend handlers...' });
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
        sendSplashStatus({ status: 'Starting', detail: `Loading handler: ${h.name}` });
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
        sendSplashStatus({ status: 'Starting', detail: 'Initializing backup manager...' });
        logToFile('[Main] Initializing Backup Manager...');
        const backupManager = require('../backend/backupManager');
        backupManager.init(ipcMain);
        logToFile('[Main] ✅ Backup Manager initialized.');
    } catch (e) {
        logToFile(`[Main] ❌ Failed to initialize Backup Manager: ${e.message}`);
    }
    if (isDeveloperMode) {
        sendSplashStatus({ status: 'Starting', detail: 'Loading renderer (development mode)...' });
        logToFile('[Main] Loading development URL...');
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        sendSplashStatus({ status: 'Starting', detail: 'Loading launcher interface...' });
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
