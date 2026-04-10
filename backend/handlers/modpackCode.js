const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { installModInternal } = require('./modrinth');
const { resolvePrimaryInstancesDir } = require('../utils/instances-path');
const { getUserProfile } = require('../utils/secureProfileStore');
const SERVER_URL = 'https://lux.pluginhub.de';

console.log('[ModpackCode-Handler] 🔧 Modul wird geladen...');

function calculateSha1(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha1');
        const stream = fs.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}

module.exports = (ipcMain, win) => {
    console.log('[ModpackCode-Handler] 🔌 Registriere Handler...');

    const appData = app.getPath('userData');
    const instancesDir = resolvePrimaryInstancesDir();
    const modCachePath = path.join(appData, 'mods_cache.json');
    ipcMain.handle('modpack:export-code', async (event, data) => {
        console.log('[ModpackCode-Handler] 📤 Export handler AUFGERUFEN', data);
        try {
            const { name, mods, resourcePacks, shaders, instanceVersion, instanceLoader, instanceName } = data;

            const Store = require('electron-store');
            const store = new Store();
            const profile = getUserProfile(store);
            const ownerUuid = profile ? profile.uuid : null;

            let optionsContent = null;
            if (instanceName) {
                const optionsPath = path.join(instancesDir, instanceName, 'options.txt');
                if (await fs.pathExists(optionsPath)) {
                    optionsContent = await fs.readFile(optionsPath, 'utf8');
                    console.log('[ModpackCode-Handler] ✅ Keybinds (options.txt) included in export');
                }
            }
            const exportData = {
                name: name || 'My Modpack',
                mods: mods?.map(m => ({
                    projectId: m.projectId,
                    versionId: m.versionId,
                    fileName: m.name || m.fileName,
                    title: m.title || m.name,
                    icon: m.icon
                })) || [],
                resourcePacks: resourcePacks?.map(p => ({
                    projectId: p.projectId,
                    versionId: p.versionId,
                    fileName: p.name || p.fileName,
                    title: p.title || p.name,
                    icon: p.icon
                })) || [],
                shaders: shaders?.map(s => ({
                    projectId: s.projectId,
                    versionId: s.versionId,
                    fileName: s.name || s.fileName,
                    title: s.title || s.name,
                    icon: s.icon
                })) || [],
                instanceVersion,
                instanceLoader,
                keybinds: optionsContent,
                ownerUuid
            };
            const response = await axios.post(`${SERVER_URL}/api/modpack/save`, exportData, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data.success) {
                return { success: true, code: response.data.code };
            } else {
                return { success: false, error: 'Server returned an error' };
            }
        } catch (error) {
            console.error('[ModpackCode-Handler] ❌ Export error:', error);
            if (error.code === 'ECONNREFUSED') {
                return { success: false, error: 'Modpack Code Server is not running on port 4000.' };
            }
            return {
                success: false,
                error: error.response?.data?.error || error.message || 'Failed to connect to server'
            };
        }
    });

    console.log('[ModpackCode-Handler] 📋 Registriere modpack:list-codes...');
    ipcMain.handle('modpack:list-codes', async () => {
        console.log('[ModpackCode-Handler] 📋 modpack:list-codes AUFGERUFEN');
        try {
            const Store = require('electron-store');
            const store = new Store();
            const profile = getUserProfile(store);
            if (!profile) return { success: false, error: 'Not logged in' };

            const response = await axios.get(`${SERVER_URL}/api/modpack/my-codes?uuid=${profile.uuid}`, { timeout: 10000 });
            return response.data;
        } catch (error) {
            console.error('[ModpackCode-Handler] ❌ List codes error:', error);
            return { success: false, error: error.response?.data?.error || 'Failed to fetch codes' };
        }
    });

    console.log('[ModpackCode-Handler] 🗑️ Registriere modpack:delete-code...');
    ipcMain.handle('modpack:delete-code', async (event, code) => {
        console.log('[ModpackCode-Handler] 🗑️ modpack:delete-code AUFGERUFEN:', code);
        try {
            const Store = require('electron-store');
            const store = new Store();
            const profile = getUserProfile(store);
            if (!profile) return { success: false, error: 'Not logged in' };

            const response = await axios.delete(`${SERVER_URL}/api/modpack/delete/${code}?uuid=${profile.uuid}`, { timeout: 10000 });
            return response.data;
        } catch (error) {
            console.error('[ModpackCode-Handler] ❌ Delete code error:', error);
            return { success: false, error: error.response?.data?.error || 'Failed to delete code' };
        }
    });

    console.log('[ModpackCode-Handler] 📥 Registriere modpack:import-code...');
    ipcMain.handle('modpack:import-code', async (event, code) => {
        console.log('[ModpackCode-Handler] 📥 modpack:import-code AUFGERUFEN:', code);
        try {
            if (!code || code.length !== 8) {
                return { success: false, error: 'Invalid code format. Code must be 8 characters.' };
            }

            const response = await axios.get(`${SERVER_URL}/api/modpack/${code}`, { timeout: 10000 });

            if (!response.data || !response.data.success) {
                return { success: false, error: 'Code not found' };
            }

            return { success: true, data: response.data.data };
        } catch (error) {
            console.error('[ModpackCode-Handler] ❌ Import metadata error:', error);
            if (error.response?.status === 404) return { success: false, error: 'Code not found' };
            return {
                success: false,
                error: error.response?.data?.error || error.message || 'Failed to connect to server'
            };
        }
    });
    ipcMain.handle('modpack:install-shared-content', async (event, { instanceName, modpackData }) => {
        console.log(`[ModpackCode-Handler] Starting background install for: ${instanceName}`);

        const gameVersion = modpackData?.instanceVersion || modpackData?.version || null;
        const loader = modpackData?.instanceLoader || modpackData?.loader || null;
        const normalizedLoader = loader ? String(loader).toLowerCase() : null;
        const normalizeContentItem = (item) => {
            if (typeof item === 'string') {
                return {
                    projectId: item,
                    title: item,
                    fileName: item
                };
            }
            return item || {};
        };

        const normalizedMods = (modpackData.mods || []).map(normalizeContentItem);
        const normalizedResourcePacks = (modpackData.resourcePacks || []).map(normalizeContentItem);
        const normalizedShaders = (modpackData.shaders || []).map(normalizeContentItem);

        const totalItems = normalizedMods.length +
            normalizedResourcePacks.length +
            normalizedShaders.length;
        win.webContents.send('install:progress', {
            instanceName: instanceName,
            progress: 0,
            status: 'Preparing installation...'
        });
        const localModCache = {};
        const saveModCache = async () => {
            try {
                let currentCache = {};
                if (await fs.pathExists(modCachePath)) {
                    try {
                        currentCache = await fs.readJson(modCachePath);
                    } catch (e) { }
                }
                const merged = { ...currentCache, ...localModCache };
                await fs.writeJson(modCachePath, merged);
                console.log('[ModpackCode-Handler] Cache safely updated.');
            } catch (e) {
                console.error('[ModpackCode-Handler] Failed to save mods cache:', e);
            }
        };

        if (totalItems === 0) {
            if (modpackData.keybinds) {
                const optionsPath = path.join(instancesDir, instanceName, 'options.txt');
                await fs.writeFile(optionsPath, modpackData.keybinds);
            }
            return { success: true };
        }

        let installedCount = 0;

        const reportProgress = (status, individualProgress = null) => {

            const overallProgress = Math.round((installedCount / totalItems) * 100);

            win.webContents.send('install:progress', {
                instanceName: instanceName,
                progress: individualProgress !== null ? individualProgress : overallProgress,
                status: status || `Importing modpack: ${installedCount}/${totalItems}`
            });
        };

        try {

            try {
                const instanceJsonPath = path.join(instancesDir, instanceName, 'instance.json');
                if (await fs.pathExists(instanceJsonPath)) {
                    const config = await fs.readJson(instanceJsonPath);
                    config.status = 'installing';
                    await fs.writeJson(instanceJsonPath, config);
                }
            } catch (e) {
                console.error('[ModpackCode-Handler] Failed to set instance status:', e);
            }
            if (modpackData.keybinds) {
                const optionsPath = path.join(instancesDir, instanceName, 'options.txt');
                await fs.writeFile(optionsPath, modpackData.keybinds);
                console.log('[ModpackCode-Handler] Keybinds restored.');
            }
            const resolveModrinthDownloadUrl = async (item, projectType) => {
                try {
                    let versionData = null;

                    if (item.versionId) {
                        const versionRes = await axios.get(`https://api.modrinth.com/v2/version/${item.versionId}`, {
                            headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                            timeout: 10000
                        });
                        versionData = versionRes.data;
                    } else if (item.projectId) {
                        const params = {};
                        if (gameVersion) params.game_versions = JSON.stringify([String(gameVersion)]);
                        if (normalizedLoader && projectType === 'mod') params.loaders = JSON.stringify([normalizedLoader]);

                        const versionsRes = await axios.get(`https://api.modrinth.com/v2/project/${item.projectId}/version`, {
                            headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                            params,
                            timeout: 10000
                        });

                        const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [];
                        versionData = versions.find(v => Array.isArray(v.files) && v.files.length > 0) || null;
                    }

                    if (!versionData || !Array.isArray(versionData.files) || versionData.files.length === 0) {
                        return null;
                    }

                    const file = versionData.files.find(f => f.primary) || versionData.files[0];
                    return {
                        url: file.url,
                        filename: file.filename,
                        versionNumber: versionData.version_number,
                        versionId: versionData.id
                    };
                } catch (e) {
                    console.error(`[ModpackCode-Handler] Failed to resolve URL for item ${item?.projectId || item?.versionId || 'unknown'}:`, e.message);
                    return null;
                }
            };
            for (const mod of normalizedMods) {
                reportProgress(`Downloading mod: ${mod.title}`);
                const resolved = await resolveModrinthDownloadUrl(mod, 'mod');
                if (!resolved) {
                    console.error(`[ModpackCode-Handler] Skipping mod ${mod.title}: could not resolve download URL`);
                    installedCount++;
                    reportProgress();
                    continue;
                }

                const result = await installModInternal(win, {
                    instanceName,
                    projectId: mod.projectId,
                    versionId: mod.versionId || resolved.versionId,
                    filename: resolved.filename || mod.fileName,
                    url: resolved.url,
                    projectType: 'mod'
                });

                if (result.success) {
                    if (result.skipped) {
                        console.log(`[ModpackCode-Handler] Skipped mod: ${mod.title} (Reason: ${result.error || 'Download failed'})`);
                    } else {
                        try {
                            const actualFileName = resolved.filename || mod.fileName;
                            const filePath = path.join(instancesDir, instanceName, 'mods', actualFileName);
                            if (await fs.pathExists(filePath)) {
                                const fsStats = await fs.stat(filePath);
                                const cacheKey = `${actualFileName}-${fsStats.size}`;
                                localModCache[cacheKey] = {
                                    title: mod.title,
                                    icon: mod.icon,
                                    version: resolved.versionNumber,
                                    projectId: mod.projectId,
                                    versionId: mod.versionId || resolved.versionId,
                                    timestamp: Date.now()
                                };
                                console.log(`[ModpackCode-Handler] Cached metadata for mod: ${mod.title} (Key: ${cacheKey})`);
                            }
                        } catch (cacheErr) {
                            console.error('Failed to update cache for mod', mod.title, cacheErr);
                        }
                    }
                }
                installedCount++;
                reportProgress();
            }
            for (const pack of normalizedResourcePacks) {
                reportProgress(`Downloading pack: ${pack.title}`);

                const resolved = await resolveModrinthDownloadUrl(pack, 'resourcepack');
                if (!resolved) {
                    console.error(`[ModpackCode-Handler] Skipping pack ${pack.title}: could not resolve download URL`);
                    installedCount++;
                    reportProgress();
                    continue;
                }

                const result = await installModInternal(win, {
                    instanceName,
                    projectId: pack.projectId,
                    versionId: pack.versionId || resolved.versionId,
                    filename: resolved.filename || pack.fileName,
                    url: resolved.url,
                    projectType: 'resourcepack'
                });

                if (result.success) {
                    if (result.skipped) {
                        console.log(`[ModpackCode-Handler] Skipped resourcepack: ${pack.title} (Reason: ${result.error || 'Download failed'})`);
                    } else {
                        try {
                            const actualFileName = resolved.filename || pack.fileName;
                            const filePath = path.join(instancesDir, instanceName, 'resourcepacks', actualFileName);
                            if (await fs.pathExists(filePath)) {
                                const fsStats = await fs.stat(filePath);
                                const cacheKey = `${actualFileName}-${fsStats.size}`;
                                localModCache[cacheKey] = {
                                    title: pack.title,
                                    icon: pack.icon,
                                    version: resolved.versionNumber,
                                    projectId: pack.projectId,
                                    versionId: pack.versionId || resolved.versionId,
                                    timestamp: Date.now()
                                };
                                console.log(`[ModpackCode-Handler] Cached metadata for resourcepack: ${pack.title} (Key: ${cacheKey})`);
                            }
                        } catch (cacheErr) {
                            console.error('Failed to update cache for resourcepack', pack.title, cacheErr);
                        }
                    }
                }
                installedCount++;
                reportProgress();
            }
            for (const shader of normalizedShaders) {
                reportProgress(`Downloading shader: ${shader.title}`);

                const resolved = await resolveModrinthDownloadUrl(shader, 'shader');
                if (!resolved) {
                    console.error(`[ModpackCode-Handler] Skipping shader ${shader.title}: could not resolve download URL`);
                    installedCount++;
                    reportProgress();
                    continue;
                }

                const result = await installModInternal(win, {
                    instanceName,
                    projectId: shader.projectId,
                    versionId: shader.versionId || resolved.versionId,
                    filename: resolved.filename || shader.fileName,
                    url: resolved.url,
                    projectType: 'shader'
                });

                if (result.success) {
                    if (result.skipped) {
                        console.log(`[ModpackCode-Handler] Skipped shader: ${shader.title} (Reason: ${result.error || 'Download failed'})`);
                    } else {
                        try {
                            const actualFileName = resolved.filename || shader.fileName;
                            const filePath = path.join(instancesDir, instanceName, 'shaderpacks', actualFileName);
                            if (await fs.pathExists(filePath)) {
                                const fsStats = await fs.stat(filePath);
                                const cacheKey = `${actualFileName}-${fsStats.size}`;
                                localModCache[cacheKey] = {
                                    title: shader.title,
                                    icon: shader.icon,
                                    version: resolved.versionNumber,
                                    projectId: shader.projectId,
                                    versionId: shader.versionId || resolved.versionId,
                                    timestamp: Date.now()
                                };
                                console.log(`[ModpackCode-Handler] Cached metadata for shader: ${shader.title} (Key: ${cacheKey})`);
                            }
                        } catch (cacheErr) {
                            console.error('Failed to update cache for shader', shader.title, cacheErr);
                        }
                    }
                }
                installedCount++;
                reportProgress();
            }

            await saveModCache();
            reportProgress('Installation complete!', 100);
            try {
                const instanceJsonPath = path.join(instancesDir, instanceName, 'instance.json');
                if (await fs.pathExists(instanceJsonPath)) {
                    const config = await fs.readJson(instanceJsonPath);
                    config.status = 'ready';
                    await fs.writeJson(instanceJsonPath, config);
                }
            } catch (e) {
                console.error('[ModpackCode-Handler] Failed to reset instance status:', e);
            }

            return { success: true };
        } catch (error) {
            console.error('[ModpackCode-Handler] Background install failed:', error);
            try {
                const instanceJsonPath = path.join(instancesDir, instanceName, 'instance.json');
                if (await fs.pathExists(instanceJsonPath)) {
                    const config = await fs.readJson(instanceJsonPath);
                    config.status = 'ready';
                    await fs.writeJson(instanceJsonPath, config);
                }
            } catch (e) { }

            win.webContents.send('install:progress', {
                instanceName: instanceName,
                progress: 100,
                status: 'Error during installation'
            });
            return { success: false, error: error.message };
        }
    });

    console.log('[ModpackCode-Handler] ALLE Handler registriert!');
};