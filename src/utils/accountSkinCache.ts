// Remembers the skin texture of every account that was signed in once, so the
// account lists can show the real head for accounts that are not active right now
// (the public avatar services often hand back a default Steve/Alex head).

const STORAGE_KEY = 'lux-account-skins';

const normalizeUuid = (uuid: unknown) => String(uuid || '').replace(/-/g, '').toLowerCase();

const readAll = (): Record<string, string> => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
};

export const getCachedAccountSkin = (uuid: unknown): string | undefined => {
    const key = normalizeUuid(uuid);
    if (!key) return undefined;
    const url = readAll()[key];
    return typeof url === 'string' && url.startsWith('http') ? url : undefined;
};

export const cacheAccountSkin = (uuid: unknown, skinUrl: unknown) => {
    const key = normalizeUuid(uuid);
    const url = String(skinUrl || '');
    if (!key || !url.startsWith('http')) return;
    try {
        const all = readAll();
        if (all[key] === url) return;
        all[key] = url;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {
        // Storage unavailable: the lists fall back to the avatar services.
    }
};

export const forgetAccountSkin = (uuid: unknown) => {
    const key = normalizeUuid(uuid);
    if (!key) return;
    try {
        const all = readAll();
        delete all[key];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {
        // ignore
    }
};
