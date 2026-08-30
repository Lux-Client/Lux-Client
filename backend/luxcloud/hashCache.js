const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');

// Ein Manifest zu bauen heisst, jede synchronisierte Datei zu hashen. Beim ersten Mal
// ist das unvermeidlich teuer; beim zweiten Mal darf es das nicht mehr sein, sonst
// wuerde der Check vor jedem Spielstart Minuten dauern.
//
// Deshalb dieser Cache: Schluessel ist der relative Pfad, gueltig bleibt ein Eintrag,
// solange Groesse und mtime unveraendert sind. Das ist dieselbe Heuristik, die rsync
// und Git benutzen -- sie kann theoretisch getaeuscht werden (Aenderung innerhalb
// derselben mtime-Aufloesung bei identischer Groesse), aber der Fall ist im
// Minecraft-Alltag nicht real, und der Sync korrigiert sich beim naechsten echten
// Schreibvorgang ohnehin selbst.
//
// sha256 ist die Identitaet im Cloud-Speicher. sha1 wird zusaetzlich gefuehrt, weil
// Modrinth danach sucht -- darueber entscheidet sich, ob eine Mod ueberhaupt
// hochgeladen werden muss oder ob der Ziel-PC sie vom CDN holen kann.

const CACHE_VERSION = 1;

// Ueber dieser Groesse wird gestreamt statt am Stueck gelesen.
const STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;

async function hashFile(filePath, algorithms = ['sha256']) {
    const hashes = algorithms.map((algo) => ({ algo, hash: crypto.createHash(algo) }));
    const stat = await fs.stat(filePath);

    if (stat.size <= STREAM_THRESHOLD_BYTES) {
        const buffer = await fs.readFile(filePath);
        for (const entry of hashes) entry.hash.update(buffer);
    } else {
        await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
            stream.on('data', (chunk) => {
                for (const entry of hashes) entry.hash.update(chunk);
            });
            stream.on('error', reject);
            stream.on('end', resolve);
        });
    }

    const result = { size: stat.size, mtimeMs: stat.mtimeMs };
    for (const entry of hashes) {
        result[entry.algo] = entry.hash.digest('hex');
    }
    return result;
}

class HashCache {
    // cacheDir wird injiziert statt aus electron gelesen, damit die Klasse ohne
    // laufende App testbar ist.
    constructor(cacheDir, instanceId) {
        this.cacheDir = cacheDir;
        this.instanceId = instanceId;
        this.entries = new Map();
        this.dirty = false;
        this.loaded = false;
    }

    get filePath() {
        return path.join(this.cacheDir, `${this.instanceId}.json`);
    }

    async load() {
        if (this.loaded) return this;

        const data = await readJsonSafe(this.filePath, null);
        if (data && data.version === CACHE_VERSION && data.entries && typeof data.entries === 'object') {
            for (const [relPath, entry] of Object.entries(data.entries)) {
                this.entries.set(relPath, entry);
            }
        }

        this.loaded = true;
        return this;
    }

    // Liefert den Hash einer Datei -- aus dem Cache, wenn Groesse und mtime passen,
    // sonst frisch berechnet.
    async resolve(relPath, absPath, { withSha1 = false } = {}) {
        const stat = await fs.stat(absPath);
        const cached = this.entries.get(relPath);

        const stillValid = cached
            && cached.size === stat.size
            && Math.abs(cached.mtimeMs - stat.mtimeMs) < 1
            && typeof cached.sha256 === 'string'
            && (!withSha1 || typeof cached.sha1 === 'string');

        if (stillValid) {
            return { ...cached, cached: true };
        }

        const algorithms = withSha1 ? ['sha256', 'sha1'] : ['sha256'];
        const computed = await hashFile(absPath, algorithms);

        // sha1 aus einem frueheren Lauf nicht wegwerfen, nur weil er diesmal nicht
        // angefordert wurde und die Datei sich nicht geaendert hat.
        if (!withSha1 && cached && cached.sha1 && cached.size === computed.size) {
            computed.sha1 = cached.sha1;
        }

        this.entries.set(relPath, computed);
        this.dirty = true;
        return { ...computed, cached: false };
    }

    // Entfernt Eintraege fuer Dateien, die es nicht mehr gibt. Ohne das waechst der
    // Cache mit jeder geloeschten Mod weiter.
    prune(livePaths) {
        const live = livePaths instanceof Set ? livePaths : new Set(livePaths);
        let removed = 0;

        for (const relPath of this.entries.keys()) {
            if (!live.has(relPath)) {
                this.entries.delete(relPath);
                removed += 1;
            }
        }

        if (removed > 0) this.dirty = true;
        return removed;
    }

    async save({ force = false } = {}) {
        if (!this.dirty && !force) return false;

        await writeJsonAtomic(this.filePath, {
            version: CACHE_VERSION,
            instanceId: this.instanceId,
            updatedAt: Date.now(),
            entries: Object.fromEntries(this.entries)
        }, { spaces: 0 });

        this.dirty = false;
        return true;
    }

    async clear() {
        this.entries.clear();
        this.dirty = false;
        await fs.remove(this.filePath).catch(() => {});
    }

    get size() {
        return this.entries.size;
    }
}

module.exports = { HashCache, hashFile, CACHE_VERSION };
