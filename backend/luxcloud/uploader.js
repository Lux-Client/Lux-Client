const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const api = require('./api');
const blobStore = require('./blobStore');
const { compressIfWorthwhile } = require('./compression');
const { buildManifestInWorker } = require('./manifestRunner');
const localChanges = require('./localChanges');
const { readInstanceState, rememberRevision } = require('./syncState');
const transfers = require('./transfers');
const manifestSnapshot = require('./manifestSnapshot');
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

async function runUpload({
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
    const stopIfCancelled = () => transfers.throwIfCancelled(instanceName);

    const supported = Array.isArray(capabilities.compression) ? capabilities.compression : ['none'];
    const maxBatchBytes = Number(capabilities.maxBatchBytes) || DEFAULT_MAX_BATCH_BYTES;
    const maxBatchEntries = Number(capabilities.maxBatchEntries) || DEFAULT_MAX_BATCH_ENTRIES;

    // Muss VOR dem Manifest genommen werden: was waehrend des Uploads noch geschrieben
    // wird, ergibt danach einen anderen Fingerabdruck und wird von der
    // Hintergrundkontrolle als das erkannt, was es ist -- eine Aenderung, die diese
    // Revision nicht mehr enthaelt. Umgekehrt (erst am Ende gemessen) waere sie verloren.
    const localSignature = await localChanges
        .signatureOf(instanceDir, {
            syncWorlds: Boolean(options.syncWorlds),
            syncScreenshots: Boolean(options.syncScreenshots),
            worldNames: Array.isArray(options.worldNames) ? options.worldNames : null
        })
        .then((result) => result.signature)
        .catch(() => null);

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

    const tracked = await readInstanceState(instanceId);
    const localRevision = Number((tracked && tracked.lastKnownRevision) || 0);
    const cloudRevision = Number(instance.revision || 0);
    const contentUnchanged = Boolean(tracked) && tracked.lastContentHash === built.contentHash;

    // The revision this upload is based on. It has to be the one this PC last saw, not
    // whatever the cloud is on right now - taking the latter made the server's
    // parentRevision check a tautology, so a PC sitting on revision 7 happily overwrote
    // revision 8 from another machine and called the result 9.
    // A forced push is the deliberate exception: the user picked this PC in the conflict
    // dialog, so it builds on the current cloud head on purpose.
    const parentRevision = Number(
        options.parentRevision ?? (options.force === true ? cloudRevision : localRevision)
    );

    const unchanged = contentUnchanged && localRevision === cloudRevision && cloudRevision > 0;

    if (unchanged && options.force !== true) {
        await rememberRevision(instanceId, {
            instanceName,
            lastCheckedAt: Date.now(),
            dirty: false,
            // Nichts hochzuladen ist auch ein Gleichstand mit der Cloud. Ohne diesen Wert
            // meldet die Hintergrundkontrolle dieselbe (inhaltlich folgenlose) Aenderung
            // bei jedem Takt erneut -- typischerweise die von Minecraft neu geschriebene
            // options.txt.
            ...(localSignature ? { lastLocalSignature: localSignature, lastLocalSignatureAt: Date.now() } : {})
        });
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

    // The cloud moved ahead of this PC. Pushing now would bury the newer revision, so
    // hand the decision back to the caller: a clean instance can simply be updated, a
    // changed one is a real conflict the user has to settle.
    if (options.force !== true && cloudRevision > localRevision) {
        // Der lokale Stand ist hier gemessen und beurteilt worden; ihn festzuhalten hindert
        // die Hintergrundkontrolle daran, denselben Konflikt im Minutentakt neu einzuplanen.
        // Aendert der Nutzer danach etwas, ergibt das einen neuen Fingerabdruck und der
        // Anstoss kommt wieder.
        if (localSignature) {
            await rememberRevision(instanceId, {
                lastLocalSignature: localSignature,
                lastLocalSignatureAt: Date.now()
            }).catch(() => {});
        }

        report('done', { revision: cloudRevision, skipped: true });

        return {
            revision: cloudRevision,
            localRevision,
            manifestHash: instance.manifestHash,
            contentHash: built.contentHash,
            instance,
            skipped: true,
            pullRequired: true,
            contentUnchanged,
            uploadedBlobs: 0,
            uploadedBytes: 0,
            skippedBlobs: 0,
            stats: built.stats
        };
    }

    // Ab hier entsteht eine Revision. Wenn der Nutzer nichts angefasst hat, ist das eine
    // Ueberraschung -- also festhalten, was der Client fuer geaendert haelt.
    if (contentUnchanged === false && tracked && tracked.lastContentHash) {
        try {
            const changes = await manifestSnapshot.diff(instanceId, built.manifest);
            console.log(`[LuxCloud] ${instanceName}: committing a revision because ${manifestSnapshot.summarize(changes)}`);
        } catch (err) {
            console.warn('[LuxCloud] Could not explain the manifest difference:', err.message);
        }
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
        stopIfCancelled();
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
        stopIfCancelled();
        const encoded = await encode(upload, supported);
        await uploadSingle(upload.sha256, encoded.data, encoded.compression, (bytes) => {
            sentBytes += Math.round((bytes / Math.max(encoded.data.length, 1)) * upload.size);
            report('upload', { files: missing.length, totalBytes, sentBytes });
        });
        if (upload.kind !== 'chunk') {
            await blobStore.write(upload.sha256, encoded.raw).catch(() => {});
        }
    });

    // Letzter Ausstieg vor dem Commit. Danach ist die Revision beim Server und ein
    // Abbruch wuerde nur noch die lokale Buchfuehrung verwirren.
    stopIfCancelled();

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
        dirty: false,
        ...(localSignature ? { lastLocalSignature: localSignature, lastLocalSignatureAt: Date.now() } : {})
    });

    await manifestSnapshot.save(instanceId, built.manifest).catch(() => {});
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

// Jeder Upload meldet am Ende genau einen Schlusszustand: 'done' oder 'error'.
//
// Vorher endete ein fehlgeschlagener Upload einfach mit einer Ausnahme, ohne dass je ein
// Abschluss gemeldet wurde. Die Oberflaeche hatte zuletzt 'upload' gesehen und blieb
// deshalb fuer immer auf "wird synchronisiert" stehen -- auch die Ursache dafuer, dass
// ein "Invalid loader" wie eine Endlosschleife aussah statt wie ein Fehler.
async function uploadInstance(args = {}) {
    const { instanceName, instanceId, onProgress } = args;

    transfers.begin(instanceName, 'upload');
    try {
        return await runUpload(args);
    } catch (err) {
        const failure = api.normalizeError(err);
        if (onProgress) {
            onProgress({
                instanceName,
                instanceId,
                phase: 'error',
                error: failure.code,
                message: failure.message
            });
        }
        throw failure;
    } finally {
        transfers.end(instanceName);
    }
}

module.exports = {
    BATCH_THRESHOLD_BYTES,
    PUT_CHUNK_BYTES,
    encode,
    readUploadBytes,
    runUpload,
    uploadInstance
};
