// Dieselbe Mod darf in einer Instanz nur einmal liegen.
//
// Der Cloud-Abgleich arbeitet Datei fuer Datei (reconcile.js). Ein Mod-Update ist fuer
// ihn aber kein "Datei geaendert", sondern "alte JAR weg, neue JAR mit anderem Namen da".
// Haben zwei PCs dieselbe Mod unterschiedlich aktualisiert, sah der Abgleich zwei
// voneinander unabhaengige neue Dateien und behielt beide; mit jedem weiteren Update
// kam eine Version dazu, und der naechste Upload trug sie alle in die Cloud. Fabric und
// Forge starten mit doppelten Mods gar nicht erst.
//
// Hier wird deshalb ueber den Inhalt entschieden: Mod-ID aus fabric.mod.json,
// quilt.mod.json oder mods.toml. Von mehreren JARs derselben Mod bleibt eine, die anderen
// wandern in .lux-sync/duplicates (geht nie in die Cloud) und sind damit nicht verloren.

const fs = require('fs-extra');
const path = require('path');

const MODS_DIR = 'mods';
const BACKUP_DIR = path.join('.lux-sync', 'duplicates');
const KEEP_BACKUPS = 3;

function text(zip, name) {
    const entry = zip.getEntry(name);
    return entry ? entry.getData().toString('utf8') : null;
}

function usable(value) {
    const result = typeof value === 'string' ? value.trim() : '';
    return result && !result.includes('${') ? result : null;
}

