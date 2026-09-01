const path = require('path');
const { app } = require('electron');

const fs = require('fs-extra');

const api = require('../luxcloud/api');
const auth = require('../luxcloud/auth');
const blobStore = require('../luxcloud/blobStore');
const downloader = require('../luxcloud/downloader');
const uploader = require('../luxcloud/uploader');
const { summarize } = require('../luxcloud/manifest');
const { buildManifestInWorker } = require('../luxcloud/manifestRunner');
const { getHashCacheDir } = require('../luxcloud/paths');
const { ensureInstanceId, readInstanceId } = require('../luxcloud/instanceIdentity');
const {
    resolveInstanceDirByName,
    resolvePrimaryInstancesDir
} = require('../utils/instances-path');

function ok(payload = {}) {
    return { success: true, ...payload };
}

function fail(err) {
    if (err instanceof api.LuxCloudError) {
        return { success: false, error: err.code, message: err.message, details: err.details };
    }
    console.error('[LuxCloud] Unexpected handler error:', err);
    return { success: false, error: 'unknown_error', message: (err && err.message) || 'Unknown error' };
}

async function ensureInstanceIdFor(instanceDir, wanted = null) {
    const existing = await readInstanceId(instanceDir);
    if (existing) return existing;

    if (wanted) {
        const configPath = path.join(instanceDir, 'instance.json');
        const config = await fs.readJson(configPath).catch(() => null);
        if (config && typeof config === 'object') {
            config.instanceId = wanted;
            await fs.writeJson(configPath, config, { spaces: 4 });
            return wanted;
        }
    }

    const assigned = await ensureInstanceId(instanceDir);
    return assigned.instanceId;
}

