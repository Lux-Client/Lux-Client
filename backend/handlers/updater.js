// @ts-nocheck
const { app, shell } = require('electron');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { compareVersions } = require('../utils/version-utils');
const { fetchAndVerifyManifest, verifyArtifactHash } = require('../utils/manifest-verify');
const pkg = require('../../package.json');

const REPO = 'Lux-Client/Lux-Client';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

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

async function resolveExpectedReleaseSha256(release, assetName) {
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

module.exports = (ipcMain, mainWindow) => {
    let testVersionOverride = null;
    let latestRelease = null;
    let verifiedManifest = null;

    ipcMain.handle('updater:check', async () => {
        try {
            console.log(`[Updater] Checking for updates... (Current: ${testVersionOverride || pkg.version})`);
            const response = await axios.get(GITHUB_API, {
                headers: { 'User-Agent': 'Lux-AutoUpdater' }
            });

            const release = response.data;
            latestRelease = release;
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
                    if (process.env.APPIMAGE) {
                        asset = assets.find(a => a.name.endsWith('.AppImage'));
                    } else if (fs.existsSync('/usr/bin/apt') || fs.existsSync('/usr/bin/apt-get') || fs.existsSync('/usr/bin/dpkg')) {
                        asset = assets.find(a => a.name.endsWith('.deb')) ||
                            assets.find(a => a.name.endsWith('.AppImage')) ||
                            assets.find(a => a.name.endsWith('.rpm'));
                    } else if (fs.existsSync('/usr/bin/rpm') || fs.existsSync('/usr/bin/dnf')) {
                        asset = assets.find(a => a.name.endsWith('.rpm')) ||
                            assets.find(a => a.name.endsWith('.AppImage')) ||
                            assets.find(a => a.name.endsWith('.deb'));
                    } else {
                        asset = assets.find(a => a.name.endsWith('.AppImage')) ||
                            assets.find(a => a.name.endsWith('.deb')) ||
                            assets.find(a => a.name.endsWith('.rpm'));
                    }
                } else if (platform === 'darwin') {
                    asset = assets.find(a => a.name.endsWith('.zip')) ||
                        assets.find(a => a.name.endsWith('.dmg'));
                }
            }

            // Fetch and verify the release manifest before returning update info
            if (needsUpdate) {
                try {
                    verifiedManifest = await fetchAndVerifyManifest(axios, release);
                    console.log(`[Updater] Manifest verified for version ${verifiedManifest.version} with ${Object.keys(verifiedManifest.artifacts).length} artifacts`);
                } catch (manifestError) {
                    console.error('[Updater] Manifest verification failed:', manifestError.message);
                    verifiedManifest = null;
                    return {
                        currentVersion,
                        latestVersion,
                        needsUpdate: false,
                        manifestError: manifestError.message,
                        releaseNotes: release.body,
                        asset: null
                    };
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

            const totalLength = parseInt(response.headers['content-length'], 10) || 0;
            let downloadedLength = 0;

            const writer = fs.createWriteStream(targetPath);
            response.data.pipe(writer);

            response.data.on('data', (chunk) => {
                downloadedLength += chunk.length;
                const percent = totalLength ? Math.min(100, Math.round((downloadedLength / totalLength) * 100)) : 0;
                mainWindow.webContents.send('updater:progress', {
                    percent,
                    bytesTransferred: downloadedLength,
                    totalBytes: totalLength
                });
            });

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Verify artifact hash from release manifest (primary verification)
            if (verifiedManifest && verifiedManifest.artifacts) {
                const manifestResult = await verifyArtifactHash(verifiedManifest, assetName, targetPath);
                if (!manifestResult.valid) {
                    try { await fs.remove(targetPath); } catch (_) { /* cleanup best-effort */ }
                    throw new Error(
                        `Update verification failed: manifest hash mismatch for ${assetName}. ` +
                        (manifestResult.error || `Expected ${manifestResult.expected}, got ${manifestResult.actual}.`)
                    );
                }
                console.log(`[Updater] Manifest hash verified for ${assetName}: ${manifestResult.actual}`);
                return { success: true, path: targetPath };
            }

            // Fallback: verify using sidecar .sha256 checksum files
            const expectedHash = await resolveExpectedReleaseSha256(latestRelease, assetName);
            if (!expectedHash) {
                try { await fs.remove(targetPath); } catch (_) { /* cleanup best-effort */ }
                throw new Error(`Update verification failed: no checksum file found for ${assetName}. Refusing to install unverified update.`);
            }

            const actualHash = await calculateFileSha256(targetPath);
            if (actualHash !== expectedHash) {
                try { await fs.remove(targetPath); } catch (_) { /* cleanup best-effort */ }
                throw new Error(`Update verification failed: SHA-256 mismatch for ${assetName}. Expected ${expectedHash}, got ${actualHash}.`);
            }

            console.log(`[Updater] SHA-256 verified for ${assetName}: ${actualHash}`);
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
                } else if (filePath.endsWith('.deb')) {
                    const aptBinary = fs.existsSync('/usr/bin/apt') ? '/usr/bin/apt' : fs.existsSync('/usr/bin/apt-get') ? '/usr/bin/apt-get' : null;
                    if (aptBinary) {
                        const relativeDebPath = `./${path.basename(filePath)}`;
                        spawn('pkexec', [aptBinary, 'install', '-y', relativeDebPath], {
                            detached: true,
                            stdio: 'ignore',
                            cwd: path.dirname(filePath)
                        }).unref();
                    } else {
                        spawn('pkexec', ['/usr/bin/dpkg', '-i', filePath], { detached: true, stdio: 'ignore' }).unref();
                    }
                    app.quit();
                } else if (filePath.endsWith('.rpm')) {
                    const dnfBinary = fs.existsSync('/usr/bin/dnf') ? '/usr/bin/dnf' : null;
                    if (dnfBinary) {
                        spawn('pkexec', [dnfBinary, 'install', '-y', filePath], { detached: true, stdio: 'ignore' }).unref();
                    } else {
                        spawn('pkexec', ['/usr/bin/rpm', '-Uvh', filePath], { detached: true, stdio: 'ignore' }).unref();
                    }
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
