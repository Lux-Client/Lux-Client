const { app, shell } = require('electron');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { compareVersions } = require('../utils/version-utils');
const pkg = require('../../package.json');

const REPO = 'Lux-Client/Lux-Client';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

module.exports = (ipcMain, mainWindow) => {
    let testVersionOverride = null;

    ipcMain.handle('updater:check', async () => {
        try {
            console.log(`[Updater] Checking for updates... (Current: ${testVersionOverride || pkg.version})`);
            const response = await axios.get(GITHUB_API, {
                headers: { 'User-Agent': 'Lux-AutoUpdater' }
            });

            const release = response.data;
            const latestVersion = release.tag_name;
            const currentVersion = testVersionOverride || pkg.version;

            const comparison = compareVersions(currentVersion, latestVersion);
            const needsUpdate = comparison === 1;

            let asset = null;
            if (needsUpdate) {
                const platform = process.platform;
                const assets = release.assets;

                if (platform === 'win32') {
                    asset = assets.find(a => a.name.endsWith('.exe'));
                } else if (platform === 'linux') {
                    asset = assets.find(a => a.name.endsWith('.AppImage')) ||
                        assets.find(a => a.name.endsWith('.deb')) ||
                        assets.find(a => a.name.endsWith('.rpm'));
                } else if (platform === 'darwin') {
                    asset = assets.find(a => a.name.endsWith('.zip')) ||
                        assets.find(a => a.name.endsWith('.dmg'));
                }
            }

            return {
                currentVersion,
                latestVersion,
                needsUpdate,
                releaseNotes: release.body,
                asset: asset ? {
                    name: asset.name,
                    size: asset.size,
                    url: asset.browser_download_url
                } : null
            };
        } catch (error) {
            console.error('[Updater] Check failed:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('updater:download', async (_, assetUrl, assetName) => {
        try {
            const downloadDir = path.join(app.getPath('userData'), 'updates');
            await fs.ensureDir(downloadDir);
            const targetPath = path.join(downloadDir, assetName);

            console.log(`[Updater] Downloading update to ${targetPath}...`);

            const response = await axios({
                url: assetUrl,
                method: 'GET',
                responseType: 'stream'
            });

            const totalLength = response.headers['content-length'];
            let downloadedLength = 0;

            const writer = fs.createWriteStream(targetPath);
            response.data.pipe(writer);

            response.data.on('data', (chunk) => {
                downloadedLength += chunk.length;
                const progress = totalLength ? (downloadedLength / totalLength) * 100 : 0;
                mainWindow.webContents.send('updater:progress', progress);
            });

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return { success: true, path: targetPath };
        } catch (error) {
            console.error('[Updater] Download failed:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('updater:install', async (_, filePath) => {
        try {
            console.log(`[Updater] Installing update from ${filePath}...`);

            if (process.platform === 'win32') {
                const updateScript = path.join(path.dirname(filePath), 'update.vbs');
                const exeTarget = process.execPath;
                const vbsContent = `Set objShell = WScript.CreateObject("WScript.Shell")
WScript.Sleep 2000
objShell.Run """" & WScript.Arguments(0) & """ /S", 1, True
objShell.Run """" & WScript.Arguments(1) & """", 1, False`;
                fs.writeFileSync(updateScript, vbsContent);
                spawn('wscript.exe', [updateScript, filePath, exeTarget], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                app.quit();
            } else if (process.platform === 'linux') {
                if (filePath.endsWith('.AppImage')) {
                    fs.chmodSync(filePath, 0o755);
                    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
                    app.quit();
                } else {
                    shell.openPath(path.dirname(filePath));
                }
            } else {
                shell.openPath(filePath);
            }

            return { success: true };
        } catch (error) {
            console.error('[Updater] Install failed:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('updater:set-test-version', (_, version) => {
        console.log(`[Updater] Setting test version override to: ${version}`);
        testVersionOverride = version;
        return { success: true, currentVersion: version };
    });

    async function runAutoUpdate() {
        console.log('[Updater] Running automatic background update check...');
        try {
            await ipcMain.emit('updater:check');
        } catch (e) { }
    }
};
