// Merkt sich, wie das zuletzt synchronisierte Manifest aussah -- Pfad fuer Pfad.
//
// Der contentHash sagt nur "gleich" oder "ungleich". Wenn ein Sync eine Revision
// erzeugt, obwohl der Nutzer nichts angefasst hat, ist genau das die Frage, die
// niemand beantworten konnte: WAS hat sich denn geaendert? Mit diesem Abbild laesst
// sich das benennen, im Log wie in der Oberflaeche.
//
// Die Datei liegt neben dem Hash-Cache und ist genauso wegwerfbar: fehlt sie, gibt es
// eben keine Detailauskunft, der Sync funktioniert trotzdem.

const fs = require('fs-extra');
const path = require('path');

const { getLuxCloudDir } = require('./paths');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');

const SNAPSHOT_VERSION = 1;
const MAX_LISTED = 20;

function snapshotDir() {
    return path.join(getLuxCloudDir(), 'manifests');
}

function snapshotFile(instanceId) {
    return path.join(snapshotDir(), `${instanceId}.json`);
}

function fingerprint(entry) {
    return [
        entry.sha256 || null,
        entry.blob || null,
        entry.source ? `${entry.source.projectId}:${entry.source.versionId}` : null,
        entry.chunks ? entry.chunks.list : null
    ].join('|');
}

function describe(manifest, revision = null) {
    const entries = {};
    for (const entry of (manifest && manifest.entries) || []) {
        entries[entry.path] = fingerprint(entry);
    }

    return {
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        // Zu welcher Revision dieses Abbild gehoert. Nur wenn sie zum lokalen Stand passt,
        // taugt es als Basis fuer Entscheidungen (etwa: was darf geloescht werden).
        revision: Number.isFinite(Number(revision)) && revision !== null ? Number(revision) : null,
        name: (manifest && manifest.name) || null,
        runtime: (manifest && manifest.runtime) || null,
        settings: (manifest && manifest.settings) || null,
        icon: (manifest && manifest.icon) || null,
        entries
    };
}

async function save(instanceId, manifest, { revision = null } = {}) {
    if (!instanceId || !manifest) return false;
    await fs.ensureDir(snapshotDir());
    await writeJsonAtomic(snapshotFile(instanceId), describe(manifest, revision), { spaces: 0 });
    return true;
}

async function load(instanceId) {
    if (!instanceId) return null;
    const data = await readJsonSafe(snapshotFile(instanceId), null);
    if (!data || data.version !== SNAPSHOT_VERSION || !data.entries) return null;
    return data;
}

// Benennt die Unterschiede zwischen dem zuletzt synchronisierten Stand und dem, was
// gerade gebaut wurde. Gibt null zurueck, wenn es kein Abbild gibt.
async function diff(instanceId, manifest) {
    const previous = await load(instanceId);
    if (!previous) return null;

    const current = describe(manifest);
    const added = [];
    const removed = [];
    const changed = [];

    for (const [relPath, print] of Object.entries(current.entries)) {
        const before = previous.entries[relPath];
        if (before === undefined) added.push(relPath);
        else if (before !== print) changed.push(relPath);
    }
    for (const relPath of Object.keys(previous.entries)) {
        if (current.entries[relPath] === undefined) removed.push(relPath);
    }

    const meta = [];
    for (const field of ['name', 'runtime', 'settings', 'icon']) {
        if (JSON.stringify(previous[field]) !== JSON.stringify(current[field])) {
            meta.push({
                field,
                before: previous[field],
                after: current[field]
            });
        }
    }

    return {
        added,
        removed,
        changed,
        meta,
        total: added.length + removed.length + changed.length + meta.length
    };
}

// Eine Zeile fuers Log -- kurz genug, um sie einem Nutzer zumuten zu koennen.
function summarize(result) {
    if (!result) return 'no previous manifest recorded';
    if (result.total === 0) return 'nothing differs from the last synced manifest';

    const parts = [];
    for (const entry of result.meta) {
        parts.push(`${entry.field}: ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}`);
    }

    const list = (label, items) => {
        if (items.length === 0) return;
        const shown = items.slice(0, MAX_LISTED).join(', ');
        parts.push(`${label} (${items.length}): ${shown}${items.length > MAX_LISTED ? ', ...' : ''}`);
    };

    list('changed', result.changed);
    list('added', result.added);
    list('removed', result.removed);

    return parts.join(' | ');
}

async function forget(instanceId) {
    if (!instanceId) return false;
    await fs.remove(snapshotFile(instanceId)).catch(() => {});
    return true;
}

module.exports = {
    SNAPSHOT_VERSION,
    describe,
    diff,
    forget,
    load,
    save,
    summarize
};
