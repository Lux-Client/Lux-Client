const path = require('path');
const fs = require('fs-extra');

// Ein Code-Import legt zuerst die Instanz an (Spiel + Loader) und laedt danach Mods,
// Resource Packs und Shader nach. Sobald das Spiel fertig ist, meldet die Instanz sich
// aber schon als startbereit -- und ein Start mitten im Mod-Download kann die Instanz
// kaputt machen. Deshalb liegt waehrend des Imports eine eigene Datei im Instanzordner
// (MARKER_FILE) mit der kompletten Liste der erwarteten Inhalte. Gestartet wird erst,
// wenn jeder Eintrag wirklich als Datei im Instanzordner liegt oder endgueltig nicht
// installierbar war.
//
// Bewusst NICHT in instance.json: der Spiel-Installer liest, aendert und schreibt
// instance.json waehrend der Installation mehrmals und wuerde den Marker dabei mit
// seinem alten Stand ueberschreiben.

const MARKER_FILE = '.lux-shared-import.json';

const CONTENT_FOLDERS = {
    mod: 'mods',
    resourcepack: 'resourcepacks',
    shader: 'shaderpacks'
};

// Imports, die in diesem Prozess gerade laufen. Ein Marker ohne laufenden Import
// stammt aus einer abgebrochenen Sitzung (Launcher geschlossen, Absturz) und wird
// fortgesetzt statt die Instanz fuer immer zu sperren.
const activeImports = new Set();
let resumeHandler = null;
let liveUpdateHandler = null;

function normalizeItem(item, kind) {
    if (typeof item === 'string') {
        return { kind, projectId: item, versionId: null, title: item, icon: null, fileName: item, state: 'pending' };
    }
    const source = item || {};
    return {
        kind,
        projectId: source.projectId || null,
        versionId: source.versionId || null,
        title: source.title || source.fileName || source.projectId || 'Unknown',
        icon: source.icon || null,
        fileName: source.fileName || null,
        state: 'pending'
    };
}

function buildImportItems(modpackData) {
    const data = modpackData || {};
    return [
        ...(data.mods || []).map((item) => normalizeItem(item, 'mod')),
        ...(data.resourcePacks || []).map((item) => normalizeItem(item, 'resourcepack')),
        ...(data.shaders || []).map((item) => normalizeItem(item, 'shader'))
    ];
}

function itemPath(instanceDir, item) {
    const folder = CONTENT_FOLDERS[item.kind];
    if (!folder || !item.fileName) return null;
    // Dateinamen kommen vom Server bzw. von Modrinth -- nie aus dem Instanzordner heraus.
    const safeName = path.basename(String(item.fileName));
    if (!safeName || safeName === '.' || safeName === '..') return null;
    return path.join(instanceDir, folder, safeName);
}

async function isItemOnDisk(instanceDir, item) {
    const filePath = itemPath(instanceDir, item);
    if (!filePath) return false;
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() && stats.size > 0;
    } catch (_) {
        return false;
    }
}

// Zaehlt nach, was wirklich im Instanzordner liegt. Ein Eintrag, der als installiert
// gilt, dessen Datei aber fehlt, faellt zurueck auf `pending`.
async function verifyItems(instanceDir, items) {
    const missing = [];
    for (const item of items) {
        if (item.state !== 'installed') continue;
        if (!(await isItemOnDisk(instanceDir, item))) {
            item.state = 'pending';
            missing.push(item);
        }
    }
    return missing;
}

function summarize(items) {
    const list = Array.isArray(items) ? items : [];
    const installed = list.filter((item) => item.state === 'installed').length;
    const failed = list.filter((item) => item.state === 'failed').length;
    return {
        total: list.length,
        installed,
        failed,
        pending: list.length - installed - failed
    };
}

function markerPath(instanceDir) {
    return path.join(instanceDir, MARKER_FILE);
}

async function readMarker(instanceDir) {
    if (!instanceDir) return null;
    try {
        const marker = await fs.readJson(markerPath(instanceDir));
        return marker && marker.pending ? marker : null;
    } catch (_) {
        return null;
    }
}

async function writeMarker(instanceDir, marker) {
    const target = markerPath(instanceDir);
    const temp = `${target}.tmp`;
    await fs.writeJson(temp, marker, { spaces: 2 });
    await fs.move(temp, target, { overwrite: true });
}

async function clearMarker(instanceDir) {
    try {
        await fs.remove(markerPath(instanceDir));
    } catch (_) { }
}

function markActive(instanceName) {
    activeImports.add(instanceName);
}

function markInactive(instanceName) {
    activeImports.delete(instanceName);
}

function isActive(instanceName) {
    return activeImports.has(instanceName);
}

function setResumeHandler(handler) {
    resumeHandler = typeof handler === 'function' ? handler : null;
}

function setLiveUpdateHandler(handler) {
    liveUpdateHandler = typeof handler === 'function' ? handler : null;
}

// Vor jedem Start: Instanzen aus einem Live-Code auf die neueste Revision bringen.
// Fehler (offline, Server weg) halten niemanden vom Spielen ab.
async function runLiveUpdate(instanceName) {
    if (!liveUpdateHandler || isActive(instanceName)) return null;
    try {
        return await liveUpdateHandler(instanceName);
    } catch (e) {
        console.error('[SharedImport] Live update failed:', e);
        return null;
    }
}

// Wird vor jedem Start aufgerufen. Liefert null, wenn gestartet werden darf, sonst
// eine Fehlermeldung fuer die Oberflaeche.
async function getLaunchBlock(instanceName, instanceDir) {
    const marker = await readMarker(instanceDir);
    const running = isActive(instanceName);
    if (!marker && !running) return null;

    const { total, installed, failed } = summarize(marker ? marker.items : []);

    if (marker && !running && resumeHandler) {
        // Abgebrochener Import aus einer frueheren Sitzung: im Hintergrund weitermachen.
        Promise.resolve()
            .then(() => resumeHandler(instanceName))
            .catch((e) => console.error('[SharedImport] Resume failed:', e));
    }

    const progress = total > 0 ? ` (${installed + failed}/${total})` : '';
    return {
        error: `Mods are still being installed${progress}. Please wait until the import has finished before starting the game.`
    };
}

module.exports = {
    CONTENT_FOLDERS,
    buildImportItems,
    itemPath,
    isItemOnDisk,
    verifyItems,
    summarize,
    MARKER_FILE,
    readMarker,
    writeMarker,
    clearMarker,
    markActive,
    markInactive,
    isActive,
    setResumeHandler,
    setLiveUpdateHandler,
    runLiveUpdate,
    getLaunchBlock
};
