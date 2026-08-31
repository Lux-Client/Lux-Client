const axios = require('axios');

const { getBaseUrl, REQUEST_TIMEOUT_MS } = require('./config');

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
    'EHOSTUNREACH', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED'
]);

function normalizeError(err) {
    if (err instanceof LuxCloudError) return err;

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

    if (err && OFFLINE_CODES.has(err.code)) {
        return new LuxCloudError('offline', 'Lux Cloud is not reachable right now', { details: { cause: err.code } });
    }

    return new LuxCloudError('server_unreachable', (err && err.message) || 'Unknown network error');
}

function client() {
    return axios.create({
        baseURL: getBaseUrl(),
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: (status) => status >= 200 && status < 300,
        headers: { Accept: 'application/json' }
    });
}

async function raw(config) {
    try {
        const response = await client().request(config);
        return response.data;
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
        const response = await client().request({
            ...config,
            headers: { ...(config.headers || {}), Authorization: `Bearer ${accessToken}` }
        });
        return response.data;
    } catch (rawErr) {
        const err = normalizeError(rawErr);

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

module.exports = { LuxCloudError, authed, normalizeError, raw };
