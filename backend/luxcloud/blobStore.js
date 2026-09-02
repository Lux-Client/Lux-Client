const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { getBlobCacheDir } = require('./paths');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

function keyPath(hash, root = getBlobCacheDir()) {
    return path.join(root, hash.slice(0, 2), hash.slice(2, 4), hash);
}

function isHash(hash) {
    return typeof hash === 'string' && SHA256_RE.test(hash);
}

async function has(hash, root = getBlobCacheDir()) {
    if (!isHash(hash)) return false;
    try {
        const stat = await fs.stat(keyPath(hash, root));
        return stat.isFile();
    } catch (_) {
        return false;
    }
}

async function read(hash, root = getBlobCacheDir()) {
    if (!isHash(hash)) return null;
    try {
        return await fs.readFile(keyPath(hash, root));
    } catch (_) {
        return null;
    }
}

async function write(hash, buffer, root = getBlobCacheDir()) {
    if (!isHash(hash) || !Buffer.isBuffer(buffer)) return false;

    const actual = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actual !== hash) return false;

    const target = keyPath(hash, root);
    await fs.ensureDir(path.dirname(target));

    const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        await fs.writeFile(tmp, buffer);
        await fs.rename(tmp, target);
        return true;
    } catch (err) {
        await fs.remove(tmp).catch(() => {});
        if (err.code === 'EEXIST') return true;
        return false;
    }
}

async function adopt(hash, sourcePath, root = getBlobCacheDir()) {
    if (!isHash(hash)) return false;
    if (await has(hash, root)) return true;

    const target = keyPath(hash, root);
    await fs.ensureDir(path.dirname(target));

    const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        await fs.copy(sourcePath, tmp);
        await fs.rename(tmp, target);
        return true;
    } catch (_) {
        await fs.remove(tmp).catch(() => {});
        return false;
    }
}

async function copyTo(hash, targetPath, root = getBlobCacheDir()) {
    if (!await has(hash, root)) return false;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(keyPath(hash, root), targetPath, { overwrite: true });
    return true;
}

async function touch(hash, root = getBlobCacheDir()) {
    if (!isHash(hash)) return;
    const now = new Date();
    await fs.utimes(keyPath(hash, root), now, now).catch(() => {});
}

async function listEntries(root = getBlobCacheDir()) {
    const entries = [];
    if (!await fs.pathExists(root)) return entries;

    for (const first of await fs.readdir(root).catch(() => [])) {
        const firstDir = path.join(root, first);
        for (const second of await fs.readdir(firstDir).catch(() => [])) {
            const secondDir = path.join(firstDir, second);
            for (const name of await fs.readdir(secondDir).catch(() => [])) {
                if (!SHA256_RE.test(name)) continue;
                const full = path.join(secondDir, name);
                try {
                    const stat = await fs.stat(full);
                    entries.push({ hash: name, path: full, size: stat.size, atimeMs: stat.atimeMs });
                } catch (_) {
                    continue;
                }
            }
        }
    }

    return entries;
}

async function prune({ maxBytes = DEFAULT_MAX_BYTES, root = getBlobCacheDir() } = {}) {
    const entries = await listEntries(root);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= maxBytes) return { removed: 0, freedBytes: 0, totalBytes: total };

    entries.sort((a, b) => a.atimeMs - b.atimeMs);

    let removed = 0;
    let freed = 0;
    for (const entry of entries) {
        if (total <= maxBytes) break;
        try {
            await fs.remove(entry.path);
            total -= entry.size;
            freed += entry.size;
            removed += 1;
        } catch (_) {
            continue;
        }
    }

    return { removed, freedBytes: freed, totalBytes: total };
}

async function stats(root = getBlobCacheDir()) {
    const entries = await listEntries(root);
    return {
        count: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0)
    };
}

module.exports = {
    DEFAULT_MAX_BYTES,
    adopt,
    copyTo,
    has,
    keyPath,
    listEntries,
    prune,
    read,
    stats,
    touch,
    write
};
