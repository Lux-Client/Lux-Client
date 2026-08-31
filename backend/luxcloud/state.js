const crypto = require('crypto');
const os = require('os');
const fs = require('fs-extra');

const { getStateFile } = require('./paths');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');
const { encryptToken, decryptToken } = require('../utils/secureProfileStore');

const EMPTY_STATE = {
    version: 1,
    deviceUuid: null,
    user: null,
    accessTokenExpiresAt: null,
    linkedAt: null
};

let cache = null;

function newDeviceUuid() {
    return crypto.randomUUID().replace(/-/g, '');
}

function getDeviceName() {
    const hostname = os.hostname();
    if (typeof hostname === 'string' && hostname.trim().length > 0) {
        return hostname.trim().slice(0, 100);
    }
    return 'Lux Client';
}

async function readState() {
    if (cache) return cache;

    const raw = await readJsonSafe(getStateFile(), null);
    if (!raw || typeof raw !== 'object') {
        cache = { ...EMPTY_STATE };
        return cache;
    }

    cache = {
        ...EMPTY_STATE,
        ...raw,
        accessToken: decryptToken(raw.accessTokenEnc) || null,
        refreshToken: decryptToken(raw.refreshTokenEnc) || null
    };
    delete cache.accessTokenEnc;
    delete cache.refreshTokenEnc;
    return cache;
}

async function writeState(next) {
    const stored = { ...next };
    stored.accessTokenEnc = next.accessToken ? encryptToken(next.accessToken) : null;
    stored.refreshTokenEnc = next.refreshToken ? encryptToken(next.refreshToken) : null;
    delete stored.accessToken;
    delete stored.refreshToken;

    await writeJsonAtomic(getStateFile(), stored);
    cache = { ...next };
    return cache;
}

async function patchState(patch) {
    const current = await readState();
    return writeState({ ...current, ...patch });
}

async function ensureDeviceUuid() {
    const state = await readState();
    if (state.deviceUuid) return state.deviceUuid;

    const deviceUuid = newDeviceUuid();
    await patchState({ deviceUuid });
    return deviceUuid;
}

async function rotateDeviceUuid() {
    const deviceUuid = newDeviceUuid();
    await patchState({ deviceUuid });
    return deviceUuid;
}

async function setSession({ user, accessToken, refreshToken, expiresIn }) {
    return patchState({
        user,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + (Number(expiresIn) || 0) * 1000,
        linkedAt: Date.now()
    });
}

async function updateTokens({ accessToken, refreshToken, expiresIn }) {
    return patchState({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + (Number(expiresIn) || 0) * 1000
    });
}

async function clearSession() {
    cache = { ...EMPTY_STATE };
    await fs.remove(getStateFile()).catch(() => {});
    return cache;
}

async function isLoggedIn() {
    const state = await readState();
    return Boolean(state.refreshToken && state.user);
}

module.exports = {
    clearSession,
    ensureDeviceUuid,
    getDeviceName,
    isLoggedIn,
    patchState,
    readState,
    rotateDeviceUuid,
    setSession,
    updateTokens
};
