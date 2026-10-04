const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { app, net } = require('electron');
const { installModInternal } = require('./modrinth');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName, getAllInstanceDirsSync } = require('../utils/instances-path');
const sharedImportState = require('../utils/sharedImportState');
const { getUserProfile } = require('../utils/secureProfileStore');
const liveCodeState = require('../utils/liveCodeState');
const cloudApi = require('../luxcloud/api');
const SERVER_URL = 'https://lux.pluginhub.de';
const LIVE_CHECK_TIMEOUT_MS = 8000;

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

// The server re-validates and re-encodes whatever we send (that's the real trust
// boundary, since it's what gets redistributed to other users), but there's no reason
// to ship a multi-megabyte icon when we don't have to — cap it here too and fail soft.
const ICON_EXPORT_MAX_BYTES = 4 * 1024 * 1024;

async function resolveIconForExport(iconValue) {
    if (!iconValue || typeof iconValue !== 'string') return undefined;
    try {
        if (iconValue.startsWith('data:image/')) {
            const approxBytes = Math.floor(iconValue.length * 0.75);
            if (approxBytes > ICON_EXPORT_MAX_BYTES) {
                console.warn('[ModpackCode-Handler] Instance icon too large to export, skipping.');
                return undefined;
            }
            return iconValue;
        }
        if (iconValue.startsWith('app-media://') || iconValue.startsWith('http://') || iconValue.startsWith('https://')) {
            const response = await net.fetch(iconValue);
            if (!response.ok) return undefined;
            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > ICON_EXPORT_MAX_BYTES) {
                console.warn('[ModpackCode-Handler] Instance icon too large to export, skipping.');
                return undefined;
            }
            const buffer = Buffer.from(arrayBuffer);
            const contentType = response.headers.get('content-type') || '';
            const mime = contentType.startsWith('image/') ? contentType : 'image/png';
            return `data:${mime};base64,${buffer.toString('base64')}`;
        }
    } catch (e) {
        console.warn('[ModpackCode-Handler] Failed to resolve instance icon for export:', e.message);
    }
    // Anything else (e.g. an emoji fallback string) isn't a real image to send.
    return undefined;
}

const mapContent = (list) => list?.map(item => ({
    projectId: item.projectId,
    versionId: item.versionId,
    fileName: item.name || item.fileName,
    title: item.title || item.name,
    icon: item.icon
})) || [];

// Fehler aus dem Lux-Konto-Client: der Codes-Server schickt { error: '<Text>' }, das landet
// in err.code. Fuer die Oberflaeche den lesbaren Text nehmen.
function describeCloudError(err) {
    if (!err) return 'Unknown error';
    if (err.code === 'unauthorized') return 'Sign in to your Lux account first.';
    if (typeof err.code === 'string' && err.code.includes(' ')) return err.code;
    return err.message || err.code || 'Request failed';
}

