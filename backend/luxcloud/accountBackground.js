const crypto = require('crypto');
const path = require('path');

const fs = require('fs-extra');

const MAX_BACKGROUND_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
};

const EXT_BY_MIME = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm'
};

const ACCOUNT_FILE_RE = /^account_([0-9a-f]{64})\.[a-z0-9]+$/;

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(filePath)
            .on('error', reject)
            .on('data', (chunk) => hash.update(chunk))
            .on('end', () => resolve(hash.digest('hex')));
    });
}

function sameMedia(a, b) {
    const urlA = (a && a.url) || '';
    const urlB = (b && b.url) || '';
    return urlA === urlB;
}

function createAccountBackgroundSync({ backgroundsDir, readSettings, patchSettings, api, isLoggedIn, getUserId, onStatus }) {
    let chain = Promise.resolve();

    const report = (payload) => {
        try {
            if (onStatus) onStatus(payload);
        } catch {
            return;
        }
    };

    const accountFilePath = (hash, ext) => path.join(backgroundsDir, `account_${hash}.${ext}`).replace(/\\/g, '/');

    async function describeLocal(media) {
        if (!media || !media.url || media.type === 'none') return null;
        if (!await fs.pathExists(media.url)) return null;

        const match = ACCOUNT_FILE_RE.exec(path.basename(media.url));
        const hash = match ? match[1] : await hashFile(media.url);
        return { hash, url: media.url, type: media.type === 'video' ? 'video' : 'image' };
    }

    async function pruneAccountFiles(keep) {
        const keepNames = new Set(keep.filter(Boolean).map((url) => path.basename(url)));
        for (const name of await fs.readdir(backgroundsDir).catch(() => [])) {
            if (ACCOUNT_FILE_RE.test(name) && !keepNames.has(name)) {
                await fs.remove(path.join(backgroundsDir, name)).catch(() => {});
            }
        }
    }

    async function fetchRemote() {
        const result = await api.authed({ method: 'GET', url: '/api/cloud/me/background' });
        return (result && result.background) || null;
    }

    async function download(remote) {
        const ext = remote.ext || EXT_BY_MIME[remote.mime] || 'bin';
        const target = accountFilePath(remote.hash, ext);
        if (await fs.pathExists(target)) return target;

        const data = await api.authed({
            method: 'GET',
            url: '/api/cloud/me/background/file',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(data);
        const digest = crypto.createHash('sha256').update(buffer).digest('hex');
        if (digest !== remote.hash) {
            throw new api.LuxCloudError('hash_mismatch', 'The downloaded background does not match the account');
        }

        await fs.ensureDir(backgroundsDir);
        const tmp = `${target}.part`;
        await fs.writeFile(tmp, buffer);
        await fs.move(tmp, target, { overwrite: true });
        return target;
    }

    async function upload(local) {
        const stat = await fs.stat(local.url);
        if (stat.size > MAX_BACKGROUND_BYTES) {
            throw new api.LuxCloudError('too_large', 'The background may be at most 50 MB to sync it with your account');
        }

        const FormData = require('form-data');
        const form = new FormData();
        const buffer = await fs.readFile(local.url);
        const extension = path.extname(local.url).toLowerCase();

        form.append('background', buffer, {
            filename: path.basename(local.url),
            contentType: MIME_BY_EXT[extension] || 'application/octet-stream',
            knownLength: buffer.length
        });

        const result = await api.authed({
            method: 'PUT',
            url: '/api/cloud/me/background',
            data: form,
            headers: form.getHeaders()
        });
        const remote = result && result.background;
        if (!remote || !remote.hash) {
            throw new api.LuxCloudError('server_error', 'Lux Cloud did not confirm the background');
        }

        const target = accountFilePath(remote.hash, remote.ext || extension.replace('.', ''));
        if (path.resolve(target) !== path.resolve(local.url)) {
            await fs.copy(local.url, target, { overwrite: true });
        }
        return { remote, url: target };
    }

    // Ein Abgleich laeuft wie bei Git gegen eine Basis: der Stand, auf den sich dieses
    // Geraet und das Konto zuletzt geeinigt haben. Hat sich nur das Geraet bewegt, geht
    // der Hintergrund hoch; hat sich nur das Konto bewegt, kommt er herunter.
    async function run(reason) {
        const settings = await readSettings();
        if (!settings.accountBackgroundSync) return { state: 'disabled' };
        if (!await isLoggedIn()) return { state: 'signed_out' };

        const userId = await getUserId();
        const startMedia = settings.theme && settings.theme.bgMedia;
        const storedBase = settings.accountBackgroundBase;
        const base = storedBase && storedBase.userId === userId ? storedBase : null;

        const [remote, local] = await Promise.all([fetchRemote(), describeLocal(startMedia)]);
        const remoteHash = remote ? remote.hash : null;
        const localHash = local ? local.hash : null;

        let action = 'none';
        if (localHash === remoteHash) {
            action = 'adopt';
        } else if (!base) {
            if (reason === 'local') action = 'push';
            else if (remote) action = 'pull';
            else if (reason === 'enable' && local) action = 'push';
        } else {
            const localChanged = localHash !== base.hash;
            const remoteChanged = remoteHash !== base.hash;
            if (localChanged && (!remoteChanged || reason === 'local')) action = 'push';
            else if (remoteChanged) action = 'pull';
        }

        if (action === 'none') return { state: 'idle' };

        let nextMedia = startMedia;
        let nextHash = remoteHash;

        if (action === 'adopt') {
            if (local && !ACCOUNT_FILE_RE.test(path.basename(local.url))) {
                const ext = (remote && remote.ext) || path.extname(local.url).replace('.', '');
                const target = accountFilePath(local.hash, ext);
                await fs.copy(local.url, target, { overwrite: true });
                nextMedia = { url: target, type: local.type };
            }
        } else if (action === 'push') {
            if (local) {
                report({ state: 'uploading' });
                const uploaded = await upload(local);
                nextHash = uploaded.remote.hash;
                nextMedia = { url: uploaded.url, type: uploaded.remote.type || local.type };
            } else {
                await api.authed({ method: 'DELETE', url: '/api/cloud/me/background' });
                nextHash = null;
                nextMedia = { url: '', type: 'none' };
            }
        } else if (action === 'pull') {
            if (remote) {
                report({ state: 'downloading' });
                nextMedia = { url: await download(remote), type: remote.type === 'video' ? 'video' : 'image' };
            } else {
                nextMedia = { url: '', type: 'none' };
            }
        }

        let raced = false;
        const saved = await patchSettings((current) => {
            const currentMedia = current.theme && current.theme.bgMedia;
            if (!current.accountBackgroundSync || !sameMedia(currentMedia, startMedia)) {
                raced = true;
                return null;
            }
            return {
                ...current,
                accountBackgroundBase: { userId, hash: nextHash },
                theme: { ...current.theme, bgMedia: nextMedia }
            };
        });

        if (raced) return { state: 'retry' };

        await pruneAccountFiles([
            nextMedia && nextMedia.url,
            saved && saved.localBgMedia && saved.localBgMedia.url
        ]);

        return { state: 'synced', action };
    }

    function reconcile(reason = 'check') {
        const next = chain.then(async () => {
            try {
                let result = await run(reason);
                if (result.state === 'retry') result = await run('local');
                if (result.state === 'synced') report({ state: 'synced', action: result.action });
                return result;
            } catch (err) {
                const code = (err && err.code) || 'unknown_error';
                if (code !== 'offline' && code !== 'unauthorized' && code !== 'signed_out') {
                    console.warn(`[LuxCloud] Background sync (${reason}) failed:`, err && err.message);
                }
                report({ state: 'error', error: code, message: err && err.message });
                return { state: 'error', error: code };
            }
        });
        chain = next.catch(() => {});
        return next;
    }

    async function setEnabled(enabled) {
        await patchSettings((current) => {
            if (Boolean(current.accountBackgroundSync) === Boolean(enabled)) return null;

            if (enabled) {
                return {
                    ...current,
                    accountBackgroundSync: true,
                    accountBackgroundBase: null,
                    localBgMedia: (current.theme && current.theme.bgMedia) || { url: '', type: 'none' }
                };
            }

            const stash = current.localBgMedia;
            const restore = stash && stash.url && fs.pathExistsSync(stash.url)
                ? stash
                : { url: '', type: 'none' };
            return {
                ...current,
                accountBackgroundSync: false,
                accountBackgroundBase: null,
                localBgMedia: null,
                theme: { ...current.theme, bgMedia: restore }
            };
        });

        if (enabled) return reconcile('enable');

        const settings = await readSettings();
        await pruneAccountFiles([settings.theme && settings.theme.bgMedia && settings.theme.bgMedia.url]);
        return { state: 'disabled' };
    }

    async function handleSignedOut() {
        await patchSettings((current) => {
            if (!current.accountBackgroundSync) return null;
            const stash = current.localBgMedia;
            const restore = stash && stash.url && fs.pathExistsSync(stash.url)
                ? stash
                : { url: '', type: 'none' };
            return {
                ...current,
                accountBackgroundBase: null,
                theme: { ...current.theme, bgMedia: restore }
            };
        });
    }

    return { handleSignedOut, reconcile, setEnabled };
}

module.exports = { MAX_BACKGROUND_BYTES, createAccountBackgroundSync };
