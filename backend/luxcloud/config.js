const DEFAULT_BASE_URL = 'https://lux.pluginhub.de';

function getBaseUrl() {
    const override = process.env.LUXCLOUD_BASE_URL;
    if (typeof override === 'string' && override.trim().length > 0) {
        return override.trim().replace(/\/+$/, '');
    }
    return DEFAULT_BASE_URL;
}

module.exports = {
    DEFAULT_BASE_URL,
    getBaseUrl,

    AUTH_DEEP_LINK_HOST: 'auth',

    LOGIN_TIMEOUT_MS: 3 * 60 * 1000,

    ACCESS_TOKEN_REFRESH_MARGIN_MS: 60 * 1000,

    REQUEST_TIMEOUT_MS: 20 * 1000,

    TRANSFER_TIMEOUT_MS: 120 * 1000
};
