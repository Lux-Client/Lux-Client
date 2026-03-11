const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const JSZip = require('jszip');
const { transform } = require('sucrase');
const { getAllInstanceDirsSync } = require('../utils/instances-path');

module.exports = (ipcMain, mainWindow) => {
    const extensionsDir = path.join(app.getPath('userData'), 'extensions');
    const configPath = path.join(app.getPath('userData'), 'extensions.json');
    fs.ensureDirSync(extensionsDir);

    const activeBackendExtensions = new Map();

    const createBackendApi = (id) => ({
        ipc: {
            handle: (channel, listener) => {
                const fullChannel = `ext:${id}:${channel}`;
                try { ipcMain.removeHandler(fullChannel); } catch (e) { }
                ipcMain.handle(fullChannel, (event, ...args) => listener(event, ...args));
            },
            on: (channel, listener) => {
                const fullChannel = `ext:${id}:${channel}`;
                ipcMain.removeAllListeners(fullChannel);
                ipcMain.on(fullChannel, (event, ...args) => listener(event, ...args));
            },
            send: (channel, ...args) => {
                const win = mainWindow || require('electron').BrowserWindow.getAllWindows()[0];
                if (win) {
                    win.webContents.send(`ext:${id}:${channel}`, ...args);
                }
            }
        },
        events: {
            emit: (event, ...args) => {
                ipcMain.emit(`ext-event:${event}`, ...args);
                const win = mainWindow || require('electron').BrowserWindow.getAllWindows()[0];
                if (win) {
                    win.webContents.send(`ext-event:${event}`, ...args);
                }
            },
            on: (event, listener) => {
                ipcMain.on(`ext-event:${event}`, listener);
            }
        },
        launcher: {
            getInstances: () => {
                const names = new Set();
                const baseDirs = getAllInstanceDirsSync();

                for (const instDir of baseDirs) {
                    if (!fs.existsSync(instDir)) continue;

                    const dirs = fs.readdirSync(instDir);
                    for (const dirName of dirs) {
                        const instancePath = path.join(instDir, dirName);
                        const configPath = path.join(instancePath, 'instance.json');

                        try {
                            if (fs.statSync(instancePath).isDirectory() && fs.existsSync(configPath)) {
                                names.add(dirName);
                            }
                        } catch (_) {
                        }
                    }
                }

                return Array.from(names);
            }
        },
        app,
        id,
        axios,
        fs,
        path
    });

    const loadBackend = async (id, extensionPath) => {
        const backendPath = path.join(extensionPath, 'backend.js');

        const resolvedBackendPath = path.resolve(backendPath);
        if (!resolvedBackendPath.startsWith(extensionsDir)) {
            console.error(`[Extensions] Blocked attempt to load backend outside extensions directory: ${resolvedBackendPath}`);
            return;
        }

        if (await fs.pathExists(resolvedBackendPath)) {
            try {
                console.log(`[Extensions] Loading backend for ${id}...`);

                delete require.cache[require.resolve(resolvedBackendPath)];
                const backendModule = require(resolvedBackendPath);
                const api = createBackendApi(id);

                if (typeof backendModule.activate === 'function') {
                    await backendModule.activate(api);
                }

                activeBackendExtensions.set(id, { module: backendModule, api });
            } catch (e) {
                console.error(`[Extensions] Failed to load backend for ${id}:`, e);
            }
        }
    };

    const unloadBackend = async (id) => {
        const active = activeBackendExtensions.get(id);
        if (active) {
            try {
                if (typeof active.module.deactivate === 'function') {
                    await active.module.deactivate();
                }
            } catch (e) {
                console.error(`[Extensions] Failed to deactivate backend for ${id}:`, e);
            }
            activeBackendExtensions.delete(id);
        }
    };
    const loadConfig = async () => {
        try {
            if (await fs.pathExists(configPath)) {
                return await fs.readJson(configPath);
            }
        } catch (e) { console.error("Failed to load extensions config", e); }
        return { enabled: {} };
    };
    const saveConfig = async (config) => {
        try {
            await fs.writeJson(configPath, config, { spaces: 2 });
        } catch (e) { console.error("Failed to save extensions config", e); }
    };
    ipcMain.handle('extensions:list', async () => {
        try {
            const dirs = await fs.readdir(extensionsDir);
            const extensions = [];
            const config = await loadConfig();

            for (const dir of dirs) {
                const manifestPath = path.join(extensionsDir, dir, 'manifest.json');
                if (await fs.pathExists(manifestPath)) {
                    try {
                        const manifest = await fs.readJson(manifestPath);

                        if (!manifest.main && manifest.entry) {
                            manifest.main = manifest.entry;
                        }

                        if (manifest.main) {
                            manifest.main = manifest.main.replace(/\.(jsx|tsx)$/, '.js');
                        }
                        const isEnabled = config.enabled[dir] !== false;
                        let iconPath = null;
                        if (manifest.icon) {
                            iconPath = path.join(extensionsDir, dir, manifest.icon).replace(/\\/g, '/');
                        }

                        extensions.push({
                            id: dir,
                            ...manifest,
                            enabled: isEnabled,
                            iconPath: iconPath,
                            localPath: path.join(extensionsDir, dir).replace(/\\/g, '/')
                        });
                    } catch (e) {
                        console.error(`Failed to read manifest for extension ${dir}`, e);
                    }
                }
            }
            return { success: true, extensions };
        } catch (error) {
            console.error('Failed to list extensions:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:toggle', async (_, id, enabled) => {
        try {
            const config = await loadConfig();
            config.enabled[id] = enabled;
            await saveConfig(config);

            if (enabled) {
                const targetPath = path.join(extensionsDir, id);
                await loadBackend(id, targetPath);
            } else {
                await unloadBackend(id);
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:install', async (_, sourcePath) => {
        try {
            let buffer;
            if (sourcePath.startsWith('http')) {
                const response = await axios.get(sourcePath, { responseType: 'arraybuffer' });
                buffer = response.data;
            } else {
                buffer = await fs.readFile(sourcePath);
            }

            const zip = await JSZip.loadAsync(buffer);
            const manifestFile = zip.file('manifest.json');
            if (!manifestFile) {
                return { success: false, error: 'Invalid extension: missing manifest.json' };
            }

            const manifestContent = await manifestFile.async('text');
            const manifest = JSON.parse(manifestContent);

            if (!manifest.id) {
                manifest.id = (manifest.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]/g, '-');
            }
            const entryFile = manifest.main || manifest.entry || 'index.js';
            const entryBasename = entryFile.replace(/\.(js|jsx|tsx)$/, '');
            const hasEntry = zip.file(entryFile) ||
                zip.file(`${entryBasename}.jsx`) ||
                zip.file(`${entryBasename}.tsx`);

            if (!hasEntry) {
                return { success: false, error: `Invalid extension: missing entry file (${entryFile}) in root` };
            }
            const installPath = path.join(extensionsDir, manifest.id);
            await fs.ensureDir(installPath);
            for (const filename of Object.keys(zip.files)) {
                if (zip.files[filename].dir) continue;

                const normalizedFilename = path.normalize(filename);
                if (normalizedFilename.startsWith('..') || path.isAbsolute(normalizedFilename)) {
                    console.warn(`[Extensions] Skipping suspicious file in ZIP: ${filename}`);
                    continue;
                }

                const fileData = await zip.files[filename].async('nodebuffer');
                const destPath = path.join(installPath, normalizedFilename);

                if (!destPath.startsWith(installPath)) {
                    console.warn(`[Extensions] Blocked attempt to write outside install directory: ${destPath}`);
                    continue;
                }

                await fs.ensureDir(path.dirname(destPath));
                if (filename.endsWith('.jsx') || filename.endsWith('.tsx') || filename.endsWith('.js')) {
                    const code = fileData.toString('utf-8');
                    try {
                        const compiled = transform(code, {
                            transforms: ['jsx', 'imports'],
                            filePath: filename
                        });

                        const jsPath = destPath.replace(/\.(jsx|tsx)$/, '.js');
                        await fs.writeFile(jsPath, compiled.code);
                    } catch (e) {
                        console.error(`Failed to transpile ${filename}:`, e);

                        await fs.writeFile(destPath, fileData);
                    }
                } else {
                    await fs.writeFile(destPath, fileData);
                }
            }
            const config = await loadConfig();
            config.enabled[manifest.id] = true;
            await saveConfig(config);

            return { success: true, id: manifest.id };
        } catch (error) {
            console.error('Failed to install extension:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:remove', async (_, extensionId) => {
        try {
            const targetPath = path.join(extensionsDir, extensionId);
            if (await fs.pathExists(targetPath)) {
                await fs.remove(targetPath);
                const config = await loadConfig();
                delete config.enabled[extensionId];
                await saveConfig(config);

                return { success: true };
            }
            return { success: false, error: 'Extension not found' };
        } catch (error) {
            console.error('Failed to remove extension:', error);
            return { success: false, error: error.message };
        }
    });
    const initBackends = async () => {
        const config = await loadConfig();
        const dirs = await fs.readdir(extensionsDir);
        for (const id of dirs) {
            if (config.enabled[id] !== false) {
                await loadBackend(id, path.join(extensionsDir, id));
            }
        }
    };
    initBackends();

    ipcMain.handle('extensions:fetch-marketplace', async () => {
        return { success: true, extensions: [] };
    });
};