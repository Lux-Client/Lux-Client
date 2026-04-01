const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

function normalizeDir(dir) {
    if (typeof dir !== 'string') return '';
    const trimmed = dir.trim();
    if (!trimmed) return '';
    return path.normalize(trimmed);
}

function samePath(left, right) {
    const a = normalizeDir(left);
    const b = normalizeDir(right);
    if (!a || !b) return false;
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function dedupeDirs(dirs) {
    const seen = new Set();
    const result = [];

    for (const dir of dirs) {
        const normalized = normalizeDir(dir);
        if (!normalized) continue;

        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(normalized);
    }

    return result;
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function readSettingsSync() {
    try {
        const settingsPath = getSettingsPath();
        if (!fs.existsSync(settingsPath)) return {};

        const parsed = fs.readJsonSync(settingsPath, { throws: false });
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (_) {
    }

    return {};
}

function getDefaultInstancesDir() {
    return path.join(app.getPath('userData'), 'instances');
}

function getConfiguredInstancesDir() {
    const settings = readSettingsSync();
    return normalizeDir(settings.instancesPath || settings.instancePath || '');
}

function resolvePrimaryInstancesDir() {
    return getConfiguredInstancesDir() || getDefaultInstancesDir();
}

function getLegacyInstanceDirs() {
    const appData = app.getPath('appData');

    return [
        path.join(appData, 'Lux', 'instances'), //Previously was MCLC, i might have broke something for old MCLC clients
        path.join(appData, 'Minecraft Launcher', 'instances'),
        path.join(appData, 'LuxClient', 'instances'),
        path.join(appData, 'luxclient', 'instances'),
        path.join(appData, 'Lux Launcher', 'instances')
    ];
}

function getAllInstanceDirsSync() {
    const primaryDir = resolvePrimaryInstancesDir();
    const defaultDir = getDefaultInstancesDir();

    const allCandidates = dedupeDirs([
        primaryDir,
        defaultDir,
        ...getLegacyInstanceDirs()
    ]);

    return allCandidates.filter((dir) => {
        try {
            return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
        } catch (_) {
            return false;
        }
    });
}

function resolveInstanceDirByName(instanceName) {
    if (!instanceName || typeof instanceName !== 'string') return null;

    const primaryDir = resolvePrimaryInstancesDir();
    const primaryCandidate = path.join(primaryDir, instanceName);
    const primaryConfig = path.join(primaryCandidate, 'instance.json');
    if (fs.existsSync(primaryConfig)) {
        return primaryCandidate;
    }

    for (const baseDir of getAllInstanceDirsSync()) {
        const candidate = path.join(baseDir, instanceName);
        const configPath = path.join(candidate, 'instance.json');
        if (fs.existsSync(configPath)) {
            return candidate;
        }
    }

    return null;
}

function migrateLegacyInstancesToPrimarySync() {
    const primaryDir = resolvePrimaryInstancesDir();
    fs.ensureDirSync(primaryDir);

    const migrated = [];
    const skipped = [];

    for (const sourceDir of getAllInstanceDirsSync()) {
        if (samePath(sourceDir, primaryDir)) continue;

        let entries = [];
        try {
            entries = fs.readdirSync(sourceDir, { withFileTypes: true });
        } catch (error) {
            skipped.push({ sourceDir, reason: error.message });
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const sourcePath = path.join(sourceDir, entry.name);
            const sourceConfig = path.join(sourcePath, 'instance.json');
            if (!fs.existsSync(sourceConfig)) continue;

            const targetPath = path.join(primaryDir, entry.name);
            if (fs.existsSync(targetPath)) {
                skipped.push({ sourcePath, reason: 'target-exists' });
                continue;
            }

            try {
                fs.moveSync(sourcePath, targetPath, { overwrite: false });
                migrated.push({ name: entry.name, from: sourceDir, to: targetPath });
            } catch (error) {
                skipped.push({ sourcePath, reason: error.message });
            }
        }
    }

    return {
        primaryDir,
        migrated,
        skipped
    };
}

module.exports = {
    getDefaultInstancesDir,
    resolvePrimaryInstancesDir,
    getAllInstanceDirsSync,
    resolveInstanceDirByName,
    migrateLegacyInstancesToPrimarySync
};
