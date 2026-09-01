const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');

const { HashCache } = require('./hashCache');
const { chunkFile, chunkListBlob } = require('./chunker');
const { chooseCompression } = require('./compression');
const { validRelPath } = require('./pathRules');
const {
    CATEGORY,
    classify,
    shouldSkipDirectory
} = require('./syncPolicy');

const MANIFEST_VERSION = 1;
const MAX_ENTRIES = 50000;
const ICON_BASENAME = 'instance-icon';

const SHA1_CATEGORIES = new Set([CATEGORY.MODS, CATEGORY.RESOURCEPACKS, CATEGORY.SHADERPACKS]);

const DEVICE_LOCAL_FIELDS = [
    'folderPath',
    'externalPath',
    'javaPath',
    'status',
    'playtime',
    'lastPlayed',
    'icon',
    'instanceType',
    'lastUsedVersion'
];

function sha256Of(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function scanInstance(instanceDir, options = {}) {
    const { syncWorlds = false, syncScreenshots = false } = options;

    const files = [];
    const excluded = {};
    const oversized = [];

    const note = (reason) => {
        excluded[reason] = (excluded[reason] || 0) + 1;
    };

    async function walk(absDir, relDir) {
        let entries;
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                if (shouldSkipDirectory(relPath, { syncWorlds, syncScreenshots })) {
                    note('policy:skipped-dir');
                    continue;
                }
                await walk(path.join(absDir, entry.name), relPath);
                continue;
            }

            if (!entry.isFile()) {
                note('policy:not-a-file');
                continue;
            }

            if (!validRelPath(relPath)) {
                note('invalid-path');
                continue;
            }

            const absPath = path.join(absDir, entry.name);
            let stat;
            try {
                stat = await fs.stat(absPath);
            } catch {
                note('unreadable');
                continue;
            }

            const verdict = classify(relPath, { syncWorlds, syncScreenshots, size: stat.size });
            if (!verdict.include) {
                note(verdict.reason);
                if (verdict.reason === 'size:too-large') {
                    oversized.push({ path: relPath, size: stat.size });
                }
                continue;
            }

            files.push({
                relPath,
                absPath,
                size: stat.size,
                mtimeMs: Math.round(stat.mtimeMs),
                category: verdict.category,
                chunk: Boolean(verdict.chunk),
                compressible: Boolean(verdict.compressible)
            });
        }
    }

    await walk(instanceDir, '');
    files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

    return { files, excluded, oversized };
}

