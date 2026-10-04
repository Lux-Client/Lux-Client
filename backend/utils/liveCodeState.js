const path = require('path');
const fs = require('fs-extra');
const sharedImportState = require('./sharedImportState');

// Instanzen, die aus einem Live-Code installiert wurden, merken sich hier Code, Revision
// und welche Dateien der Code mitgebracht hat. Vor jedem Start fragt der Launcher die
// aktuelle Revision ab; ist sie neuer, werden nur die Dateien des Codes ausgetauscht --
// was der Spieler selbst dazu installiert hat, bleibt unangetastet.
//
// Wie der Import-Marker bewusst nicht in instance.json (siehe sharedImportState.js).

const LIVE_FILE = '.lux-live-code.json';

function livePath(instanceDir) {
    return path.join(instanceDir, LIVE_FILE);
}

async function readLiveState(instanceDir) {
    if (!instanceDir) return null;
    try {
        const state = await fs.readJson(livePath(instanceDir));
        return state && typeof state.code === 'string' ? state : null;
    } catch (_) {
        return null;
    }
}

async function writeLiveState(instanceDir, state) {
    const target = livePath(instanceDir);
    const temp = `${target}.tmp`;
    await fs.writeJson(temp, state, { spaces: 2 });
    await fs.move(temp, target, { overwrite: true });
}

async function clearLiveState(instanceDir) {
    try {
        await fs.remove(livePath(instanceDir));
    } catch (_) { }
}

function trackedItem(item) {
    return {
        kind: item.kind,
        projectId: item.projectId || null,
        versionId: item.versionId || null,
        fileName: item.fileName || null,
        title: item.title || null
    };
}

function sameContent(a, b) {
    if (a.kind !== b.kind) return false;
    if (a.projectId && b.projectId) {
        return a.projectId === b.projectId && (a.versionId || null) === (b.versionId || null);
    }
    return Boolean(a.fileName) && a.fileName === b.fileName;
}

// Vergleicht den installierten Stand mit der neuen Revision. Liefert die Liste fuer den
// Import-Marker (unveraenderte Dateien gelten schon als installiert) und die Dateien,
// die der Code nicht mehr enthaelt und deshalb entfernt werden.
async function planUpdate(instanceDir, state, remoteData) {
    const previous = Array.isArray(state && state.items) ? state.items : [];
    const items = sharedImportState.buildImportItems(remoteData);

    for (const item of items) {
        const match = previous.find((old) => sameContent(old, item));
        if (!match || !match.fileName) continue;
        const candidate = { ...item, fileName: match.fileName };
        if (await sharedImportState.isItemOnDisk(instanceDir, candidate)) {
            item.fileName = match.fileName;
            item.state = 'installed';
        }
    }

    const keptFiles = new Set(items
        .map((item) => sharedImportState.itemPath(instanceDir, item))
        .filter(Boolean));
    const remove = [];
    for (const old of previous) {
        if (items.some((item) => sameContent(old, item))) continue;
        const filePath = sharedImportState.itemPath(instanceDir, old);
        if (filePath && !keptFiles.has(filePath)) remove.push(filePath);
    }

    return { items, remove };
}

function isNewer(state, remoteData) {
    return Number(remoteData && remoteData.revision) > Number(state && state.revision || 0);
}

function targetChanged(state, remoteData) {
    const norm = (value) => (value ? String(value).toLowerCase() : null);
    return Boolean(
        (state.gameVersion && remoteData.version && norm(state.gameVersion) !== norm(remoteData.version))
        || (state.loader && remoteData.loader && norm(state.loader) !== norm(remoteData.loader))
    );
}

module.exports = {
    LIVE_FILE,
    readLiveState,
    writeLiveState,
    clearLiveState,
    trackedItem,
    planUpdate,
    isNewer,
    targetChanged
};
