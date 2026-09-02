const axios = require('axios');

const { getBaseUrl, REQUEST_TIMEOUT_MS, TRANSFER_TIMEOUT_MS } = require('./config');

class LuxCloudError extends Error {
    constructor(code, message, { status = null, details = null, retryAfter = null } = {}) {
        super(message || code);
        this.name = 'LuxCloudError';
        this.code = code;
        this.status = status;
        this.details = details;
        this.retryAfter = retryAfter;
    }

    toIpc() {
        return { error: this.code, message: this.message, status: this.status, details: this.details };
    }
}

const OFFLINE_CODES = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
    'EHOSTUNREACH', 'ECONNRESET', 'EPIPE'
]);

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_BAD_RESPONSE_TIMEOUT']);

const inflight = new Set();
let abortReason = null;

function abortAll(reason = 'cancelled') {
    abortReason = reason;
    const controllers = [...inflight];
    inflight.clear();

    for (const controller of controllers) {
        try {
            controller.abort();
        } catch {
            abortReason = reason;
        }
    }
    return controllers.length;
}

function isCancelled(err) {
    return Boolean(err && (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || axios.isCancel(err)));
}

function normalizeError(err) {
    if (err instanceof LuxCloudError) return err;

    if (isCancelled(err)) {
        const reason = abortReason === 'signed_out' ? 'signed_out' : 'cancelled';
        return new LuxCloudError(
            reason,
            reason === 'signed_out'
                ? 'Signed out of the Lux account, the cloud operation was stopped'
                : 'The cloud operation was cancelled'
        );
    }

    if (err && err.response) {
        const { status, data } = err.response;
        const code = (data && data.error) || (status === 401 ? 'unauthorized' : 'server_error');
        const message = (data && data.message) || `Request failed with status ${status}`;
        return new LuxCloudError(code, message, {
            status,
            details: data && data.details ? data.details : null,
            retryAfter: data && data.retryAfter ? data.retryAfter : null
        });
    }

    if (err && TIMEOUT_CODES.has(err.code)) {
        return new LuxCloudError('timeout', 'Lux Cloud did not answer in time', { details: { cause: err.code } });
    }

    if (err && OFFLINE_CODES.has(err.code)) {
        return new LuxCloudError('offline', 'Lux Cloud is not reachable right now', { details: { cause: err.code } });
    }

    return new LuxCloudError('server_unreachable', (err && err.message) || 'Unknown network error');
}

function timeoutFor(config) {
    if (Number.isFinite(config.timeout) && config.timeout > 0) return config.timeout;
    return config.responseType === 'arraybuffer' || config.responseType === 'stream'
        ? TRANSFER_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS;
}

function client(config) {
    return axios.create({
        baseURL: getBaseUrl(),
        timeout: timeoutFor(config),
        validateStatus: (status) => status >= 200 && status < 300,
        headers: { Accept: 'application/json' }
    });
}

async function send(config) {
    const controller = new AbortController();
    inflight.add(controller);

    try {
        const response = await client(config).request({ ...config, signal: controller.signal });
        return response.data;
    } finally {
        inflight.delete(controller);
    }
}

async function raw(config) {
    try {
        return await send(config);
    } catch (err) {
        throw normalizeError(err);
    }
}

async function authed(config, { allowRetry = true } = {}) {
    const auth = require('./auth');

    const accessToken = await auth.getValidAccessToken();
    if (!accessToken) {
        throw new LuxCloudError('unauthorized', 'Not signed in to a Lux account');
    }

    try {
        return await send({
            ...config,
            headers: { ...(config.headers || {}), Authorization: `Bearer ${accessToken}` }
        });
    } catch (rawErr) {
        const err = normalizeError(rawErr);

        if (err.code === 'cancelled' || err.code === 'signed_out') throw err;

        if (err.code === 'device_revoked') {
            await auth.handleRevocation(err);
            throw err;
        }

        if (allowRetry && (err.code === 'token_expired' || err.code === 'unauthorized')) {
            const refreshed = await auth.refreshSession({ reason: err.code });
            if (refreshed) {
                return authed(config, { allowRetry: false });
            }
        }

        throw err;
    }
}

function resetAbortReason() {
    abortReason = null;
}

module.exports = {
    LuxCloudError,
    abortAll,
    authed,
    isCancelled,
    normalizeError,
    raw,
    resetAbortReason
};
