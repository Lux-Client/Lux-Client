const api = require('./api');
const { readInstanceState } = require('./syncState');

const HEARTBEAT_MS = 60 * 1000;

const active = new Map();

async function start(instanceId, instanceName) {
    if (!instanceId) return null;

    const tracked = await readInstanceState(instanceId);
    if (!tracked || !tracked.cloudLinked) return null;

    let session;
    try {
        session = await api.authed({
            method: 'POST',
            url: `/api/cloud/instances/${instanceId}/session`
        });
    } catch (err) {
        return { instanceId, instanceName, sessionId: null, offline: true, error: err.code };
    }

    const timer = setInterval(() => {
        api.authed({ method: 'POST', url: `/api/cloud/sessions/${session.sessionId}/heartbeat` })
            .catch(() => {});
    }, session.heartbeatIntervalMs || HEARTBEAT_MS);

    if (typeof timer.unref === 'function') timer.unref();
    active.set(instanceId, { sessionId: session.sessionId, timer, instanceName });

    return {
        instanceId,
        instanceName,
        sessionId: session.sessionId,
        offline: false,
        otherActiveSessions: session.otherActiveSessions || []
    };
}

async function end(instanceId) {
    const entry = active.get(instanceId);
    if (!entry) return false;

    clearInterval(entry.timer);
    active.delete(instanceId);

    try {
        await api.authed({ method: 'POST', url: `/api/cloud/sessions/${entry.sessionId}/end` });
        return true;
    } catch (_) {
        return false;
    }
}

function stopAll() {
    for (const entry of active.values()) clearInterval(entry.timer);
    active.clear();
}

function isActive(instanceId) {
    return active.has(instanceId);
}

module.exports = { HEARTBEAT_MS, end, isActive, start, stopAll };
