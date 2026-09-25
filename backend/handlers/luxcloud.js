const path = require('path');
const { app } = require('electron');

const fs = require('fs-extra');

const api = require('../luxcloud/api');
const auth = require('../luxcloud/auth');
const autoSync = require('../luxcloud/autoSync');
const blobStore = require('../luxcloud/blobStore');
const changeMonitor = require('../luxcloud/changeMonitor');
const conflict = require('../luxcloud/conflict');
const downloader = require('../luxcloud/downloader');
const cloudPlaytime = require('../luxcloud/playtime');
const preLaunch = require('../luxcloud/preLaunch');
const uploader = require('../luxcloud/uploader');
const luxState = require('../luxcloud/state');
const { scopeOf } = require('../luxcloud/localChanges');
const {
    forgetInstance,
    isTrashed,
    listTrackedInstances,
    readInstanceState,
    rememberRevision,
    setTrashed
} = require('../luxcloud/syncState');
const { withSyncScope } = require('../luxcloud/syncScope');
const transfers = require('../luxcloud/transfers');
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

// The auto-sync queue is keyed by folder name, while the cloud speaks in uuids, so
// suspending and resuming an instance needs the translation between the two.
async function nameForInstanceId(instanceUuid) {
    const baseDir = resolvePrimaryInstancesDir();

    for (const entry of await fs.readdir(baseDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(baseDir, entry.name);
        if (await readInstanceId(candidate) === instanceUuid) return entry.name;
    }
    return null;
}

// Welche Instanzen die Hintergrundkontrolle ueberhaupt ansehen muss.
//
// Ausgelassen wird, was gerade gespielt wird (dafuer gibt es den Anstoss nach dem
// Spielen) und was ohnehin gerade uebertragen wird -- in beiden Faellen ist der Ordner in
// Bewegung, und ein Fingerabdruck davon sagt nichts.
async function collectSyncCandidates() {
    if (!await luxState.isLoggedIn().catch(() => false)) return [];

    const candidates = [];

    for (const entry of await listTrackedInstances().catch(() => [])) {
        if (!entry.cloudLinked || entry.trashed) continue;

        let instanceName = entry.instanceName || null;
        let instanceDir = instanceName ? resolveInstanceDirByName(instanceName) : null;

        // Der Ordner kann seit dem letzten Sync umbenannt worden sein; dann gilt die UUID.
        if (!instanceDir) {
            instanceName = await nameForInstanceId(entry.instanceId).catch(() => null);
            instanceDir = instanceName ? resolveInstanceDirByName(instanceName) : null;
        }

        if (!instanceName || !instanceDir) continue;
        if (autoSync.isSuspended(instanceName)) continue;
        if (transfers.list().some((transfer) => transfer.instanceName === instanceName)) continue;

        candidates.push({
            instanceId: entry.instanceId,
            instanceName,
            instanceDir,
            options: scopeOf(entry),
            lastSignature: entry.lastLocalSignature || null,
            queued: autoSync.isQueued(instanceName)
        });
    }

    return candidates;
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

            if (me && me.user) {
                await luxState.patchState({ user: me.user }).catch(() => {});
            }
            return ok({ me });
        } catch (err) {
            return fail(err);
        }
    });


    ipcMain.handle('luxcloud:update-instance-settings', async (_event, instanceUuid, patch) => {
        try {
            const allowed = {};
            for (const key of ['crossPlatform', 'syncWorlds', 'syncScreenshots', 'name']) {
                if (patch && key in patch) allowed[key] = patch[key];
            }
            if (Object.keys(allowed).length === 0) {
                return { success: false, error: 'invalid_request', message: 'Nothing to change' };
            }

            const result = await api.authed({
                method: 'PATCH',
                url: `/api/cloud/instances/${encodeURIComponent(String(instanceUuid))}`,
                data: allowed
            });

            const local = {};
            for (const key of ['crossPlatform', 'syncWorlds', 'syncScreenshots']) {
                if (typeof allowed[key] === 'boolean') local[key] = allowed[key];
            }
            if (Object.keys(local).length > 0) {
                await rememberRevision(String(instanceUuid), { ...local, dirty: true }).catch(() => {});
            }

            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:delete-cloud-instance', async (_event, instanceUuid) => {
        try {
            const result = await api.authed({
                method: 'DELETE',
                url: `/api/cloud/instances/${encodeURIComponent(String(instanceUuid))}`
            });

            await forgetInstance(String(instanceUuid)).catch(() => {});
            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:list-worlds', async (_event, instanceName) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const savesDir = path.join(instanceDir, 'saves');
            if (!await fs.pathExists(savesDir)) return ok({ worlds: [] });

            const worlds = [];
            for (const entry of await fs.readdir(savesDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;

                const dir = path.join(savesDir, entry.name);
                let bytes = 0;
                const walk = async (current) => {
                    for (const child of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
                        const full = path.join(current, child.name);
                        if (child.isDirectory()) await walk(full);
                        else if (child.isFile()) {
                            bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
                        }
                    }
                };
                await walk(dir);

                const stat = await fs.stat(dir).catch(() => null);
                worlds.push({
                    name: entry.name,
                    bytes,
                    lastPlayed: stat ? stat.mtimeMs : null
                });
            }

            worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
            return ok({ worlds });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:set-world-selection', async (_event, instanceId, worldNames) => {
        try {
            const names = Array.isArray(worldNames)
                ? worldNames.filter((name) => typeof name === 'string' && name.length > 0)
                : [];
            await rememberRevision(String(instanceId), { syncWorldNames: names });
            return ok({ worldNames: names });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:get-world-selection', async (_event, instanceId) => {
        try {
            const tracked = await readInstanceState(String(instanceId));
            return ok({ worldNames: (tracked && tracked.syncWorldNames) || null });
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

            // Wer den automatischen Sync gerade wieder einschaltet, erwartet nicht, jede
            // Datei noch einmal anfassen zu muessen, damit sie doch noch hochgeht.
            if (patch && patch.autoSync === true) {
                changeMonitor.forgetAll();
                changeMonitor.scan().catch(() => {});
            }

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

    cloudPlaytime.pushAllPending().catch(() => {});

    autoSync.setRunner(async (instanceName) => {
        const instanceDir = resolveInstanceDirByName(instanceName);
        if (!instanceDir) return { skipped: true, reason: 'not_found' };

        const instanceId = await readInstanceId(instanceDir);
        if (!instanceId) return { skipped: true, reason: 'no_instance_id' };

        const tracked = await readInstanceState(instanceId);
        if (!tracked || !tracked.cloudLinked) return { skipped: true, reason: 'not_linked' };

        // A trashed instance can only be rejected by the server, so do not even try.
        // Retrying on every change is what made the sync indicator run in circles.
        if (tracked.trashed) return { skipped: true, reason: 'instance_trashed' };

        const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
        if (me.settings && me.settings.autoSync === false) return { skipped: true, reason: 'auto_sync_off' };

        const result = await uploader.uploadInstance({
            instanceDir,
            instanceId,
            instanceName,
            capabilities: me.capabilities || {},
            options: await withSyncScope(instanceId, { modCachePath: path.join(app.getPath('userData'), 'mod_cache.json') }),
            onProgress: (progress) => sendProgress('luxcloud:sync-progress', { ...progress, auto: true })
        });

        // The background queue never pulls on its own - fetching files behind the user's
        // back is not its job. It only reports that an update is waiting.
        if (result.pullRequired) {
            return {
                skipped: true,
                reason: result.contentUnchanged ? 'update_available' : 'revision_conflict',
                revision: result.revision,
                localRevision: result.localRevision
            };
        }

        return result;
    });

    // Ein Upload braucht einen Ausloeser. Bis hierher gab es genau einen -- das Ende einer
    // Spielsitzung. Wer eine Mod loeschte oder eine Einstellung aenderte, ohne danach zu
    // spielen, sah in der Cloud nie etwas davon und musste "Jetzt synchronisieren"
    // druecken. Diese Kontrolle bemerkt die Aenderung von allein.
    changeMonitor.configure({
        candidates: collectSyncCandidates,
        onChanged: ({ instanceName, instanceId, files, firstCheck }) => {
            console.log(`[LuxCloud] "${instanceName}" changed locally (${files} synced files`
                + `${firstCheck ? ', first check since this update' : ''}) - queueing an upload.`);
            const queued = autoSync.notifyChanged(instanceName, 'local-change');

            // Abgelehnt (Auto-Sync aus, Instanz pausiert): dann darf die Meldung nicht als
            // erledigt gelten, sonst faellt dieselbe Aenderung spaeter unter den Tisch.
            if (!queued) changeMonitor.forget(instanceId);
        }
    });
    changeMonitor.start();

    let contentChangeTimer = null;
    app.on('lux:instance-content-changed', () => {
        if (contentChangeTimer) clearTimeout(contentChangeTimer);
        contentChangeTimer = setTimeout(() => {
            contentChangeTimer = null;
            changeMonitor.scan().catch(() => {});
        }, 3000);
        if (typeof contentChangeTimer.unref === 'function') contentChangeTimer.unref();
    });

    for (const event of ['scheduled', 'start', 'done', 'error', 'cancelled']) {
        autoSync.events.on(event, (payload) => {
            sendProgress('luxcloud:auto-sync', {
                event,
                instanceName: payload.instanceName,
                reason: payload.reason,
                attempt: payload.attempt,
                retryable: payload.retryable,
                error: payload.error ? { code: payload.error.code, message: payload.error.message } : undefined,
                result: payload.result
                    ? {
                        revision: payload.result.revision,
                        skipped: Boolean(payload.result.skipped),
                        reason: payload.result.reason
                    }
                    : undefined
            });
        });
    }

    ipcMain.handle('luxcloud:redeem-code', async (_event, userCode) => {
        try {
            return ok({ account: await auth.redeemManualCode({ userCode, appVersion: app.getVersion() }) });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:start-pairing', async () => {
        try {
            return ok({ pairing: await auth.startPairing({ appVersion: app.getVersion() }) });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:poll-pairing', async () => {
        try {
            return ok(await auth.pollPairing());
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:cancel-pairing', async () => {
        auth.cancelPairing('Cancelled from the client');
        return ok();
    });

    ipcMain.handle('luxcloud:get-notifications', async (_event, limit) => {
        try {
            const count = Number(limit) > 0 ? Number(limit) : 0;
            const url = count > 0
                ? `/api/cloud/notifications?limit=${count}`
                : '/api/cloud/notifications';
            return ok(await api.authed({ method: 'GET', url }));
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:mark-notifications-read', async (_event, id) => {
        try {
            const data = Number.isFinite(Number(id)) && Number(id) > 0 ? { id: Number(id) } : {};
            return ok(await api.authed({ method: 'POST', url: '/api/cloud/notifications/read', data }));
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:set-avatar', async () => {
        try {
            const { dialog } = require('electron');
            const picked = await dialog.showOpenDialog(mainWindow, {
                title: 'Choose a profile picture',
                properties: ['openFile'],
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
            });
            if (picked.canceled || picked.filePaths.length === 0) {
                return ok({ cancelled: true });
            }

            const filePath = picked.filePaths[0];
            const stat = await fs.stat(filePath);
            if (stat.size > 4 * 1024 * 1024) {
                return { success: false, error: 'too_large', message: 'The picture may be at most 4 MB' };
            }

            const FormData = require('form-data');
            const form = new FormData();
            const buffer = await fs.readFile(filePath);
            const extension = path.extname(filePath).toLowerCase();
            const contentType = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
                '.gif': 'image/gif'
            }[extension] || 'image/png';

            form.append('avatar', buffer, {
                filename: path.basename(filePath),
                contentType,
                knownLength: buffer.length
            });

            const result = await api.authed({
                method: 'POST',
                url: '/api/cloud/me/avatar',
                data: form,
                headers: form.getHeaders()
            });

            // The stored session still carries the old picture. Tell the renderer so
            // it reloads the account instead of showing a stale avatar until restart.
            sendProgress('luxcloud:account-changed', { reason: 'avatar' });
            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:delete-cloud-data', async () => {
        try {
            const result = await api.authed({
                method: 'DELETE',
                url: '/api/cloud/me',
                data: { confirm: 'delete-my-cloud-data' }
            });
            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:get-playtime', async (_event, instanceName) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const instanceId = await readInstanceId(instanceDir);
            if (!instanceId) {
                return { success: false, error: 'no_instance_id', message: 'This instance has no id yet' };
            }

            const tracked = await readInstanceState(instanceId);
            if (!tracked || !tracked.cloudLinked) {
                return ok({
                    cloudLinked: false,
                    deviceTotalMs: await cloudPlaytime.readLocalPlaytime(instanceDir),
                    totalMs: await cloudPlaytime.readLocalPlaytime(instanceDir),
                    byDevice: []
                });
            }

            const breakdown = await cloudPlaytime.fetchBreakdown(instanceId);
            return ok({ cloudLinked: true, ...breakdown });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:push-playtime', async () => {
        try {
            return ok({ results: await cloudPlaytime.pushAllPending() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:pre-launch-check', async (_event, instanceName, options = {}) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return ok({ decision: preLaunch.DECISION.NOT_LINKED, canLaunch: true });
            }

            const instanceId = await readInstanceId(instanceDir);
            if (!instanceId) {
                return ok({ decision: preLaunch.DECISION.NOT_LINKED, canLaunch: true });
            }

            const result = await preLaunch.checkBeforeLaunch({
                instanceDir,
                instanceId,
                instanceName,
                // Der Umfang gehoert nicht in die Hand des Aufrufers: ohne ihn haelt der
                // Dirty-Check Welten und Screenshots faelschlich fuer nicht synchronisiert.
                options: await withSyncScope(instanceId, options),
                onProgress: (progress) => sendProgress('luxcloud:pre-launch-progress', progress)
            });

            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    // Deliberately cheap: just the recorded state, no directory scan. The instance panel
    // calls this on every open to tell whether the cloud is ahead of this PC.
    ipcMain.handle('luxcloud:local-revision', async (_event, instanceName) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) return ok({ linked: false, revision: 0 });

            const instanceId = await readInstanceId(instanceDir);
            if (!instanceId) return ok({ linked: false, revision: 0 });

            const tracked = await readInstanceState(instanceId);
            return ok({
                instanceId,
                linked: Boolean(tracked && tracked.cloudLinked),
                revision: Number((tracked && tracked.lastKnownRevision) || 0),
                trashed: Boolean(tracked && tracked.trashed),
                lastSyncedAt: (tracked && tracked.lastSyncedAt) || null
            });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:diff-instance', async (_event, instanceName, options = {}) => {
        try {
            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const instanceId = await readInstanceId(instanceDir);
            if (!instanceId) {
                return { success: false, error: 'no_instance_id', message: 'This instance has no id yet' };
            }

            const dirty = await conflict.isLocallyDirty(instanceDir, instanceId, options);
            const tracked = await readInstanceState(instanceId);

            return ok({
                instanceId,
                dirty: dirty.dirty,
                changed: dirty.changed.slice(0, 500),
                lastKnownRevision: tracked ? tracked.lastKnownRevision : 0,
                lastSyncedAt: tracked ? tracked.lastSyncedAt : null
            });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:resolve-conflict', async (_event, instanceName, choice, options = {}) => {
        try {
            if (![conflict.RESOLUTION.LOCAL, conflict.RESOLUTION.REMOTE].includes(choice)) {
                return { success: false, error: 'invalid_request', message: 'choice must be local or remote' };
            }

            const instanceDir = resolveInstanceDirByName(instanceName);
            if (!instanceDir) {
                return { success: false, error: 'not_found', message: `Unknown instance: ${instanceName}` };
            }

            const instanceId = await readInstanceId(instanceDir);
            const tracked = await readInstanceState(instanceId);
            const revision = tracked ? Number(tracked.lastKnownRevision || 0) : 0;

            const dirty = await conflict.isLocallyDirty(instanceDir, instanceId, options);
            const backup = await conflict.backupLosers(
                instanceDir,
                revision,
                dirty.changed.map((entry) => entry.path)
            );

            if (choice === conflict.RESOLUTION.REMOTE) {
                const restored = await downloader.restoreInstance({
                    instanceUuid: instanceId,
                    instanceDir,
                    instanceName,
                    modCachePath: path.join(app.getPath('userData'), 'mod_cache.json'),
                    onProgress: (progress) => sendProgress('luxcloud:restore-progress', progress)
                });
                return ok({ resolved: 'remote', backup, revision: restored.revision });
            }

            const head = await preLaunch.fetchHead(instanceId);
            const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });

            const pushed = await uploader.uploadInstance({
                instanceDir,
                instanceId,
                instanceName,
                capabilities: me.capabilities || {},
                options: await withSyncScope(instanceId, {
                    ...options,
                    force: true,
                    parentRevision: Number(head.revision || 0),
                    modCachePath: path.join(app.getPath('userData'), 'mod_cache.json')
                }),
                onProgress: (progress) => sendProgress('luxcloud:sync-progress', progress)
            });

            return ok({ resolved: 'local', backup, revision: pushed.revision });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:rollback', async (_event, instanceUuid, revision) => {
        try {
            const result = await api.authed({
                method: 'POST',
                url: `/api/cloud/instances/${encodeURIComponent(String(instanceUuid))}/revisions/${Number(revision)}/rollback`
            });
            return ok(result);
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:auto-sync-state', async () => {
        try {
            return ok({
                enabled: autoSync.isEnabled(),
                pending: autoSync.pendingInstances(),
                monitoring: changeMonitor.isRunning()
            });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:cancel-transfer', async (_event, instanceName) => {
        try {
            if (typeof instanceName === 'string' && instanceName.length > 0) {
                // Auch die Warteschlange anhalten, sonst startet der Abbruch nur eine
                // Pause bis zum naechsten Debounce.
                autoSync.cancel(instanceName);
                return ok({ cancelled: transfers.cancel(instanceName) });
            }
            return ok({ cancelled: transfers.cancelAll() > 0 });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:active-transfers', async () => {
        try {
            return ok({ transfers: transfers.list() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:flush-auto-sync', async () => {
        try {
            return ok(await autoSync.flush());
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

    ipcMain.handle('luxcloud:restore-cloud-instance', async (_event, instanceUuid) => {
        try {
            if (typeof instanceUuid !== 'string' || instanceUuid.length === 0) {
                return { success: false, error: 'invalid_request', message: 'Missing instance id' };
            }

            const result = await api.authed({
                method: 'POST',
                url: `/api/cloud/instances/${encodeURIComponent(instanceUuid)}/restore`
            });

            // The instance is out of the trash, so lift the local block and let the
            // background queue pick it up again.
            await setTrashed(instanceUuid, false).catch(() => {});
            const restoredName = (result.instance && result.instance.name) || null;
            const localName = (await nameForInstanceId(instanceUuid)) || restoredName;
            if (localName) autoSync.resume(localName);

            return ok({ instance: result.instance });
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

            // Answer straight from the local note instead of walking into a rejection the
            // server has already given us once.
            if (await isTrashed(instanceId)) {
                autoSync.suspend(instanceName);
                autoSync.cancel(instanceName);
                return {
                    success: false,
                    error: 'instance_trashed',
                    message: 'This instance is in the cloud trash. Restore it to sync again.',
                    instanceUuid: instanceId
                };
            }

            const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
            const started = Date.now();

            const result = await uploader.uploadInstance({
                instanceDir,
                instanceId,
                instanceName,
                capabilities: me.capabilities || {},
                options: await withSyncScope(instanceId, {
                    ...options,
                    modCachePath: path.join(app.getPath('userData'), 'mod_cache.json')
                }),
                onProgress: (progress) => sendProgress('luxcloud:sync-progress', progress)
            });

            // "Sync" means bringing both sides together, not only pushing. When the cloud
            // is ahead and nothing changed here, the honest answer is to fetch it - that
            // is the update the user had no button for.
            if (result.pullRequired) {
                if (!result.contentUnchanged) {
                    return {
                        success: false,
                        error: 'revision_conflict',
                        message: 'This instance changed here and in the cloud.',
                        details: {
                            currentRevision: result.revision,
                            localRevision: result.localRevision
                        }
                    };
                }

                const pulled = await downloader.restoreInstance({
                    instanceUuid: instanceId,
                    instanceDir,
                    instanceName,
                    modCachePath: path.join(app.getPath('userData'), 'mod_cache.json'),
                    onProgress: (progress) => sendProgress('luxcloud:restore-progress', progress)
                });

                return ok({
                    ...pulled,
                    pulled: true,
                    direction: 'download',
                    previousRevision: result.localRevision,
                    durationMs: Date.now() - started
                });
            }

            return ok({ ...result, durationMs: Date.now() - started });
        } catch (err) {
            const failure = fail(err);
            if (failure.error === 'instance_trashed') {
                const dir = resolveInstanceDirByName(instanceName);
                const uuid = dir ? await readInstanceId(dir) : null;
                failure.instanceUuid = uuid;

                // Record it and stop the background queue, otherwise every later file
                // change schedules another upload the server will reject again.
                if (uuid) await setTrashed(uuid, true).catch(() => {});
                autoSync.suspend(instanceName);
                autoSync.cancel(instanceName);
            }
            return failure;
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
