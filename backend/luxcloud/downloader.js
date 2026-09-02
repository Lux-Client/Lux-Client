const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const api = require('./api');
const blobStore = require('./blobStore');
const { decompress } = require('./compression');
const { validRelPath } = require('./pathRules');
const { rememberRevision } = require('./syncState');

const STAGING_DIR = '.lux-sync';
const MODRINTH_CDN = 'https://cdn.modrinth.com';
const MODRINTH_API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'Client/Lux/1.0 (fernsehheft@pluginhub.de)';
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
const PARALLEL_DOWNLOADS = 4;

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha1(buffer) {
    return crypto.createHash('sha1').update(buffer).digest('hex');
}

function insideInstance(instanceDir, relPath) {
    const resolved = path.resolve(instanceDir, relPath);
    const base = path.resolve(instanceDir);
    return resolved === base || resolved.startsWith(base + path.sep);
}

async function fileMatches(absPath, expected, size) {
    try {
        const stat = await fs.stat(absPath);
        if (!stat.isFile()) return false;
        if (Number.isFinite(size) && stat.size !== size) return false;
        return sha256(await fs.readFile(absPath)) === expected;
    } catch (_) {
        return false;
    }
}

async function fetchBlob(hash) {
    const response = await api.authed({
        method: 'GET',
        url: `/api/cloud/blobs/${hash}`,
        responseType: 'arraybuffer',
        headers: { Accept: 'application/octet-stream' }
    });

    const stored = Buffer.isBuffer(response) ? response : Buffer.from(response);
    const raw = decompress(stored, 'zstd');
    const candidate = raw && sha256(raw) === hash ? raw : stored;

    if (sha256(candidate) !== hash) {
        throw new api.LuxCloudError('hash_mismatch', `Blob ${hash} did not match its hash`);
    }

    await blobStore.write(hash, candidate).catch(() => {});
    return candidate;
}

async function fetchModrinth(source) {
    const versionUrl = `${MODRINTH_API}/version/${source.versionId}`;
    const version = await axios.get(versionUrl, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: DOWNLOAD_TIMEOUT_MS
    });

    const files = Array.isArray(version.data && version.data.files) ? version.data.files : [];
    const wanted = files.find((file) => file.hashes && file.hashes.sha1 === source.sha1) || files[0];
    if (!wanted || typeof wanted.url !== 'string' || !wanted.url.startsWith(MODRINTH_CDN)) {
        throw new Error(`No usable download for Modrinth version ${source.versionId}`);
    }

    const download = await axios.get(wanted.url, {
        headers: { 'User-Agent': USER_AGENT },
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength: Infinity
    });

    const buffer = Buffer.from(download.data);
    if (sha1(buffer) !== source.sha1) {
        throw new Error(`Modrinth file for ${source.versionId} did not match its sha1`);
    }
    return buffer;
}

async function assembleChunks(entry) {
    const listBuffer = await (async () => {
        const cached = await blobStore.read(entry.chunks.list);
        return cached || fetchBlob(entry.chunks.list);
    })();

    const hashes = JSON.parse(listBuffer.toString('utf8'));
    if (!Array.isArray(hashes)) {
        throw new api.LuxCloudError('invalid_chunk_list', `Chunk list ${entry.chunks.list} is malformed`);
    }

    const parts = [];
    for (const hash of hashes) {
        const cached = await blobStore.read(hash);
        parts.push(cached || await fetchBlob(hash));
    }
    return Buffer.concat(parts);
}

async function resolveEntry(entry, instanceDir) {
    const absPath = path.join(instanceDir, entry.path);

    if (await fileMatches(absPath, entry.sha256, entry.size)) {
        return { source: 'local', bytes: 0 };
    }

    if (await blobStore.has(entry.sha256)) {
        await blobStore.touch(entry.sha256);
        return { source: 'cache', buffer: await blobStore.read(entry.sha256), bytes: 0 };
    }

    if (entry.source && entry.source.type === 'modrinth') {
        try {
            const buffer = await fetchModrinth(entry.source);
            if (sha256(buffer) !== entry.sha256) {
                throw new Error('content differs from the manifest');
            }
            await blobStore.write(entry.sha256, buffer).catch(() => {});
            return { source: 'modrinth', buffer, bytes: buffer.length };
        } catch (err) {
            if (!entry.blob) {
                return { source: 'unavailable', reason: err.message };
            }
        }
    }

    if (entry.chunks) {
        const buffer = await assembleChunks(entry);
        if (sha256(buffer) !== entry.sha256) {
            throw new api.LuxCloudError('hash_mismatch', `${entry.path} did not match after reassembly`);
        }
        return { source: 'chunks', buffer, bytes: buffer.length };
    }

    const hash = entry.blob || entry.sha256;
    const buffer = await fetchBlob(hash);
    return { source: 'server', buffer, bytes: buffer.length };
}

