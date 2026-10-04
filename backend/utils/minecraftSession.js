const { Auth, mcTokenToolbox } = require('msmc');
const { getUserProfile, setUserProfile, getAccounts, setAccounts } = require('./secureProfileStore');

const authManager = new Auth('select_account');

// Minecraft-Tokens leben ~24h. Beim Spielstart erneuern wir schon, wenn weniger
// als diese Restzeit uebrig ist, damit die Session nicht mitten im Spiel ablaeuft.
const LAUNCH_REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000;

const pendingRefreshes = new Map();

function isAuthRejection(e) {
    const status = e?.response?.status;
    if (status === 400 || status === 401 || status === 403) return true;
    // msmc-Fehler (z.B. "error.auth.microsoft") bedeuten, dass der Refresh-Token ungueltig ist.
    return typeof e?.ts === 'string' && e.ts.startsWith('error.auth');
}

async function refreshProfile(store, profile) {
    if (!profile.refresh_token) {
        const err = new Error('Session expired and no refresh token available');
        err.authRejected = true;
        throw err;
    }

    console.log('[Session] Refreshing Minecraft token for', profile.name);
    let xboxManager, token;
    try {
        xboxManager = await authManager.refresh(profile.refresh_token);
        token = await xboxManager.getMinecraft();
    } catch (e) {
        if (isAuthRejection(e)) e.authRejected = true;
        throw e;
    }

    const newAccessToken = token.mcToken || token.access_token;
    if (!newAccessToken) throw new Error('Refresh returned no access token');

    try {
        const { clearCache } = require('./profileCache');
        clearCache(profile.access_token);
    } catch (e) { }

    const updatedProfile = {
        ...profile,
        access_token: newAccessToken,
        refresh_token: xboxManager.save(),
        exp: token.exp,
        xuid: token.xuid || profile.xuid || ''
    };

    const accounts = getAccounts(store);
    const idx = accounts.findIndex(a => a.uuid === profile.uuid);
    if (idx !== -1) {
        accounts[idx] = updatedProfile;
        setAccounts(store, accounts);
    }

    // Nur als aktives Profil setzen, wenn in der Zwischenzeit nicht gewechselt wurde.
    const current = getUserProfile(store);
    if (!current || current.uuid === profile.uuid) {
        setUserProfile(store, updatedProfile);
    }

    console.log('[Session] Refresh successful for', profile.name);
    return updatedProfile;
}

/**
 * Stellt sicher, dass das aktive Profil einen gueltigen Minecraft-Token hat und
 * erneuert ihn bei Bedarf automatisch ueber den gespeicherten Refresh-Token.
 *
 * @param {object} store electron-store Instanz
 * @param {object} [options]
 * @param {number} [options.minValidityMs] Token erneuern, wenn er kuerzer als das gueltig ist
 * @returns {Promise<{ profile: object, refreshed: boolean }>}
 */
async function ensureValidSession(store, options = {}) {
    const profile = getUserProfile(store);
    if (!profile || !profile.access_token) {
        const err = new Error('Not logged in');
        err.authRejected = true;
        throw err;
    }

    const minValidityMs = options.minValidityMs || 0;
    const locallyValid = mcTokenToolbox.validate({ exp: profile.exp })
        && (typeof profile.exp !== 'number' || profile.exp - Date.now() > minValidityMs);

    if (locallyValid) {
        try {
            const { getCachedProfile } = require('./profileCache');
            await getCachedProfile(profile.access_token);
            return { profile, refreshed: false };
        } catch (e) {
            if (e.response?.status !== 401) {
                // Netzwerkproblem o.ae. - Token ist lokal noch gueltig, also weiter benutzen.
                return { profile, refreshed: false };
            }
            console.log('[Session] Token locally valid but rejected by Mojang, refreshing.');
        }
    }

    let pending = pendingRefreshes.get(profile.uuid);
    if (!pending) {
        pending = refreshProfile(store, profile).finally(() => {
            pendingRefreshes.delete(profile.uuid);
        });
        pendingRefreshes.set(profile.uuid, pending);
    }
    const refreshedProfile = await pending;
    return { profile: refreshedProfile, refreshed: true };
}

module.exports = {
    ensureValidSession,
    LAUNCH_REFRESH_MARGIN_MS
};