module.exports = (ipcMain, win) => {
    console.log('[ModpackCode-Handler] 🔌 Registriere Handler...');

    const appData = app.getPath('userData');
    const instancesDir = resolvePrimaryInstancesDir();
    const modCachePath = path.join(appData, 'mods_cache.json');
    const buildExportPayload = async (data) => {
        const { name, mods, resourcePacks, shaders, instanceVersion, instanceLoader, instanceName, icon } = data;
        // Aeltere Aufrufer kennen den Schalter nicht und haben die Einstellungen immer mitgeschickt.
        const includeSettings = data.includeSettings !== false;

        let optionsContent = null;
        if (instanceName && includeSettings) {
            const optionsPath = path.join(instancesDir, instanceName, 'options.txt');
            if (await fs.pathExists(optionsPath)) {
                optionsContent = await fs.readFile(optionsPath, 'utf8');
            }
        }
        return {
            name: name || 'My Modpack',
            mods: mapContent(mods),
            resourcePacks: mapContent(resourcePacks),
            shaders: mapContent(shaders),
            instanceVersion,
            instanceLoader,
            keybinds: optionsContent,
            icon: await resolveIconForExport(icon)
        };
    };

    // Admin-Funktionen (Live-Codes, eigene Laufzeit) laufen ueber das Lux-Konto.
    ipcMain.handle('modpack:admin-status', async () => {
        try {
            const result = await cloudApi.authed({ method: 'GET', url: '/api/modpack/admin/status', timeout: 10000 });
            return { success: true, isAdmin: Boolean(result && result.isAdmin) };
        } catch (err) {
            return { success: true, isAdmin: false };
        }
    });

    ipcMain.handle('modpack:update-live-code', async (event, code, data) => {
        try {
            const payload = await buildExportPayload(data || {});
            const result = await cloudApi.authed({
                method: 'PUT',
                url: `/api/modpack/${encodeURIComponent(code)}/content`,
                data: payload,
                timeout: 15000
            });
            console.log(`[ModpackCode-Handler] Live code ${code} updated to revision ${result.revision}`);
            return result;
        } catch (err) {
            console.error('[ModpackCode-Handler] Live code update failed:', err);
            return { success: false, error: describeCloudError(err) };
        }
    });

    ipcMain.handle('modpack:set-code-settings', async (event, code, settings) => {
        try {
            const body = {};
            if (typeof settings?.live === 'boolean') body.live = settings.live;
            if (settings?.expiry !== undefined) body.expiry = settings.expiry;
            return await cloudApi.authed({
                method: 'PATCH',
                url: `/api/modpack/${encodeURIComponent(code)}/settings`,
                data: body,
                timeout: 10000
            });
        } catch (err) {
            console.error('[ModpackCode-Handler] Code settings update failed:', err);
            return { success: false, error: describeCloudError(err) };
        }
    });

    ipcMain.handle('modpack:export-code', async (event, data) => {
        console.log('[ModpackCode-Handler] 📤 Export handler AUFGERUFEN', data);
        try {
            const adminOptions = {};
            if (data.live === true) adminOptions.live = true;
            if (data.expiry !== undefined && data.expiry !== null && data.expiry !== '') adminOptions.expiry = data.expiry;

            const Store = require('electron-store');
            const store = new Store();
            const profile = getUserProfile(store);
            const ownerUuid = profile ? profile.uuid : null;

            const exportData = { ...(await buildExportPayload(data)), ownerUuid };
            if (exportData.keybinds) {
                console.log('[ModpackCode-Handler] ✅ Keybinds (options.txt) included in export');
            }

            if (Object.keys(adminOptions).length > 0) {
                try {
                    const result = await cloudApi.authed({
                        method: 'POST',
                        url: '/api/modpack/save',
                        data: { ...exportData, ...adminOptions },
                        timeout: 15000
                    });
                    return { success: true, code: result.code, live: result.live, revision: result.revision };
                } catch (err) {
                    return { success: false, error: describeCloudError(err) };
                }
            }

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
    const MODRINTH_HEADERS = { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' };

    const getInstanceDir = (instanceName) => resolveInstanceDirByName(instanceName) || path.join(instancesDir, instanceName);

    const canSend = () => win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed();

    const sendProgress = (instanceName, progress, status) => {
        if (!canSend()) return;
        win.webContents.send('install:progress', { instanceName, progress, status });
    };

    const sendStatus = (instanceName, status) => {
        if (!canSend()) return;
        win.webContents.send('instance:status', { instanceName, status });
    };

    // Eigener Kanal fuer die Oberflaeche: solange hier pending=true gemeldet wird, zeigt
    // sie die Instanz als "installing" und sperrt den Play-Button -- unabhaengig davon,
    // was der Spiel-Installer zwischendurch an Status-Events schickt.
    const sendImportState = (instanceName, items, pending) => {
        if (!canSend()) return;
        const { total, installed, failed } = sharedImportState.summarize(items || []);
        win.webContents.send('modpack:import-state', {
            instanceName,
            pending: Boolean(pending),
            total,
            installed,
            failed
        });
    };

    const updateConfig = async (instanceDir, mutate) => {
        const configPath = path.join(instanceDir, 'instance.json');
        if (!await fs.pathExists(configPath)) return null;
        const config = await fs.readJson(configPath);
        mutate(config);
        await fs.writeJson(configPath, config, { spaces: 4 });
        app.emit('lux:instances-changed');
        return config;
    };

    const resolveModrinthDownloadUrl = async (item, gameVersion, normalizedLoader) => {
        try {
            let versionData = null;

            if (item.versionId) {
                const versionRes = await axios.get(`https://api.modrinth.com/v2/version/${item.versionId}`, {
                    headers: MODRINTH_HEADERS,
                    timeout: 10000
                });
                versionData = versionRes.data;
            } else if (item.projectId) {
                const params = {};
                if (gameVersion) params.game_versions = JSON.stringify([String(gameVersion)]);
                if (normalizedLoader && item.kind === 'mod') params.loaders = JSON.stringify([normalizedLoader]);

                const versionsRes = await axios.get(`https://api.modrinth.com/v2/project/${item.projectId}/version`, {
                    headers: MODRINTH_HEADERS,
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

    const saveModCache = async (localModCache) => {
        if (Object.keys(localModCache).length === 0) return;
        try {
            let currentCache = {};
            if (await fs.pathExists(modCachePath)) {
                try {
                    currentCache = await fs.readJson(modCachePath);
                } catch (e) { }
            }
            await fs.writeJson(modCachePath, { ...currentCache, ...localModCache });
            console.log('[ModpackCode-Handler] Cache safely updated.');
        } catch (e) {
            console.error('[ModpackCode-Handler] Failed to save mods cache:', e);
        }
    };

    const KIND_LABELS = { mod: 'mod', resourcepack: 'pack', shader: 'shader' };

    // Arbeitet die Liste aus der Marker-Datei ab. Jeder Eintrag gilt erst als erledigt, wenn
    // seine Datei wirklich im Instanzordner liegt; was im ersten Durchgang fehlt, wird ein
    // zweites Mal versucht und erst danach als fehlgeschlagen verbucht. Die Instanz bleibt
    // so lange im Status "installing" und laesst sich nicht starten (siehe
    // utils/sharedImportState.js und launcher.js).
    const processSharedImport = async (instanceName) => {
        const instanceDir = getInstanceDir(instanceName);
        const marker = await sharedImportState.readMarker(instanceDir);
        if (!marker) {
            sendImportState(instanceName, [], false);
            return { success: true };
        }

        const items = Array.isArray(marker.items) ? marker.items : [];
        const gameVersion = marker.gameVersion || null;
        const normalizedLoader = marker.loader ? String(marker.loader).toLowerCase() : null;
        const localModCache = {};

        const persistItems = async () => {
            await sharedImportState.writeMarker(instanceDir, { ...marker, items });
            sendImportState(instanceName, items, true);
        };

        const reportProgress = (status) => {
            const { total, installed, failed } = sharedImportState.summarize(items);
            const done = installed + failed;
            // Nie 100 melden, bevor alles nachgezaehlt ist -- 100 heisst fuer die Oberflaeche "fertig".
            const progress = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 99;
            sendProgress(instanceName, progress, status || `Importing modpack: ${done}/${total}`);
        };

        // Was laut Marker schon installiert war, aber nicht mehr auf der Platte liegt, neu laden.
        await sharedImportState.verifyItems(instanceDir, items);

        const MAX_PASSES = 2;
        for (let pass = 1; pass <= MAX_PASSES; pass++) {
            const isLastPass = pass === MAX_PASSES;
            const pendingItems = items.filter((item) => item.state === 'pending');
            if (pendingItems.length === 0) break;

            for (const item of pendingItems) {
                reportProgress(`Downloading ${KIND_LABELS[item.kind] || 'file'}: ${item.title}`);

                const resolved = await resolveModrinthDownloadUrl(item, gameVersion, normalizedLoader);
                if (!resolved) {
                    console.error(`[ModpackCode-Handler] Could not resolve download URL for ${item.title} (pass ${pass})`);
                    if (isLastPass) item.state = 'failed';
                    await persistItems();
                    reportProgress();
                    continue;
                }

                const fileName = path.basename(String(resolved.filename || item.fileName || ''));
                if (!fileName) {
                    item.state = 'failed';
                    await persistItems();
                    reportProgress();
                    continue;
                }
                item.fileName = fileName;
                item.versionId = item.versionId || resolved.versionId;

                try {
                    await installModInternal(win, {
                        instanceName,
                        projectId: item.projectId,
                        versionId: item.versionId,
                        filename: fileName,
                        url: resolved.url,
                        projectType: item.kind
                    });
                } catch (e) {
                    console.error(`[ModpackCode-Handler] Install of ${item.title} threw:`, e.message);
                }

                if (await sharedImportState.isItemOnDisk(instanceDir, item)) {
                    item.state = 'installed';
                    try {
                        const fsStats = await fs.stat(sharedImportState.itemPath(instanceDir, item));
                        localModCache[`${fileName}-${fsStats.size}`] = {
                            title: item.title,
                            icon: item.icon,
                            version: resolved.versionNumber,
                            projectId: item.projectId,
                            versionId: item.versionId,
                            timestamp: Date.now()
                        };
                    } catch (cacheErr) {
                        console.error('[ModpackCode-Handler] Failed to cache metadata for', item.title, cacheErr);
                    }
                } else if (isLastPass) {
                    console.error(`[ModpackCode-Handler] ${item.title} is still missing after ${pass} attempts.`);
                    item.state = 'failed';
                }

                await persistItems();
                reportProgress();
            }

            // Nachzaehlen: liegt wirklich alles im Ordner, was als installiert gilt?
            await sharedImportState.verifyItems(instanceDir, items);
        }

        for (const item of items) {
            if (item.state === 'pending') item.state = 'failed';
        }

        await saveModCache(localModCache);

        const summary = sharedImportState.summarize(items);
        const failedTitles = items.filter((item) => item.state === 'failed').map((item) => item.title);

        if (marker.live && marker.live.code) {
            try {
                await liveCodeState.writeLiveState(instanceDir, {
                    code: marker.live.code,
                    revision: Number(marker.live.revision) || 1,
                    gameVersion,
                    loader: marker.loader || null,
                    updatedAt: Date.now(),
                    items: items.filter((item) => item.state === 'installed').map(liveCodeState.trackedItem)
                });
            } catch (e) {
                console.error('[ModpackCode-Handler] Failed to remember live code:', e);
            }
        }

        await sharedImportState.clearMarker(instanceDir);
        try {
            await updateConfig(instanceDir, (c) => { c.status = 'ready'; });
        } catch (e) {
            console.error('[ModpackCode-Handler] Failed to reset instance status:', e);
        }
        sendImportState(instanceName, items, false);

        console.log(`[ModpackCode-Handler] Import for ${instanceName} finished: ${summary.installed}/${summary.total} installed, ${summary.failed} failed.`);
        if (failedTitles.length > 0) {
            console.warn('[ModpackCode-Handler] Could not install:', failedTitles.join(', '));
        }

        sendProgress(
            instanceName,
            100,
            summary.failed > 0
                ? `Installed ${summary.installed}/${summary.total} (${summary.failed} could not be installed)`
                : 'Installation complete!'
        );
        sendStatus(instanceName, 'stopped');

        return { success: true, installed: summary.installed, failed: failedTitles };
    };

    const runTracked = async (instanceName, work) => {
        if (sharedImportState.isActive(instanceName)) {
            return { success: false, error: 'An import is already running for this instance.' };
        }
        sharedImportState.markActive(instanceName);
        try {
            return await work();
        } catch (error) {
            console.error('[ModpackCode-Handler] Background install failed:', error);
            // Der Marker bleibt stehen: die Instanz bleibt gesperrt und der Import wird beim
            // naechsten Startversuch (oder Launcher-Start) fortgesetzt.
            try {
                await updateConfig(getInstanceDir(instanceName), (c) => { c.status = 'ready'; });
            } catch (e) { }
            sendProgress(instanceName, 100, 'Error during installation');
            sendStatus(instanceName, 'stopped');
            sendImportState(instanceName, [], false);
            return { success: false, error: error.message };
        } finally {
            sharedImportState.markInactive(instanceName);
        }
    };

    const resumeSharedImport = (instanceName) => runTracked(instanceName, async () => {
        console.log(`[ModpackCode-Handler] Resuming interrupted import for ${instanceName}`);
        const marker = await sharedImportState.readMarker(getInstanceDir(instanceName));
        sendImportState(instanceName, marker ? marker.items : [], true);
        sendStatus(instanceName, 'installing');
        return processSharedImport(instanceName);
    });

    sharedImportState.setResumeHandler(resumeSharedImport);

    // Vor jedem Start: neue Revision eines Live-Codes einspielen. Nur die Dateien, die der
    // Code mitgebracht hat, werden ausgetauscht; Einstellungen (options.txt) bleiben.
    const checkLiveUpdate = async (instanceName) => {
        const instanceDir = getInstanceDir(instanceName);
        const state = await liveCodeState.readLiveState(instanceDir);
        if (!state) return null;

        let remote;
        try {
            const response = await axios.get(`${SERVER_URL}/api/modpack/${encodeURIComponent(state.code)}/live`, {
                timeout: LIVE_CHECK_TIMEOUT_MS
            });
            remote = response.data && response.data.data;
        } catch (error) {
            if (error.response?.status === 404) {
                console.log(`[ModpackCode-Handler] Live code ${state.code} no longer exists, stopping updates for ${instanceName}.`);
                await liveCodeState.clearLiveState(instanceDir);
            } else {
                console.warn(`[ModpackCode-Handler] Live code check for ${instanceName} failed (${error.code || error.message}), starting as is.`);
            }
            return null;
        }

        if (!remote || !remote.live || !liveCodeState.isNewer(state, remote)) return null;

        if (liveCodeState.targetChanged(state, remote)) {
            console.warn(`[ModpackCode-Handler] Live code ${state.code} moved to ${remote.version}/${remote.loader}; `
                + `${instanceName} is on ${state.gameVersion}/${state.loader}. Not updating automatically.`);
            return null;
        }

        const { items, remove } = await liveCodeState.planUpdate(instanceDir, state, remote);
        console.log(`[ModpackCode-Handler] Updating ${instanceName} from live code ${state.code} `
            + `revision ${state.revision} -> ${remote.revision} (${remove.length} removed, `
            + `${items.filter((item) => item.state === 'pending').length} to download).`);

        return runTracked(instanceName, async () => {
            for (const filePath of remove) {
                try {
                    await fs.remove(filePath);
                } catch (e) {
                    console.warn('[ModpackCode-Handler] Could not remove old file', filePath, e.message);
                }
            }

            await sharedImportState.writeMarker(instanceDir, {
                pending: true,
                instanceName,
                code: state.code,
                live: { code: state.code, revision: Number(remote.revision) },
                gameVersion: state.gameVersion || remote.version || null,
                loader: state.loader || remote.loader || null,
                startedAt: Date.now(),
                items
            });
            sendImportState(instanceName, items, true);
            sendStatus(instanceName, 'installing');
            sendProgress(instanceName, 0, `Updating modpack to revision ${remote.revision}...`);
            return processSharedImport(instanceName);
        });
    };

    sharedImportState.setLiveUpdateHandler(checkLiveUpdate);

    ipcMain.handle('modpack:install-shared-content', async (event, { instanceName, modpackData }) => {
        console.log(`[ModpackCode-Handler] Starting background install for: ${instanceName}`);

        return runTracked(instanceName, async () => {
            const instanceDir = getInstanceDir(instanceName);
            const items = sharedImportState.buildImportItems(modpackData);
            const gameVersion = modpackData?.instanceVersion || modpackData?.version || null;
            const loader = modpackData?.instanceLoader || modpackData?.loader || null;

            // Erst die komplette Liste festhalten, dann laden: ab hier ist die Instanz
            // gesperrt, auch wenn das Spiel selbst schon fertig installiert ist.
            if (items.length > 0) {
                sendImportState(instanceName, items, true);
                await sharedImportState.writeMarker(instanceDir, {
                    pending: true,
                    instanceName,
                    code: modpackData?.code || null,
                    live: modpackData?.live && modpackData?.code
                        ? { code: modpackData.code, revision: Number(modpackData.revision) || 1 }
                        : null,
                    gameVersion,
                    loader,
                    startedAt: Date.now(),
                    items
                });
                try {
                    await updateConfig(instanceDir, (c) => { c.status = 'installing'; });
                } catch (e) { }
            }

            if (modpackData?.keybinds) {
                await fs.writeFile(path.join(instanceDir, 'options.txt'), modpackData.keybinds);
                console.log('[ModpackCode-Handler] Keybinds restored.');
            }

            if (items.length === 0) {
                return { success: true };
            }

            sendStatus(instanceName, 'installing');
            sendProgress(instanceName, 0, 'Preparing installation...');

            return processSharedImport(instanceName);
        });
    });

    const findPendingImports = async () => {
        const found = [];
        const seen = new Set();
        for (const baseDir of getAllInstanceDirsSync()) {
            let entries = [];
            try {
                entries = await fs.readdir(baseDir, { withFileTypes: true });
            } catch (_) {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const marker = await sharedImportState.readMarker(path.join(baseDir, entry.name));
                if (!marker) continue;
                const instanceName = marker.instanceName || entry.name;
                if (seen.has(instanceName)) continue;
                seen.add(instanceName);
                found.push({ instanceName, items: marker.items || [] });
            }
        }
        return found;
    };

    // Beim Laden der Oberflaeche (auch nach einem Reload) den aktuellen Stand abfragen.
    ipcMain.handle('modpack:get-import-states', async () => {
        try {
            const pending = await findPendingImports();
            return pending.map(({ instanceName, items }) => {
                const { total, installed, failed } = sharedImportState.summarize(items);
                return { instanceName, pending: true, total, installed, failed };
            });
        } catch (e) {
            console.error('[ModpackCode-Handler] Failed to list import states:', e);
            return [];
        }
    });

    // Imports, die beim letzten Beenden noch liefen, nach dem Start fortsetzen.
    setTimeout(async () => {
        try {
            for (const { instanceName } of await findPendingImports()) {
                if (sharedImportState.isActive(instanceName)) continue;
                resumeSharedImport(instanceName).catch((e) => console.error('[ModpackCode-Handler] Resume failed:', e));
            }
        } catch (e) {
            console.error('[ModpackCode-Handler] Failed to scan for interrupted imports:', e);
        }
    }, 10000);

    console.log('[ModpackCode-Handler] ALLE Handler registriert!');
};