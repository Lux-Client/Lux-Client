const { app, BrowserWindow, ipcMain } = require('electron');
console.log('☢️ NUCLEAR STARTUP CHECK: main/main.js is running!');

ipcMain.handle('ping', () => {
    console.log('📥 [main/main.js] Ping received!');
    return 'pong-from-main';
});

ipcMain.handle('instance:unified-import-v3', async () => {
    console.log('🚀 [main/main.js] BYPASS import handler triggered!');
    return { success: false, error: 'Bypass active in main/main.js.' };
});
const path = require('path');
const fs = require('fs');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 900,
        minHeight: 600,
        title: 'Lux Launcher',
        frame: false,
        backgroundColor: '#121212',
        webPreferences: {
            preload: path.join(__dirname, '../backend/preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
    });
    require('../backend/handlers/auth')(ipcMain, mainWindow);
    require('../backend/handlers/instances')(ipcMain, mainWindow);
    require('../backend/handlers/launcher')(ipcMain, mainWindow);
    require('../backend/handlers/modrinth')(ipcMain);
    require('../backend/handlers/data')(ipcMain);
    require('../backend/handlers/settings')(ipcMain);
    require('../backend/handlers/external')(ipcMain, mainWindow);
    const discord = require('../backend/handlers/discord');
    discord.initRPC();
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => mainWindow.close());
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});