async function resolveRestoreDir(instanceUuid, targetName) {
    const baseDir = resolvePrimaryInstancesDir();
    await fs.ensureDir(baseDir);

    for (const entry of await fs.readdir(baseDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(baseDir, entry.name);
        if (await readInstanceId(candidate) === instanceUuid) return candidate;
    }

    const wanted = targetName || instanceUuid;
    let finalName = wanted;
    let counter = 1;
    while (await fs.pathExists(path.join(baseDir, finalName))) {
        finalName = `${wanted} (${counter})`;
        counter += 1;
    }

    const created = path.join(baseDir, finalName);
    await fs.ensureDir(created);
    return created;
}

module.exports = (ipcMain, mainWindow) => {
    const sendProgress = (channel, payload) => {
        try {
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send(channel, payload);
            }
        } catch (e) {
            console.warn(`[LuxCloud] Could not deliver ${channel}:`, e.message);
        }
    };

    auth.events.on('account-changed', (payload) => {
        try {
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('luxcloud:account-changed', payload);
            }
        } catch (e) {
            console.warn('[LuxCloud] Could not deliver account-changed to the renderer:', e.message);
        }
    });

    ipcMain.handle('luxcloud:get-account', async () => {
        try {
            return ok({ account: await auth.getAccount() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:login', async () => {
        try {
            const account = await auth.login({ appVersion: app.getVersion() });
            return ok({ account });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:cancel-login', async () => {
        auth.cancelPendingLogin('Cancelled from the client');
        return ok();
    });

    ipcMain.handle('luxcloud:logout', async () => {
        try {
            return ok({ account: await auth.logout() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:get-me', async () => {
        try {
            const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
            return ok({ me });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:update-settings', async (_event, patch) => {
        try {
            const result = await api.authed({
                method: 'PATCH',
                url: '/api/cloud/me/settings',
                data: patch || {}
            });
            return ok({ settings: result.settings });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:list-devices', async () => {
        try {
            const result = await api.authed({ method: 'GET', url: '/api/cloud/devices' });
            return ok({ devices: result.devices || [] });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:list-cloud-instances', async (_event, status = 'active') => {
        try {
            const query = ['active', 'trashed', 'all'].includes(String(status)) ? String(status) : 'active';
            const result = await api.authed({ method: 'GET', url: `/api/cloud/instances?status=${query}` });
            return ok({ instances: result.instances || [] });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:sync-instance', async (_event, instanceName, options = {}) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const instanceId = await ensureInstanceIdFor(instanceDir);
            if (!instanceId) {
                return { success: false, error: 'no_instance_id', message: 'This instance has no id yet' };
            }

            const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
            const started = Date.now();

            const result = await uploader.uploadInstance({
                instanceDir,
                instanceId,
                instanceName,
                capabilities: me.capabilities || {},
                options: {
                    ...options,
                    modCachePath: path.join(app.getPath('userData'), 'mod_cache.json')
                },
                onProgress: (progress) => sendProgress('luxcloud:sync-progress', progress)
            });

            return ok({ ...result, durationMs: Date.now() - started });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:restore-instance', async (_event, instanceUuid, options = {}) => {
        try {
            if (typeof instanceUuid !== 'string' || instanceUuid.length === 0) {
                return { success: false, error: 'invalid_request', message: 'Missing instance id' };
            }

            const targetName = typeof options.instanceName === 'string' && options.instanceName.trim()
                ? options.instanceName.trim()
                : null;

            const instanceDir = await resolveRestoreDir(instanceUuid, targetName);
            const started = Date.now();

            const result = await downloader.restoreInstance({
                instanceUuid,
                instanceDir,
                instanceName: targetName,
                revision: options.revision || 'latest',
                onProgress: (progress) => sendProgress('luxcloud:restore-progress', progress)
            });

            await ensureInstanceIdFor(instanceDir, instanceUuid);

            return ok({ ...result, instanceDir, durationMs: Date.now() - started });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:list-revisions', async (_event, instanceUuid) => {
        try {
            const result = await api.authed({
                method: 'GET',
                url: `/api/cloud/instances/${encodeURIComponent(String(instanceUuid))}/revisions`
            });
            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:blob-cache-stats', async () => {
        try {
            return ok({ cache: await blobStore.stats() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:prune-blob-cache', async (_event, maxBytes) => {
        try {
            const limit = Number(maxBytes) > 0 ? Number(maxBytes) : blobStore.DEFAULT_MAX_BYTES;
            return ok({ result: await blobStore.prune({ maxBytes: limit }) });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:preview-manifest', async (_event, instanceName, options = {}) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const instanceId = await readInstanceId(instanceDir);
            if (!instanceId) {
                return { success: false, error: 'no_instance_id', message: 'This instance has no id yet' };
            }

            const started = Date.now();
            const result = await buildManifestInWorker({
                instanceDir,
                instanceId,
                name: instanceName,
                hashCacheDir: getHashCacheDir(),
                modCachePath: path.join(app.getPath('userData'), 'mod_cache.json'),
                syncWorlds: Boolean(options.syncWorlds),
                syncScreenshots: Boolean(options.syncScreenshots),
                enableChunking: Boolean(options.enableChunking)
            }, {
                onProgress: (progress) => {
                    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                        mainWindow.webContents.send('luxcloud:manifest-progress', { instanceName, ...progress });
                    }
                }
            });

            return ok({
                instanceId,
                durationMs: Date.now() - started,
                manifestHash: result.manifestBlob.sha256,
                summary: summarize(result)
            });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:revoke-device', async (_event, deviceUuid) => {
        try {
            if (typeof deviceUuid !== 'string' || deviceUuid.length === 0) {
                return { success: false, error: 'invalid_request', message: 'Missing device id' };
            }

            const account = await auth.getAccount();
            await api.authed({
                method: 'DELETE',
                url: `/api/cloud/devices/${encodeURIComponent(deviceUuid)}`
            });

            if (account.device && account.device.uuid === deviceUuid) {
                await auth.handleRevocation({ code: 'device_revoked' });
            }
            return ok();
        } catch (err) {
            return fail(err);
        }
    });
};
