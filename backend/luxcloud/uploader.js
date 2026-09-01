const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const api = require('./api');
const blobStore = require('./blobStore');
const { compressIfWorthwhile } = require('./compression');
const { buildManifestInWorker } = require('./manifestRunner');
const { readInstanceState, rememberRevision } = require('./syncState');
const { seedIfNeeded: seedPlaytime, push: pushPlaytime } = require('./playtime');

const BATCH_THRESHOLD_BYTES = 256 * 1024;
const DEFAULT_MAX_BATCH_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BATCH_ENTRIES = 500;
const PUT_CHUNK_BYTES = 8 * 1024 * 1024;
const PARALLEL_PUTS = 4;

function instanceConfigHashOf(manifest) {
    const entry = (manifest.entries || []).find((item) => item.path === 'instance.json');
    return entry ? entry.sha256 : null;
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function readUploadBytes(upload) {
    if (upload.buffer) return Buffer.from(upload.buffer);

    if (upload.kind === 'chunk') {
        const handle = await fs.open(upload.absPath, 'r');
        try {
            const buffer = Buffer.alloc(upload.size);
            await fs.read(handle, buffer, 0, upload.size, upload.offset);
            return buffer;
        } finally {
            await fs.close(handle).catch(() => {});
        }
    }

    return fs.readFile(upload.absPath);
}

function pickCompression(requested, supported) {
    if (requested === 'zstd' && supported.includes('zstd')) return 'zstd';
    return 'none';
}

async function encode(upload, supported) {
    const raw = await readUploadBytes(upload);

    if (sha256(raw) !== upload.sha256) {
        const err = new api.LuxCloudError('hash_mismatch', `${upload.path} changed while it was being read`);
        err.details = { path: upload.path, expected: upload.sha256 };
        throw err;
    }

    if (pickCompression(upload.compression, supported) === 'none') {
        return { raw, data: raw, compression: 'none' };
    }

    const result = compressIfWorthwhile(upload.path, raw);
    return { raw, data: result.data, compression: result.compression };
}

async function uploadBatch(items) {
    return api.authed({
        method: 'POST',
        url: '/api/cloud/blobs/batch',
        data: {
            blobs: items.map((item) => ({
                hash: item.hash,
                compression: item.compression,
                data: item.data.toString('base64')
            }))
        }
    });
}

async function uploadSingle(hash, data, compression, onBytes) {
    if (data.length <= PUT_CHUNK_BYTES) {
        try {
            await api.authed({
                method: 'PUT',
                url: `/api/cloud/blobs/${hash}`,
                data,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': data.length,
                    'X-Lux-Compression': compression
                }
            });
        } catch (err) {
            if (err.code !== 'already_exists') throw err;
        }
        if (onBytes) onBytes(data.length);
        return;
    }

    let offset = 0;
    while (offset < data.length) {
        const end = Math.min(offset + PUT_CHUNK_BYTES, data.length);
        const slice = data.subarray(offset, end);

        try {
            await api.authed({
                method: 'PUT',
                url: `/api/cloud/blobs/${hash}`,
                data: slice,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': slice.length,
                    'Content-Range': `bytes ${offset}-${end - 1}/${data.length}`,
                    'X-Lux-Compression': compression
                }
            });
        } catch (err) {
            if (err.code !== 'already_exists') throw err;
            if (onBytes) onBytes(data.length - offset);
            return;
        }

        if (onBytes) onBytes(slice.length);
        offset = end;
    }
}

async function runPool(items, limit, worker) {
    let cursor = 0;
    const runners = [];

    for (let i = 0; i < Math.min(limit, items.length); i += 1) {
        runners.push((async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                await worker(items[index]);
            }
        })());
    }

    await Promise.all(runners);
}

async function ensureCloudInstance({ instanceUuid, manifest, options }) {
    const runtime = manifest.runtime || {};
    const body = {
        instanceUuid,
        name: manifest.name,
        mcVersion: runtime.mcVersion || undefined,
        loader: runtime.loader || undefined,
        loaderVersion: runtime.loaderVersion || undefined
    };

    if (typeof options.crossPlatform === 'boolean') body.crossPlatform = options.crossPlatform;
    if (typeof options.syncWorlds === 'boolean') body.syncWorlds = options.syncWorlds;
    if (typeof options.syncScreenshots === 'boolean') body.syncScreenshots = options.syncScreenshots;

    const result = await api.authed({ method: 'POST', url: '/api/cloud/instances', data: body });
    return result.instance;
}

