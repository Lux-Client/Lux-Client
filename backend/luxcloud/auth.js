const crypto = require('crypto');
const { EventEmitter } = require('events');
const { app, shell } = require('electron');

const api = require('./api');
const state = require('./state');
const {
    ACCESS_TOKEN_REFRESH_MARGIN_MS,
    LOGIN_TIMEOUT_MS,
    getBaseUrl
} = require('./config');

const events = new EventEmitter();

let pendingLogin = null;
let refreshInFlight = null;

function base64Url(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkcePair() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

function isDeepLinkReady() {
    try {
        if (app.isPackaged) return app.isDefaultProtocolClient('luxclient');
        return app.isDefaultProtocolClient('luxclient', process.execPath, [app.getAppPath()]);
    } catch {
        return true;
    }
}

function emitAccountChanged(reason) {
    getAccount()
        .then((account) => events.emit('account-changed', { reason, account }))
        .catch(() => {});
}

async function getAccount() {
    const current = await state.readState();
    return {
        loggedIn: Boolean(current.refreshToken && current.user),
        user: current.user || null,
        device: {
            uuid: current.deviceUuid || null,
            name: state.getDeviceName(),
            platform: process.platform
        },
        loginTimeoutMs: LOGIN_TIMEOUT_MS,
        deepLinkReady: isDeepLinkReady(),
        linkedAt: current.linkedAt || null,
        baseUrl: getBaseUrl()
    };
}

function cancelPendingLogin(reason) {
    if (!pendingLogin) return;

    clearTimeout(pendingLogin.timer);
    const { reject } = pendingLogin;
    pendingLogin = null;
    reject(new api.LuxCloudError('login_cancelled', reason || 'Sign-in was cancelled'));
}

async function exchangeCode({ code, verifier, deviceUuid, appVersion }) {
    return api.raw({
        method: 'POST',
        url: '/api/auth/device/token',
        data: {
            code,
            code_verifier: verifier,
            device_uuid: deviceUuid,
            device_name: state.getDeviceName(),
            platform: process.platform,
            app_version: appVersion || null
        }
    });
}

async function login({ appVersion } = {}) {
    cancelPendingLogin('A newer sign-in was started');

    const deviceUuid = await state.ensureDeviceUuid();
    const pkce = createPkcePair();
    const requestState = base64Url(crypto.randomBytes(16));

    const params = new URLSearchParams({
        code_challenge: pkce.challenge,
        state: requestState,
        device_name: state.getDeviceName(),
        platform: process.platform
    });

    const codePromise = new Promise((resolve, reject) => {
        pendingLogin = {
            state: requestState,
            // Kept so the manual code shown on the website can be redeemed against the
            // same PKCE challenge -- that is what makes the code useless to anyone else.
            verifier: pkce.verifier,
            resolve,
            reject,
            timer: setTimeout(() => {
                pendingLogin = null;
                reject(new api.LuxCloudError('login_timeout', 'Sign-in timed out. Please try again.'));
            }, LOGIN_TIMEOUT_MS)
        };
    });

    try {
        await shell.openExternal(`${getBaseUrl()}/auth/device?${params.toString()}`);
    } catch (err) {
        cancelPendingLogin('The browser could not be opened');
        throw new api.LuxCloudError('browser_unavailable', 'Could not open your browser for the sign-in.');
    }

    const { code } = await codePromise;

    let tokens;
    try {
        tokens = await exchangeCode({ code, verifier: pkce.verifier, deviceUuid, appVersion });
    } catch (err) {
        if (err.code === 'device_conflict') {
            const freshUuid = await state.rotateDeviceUuid();
            tokens = await exchangeCode({ code, verifier: pkce.verifier, deviceUuid: freshUuid, appVersion });
        } else {
            throw err;
        }
    }

    await state.setSession({
        user: tokens.user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
    });

    emitAccountChanged('login');
    return getAccount();
}

function completeLogin({ code, state: returnedState, error }) {
    if (!pendingLogin) {
        console.warn('[LuxCloud] Received an auth deep link without a pending sign-in - ignoring.');
        return false;
    }

    if (returnedState !== pendingLogin.state) {
        console.warn('[LuxCloud] Auth deep link with an unexpected state - ignoring.');
        return false;
    }

    const { resolve, reject, timer } = pendingLogin;
    clearTimeout(timer);
    pendingLogin = null;

    if (error) {
        reject(new api.LuxCloudError(
            error === 'access_denied' ? 'login_denied' : 'login_failed',
            error === 'access_denied' ? 'Sign-in was declined in the browser.' : 'Sign-in failed.'
        ));
        return true;
    }

    if (typeof code !== 'string' || code.length === 0) {
        reject(new api.LuxCloudError('login_failed', 'The browser returned no authorization code.'));
        return true;
    }

    resolve({ code });
    return true;
}

async function refreshSession({ reason } = {}) {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        const current = await state.readState();
        if (!current.refreshToken || !current.deviceUuid) return false;

        try {
            const tokens = await api.raw({
                method: 'POST',
                url: '/api/auth/device/refresh',
                data: { refresh_token: current.refreshToken, device_uuid: current.deviceUuid }
            });

            await state.updateTokens({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn
            });
            return true;
        } catch (err) {
            if (err.code === 'device_revoked' || err.code === 'forbidden' || err.code === 'invalid_request') {
                await handleRevocation(err);
                return false;
            }
            console.warn(`[LuxCloud] Token refresh failed (${reason || 'scheduled'}): ${err.code}`);
            return false;
        } finally {
            refreshInFlight = null;
        }
    })();

    return refreshInFlight;
}