async function loadModCache(modCachePath) {
    if (!modCachePath) return {};
    try {
        if (!await fs.pathExists(modCachePath)) return {};
        const data = await fs.readJson(modCachePath);
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

function lookupSource(modCache, file, sha1) {
    const fileName = file.relPath.split('/').pop();
    const candidates = [`${fileName}-${file.size}`];
    if (sha1) candidates.push(sha1);

    for (const key of candidates) {
        const hit = modCache[key];
        if (!hit || !hit.projectId || !hit.versionId) continue;
        if ((hit.source || 'modrinth') !== 'modrinth') continue;

        const resolvedSha1 = typeof hit.hash === 'string' ? hit.hash : sha1;
        if (!resolvedSha1) continue;
        if (sha1 && resolvedSha1 !== sha1) continue;

        return {
            type: 'modrinth',
            projectId: String(hit.projectId),
            versionId: String(hit.versionId),
            sha1: resolvedSha1
        };
    }

    return null;
}

function normalizeInstanceConfig(config) {
    const normalized = {};
    for (const [key, value] of Object.entries(config || {})) {
        if (DEVICE_LOCAL_FIELDS.includes(key)) continue;
        normalized[key] = value;
    }
    return normalized;
}

async function buildNormalizedInstanceJson(instanceDir) {
    const file = path.join(instanceDir, 'instance.json');
    if (!await fs.pathExists(file)) return null;

    let config;
    let stat;
    try {
        config = await fs.readJson(file);
        stat = await fs.stat(file);
    } catch {
        return null;
    }

    const buffer = Buffer.from(JSON.stringify(normalizeInstanceConfig(config), null, 2), 'utf8');
    return { buffer, sha256: sha256Of(buffer), config, mtimeMs: Math.round(stat.mtimeMs) };
}

async function buildManifest(options) {
    const {
        instanceDir,
        instanceId,
        name,
        hashCacheDir,
        modCachePath = null,
        syncWorlds = false,
        syncScreenshots = false,
        enableChunking = false,
        device = null,
        runtime = null,
        settings = null,
        parentRevision = 0,
        playtimeTotalMs = 0,
        onProgress = null
    } = options;

    const scan = await scanInstance(instanceDir, { syncWorlds, syncScreenshots });
    if (scan.files.length > MAX_ENTRIES) {
        const error = new Error(`Instance has ${scan.files.length} syncable files, the limit is ${MAX_ENTRIES}`);
        error.code = 'too_many_entries';
        throw error;
    }

    const cache = await new HashCache(hashCacheDir, instanceId).load();
    const modCache = await loadModCache(modCachePath);

    const entries = [];
    const uploads = [];
    const excluded = { ...scan.excluded };
    const stats = {
        fileCount: scan.files.length,
        totalBytes: 0,
        referencedBytes: 0,
        uploadBytes: 0,
        chunkedFiles: 0,
        cachedHashes: 0,
        oversized: scan.oversized
    };

    const note = (reason) => {
        excluded[reason] = (excluded[reason] || 0) + 1;
    };

    let icon = null;
    let processed = 0;

    const instanceJson = await buildNormalizedInstanceJson(instanceDir);

    for (const file of scan.files) {
        processed += 1;
        if (onProgress && processed % 25 === 0) {
            onProgress({ processed, total: scan.files.length, path: file.relPath });
        }

        if (file.relPath === 'instance.json') continue;

        const wantsSha1 = SHA1_CATEGORIES.has(file.category);
        let hashed;
        try {
            hashed = await cache.resolve(file.relPath, file.absPath, { withSha1: wantsSha1 });
        } catch {
            note('unreadable');
            continue;
        }

        if (hashed.size !== file.size) {
            note('changed-while-hashing');
            continue;
        }
        if (hashed.cached) stats.cachedHashes += 1;

        stats.totalBytes += file.size;

        const base = {
            path: file.relPath,
            size: file.size,
            mtime: file.mtimeMs,
            sha256: hashed.sha256
        };

        if (file.relPath.startsWith(`${ICON_BASENAME}.`)) {
            icon = { blob: hashed.sha256 };
        }

        const source = wantsSha1 ? lookupSource(modCache, file, hashed.sha1) : null;
        if (source) {
            entries.push({ ...base, source });
            stats.referencedBytes += file.size;
            continue;
        }

        if (enableChunking && file.chunk) {
            const chunked = await chunkFile(file.absPath);
            const list = chunkListBlob(chunked.chunks);

            entries.push({ ...base, chunks: { algo: chunked.algo, list: list.sha256 } });
            uploads.push({
                path: file.relPath,
                kind: 'chunk-list',
                sha256: list.sha256,
                size: list.buffer.length,
                buffer: list.buffer,
                compression: 'zstd'
            });
            for (const chunk of chunked.chunks) {
                uploads.push({
                    path: file.relPath,
                    kind: 'chunk',
                    sha256: chunk.sha256,
                    size: chunk.size,
                    offset: chunk.offset,
                    absPath: file.absPath,
                    compression: 'none'
                });
            }

            stats.chunkedFiles += 1;
            stats.uploadBytes += file.size;
            continue;
        }

        entries.push({ ...base, blob: hashed.sha256 });
        uploads.push({
            path: file.relPath,
            kind: 'file',
            sha256: hashed.sha256,
            size: file.size,
            absPath: file.absPath,
            compression: file.compressible ? chooseCompression(file.relPath, file.size) : 'none'
        });
        stats.uploadBytes += file.size;
    }

    if (instanceJson) {
        entries.push({
            path: 'instance.json',
            size: instanceJson.buffer.length,
            mtime: instanceJson.mtimeMs,
            sha256: instanceJson.sha256,
            blob: instanceJson.sha256
        });
        uploads.push({
            path: 'instance.json',
            kind: 'inline',
            sha256: instanceJson.sha256,
            size: instanceJson.buffer.length,
            buffer: instanceJson.buffer,
            compression: 'zstd'
        });
        stats.totalBytes += instanceJson.buffer.length;
        stats.uploadBytes += instanceJson.buffer.length;
    }

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    await cache.prune(new Set(scan.files.map((file) => file.relPath)));
    await cache.save();

    const manifest = {
        manifestVersion: MANIFEST_VERSION,
        instanceId,
        name,
        parentRevision,
        createdAt: Date.now(),
        device: device || undefined,
        runtime: runtime || undefined,
        settings: settings || undefined,
        icon: icon || undefined,
        playtime: { totalMs: playtimeTotalMs },
        entries,
        excluded
    };

    const serialized = Buffer.from(JSON.stringify(manifest), 'utf8');

    return {
        manifest,
        manifestBlob: { buffer: serialized, sha256: sha256Of(serialized) },
        contentHash: contentHashOf(manifest),
        uploads,
        stats
    };
}

function contentHashOf(manifest) {
    const relevant = {
        instanceId: manifest.instanceId,
        name: manifest.name,
        runtime: manifest.runtime || null,
        settings: manifest.settings || null,
        icon: manifest.icon || null,
        entries: (manifest.entries || []).map((entry) => [
            entry.path,
            entry.sha256,
            entry.blob || null,
            entry.source ? `${entry.source.projectId}:${entry.source.versionId}` : null,
            entry.chunks ? entry.chunks.list : null
        ])
    };
    return sha256Of(Buffer.from(JSON.stringify(relevant), 'utf8'));
}

function summarize(result) {
    const byCategory = {};
    for (const upload of result.uploads) {
        const top = upload.path.split('/')[0];
        byCategory[top] = (byCategory[top] || 0) + upload.size;
    }

    return {
        entries: result.manifest.entries.length,
        referencedFiles: result.manifest.entries.filter((entry) => entry.source).length,
        chunkedFiles: result.stats.chunkedFiles,
        totalBytes: result.stats.totalBytes,
        referencedBytes: result.stats.referencedBytes,
        uploadBytes: result.stats.uploadBytes,
        manifestBytes: result.manifestBlob.buffer.length,
        cachedHashes: result.stats.cachedHashes,
        excluded: result.manifest.excluded,
        oversized: result.stats.oversized,
        uploadBytesByFolder: byCategory
    };
}

module.exports = {
    MANIFEST_VERSION,
    MAX_ENTRIES,
    buildManifest,
    buildNormalizedInstanceJson,
    contentHashOf,
    normalizeInstanceConfig,
    scanInstance,
    summarize
};
