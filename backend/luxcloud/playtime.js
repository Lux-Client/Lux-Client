const fs = require('fs-extra');
const path = require('path');

const api = require('./api');
const { readInstanceState, rememberRevision, listTrackedInstances } = require('./syncState');

const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

async function readLocalPlaytime(instanceDir) {
    try {
        const config = await fs.readJson(path.join(instanceDir, 'instance.json'));
        const value = Number(config && config.playtime);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    } catch (_) {
        return 0;
    }
}

async function seedIfNeeded(instanceId, instanceDir) {
    const tracked = await readInstanceState(instanceId);
    if (!tracked) return 0;
    if (tracked.playtimeSeeded) return Number(tracked.deviceTotalMs || 0);

    const local = await readLocalPlaytime(instanceDir);
    await rememberRevision(instanceId, {
        deviceTotalMs: local,
        playtimeSeeded: true,
        playtimeSeededAt: Date.now()
    });
    return local;
}

async function creditSession(instanceId, durationMs) {
    if (!instanceId || !Number.isFinite(durationMs) || durationMs <= 0) return null;

    const tracked = await readInstanceState(instanceId);
    if (!tracked) return null;

    const capped = Math.min(Math.round(durationMs), MAX_SESSION_MS);
    const next = Number(tracked.deviceTotalMs || 0) + capped;

    await rememberRevision(instanceId, { deviceTotalMs: next, playtimeSeeded: true });
    return { deviceTotalMs: next, credited: capped };
}

async function push(instanceId, { sessionId = null } = {}) {
    const tracked = await readInstanceState(instanceId);
    if (!tracked || !tracked.cloudLinked) return { skipped: true, reason: 'not_linked' };

    const deviceTotalMs = Number(tracked.deviceTotalMs || 0);
    if (deviceTotalMs === Number(tracked.playtimePushedMs || -1)) {
        return { skipped: true, reason: 'unchanged', deviceTotalMs };
    }

    try {
        const result = await api.authed({
            method: 'PUT',
            url: `/api/cloud/instances/${instanceId}/playtime`,
            data: { deviceTotalMs, lastSessionId: sessionId }
        });

        await rememberRevision(instanceId, {
            playtimePushedMs: deviceTotalMs,
            playtimeTotalMs: result.instanceTotalMs,
            playtimePushedAt: Date.now()
        });

        return { pushed: true, ...result };
    } catch (err) {
        if (err.code === 'non_monotonic' && err.details && Number.isFinite(err.details.storedTotalMs)) {
            const stored = Number(err.details.storedTotalMs);
            await rememberRevision(instanceId, {
                deviceTotalMs: stored,
                playtimePushedMs: stored
            });
            return { pushed: false, reason: 'non_monotonic', deviceTotalMs: stored };
        }
        throw err;
    }
}

async function pushAllPending() {
    const tracked = await listTrackedInstances();
    const results = [];

    for (const entry of tracked) {
        if (!entry.cloudLinked) continue;
        if (Number(entry.deviceTotalMs || 0) === Number(entry.playtimePushedMs || -1)) continue;

        try {
            results.push({ instanceId: entry.instanceId, result: await push(entry.instanceId) });
        } catch (err) {
            results.push({ instanceId: entry.instanceId, error: err.code || 'unknown_error' });
        }
    }

    return results;
}

async function fetchBreakdown(instanceId) {
    return api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/playtime` });
}

module.exports = {
    MAX_SESSION_MS,
    creditSession,
    fetchBreakdown,
    push,
    pushAllPending,
    readLocalPlaytime,
    seedIfNeeded
};