// fabric.mod.json ist nicht immer strenges JSON (Kommentare, Zeilenumbrueche in Strings).
// Fuer die ID reicht dann auch ein Blick auf das erste "id"-Feld.
function parseLenient(raw, field) {
    try {
        return JSON.parse(raw);
    } catch (_) {
        const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`));
        return match ? { [field]: match[1] } : null;
    }
}

// { id, version } oder null, wenn die JAR keine lesbare Mod-ID mitbringt. Solche Dateien
// werden nie angefasst.
function readModIdentity(absPath) {
    let zip;
    try {
        const AdmZip = require('adm-zip');
        zip = new AdmZip(absPath);
    } catch (_) {
        return null;
    }

    try {
        const fabric = text(zip, 'fabric.mod.json');
        if (fabric) {
            const data = parseLenient(fabric, 'id');
            const id = usable(data && data.id);
            if (id) return { id: id.toLowerCase(), version: usable(data.version) };
        }

        const quilt = text(zip, 'quilt.mod.json');
        if (quilt) {
            const data = parseLenient(quilt, 'id');
            const loader = (data && data.quilt_loader) || data || {};
            const id = usable(loader.id);
            if (id) return { id: id.toLowerCase(), version: usable(loader.version) };
        }

        const toml = text(zip, 'META-INF/mods.toml') || text(zip, 'META-INF/neoforge.mods.toml');
        if (toml) {
            // Nur der erste [[mods]]-Block: das ist die Mod selbst.
            const block = toml.split(/^\s*\[\[mods\]\]\s*$/m)[1] || '';
            const idMatch = block.match(/^\s*modId\s*=\s*["']([^"']+)["']/m);
            const id = idMatch ? usable(idMatch[1]) : null;
            if (id) {
                const versionMatch = block.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
                let version = versionMatch ? usable(versionMatch[1]) : null;
                if (!version) {
                    const manifest = text(zip, 'META-INF/MANIFEST.MF') || '';
                    const implementation = manifest.match(/^Implementation-Version:\s*(.+)$/m);
                    version = implementation ? usable(implementation[1]) : null;
                }
                return { id: id.toLowerCase(), version };
            }
        }
    } catch (_) {
        return null;
    }

    return null;
}

const PRERELEASE = /^(alpha|beta|pre|rc|snapshot|dev|a|b)\d*$/i;

// Vergleicht zwei Versionsangaben grob nach semver: Zahlen numerisch, Build-Metadaten
// (+mc1.21) zaehlen nicht, eine Vorabversion ist kleiner als die fertige.
function compareVersions(a, b) {
    if (a === b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const tokens = (value) => String(value).split('+')[0].split(/[^0-9A-Za-z]+/).filter(Boolean);
    const left = tokens(a);
    const right = tokens(b);

    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const l = left[i];
        const r = right[i];
        if (l === undefined) return PRERELEASE.test(r) ? 1 : -1;
        if (r === undefined) return PRERELEASE.test(l) ? -1 : 1;

        const ln = /^\d+$/.test(l);
        const rn = /^\d+$/.test(r);
        if (ln && rn) {
            const diff = Number(l) - Number(r);
            if (diff !== 0) return diff > 0 ? 1 : -1;
            continue;
        }
        if (ln !== rn) return ln ? 1 : -1;
        const diff = l.localeCompare(r, 'en', { sensitivity: 'base' });
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

async function listModJars(instanceDir) {
    const dir = path.join(instanceDir, MODS_DIR);
    let names;
    try {
        names = await fs.readdir(dir, { withFileTypes: true });
    } catch (_) {
        return [];
    }

    const jars = [];
    for (const entry of names) {
        // Nur aktive Mods. Eine deaktivierte Version daneben hat jemand bewusst so abgelegt.
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue;
        const absPath = path.join(dir, entry.name);
        let stat;
        try {
            stat = await fs.stat(absPath);
        } catch (_) {
            continue;
        }
        jars.push({ name: entry.name, relPath: `${MODS_DIR}/${entry.name}`, absPath, mtimeMs: stat.mtimeMs });
    }
    return jars;
}

// Sucht Gruppen von JARs mit derselben Mod-ID und waehlt je Gruppe eine aus.
//   prefer:  Pfade, die bevorzugt bleiben (der Stand der Cloud beim Holen).
//   protect: Pfade, die nie entfernt werden (ein Mitglied darf die Cloud-Dateien des
//            Hosts nicht anfassen -- der Server wuerde die Aenderung ablehnen).
async function findDuplicateMods(instanceDir, { prefer = null, protect = null } = {}) {
    const jars = await listModJars(instanceDir);
    if (jars.length < 2) return [];

    const groups = new Map();
    for (const jar of jars) {
        const identity = readModIdentity(jar.absPath);
        if (!identity) continue;
        if (!groups.has(identity.id)) groups.set(identity.id, []);
        groups.get(identity.id).push({ ...jar, version: identity.version });
    }

    const plans = [];
    for (const [id, members] of groups) {
        if (members.length < 2) continue;

        const preferred = prefer ? members.filter((jar) => prefer.has(jar.relPath)) : [];
        const pool = preferred.length > 0 ? preferred : members;
        const keep = pool.slice().sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs)[0];

        const remove = members.filter((jar) => jar !== keep && !(protect && protect.has(jar.relPath)));
        if (remove.length > 0) plans.push({ id, keep, remove });
    }
    return plans;
}

async function pruneBackups(instanceDir) {
    const root = path.join(instanceDir, BACKUP_DIR);
    const entries = await fs.readdir(root).catch(() => []);
    const stale = entries.sort().reverse().slice(KEEP_BACKUPS);
    for (const name of stale) {
        await fs.remove(path.join(root, name)).catch(() => {});
    }
}

async function removeDuplicateMods(instanceDir, options = {}) {
    const plans = await findDuplicateMods(instanceDir, options);
    if (plans.length === 0) return { removed: [], kept: [], backupDir: null };

    const backupDir = path.join(instanceDir, BACKUP_DIR, String(Date.now()));
    const removed = [];
    const kept = [];

    for (const plan of plans) {
        kept.push(plan.keep.relPath);
        for (const jar of plan.remove) {
            try {
                const target = path.join(backupDir, jar.relPath);
                await fs.ensureDir(path.dirname(target));
                await fs.move(jar.absPath, target, { overwrite: true });
                removed.push(jar.relPath);
            } catch (err) {
                console.warn(`[LuxCloud] Could not remove duplicate mod ${jar.relPath}: ${err.message}`);
            }
        }
        console.log(`[LuxCloud] Mod "${plan.id}" was installed ${plan.remove.length + 1} times; kept ${plan.keep.name}`
            + `${plan.keep.version ? ` (${plan.keep.version})` : ''}, removed ${plan.remove.map((jar) => jar.name).join(', ')}.`);
    }

    await pruneBackups(instanceDir);
    return { removed, kept, backupDir: removed.length > 0 ? backupDir : null };
}

// Einmalig je Instanz beim Start: raeumt auf, was fruehere Syncs schon doppelt abgelegt
// haben. Danach sieht die Hintergrundkontrolle die geaenderten Dateien und laedt die
// Bereinigung hoch; jeder andere PC entfernt die Duplikate beim naechsten Holen
// (downloader.removeStaleFiles), weil sie dort unveraendert seit dem letzten Sync liegen.
// Geteilte Instanzen, in denen dieser PC nur Mitglied ist, bleiben aussen vor -- die
// Dateien gehoeren dem Host.
const CLEANUP_VERSION = 1;

async function cleanupLinkedInstances({ resolveInstanceDir }) {
    const { listTrackedInstances, rememberRevision } = require('./syncState');
    const { readInstanceId } = require('./instanceIdentity');
    const { isMemberState } = require('./shareScope');

    const cleaned = [];
    for (const tracked of await listTrackedInstances()) {
        if (!tracked.cloudLinked || isMemberState(tracked)) continue;
        if (Number(tracked.duplicateModsCleanup || 0) >= CLEANUP_VERSION) continue;

        const instanceDir = tracked.instanceName ? resolveInstanceDir(tracked.instanceName) : null;
        if (!instanceDir || await readInstanceId(instanceDir).catch(() => null) !== tracked.instanceId) continue;

        const result = await removeDuplicateMods(instanceDir);
        await rememberRevision(tracked.instanceId, { duplicateModsCleanup: CLEANUP_VERSION });
        if (result.removed.length > 0) {
            cleaned.push({ instanceName: tracked.instanceName, removed: result.removed });
        }
    }
    return { cleaned };
}

module.exports = {
    BACKUP_DIR,
    cleanupLinkedInstances,
    compareVersions,
    findDuplicateMods,
    readModIdentity,
    removeDuplicateMods
};
