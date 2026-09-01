const { readState, patchState } = require('./state');

async function readInstanceState(instanceId) {
    const state = await readState();
    const instances = state.instances || {};
    return instances[instanceId] || null;
}

async function rememberRevision(instanceId, patch) {
    const state = await readState();
    const instances = { ...(state.instances || {}) };

    instances[instanceId] = {
        ...(instances[instanceId] || {}),
        cloudLinked: true,
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

module.exports = {
    forgetInstance,
    listTrackedInstances,
    readInstanceState,
    rememberRevision
};