async function restoreInstance({
    instanceUuid,
    instanceDir,
    revision = 'latest',
    onProgress = null,
    instanceName = null
} = {}) {
    let reportName = instanceName || instanceUuid;
    const report = (phase, detail = {}) => {
        if (onProgress) onProgress({ instanceUuid, instanceName: reportName, phase, ...detail });
    };

    report('manifest');
    let payload;
    try {
        payload = await api.authed({
            method: 'GET',
            url: `/api/cloud/instances/${instanceUuid}/manifest?revision=${encodeURIComponent(revision)}&touch=1`
        });
    } catch (err) {
        const failure = api.normalizeError(err);
        report('error', { error: failure.code, message: failure.message });
        throw failure;
    }

    const manifest = payload.manifest;
    if (!instanceName && typeof manifest.name === 'string' && manifest.name) {
        reportName = manifest.name;
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

    for (const entry of entries) {
        if (!validRelPath(entry.path) || !insideInstance(instanceDir, entry.path)) {
            throw new api.LuxCloudError('invalid_path', `Manifest contains an unsafe path: ${entry.path}`);
        }
    }

    const stagingRoot = path.join(instanceDir, STAGING_DIR, 'staging');
    await fs.ensureDir(stagingRoot);

    const totalBytes = entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    const counters = { local: 0, cache: 0, modrinth: 0, server: 0, chunks: 0, unavailable: 0 };
    const unavailable = [];
    let processedBytes = 0;
    let networkBytes = 0;
    let done = 0;
    let aborted = null;

    report('download', { files: entries.length, totalBytes, processedBytes: 0, networkBytes: 0, done: 0 });

    let cursor = 0;
    const worker = async () => {
        while (cursor < entries.length && !aborted) {
            const entry = entries[cursor];
            cursor += 1;

            try {
                const resolved = await resolveEntry(entry, instanceDir);
                counters[resolved.source] = (counters[resolved.source] || 0) + 1;

                if (resolved.source === 'unavailable') {
                    unavailable.push({ path: entry.path, reason: resolved.reason });
                } else if (resolved.buffer) {
                    const staged = path.join(stagingRoot, `${entry.sha256}.part`);
                    await fs.writeFile(staged, resolved.buffer);

                    const target = path.join(instanceDir, entry.path);
                    await fs.ensureDir(path.dirname(target));
                    await fs.move(staged, target, { overwrite: true });
                }

                networkBytes += resolved.bytes || 0;
                processedBytes += Number(entry.size) || 0;
            } catch (err) {
                const failure = api.normalizeError(err);
                failure.details = { ...(failure.details || {}), path: entry.path };
                aborted = failure;
                return;
            }

            done += 1;
            report('download', { files: entries.length, totalBytes, processedBytes, networkBytes, done });
        }
    };

    await Promise.all(
        new Array(Math.min(PARALLEL_DOWNLOADS, entries.length || 1)).fill(null).map(() => worker())
    );

    if (aborted) {
        await fs.remove(stagingRoot).catch(() => {});
        report('error', { error: aborted.code, message: aborted.message, path: aborted.details.path });
        throw aborted;
    }

    await fs.remove(stagingRoot).catch(() => {});

    try {
        await rememberRevision(manifest.instanceId, {
            instanceName: instanceName || manifest.name,
            lastKnownRevision: payload.revision,
            lastManifestHash: payload.manifestHash,
            lastSyncedAt: Date.now(),
            dirty: false
        });
    } catch (err) {
        console.warn('[LuxCloud] Could not remember the restored revision:', err.message);
    }

    report('done', { revision: payload.revision, unavailable: unavailable.length });

    return {
        revision: payload.revision,
        manifestHash: payload.manifestHash,
        name: manifest.name,
        runtime: manifest.runtime || null,
        files: entries.length,
        downloadedBytes: networkBytes,
        restoredBytes: processedBytes,
        counters,
        unavailable
    };
}

module.exports = {
    STAGING_DIR,
    assembleChunks,
    fetchBlob,
    fetchModrinth,
    resolveEntry,
    restoreInstance
};
