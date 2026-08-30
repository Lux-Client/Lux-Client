const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

async function writeJsonAtomic(filePath, data, { spaces = 4 } = {}) {
    const dir = path.dirname(filePath);
    await fs.ensureDir(dir);

    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    const payload = JSON.stringify(data, null, spaces);

    let handle;
    try {
        handle = await fs.open(tmpPath, 'w');
        await fs.write(handle, payload, 0, 'utf8');
        await fs.fsync(handle);
    } finally {
        if (handle !== undefined) {
            await fs.close(handle).catch(() => {});
        }
    }

    try {
        await fs.rename(tmpPath, filePath);
    } catch (error) {
        await fs.remove(tmpPath).catch(() => {});
        throw error;
    }
}

async function readJsonSafe(filePath, fallback = null) {
    try {
        if (!await fs.pathExists(filePath)) return fallback;
        const raw = await fs.readFile(filePath, 'utf8');
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

module.exports = { writeJsonAtomic, readJsonSafe };