async function uploadInstance({
    instanceDir,
    instanceId,
    instanceName,
    options = {},
    capabilities = {},
    onProgress = null
} = {}) {
    const report = (phase, detail = {}) => {
        if (onProgress) onProgress({ instanceName, instanceId, phase, ...detail });
    };

    const supported = Array.isArray(capabilities.compression) ? capabilities.compression : ['none'];
    const maxBatchBytes = Number(capabilities.maxBatchBytes) || DEFAULT_MAX_BATCH_BYTES;
    const maxBatchEntries = Number(capabilities.maxBatchEntries) || DEFAULT_MAX_BATCH_ENTRIES;

    report('manifest');
    const built = await buildManifestInWorker({
        instanceDir,
        instanceId,
        name: instanceName,
        hashCacheDir: require('./paths').getHashCacheDir(),
        modCachePath: options.modCachePath,
        syncWorlds: Boolean(options.syncWorlds),
        syncScreenshots: Boolean(options.syncScreenshots),
        worldNames: Array.isArray(options.worldNames) ? options.worldNames : null,
        enableChunking: options.enableChunking !== false,
        parentRevision: Number(options.parentRevision) || 0
    }, {
        onProgress: (progress) => report('manifest', progress)
    });

    const instance = await ensureCloudInstance({ instanceUuid: instanceId, manifest: built.manifest, options });

    await rememberRevision(instanceId, { instanceName, cloudLinked: true });
    await seedPlaytime(instanceId, instanceDir).catch(() => {});
    const parentRevision = Number(options.parentRevision ?? instance.revision ?? 0);

    const tracked = await readInstanceState(instanceId);
    const unchanged = Boolean(tracked)
        && tracked.lastContentHash === built.contentHash
        && Number(tracked.lastKnownRevision) === Number(instance.revision)
        && Number(instance.revision) > 0;

    if (unchanged && options.force !== true) {
        await rememberRevision(instanceId, { instanceName, lastCheckedAt: Date.now(), dirty: false });
        report('done', { revision: instance.revision, skipped: true });

        return {
            revision: Number(instance.revision),
            manifestHash: instance.manifestHash,
            contentHash: built.contentHash,
            instance,
            skipped: true,
            uploadedBlobs: 0,
            uploadedBytes: 0,
            skippedBlobs: 0,
            stats: built.stats
        };
    }

    const byHash = new Map();
    for (const upload of built.uploads) {
        if (!byHash.has(upload.sha256)) byHash.set(upload.sha256, upload);
    }

    report('negotiate', { blobs: byHash.size });
    const negotiated = await api.authed({
        method: 'POST',
        url: `/api/cloud/instances/${instanceId}/negotiate`,
        data: {
            blobs: [...byHash.values()].map((upload) => ({ hash: upload.sha256, size: upload.size })),
            projectedBytes: built.stats.uploadBytes + built.manifestBlob.buffer.length
        }
    });

    const missing = negotiated.missing.map((hash) => byHash.get(hash)).filter(Boolean);
    const totalBytes = missing.reduce((sum, upload) => sum + upload.size, 0);
    let sentBytes = 0;

    report('upload', { files: missing.length, totalBytes, sentBytes: 0, skipped: negotiated.known.length });

    const small = [];
    const large = [];
    for (const upload of missing) {
        (upload.size <= BATCH_THRESHOLD_BYTES ? small : large).push(upload);
    }

    let pending = [];
    let pendingBytes = 0;

    const flush = async () => {
        if (pending.length === 0) return;
        await uploadBatch(pending);
        for (const item of pending) {
            sentBytes += item.originalSize;
            await blobStore.write(item.hash, item.rawBuffer).catch(() => {});
        }
        report('upload', { files: missing.length, totalBytes, sentBytes });
        pending = [];
        pendingBytes = 0;
    };

    for (const upload of small) {
        const encoded = await encode(upload, supported);

        if (pending.length + 1 > maxBatchEntries || pendingBytes + encoded.data.length > maxBatchBytes) {
            await flush();
        }

        pending.push({
            hash: upload.sha256,
            compression: encoded.compression,
            data: encoded.data,
            rawBuffer: encoded.raw,
            originalSize: upload.size
        });
        pendingBytes += encoded.data.length;
    }
    await flush();

    await runPool(large, PARALLEL_PUTS, async (upload) => {
        const encoded = await encode(upload, supported);
        await uploadSingle(upload.sha256, encoded.data, encoded.compression, (bytes) => {
            sentBytes += Math.round((bytes / Math.max(encoded.data.length, 1)) * upload.size);
            report('upload', { files: missing.length, totalBytes, sentBytes });
        });
        if (upload.kind !== 'chunk') {
            await blobStore.write(upload.sha256, encoded.raw).catch(() => {});
        }
    });

    report('commit', { parentRevision });
    const committed = await api.authed({
        method: 'POST',
        url: `/api/cloud/instances/${instanceId}/commit`,
        data: { manifest: built.manifest, parentRevision }
    });

    await rememberRevision(instanceId, {
        instanceName,
        lastKnownRevision: committed.revision,
        cloudLinked: true,
        lastManifestHash: committed.manifestHash,
        lastContentHash: built.contentHash,
        lastInstanceConfigHash: instanceConfigHashOf(built.manifest),
        lastSyncedAt: Date.now(),
        dirty: false
    });

    await pushPlaytime(instanceId).catch(() => {});

    report('done', { revision: committed.revision });

    return {
        revision: committed.revision,
        manifestHash: committed.manifestHash,
        contentHash: built.contentHash,
        skipped: false,
        instance: committed.instance,
        quota: committed.quota,
        uploadedBlobs: missing.length,
        uploadedBytes: totalBytes,
        skippedBlobs: negotiated.known.length,
        stats: built.stats
    };
}

module.exports = {
    BATCH_THRESHOLD_BYTES,
    PUT_CHUNK_BYTES,
    encode,
    readUploadBytes,
    uploadInstance
};
