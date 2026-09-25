const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const api = require('./api');
const blobStore = require('./blobStore');
const { decompress } = require('./compression');
const { validRelPath } = require('./pathRules');
const { readInstanceState, rememberRevision } = require('./syncState');
const { rememberLocalSignature } = require('./localChanges');
const {
    buildNormalizedInstanceJson,
    contentHashOf,
    mergeInstanceConfig,
    saveModCacheUpdates
} = require('./manifest');
const transfers = require('./transfers');
const manifestSnapshot = require('./manifestSnapshot');
const { HashCache } = require('./hashCache');
const { getHashCacheDir } = require('./paths');
const { isMemberWritable, memberContentHash, memberContribution } = require('./shareScope');

const INSTANCE_CONFIG = 'instance.json';

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

async function writeMergedInstanceConfig(instanceDir, buffer) {
    const target = path.join(instanceDir, INSTANCE_CONFIG);

    let remoteConfig;
    try {
        remoteConfig = JSON.parse(buffer.toString('utf8'));
    } catch (_) {
        // Not parseable as JSON - fall back to writing it verbatim rather than losing it.
        await fs.writeFile(target, buffer);
        return;
    }

    const localConfig = await fs.readJson(target).catch(() => null);
    const merged = mergeInstanceConfig(remoteConfig, localConfig);
    await fs.writeJson(target, merged, { spaces: 4 });
}

// Übernimmt die Modrinth-Zuordnungen aus dem Manifest in den lokalen Mod-Cache.
//
// Der hochladende PC kennt seine Mods aus dem Mod-Browser und verweist im Manifest aufs
// CDN, statt die JARs mitzuschicken. Der herunterladende PC hatte diese Zuordnung nicht -
// er hat die Mods ja gerade erst aus der Cloud bekommen. Sein naechstes Manifest kam
// deshalb ohne die Verweise heraus, unterschied sich vom heruntergeladenen und loeste
// eine Revision aus, obwohl niemand etwas geaendert hatte. Nebenbei haette er die JARs
// beim naechsten Upload als Blobs mitgeschickt, statt sie zu referenzieren.
async function adoptModSources(modCachePath, entries) {
    if (!modCachePath) return 0;

    const updates = {};
    for (const entry of entries) {
        const source = entry.source;
        if (!source || source.type !== 'modrinth') continue;
        if (!source.projectId || !source.versionId || !source.sha1) continue;

        const record = {
            projectId: String(source.projectId),
            versionId: String(source.versionId),
            hash: String(source.sha1),
            source: 'modrinth'
        };

        // Beide Schluesselformen, die lookupSource kennt.
        updates[source.sha1] = record;
        const fileName = String(entry.path).split('/').pop();
        if (fileName && Number.isFinite(Number(entry.size))) {
            updates[`${fileName}-${entry.size}`] = record;
        }
    }

    if (Object.keys(updates).length === 0) return 0;
    await saveModCacheUpdates(modCachePath, updates).catch(() => {});
    return Object.keys(updates).length;
}

// After a restore the hash cache still describes the files as they were before, so the
// dirty check would report every single one as changed and the next sync would push a
// pointless revision. The manifest already carries the authoritative hashes, so the
// cache can be refreshed from it with a stat per file instead of re-hashing everything.
async function refreshHashCache(instanceDir, instanceId, entries) {
    if (!instanceId) return;

    const cache = await new HashCache(getHashCacheDir(), instanceId).load();
    const live = new Set();

    for (const entry of entries) {
        // instance.json is merged rather than written verbatim, so its on-disk hash is
        // not the manifest hash. Leave it out and let the next build hash it.
        if (entry.path === INSTANCE_CONFIG) continue;

        const absPath = path.join(instanceDir, entry.path);
        let stat;
        try {
            stat = await fs.stat(absPath);
        } catch (_) {
            continue;
        }
        if (stat.size !== Number(entry.size)) continue;

        live.add(entry.path);
        const previous = cache.entries.get(entry.path) || {};
        cache.entries.set(entry.path, {
            ...previous,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256: entry.sha256
        });
        cache.dirty = true;
    }

    cache.prune(live);
    await cache.save().catch(() => {});
}