async function getValidAccessToken() {
    const current = await state.readState();
    if (!current.refreshToken) return null;

    const expiresAt = Number(current.accessTokenExpiresAt || 0);
    if (current.accessToken && expiresAt - Date.now() > ACCESS_TOKEN_REFRESH_MARGIN_MS) {
        return current.accessToken;
    }

    const refreshed = await refreshSession({ reason: 'expiring' });
    if (!refreshed) return null;

    const next = await state.readState();
    return next.accessToken || null;
}

async function handleRevocation(err) {
    const stopped = api.abortAll('signed_out');
    await state.clearSession();
    api.resetAbortReason();
    events.emit('cloud-aborted', { reason: 'device_revoked', stopped });
    emitAccountChanged('revoked');
    console.warn(`[LuxCloud] Signed out locally: ${err ? err.code : 'device_revoked'}`);
}

async function logout() {
    cancelPendingLogin('Signed out');
    cancelPairing('Signed out');

    try {
        await api.authed({ method: 'POST', url: '/api/auth/device/revoke' }, { allowRetry: false });
    } catch (err) {
        console.warn(`[LuxCloud] Server-side sign-out failed (${err.code}) - clearing local session anyway.`);
    }

    const stopped = api.abortAll('signed_out');
    if (stopped > 0) {
        console.warn(`[LuxCloud] Sign-out stopped ${stopped} running cloud request(s).`);
    }

    await state.clearSession();
    api.resetAbortReason();
    events.emit('cloud-aborted', { reason: 'signed_out', stopped });
    emitAccountChanged('logout');
    return getAccount();
}

let pendingPairing = null;

function cancelPairing(reason = 'Cancelled') {
    if (!pendingPairing) return false;
    pendingPairing.cancelled = true;
    clearTimeout(pendingPairing.timer);
    pendingPairing = null;
    return Boolean(reason);
}

async function redeemManualCode({ userCode, appVersion } = {}) {
    if (!pendingLogin || !pendingLogin.verifier) {
        throw new api.LuxCloudError('no_login', 'Start the sign-in first, then enter the code');
    }

    const deviceUuid = await state.ensureDeviceUuid();
    const attempt = async (uuid) => api.raw({
        method: 'POST',
        url: '/api/auth/device/pair/redeem',
        data: {
            user_code: String(userCode || '').trim().toUpperCase(),
            code_verifier: pendingLogin.verifier,
            device_uuid: uuid,
            device_name: state.getDeviceName(),
            platform: process.platform,
            app_version: appVersion || null
        }
    });

    let tokens;
    try {
        tokens = await attempt(deviceUuid);
    } catch (err) {
        if (err.code !== 'device_conflict') throw err;
        tokens = await attempt(await state.rotateDeviceUuid());
    }

    if (!tokens || !tokens.accessToken) {
        throw new api.LuxCloudError('pairing_failed', 'The server did not return a session');
    }

    cancelPendingLogin('Signed in with a code');

    await state.setSession({
        user: tokens.user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
    });

    emitAccountChanged('login');
    return getAccount();
}

async function startPairing({ appVersion } = {}) {
    cancelPairing('A newer pairing was started');
    cancelPendingLogin('A pairing was started instead');

    const deviceUuid = await state.ensureDeviceUuid();
    const pkce = createPkcePair();

    const started = await api.raw({
        method: 'POST',
        url: '/api/auth/device/pair/start',
        data: {
            code_challenge: pkce.challenge,
            device_name: state.getDeviceName(),
            platform: process.platform
        }
    });

    pendingPairing = {
        cancelled: false,
        deviceCode: started.deviceCode,
        verifier: pkce.verifier,
        deviceUuid,
        appVersion: appVersion || null,
        timer: setTimeout(() => cancelPairing('Pairing timed out'), (started.expiresIn || 600) * 1000)
    };

    return {
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresIn: started.expiresIn,
        interval: started.interval || 3
    };
}

async function pollPairing() {
    if (!pendingPairing) {
        throw new api.LuxCloudError('no_pairing', 'No pairing is in progress');
    }

    const current = pendingPairing;
    const attempt = async (uuid) => api.raw({
        method: 'POST',
        url: '/api/auth/device/pair/poll',
        data: {
            device_code: current.deviceCode,
            code_verifier: current.verifier,
            device_uuid: uuid,
            device_name: state.getDeviceName(),
            platform: process.platform,
            app_version: current.appVersion
        }
    });

    let tokens;
    try {
        tokens = await attempt(current.deviceUuid);
    } catch (err) {
        if (err.code === 'device_conflict') {
            const freshUuid = await state.rotateDeviceUuid();
            current.deviceUuid = freshUuid;
            tokens = await attempt(freshUuid);
        } else {
            cancelPairing('Pairing failed');
            throw err;
        }
    }

    // The server answers 202 while nobody has approved the code yet. axios treats
    // any 2xx as success, so this arrives as a normal body and not as a throw.
    if (tokens && tokens.error === 'authorization_pending') {
        return { status: 'pending', interval: tokens.interval || 3 };
    }
    if (!tokens || !tokens.accessToken) {
        cancelPairing('Pairing returned nothing usable');
        throw new api.LuxCloudError('pairing_failed', 'The server did not return a session');
    }

    cancelPairing('Pairing finished');

    await state.setSession({
        user: tokens.user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
    });

    emitAccountChanged('login');
    return { status: 'done', account: await getAccount() };
}

module.exports = {
    cancelPairing,
    cancelPendingLogin,
    completeLogin,
    events,
    getAccount,
    getValidAccessToken,
    handleRevocation,
    login,
    logout,
    pollPairing,
    redeemManualCode,
    refreshSession,
    startPairing
};
