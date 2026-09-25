// Drei-Wege-Abgleich zwischen dem zuletzt gemeinsamen Stand (Basis), diesem PC und der
// Cloud.
//
// Bisher kannte der Sync nur "gleich" oder "ungleich" fuer die ganze Instanz: hatte sich
// die Cloud bewegt UND dieser PC etwas geaendert, war das ein Konflikt -- selbst wenn der
// eine nur eine Mod hinzugefuegt und der andere nur gespielt hatte. Beim Zusammenarbeiten
// an einer Instanz waere das der Normalfall. Hier wird Datei fuer Datei entschieden:
//
//   lokal == Basis            -> die Cloud hat recht (uebernehmen oder entfernen)
//   Cloud == Basis            -> dieser PC hat recht (bleibt, geht mit dem Upload hoch)
//   lokal == Cloud            -> nichts zu tun
//   sonst                     -> echter Konflikt, entscheidet weiter der Nutzer
//
// Verglichen wird der Inhalt (sha256), nicht die Darstellung im Manifest: derselbe Mod
// kann auf einem PC als Modrinth-Verweis und auf dem anderen als Blob beschrieben sein.

const { isMemberReadable, isMemberWritable, SHARED_WRITABLE_DIRS } = require('./shareScope');

// Entfernt wird nur, was sich bedenkenlos wiederbeschaffen laesst. Eine Welt, die auf
// einem anderen PC geloescht wurde, verschwindet hier nicht still mit.
function isDeletable(relPath) {
    return isMemberWritable(relPath);
}

function shaOfFingerprint(print) {
    if (typeof print !== 'string') return undefined;
    const sha = print.split('|')[0];
    return sha && sha !== 'null' ? sha : undefined;
}

function toMap(manifest, filter) {
    const map = new Map();
    for (const entry of (manifest && manifest.entries) || []) {
        if (filter && !filter(entry.path)) continue;
        map.set(entry.path, entry);
    }
    return map;
}

// base: das Abbild aus manifestSnapshot ({ entries: { path: fingerprint } }).
// member: true, wenn dieser PC nur Mitglied der Instanz ist.
function planMerge({ base, local, remote, member = false }) {
    const scope = member ? isMemberReadable : null;
    const baseShas = new Map();
    for (const [relPath, print] of Object.entries((base && base.entries) || {})) {
        if (scope && !scope(relPath)) continue;
        baseShas.set(relPath, shaOfFingerprint(print));
    }
    const localMap = toMap(local, scope);
    const remoteMap = toMap(remote, scope);

    const paths = new Set([...baseShas.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const fetch = [];
    const remove = [];
    const conflicts = [];
    let localChanged = false;
    let remoteChanged = false;

    for (const relPath of paths) {
        const b = baseShas.get(relPath);
        const localEntry = localMap.get(relPath);
        const remoteEntry = remoteMap.get(relPath);
        const l = localEntry ? localEntry.sha256 : undefined;
        const r = remoteEntry ? remoteEntry.sha256 : undefined;

        // Fuer ein Mitglied gehoeren instance.json und das Icon dem Host: lesen ja,
        // aendern nein. Weicht die Cloud ab, gilt die Cloud -- ohne Konflikt.
        if (member && !isMemberWritable(relPath)) {
            if (r !== undefined && r !== l) {
                fetch.push(remoteEntry);
                remoteChanged = true;
            }
            continue;
        }

        if (l !== b) localChanged = true;
        if (r !== b) remoteChanged = true;

        if (l === r) continue;

        if (l === b) {
            if (r === undefined) {
                if (isDeletable(relPath)) remove.push(relPath);
            } else {
                fetch.push(remoteEntry);
            }
            continue;
        }

        if (r === b) continue;

        conflicts.push(relPath);
    }

    return {
        fetch,
        remove: remove.sort(),
        conflicts: conflicts.sort(),
        localChanged,
        remoteChanged
    };
}

module.exports = {
    SHARED_WRITABLE_DIRS,
    isDeletable,
    planMerge
};