async function resolveEntry(entry, instanceDir) {
    const absPath = path.join(instanceDir, entry.path);

    if (entry.path === INSTANCE_CONFIG) {
        // The local file also carries this machine's own fields, so it is never byte
        // identical to the cloud copy. Comparing the normalized form instead keeps
        // instance.json from counting as missing on every single restore.
        const normalized = await buildNormalizedInstanceJson(instanceDir);
        if (normalized && normalized.sha256 === entry.sha256) {
            return { source: 'local', bytes: 0 };
        }
    } else if (await fileMatches(absPath, entry.sha256, entry.size)) {
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

async function restoreInstance(args = {}) {
    const key = args.instanceName || args.instanceUuid;
    const nested = transfers.isCancelled(key) === false && transfers.list().some((t) => t.instanceName === key);

    // Der Sync-Handler laedt bei Bedarf direkt nach einem Upload herunter; dann laeuft
    // bereits ein Eintrag unter demselben Namen und darf hier nicht abgeraeumt werden.
    if (!nested) transfers.begin(key, 'download');
    try {
        return await runRestore(args);
    } finally {
        if (!nested) transfers.end(key);
    }
}

async function runRestore({
    instanceUuid,
    instanceDir,
    revision = 'latest',
    onProgress = null,
    instanceName = null,
    modCachePath = null,
    shareInfo = null
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

    // Die Basis fuer das Aufraeumen muss VOR dem Schreiben gelesen werden -- danach steht
    // dort schon der neue Stand.
    const snapshot = await manifestSnapshot.load(manifest.instanceId).catch(() => null);
    const trackedBefore = await readInstanceState(manifest.instanceId).catch(() => null);
    const previous = snapshot && trackedBefore
        && snapshot.revision !== null && snapshot.revision === Number(trackedBefore.lastKnownRevision || 0)
        ? snapshot
        : null;

    let applied;
    try {
        applied = await applyEntries({
            instanceDir,
            entries,
            cancelKeys: [reportName, instanceName],
            onProgress: (detail) => report('download', detail)
        });
    } catch (err) {
        const failure = api.normalizeError(err);
        report('error', { error: failure.code, message: failure.message, path: failure.details && failure.details.path });
        throw failure;
    }
    const { counters, unavailable, networkBytes, processedBytes } = applied;

    // Was in der Cloud entfernt wurde (etwa eine Mod, die ein Mitspieler geloescht hat),
    // verschwindet auch hier -- aber nur, wenn die Datei hier seit dem letzten Sync
    // unveraendert ist. Eigene Aenderungen werden nie still geloescht.
    const removed = await removeStaleFiles(instanceDir, previous, entries).catch((err) => {
        console.warn('[LuxCloud] Could not clean up files removed in the cloud:', err.message);
        return [];
    });

    await refreshHashCache(instanceDir, manifest.instanceId, entries).catch((err) => {
        console.warn('[LuxCloud] Could not refresh the hash cache after the restore:', err.message);
    });

    // Muss vor dem contentHash unten passieren: ohne die uebernommenen Verweise baut
    // dieser PC ein anderes Manifest als das gerade heruntergeladene.
    await adoptModSources(modCachePath, entries).catch((err) => {
        console.warn('[LuxCloud] Could not adopt the mod references after the restore:', err.message);
    });

    // Vergleichsbasis fuer den naechsten Sync: erzeugt er trotzdem eine Revision, kann er
    // benennen, welche Datei dafuer verantwortlich ist.
    // Ein Mitglied vergleicht sich nur ueber den gemeinsamen Teil; instance.json und das
    // Icon gehoeren dem Host und waeren im naechsten Vergleich sonst "entfernt".
    await manifestSnapshot.save(
        manifest.instanceId,
        payload.access === 'member' ? memberContribution(manifest) : manifest,
        { revision: payload.revision }
    ).catch(() => {});

    const isMember = payload.access === 'member';

    try {
        const instanceConfigEntry = entries.find((entry) => entry.path === INSTANCE_CONFIG);

        await rememberRevision(manifest.instanceId, {
            instanceName: instanceName || manifest.name,
            cloudLinked: true,
            // Mitglied oder Host: bestimmt, was dieser PC hochladen darf (shareScope.js).
            shareRole: isMember ? 'member' : null,
            // Zu welchem Cloud-Namen dieser Ordner passt (siehe applyCloudRename). Nur beim
            // ersten Mal gesetzt -- eine spaetere Umbenennung soll erkannt werden koennen.
            ...(trackedBefore && trackedBefore.cloudName ? {} : { cloudName: manifest.name }),
            ...(isMember && shareInfo ? { shareOwner: shareInfo.owner || null } : {}),
            lastKnownRevision: payload.revision,
            lastManifestHash: payload.manifestHash,
            // Without these two the very next sync saw an unknown content hash, judged the
            // instance changed and committed a new revision even though the user had only
            // just downloaded it and touched nothing.
            lastContentHash: isMember ? memberContentHash(manifest) : contentHashOf(manifest),
            lastInstanceConfigHash: instanceConfigEntry ? instanceConfigEntry.sha256 : null,
            lastSyncedAt: Date.now(),
            dirty: false
        });

        // Erst nach rememberRevision, denn der Fingerabdruck wird mit dem gerade
        // geschriebenen Sync-Umfang gebildet. Ohne ihn saehe die Hintergrundkontrolle die
        // frischen mtimes der heruntergeladenen Dateien als lokale Aenderung und schoebe
        // unmittelbar nach jedem Download einen Upload hinterher.
        await rememberLocalSignature(manifest.instanceId, instanceDir);
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
        unavailable,
        removed,
        access: payload.access || 'owner'
    };
}

// Holt und schreibt die uebergebenen Manifest-Eintraege. Dateien, die hier schon
// inhaltsgleich liegen, werden uebersprungen (resolveEntry prueft das).
async function applyEntries({ instanceDir, entries, cancelKeys = [], onProgress = null }) {
    const stagingRoot = path.join(instanceDir, STAGING_DIR, 'staging');
    await fs.ensureDir(stagingRoot);

    const totalBytes = entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    const counters = { local: 0, cache: 0, modrinth: 0, server: 0, chunks: 0, unavailable: 0 };
    const unavailable = [];
    let processedBytes = 0;
    let networkBytes = 0;
    let done = 0;
    let aborted = null;

    const progress = () => {
        if (onProgress) onProgress({ files: entries.length, totalBytes, processedBytes, networkBytes, done });
    };
    progress();

    let cursor = 0;
    const worker = async () => {
        while (cursor < entries.length && !aborted) {
            const entry = entries[cursor];
            cursor += 1;

            // Zwischen zwei Dateien ist der sichere Punkt zum Aussteigen: das Staging
            // wird unten aufgeraeumt, und bereits geschriebene Dateien sind vollstaendig.
            if (cancelKeys.some((key) => key && transfers.isCancelled(key))) {
                aborted = new api.LuxCloudError('cancelled', 'The transfer was cancelled');
                aborted.details = { path: entry.path };
                return;
            }

            try {
                const resolved = await resolveEntry(entry, instanceDir);
                counters[resolved.source] = (counters[resolved.source] || 0) + 1;

                if (resolved.source === 'unavailable') {
                    unavailable.push({ path: entry.path, reason: resolved.reason });
                } else if (entry.path === INSTANCE_CONFIG && resolved.buffer) {
                    // The cloud copy is the normalized one, without this machine's own
                    // fields. Writing it straight out would wipe javaPath, the install
                    // state and the playtime of the PC we are restoring onto.
                    await writeMergedInstanceConfig(instanceDir, resolved.buffer);
                } else if (resolved.buffer) {
                    // The staging name must be unique per entry, not per hash. A manifest
                    // regularly lists the same content under several paths (mod archives
                    // unpacked by WorldEdit alone produce hundreds of identical language
                    // files), and with parallel workers two of them would otherwise write
                    // and move the very same <sha256>.part - whoever moves second finds
                    // the file already gone and the whole restore dies with ENOENT.
                    const staged = path.join(stagingRoot, `${entry.sha256}-${crypto.randomBytes(8).toString('hex')}.part`);
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
            progress();
        }
    };

    await Promise.all(
        new Array(Math.min(PARALLEL_DOWNLOADS, entries.length || 1)).fill(null).map(() => worker())
    );

    await fs.remove(stagingRoot).catch(() => {});
    if (aborted) throw aborted;

    return { counters, unavailable, networkBytes, processedBytes, totalBytes };
}

// Entfernt Dateien, die der letzte gemeinsame Stand noch kannte, die Cloud aber nicht
// mehr -- nur im gemeinsamen Teil (Mods, Packs, Shader, Configs) und nur, wenn die Datei
// hier seither niemand angefasst hat.
async function removeStaleFiles(instanceDir, previousSnapshot, currentEntries) {
    if (!previousSnapshot || !previousSnapshot.entries) return [];

    const current = new Set(currentEntries.map((entry) => entry.path));
    const removed = [];

    for (const [relPath, print] of Object.entries(previousSnapshot.entries)) {
        if (current.has(relPath) || !isMemberWritable(relPath)) continue;
        if (!validRelPath(relPath) || !insideInstance(instanceDir, relPath)) continue;
        const expected = String(print || '').split('|')[0];
        if (!expected || expected === 'null') continue;

        const absPath = path.join(instanceDir, relPath);
        if (!await fileMatches(absPath, expected)) continue;

        await fs.remove(absPath);
        removed.push(relPath);
    }

    if (removed.length > 0) {
        console.log(`[LuxCloud] Removed ${removed.length} file(s) that were deleted in the cloud: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ' ...' : ''}`);
    }
    return removed;
}

module.exports = {
    STAGING_DIR,
    adoptModSources,
    applyEntries,
    assembleChunks,
    refreshHashCache,
    removeStaleFiles,
    fetchBlob,
    fetchModrinth,
    resolveEntry,
    restoreInstance
};
