const fs = require('fs-extra');
const path = require('path');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');
const { INSTANCE_CONFIG } = require('./instanceIdentity');

const MIME_EXTENSIONS = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/bmp': '.bmp'
};

const ICON_BASENAME = 'instance-icon';
const MAX_ICON_BYTES = 8 * 1024 * 1024;

function isDataUri(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

function parseDataUri(value) {
    const match = /^data:([^;,]+)?((?:;[^;,]+)*),([\s\S]*)$/.exec(value);
    if (!match) return null;

    const mime = (match[1] || 'text/plain').trim().toLowerCase();
    const isBase64 = /;base64/i.test(match[2] || '');
    const payload = match[3];

    let buffer;
    try {
        buffer = isBase64
            ? Buffer.from(payload, 'base64')
            : Buffer.from(decodeURIComponent(payload), 'utf8');
    } catch (_) {
        return null;
    }

    if (!buffer.length) return null;
    return { mime, buffer, isBase64 };
}

function extensionForMime(mime) {
    return MIME_EXTENSIONS[mime] || '.bin';
}

function mimeForExtension(ext) {
    const lower = String(ext || '').toLowerCase();
    for (const [mime, candidate] of Object.entries(MIME_EXTENSIONS)) {
        if (candidate === lower) return mime;
    }
    return 'application/octet-stream';
}

function isLocalIconFile(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || isDataUri(trimmed)) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
    // Nur ein einfacher Dateiname direkt in der Instanz -- kein Unterordner, kein ..
    return !trimmed.includes('/') && !trimmed.includes('\\');
}

async function resolveIconForRenderer(instanceDir, iconValue) {
    if (!isLocalIconFile(iconValue)) return iconValue;

    const iconPath = path.join(instanceDir, iconValue.trim());
    const resolved = path.resolve(iconPath);
    if (!resolved.startsWith(path.resolve(instanceDir) + path.sep)) return null;

    try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return null;

        const buffer = await fs.readFile(resolved);
        const mime = mimeForExtension(path.extname(resolved));
        return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (_) {
        return null;
    }
}


async function extractIconToFile(instanceDir, { config = null } = {}) {
    const configPath = path.join(instanceDir, INSTANCE_CONFIG);
    const current = config || await readJsonSafe(configPath, null);

    if (!current || typeof current !== 'object') {
        return { changed: false, reason: 'no-config' };
    }
    if (!isDataUri(current.icon)) {
        return { changed: false, reason: 'not-inline' };
    }

    const parsed = parseDataUri(current.icon);
    if (!parsed) {
        return { changed: false, reason: 'unparsable' };
    }
    if (parsed.buffer.length > MAX_ICON_BYTES) {
        return { changed: false, reason: 'too-large' };
    }

    const fileName = `${ICON_BASENAME}${extensionForMime(parsed.mime)}`;
    const iconPath = path.join(instanceDir, fileName);

    await fs.writeFile(iconPath, parsed.buffer);


    for (const ext of new Set(Object.values(MIME_EXTENSIONS))) {
        if (ext === path.extname(fileName)) continue;
        await fs.remove(path.join(instanceDir, `${ICON_BASENAME}${ext}`)).catch(() => {});
    }

    const nextConfig = { ...current, icon: fileName };
    await writeJsonAtomic(configPath, nextConfig);

    return {
        changed: true,
        reason: 'extracted',
        fileName,
        bytes: parsed.buffer.length,
        config: nextConfig
    };
}

async function extractAllIcons(baseDirs) {
    const extracted = [];
    const skipped = [];
    let bytesSaved = 0;

    for (const baseDir of baseDirs) {
        let entries;
        try {
            if (!await fs.pathExists(baseDir)) continue;
            entries = await fs.readdir(baseDir, { withFileTypes: true });
        } catch (error) {
            skipped.push({ baseDir, reason: error.message });
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const instanceDir = path.join(baseDir, entry.name);
            if (!await fs.pathExists(path.join(instanceDir, INSTANCE_CONFIG))) continue;

            try {
                const result = await extractIconToFile(instanceDir);
                if (result.changed) {
                    extracted.push({ instanceDir, fileName: result.fileName, bytes: result.bytes });
                    bytesSaved += result.bytes;
                }
            } catch (error) {
                skipped.push({ instanceDir, reason: error.message });
            }
        }
    }

    return { extracted, skipped, bytesSaved };
}

module.exports = {
    ICON_BASENAME,
    isDataUri,
    isLocalIconFile,
    parseDataUri,
    resolveIconForRenderer,
    extractIconToFile,
    extractAllIcons
};
