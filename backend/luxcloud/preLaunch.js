const api = require('./api');
const conflict = require('./conflict');
const downloader = require('./downloader');
const { readInstanceState } = require('./syncState');

const HEAD_TIMEOUT_MS = 2500;

const DECISION = {
    LAUNCH: 'launch',
    UPDATED: 'updated',
    CONFLICT: 'conflict',
    OFFLINE: 'offline',
    NOT_LINKED: 'not-linked',
    DISABLED: 'disabled',
    BUSY: 'busy'
};

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            const err = new api.LuxCloudError('offline', 'The cloud did not answer in time');
            reject(err);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchHead(instanceId) {
    return withTimeout(
        api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/head?touch=1` }),
        HEAD_TIMEOUT_MS
    );
}

async function checkBeforeLaunch({
    instanceDir,
    instanceId,
    instanceName,
    options = {},
    onProgress = null
} = {}) {
    const report = (phase, detail = {}) => {
        if (onProgress) onProgress({ instanceName, instanceId, phase, ...detail });
    };

    if (options.enabled === false) {
        return { decision: DECISION.DISABLED, canLaunch: true };
    }

    const tracked = await readInstanceState(instanceId);
    if (!tracked || !tracked.cloudLinked) {
        return { decision: DECISION.NOT_LINKED, canLaunch: true };
    }

    report('checking');

    let head;
    try {
        head = await fetchHead(instanceId);
    } catch (err) {
        return {
            decision: DECISION.OFFLINE,
            canLaunch: true,
            reason: err.code || 'offline',
            lastSyncedAt: tracked.lastSyncedAt || null
        };
    }

    const localRevision = Number(tracked.lastKnownRevision || 0);
    const remoteRevision = Number(head.revision || 0);

    const dirty = await conflict.isLocallyDirty(instanceDir, instanceId, {
        syncWorlds: Boolean(options.syncWorlds),
        syncScreenshots: Boolean(options.syncScreenshots),
        instanceConfigHash: tracked.lastInstanceConfigHash || null
    });

    const activeElsewhere = head.activeSession
        && head.activeSession.deviceUuid
        && head.activeSession.deviceUuid !== options.deviceUuid;

    const base = {
        localRevision,
        remoteRevision,
        dirty: dirty.dirty,
        changedLocally: dirty.changed.length,
        activeSession: activeElsewhere ? head.activeSession : null
    };

    if (remoteRevision <= localRevision) {
        return {
            ...base,
            decision: DECISION.LAUNCH,
            canLaunch: true,
            pushAfterLaunch: dirty.dirty
        };
    }

    if (!dirty.dirty) {
        report('updating', { from: localRevision, to: remoteRevision });

        const restored = await downloader.restoreInstance({
            instanceUuid: instanceId,
            instanceDir,
            instanceName,
            onProgress: (progress) => report('updating', progress)
        });

        report('ready', { revision: restored.revision });
        return {
            ...base,
            decision: DECISION.UPDATED,
            canLaunch: true,
            revision: restored.revision,
            downloadedBytes: restored.downloadedBytes,
            unavailable: restored.unavailable
        };
    }

    report('conflict', { localRevision, remoteRevision });

    const remote = await api.authed({
        method: 'GET',
        url: `/api/cloud/instances/${instanceId}/manifest?revision=latest`
    });

    let baseManifest = null;
    if (localRevision > 0) {
        try {
            const previous = await api.authed({
                method: 'GET',
                url: `/api/cloud/instances/${instanceId}/manifest?revision=${localRevision}`
            });
            baseManifest = previous.manifest;
        } catch (_) {
            baseManifest = null;
        }
    }

    return {
        ...base,
        decision: DECISION.CONFLICT,
        canLaunch: false,
        remoteManifest: remote.manifest,
        baseManifest,
        changed: dirty.changed.slice(0, 200)
    };
}

module.exports = {
    DECISION,
    HEAD_TIMEOUT_MS,
    checkBeforeLaunch,
    fetchHead
};
