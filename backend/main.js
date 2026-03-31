const { app, BrowserWindow, ipcMain, protocol } = require('electron');

const path = require('path');
const fs = require('fs-extra');

console.log('Electron versions:', process.versions);
if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 900,
        minHeight: 600,
        title: 'Lux Client',
        frame: false,
        backgroundColor: '#121212',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });

    console.log('[Main] Preload script configured.');
    console.log('[Main] ========== REGISTRIERE ALLE HANDLER ==========');

    try {

        console.log('[Main] Registering auth handler...');
        require('./handlers/auth')(ipcMain, mainWindow);
        console.log('[Main] Registering instances handler...');
        require('./handlers/instances')(ipcMain, mainWindow);
        console.log('[Main] Registering launcher handler...');
        const launcherApi = require('./handlers/launcher')(ipcMain, mainWindow);
        const handleCliArgs = (argv) => {
            console.log('[Main] Processing CLI args:', argv);
            const runIndex = argv.indexOf('run');
            if (runIndex !== -1 && argv.length > runIndex + 1) {
                const instanceName = argv[runIndex + 1];
                console.log(`[Main] CLI Launch request detected for: ${instanceName}`);
                setTimeout(() => {
                    console.log(`[Main] Triggering CLI launch for ${instanceName}`);
                    launcherApi.launchInstance(instanceName).catch(err => {
                        console.error('[Main] CLI launch failed:', err);
                    });
                }, 3000);
            }
        };
        handleCliArgs(process.argv);
        const gotTheLock = app.requestSingleInstanceLock();
        if (!gotTheLock) {
            app.quit();
        } else {
            app.on('second-instance', (event, commandLine, workingDirectory) => {

                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                }

                handleCliArgs(commandLine);
            });
        }
        console.log('[Main] Registering modrinth handler...');
        require('./handlers/modrinth')(ipcMain, mainWindow);
        console.log('[Main] Registering data handler...');
        require('./handlers/data')(ipcMain, mainWindow);
        console.log('[Main] Registering settings handler...');
        require('./handlers/settings')(ipcMain, mainWindow);
        console.log('[Main] Registering external handler...');
        require('./handlers/external')(ipcMain, mainWindow);
        console.log('[Main] Registering server handler...');
        require('./handlers/servers')(ipcMain, mainWindow);
        console.log('[Main] Registering modpack code handler...');
        try {
            const modpackHandler = require('./handlers/modpackCode');
            modpackHandler(ipcMain, mainWindow);
            console.log('[Main] Modpack code handler registered successfully.');
        } catch (error) {
            console.error('[Main] Error registering modpack code handler:', error);
        }
        console.log('[Main] Registering skins handler...');
        require('./handlers/skins')(ipcMain, mainWindow);
        console.log('[Main] Registering extensions handler...');
        require('./handlers/extensions')(ipcMain, mainWindow);
        console.log('[Main] Registering cloud backup handler...');
        require('./handlers/cloudBackup')(ipcMain, mainWindow);
        console.log('[Main] Registering texturepacks handler...');
        require('./handlers/texturepacks')(ipcMain, mainWindow);
        console.log('[Main] Registering remote control handler...');
        require('./handlers/remoteControl')(ipcMain, mainWindow);
        console.log('[Main] Registering discord handler...');
        try {
            const discord = require('./handlers/discord');
            discord.initRPC();
        } catch (error) {
            console.error('[Main] Discord RPC error:', error);
        }

        console.log('[Main] All handlers registered successfully.');
    } catch (error) {
        console.error('[Main] Error registering handlers:', error);
    }
    const allHandlers = ipcMain._events ? Object.keys(ipcMain._events) : [];
    console.log('[Main] ALLE registrierten IPC Handler:', allHandlers);
    const modpackHandlers = allHandlers.filter(key => key.includes('modpack'));
    console.log('[Main] Modpack Handler gefunden:', modpackHandlers);
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => mainWindow.close());

    ipcMain.handle('app:get-version', () => {
        try {
            const pkg = require(path.join(__dirname, '../package.json'));
            return pkg.version;
        } catch (e) {
            return app.getVersion();
        }
    });

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('extension', (request, callback) => {
        const url = request.url.replace(/^extension:\/\/?/, '');
        try {
            const decodedUrl = decodeURIComponent(url);
            const extensionsDir = path.join(app.getPath('userData'), 'extensions');
            const filePath = path.normalize(path.join(extensionsDir, decodedUrl));

            if (!filePath.startsWith(extensionsDir)) {
                return callback({ error: -2 });
            }
            callback({ path: filePath });
        } catch (error) {
            console.error('Failed to parse extension URL:', error);
            callback({ error: -2 });
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
