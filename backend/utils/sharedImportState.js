const path = require('path');
const fs = require('fs-extra');

// Ein Code-Import legt zuerst die Instanz an (Spiel + Loader) und laedt danach Mods,
// Resource Packs und Shader nach. Sobald das Spiel fertig ist, meldet die Instanz sich
// aber schon als startbereit -- und ein Start mitten im Mod-Download kann die Instanz
// kaputt machen. Deshalb merkt sich instance.json unter `sharedImport` die komplette
// Liste der erwarteten Inhalte, und gestartet wird erst, wenn jeder Eintrag entweder
// wirklich als Datei im Instanzordner liegt oder endgueltig nicht installierbar war.

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

async function readConfig(instanceDir) {
    try {
        return await fs.readJson(path.join(instanceDir, 'instance.json'));
    } catch (_) {
        return null;
    }
}

function hasPendingImport(config) {
    return Boolean(config && config.sharedImport && config.sharedImport.pending);
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

// Wird vor jedem Start aufgerufen. Liefert null, wenn gestartet werden darf, sonst
// eine Fehlermeldung fuer die Oberflaeche.
async function getLaunchBlock(instanceName, instanceDir) {
    if (!instanceDir) return null;
    const config = await readConfig(instanceDir);
    if (!hasPendingImport(config)) return null;

    const items = Array.isArray(config.sharedImport.items) ? config.sharedImport.items : [];
    const { total, installed, failed } = summarize(items);

    if (!isActive(instanceName) && resumeHandler) {
        // Abgebrochener Import aus einer frueheren Sitzung: im Hintergrund weitermachen.
        Promise.resolve()
            .then(() => resumeHandler(instanceName))
            .catch((e) => console.error('[SharedImport] Resume failed:', e));
    }

    return {
        error: `Shared content is still being installed (${installed + failed}/${total}). Please wait until the import has finished before starting the game.`
    };
}

module.exports = {
    CONTENT_FOLDERS,
    buildImportItems,
    itemPath,
    isItemOnDisk,
    verifyItems,
    summarize,
    readConfig,
    hasPendingImport,
    markActive,
    markInactive,
    isActive,
    setResumeHandler,
    getLaunchBlock
};
