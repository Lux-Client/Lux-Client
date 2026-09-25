const { readState, patchState } = require('./state');

async function readInstanceState(instanceId) {
    const state = await readState();
    const instances = state.instances || {};
    return instances[instanceId] || null;
}

async function rememberRevision(instanceId, patch) {
    const state = await readState();
    const instances = { ...(state.instances || {}) };

    // Verknuepft wird nur, wer es ausdruecklich sagt (Upload, Download). Frueher machte
    // jeder beliebige Vermerk -- Spielzeit, Weltauswahl, Umfang -- aus einer rein lokalen
    // Instanz eine verknuepfte, und der automatische Sync lud sie ungefragt hoch.
    const existing = instances[instanceId] || {};
    instances[instanceId] = {
        ...existing,
        cloudLinked: Boolean(existing.cloudLinked),
        ...patch
    };

    await patchState({ instances });
    return instances[instanceId];
}

async function forgetInstance(instanceId) {
    const state = await readState();
    const instances = { ...(state.instances || {}) };
    if (!(instanceId in instances)) return false;

    delete instances[instanceId];
    await patchState({ instances });
    return true;
}

async function listTrackedInstances() {
    const state = await readState();
    return Object.entries(state.instances || {}).map(([instanceId, entry]) => ({ instanceId, ...entry }));
}

// Remembers that the server refused this instance because it sits in the cloud trash.
// Without a local note every file change would queue another upload that is bound to be
// rejected, which is what kept the sync indicator spinning forever.
async function setTrashed(instanceId, trashed) {
    const state = await readState();
    const instances = { ...(state.instances || {}) };
    const current = instances[instanceId];
    if (!current) return false;
    if (Boolean(current.trashed) === Boolean(trashed)) return false;

    instances[instanceId] = { ...current, trashed: Boolean(trashed) };
    await patchState({ instances });
    return true;
}

async function isTrashed(instanceId) {
    const entry = await readInstanceState(instanceId);
    return Boolean(entry && entry.trashed);
}

module.exports = {
    forgetInstance,
    isTrashed,
    listTrackedInstances,
    readInstanceState,
    rememberRevision,
    setTrashed
};
