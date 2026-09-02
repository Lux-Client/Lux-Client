const fs = require('fs-extra');
const path = require('path');

const { classify, shouldSkipDirectory, normalizeRelPath } = require('./syncPolicy');
const { HashCache } = require('./hashCache');
const { buildNormalizedInstanceJson } = require('./manifest');
const { getHashCacheDir } = require('./paths');

const CONFLICT_DIR = path.join('.lux-sync', 'conflicts');
const INSTANCE_CONFIG = 'instance.json';

const RESOLUTION = {
    LOCAL: 'local',
    REMOTE: 'remote',
    BOTH: 'both'
};

const KIND = {
    CONFIG: 'config',
    MOD: 'mod',
    WORLD: 'world',
    OTHER: 'other'
};

function entryMap(manifest) {
    const map = new Map();
    for (const entry of (manifest && manifest.entries) || []) {
        map.set(normalizeRelPath(entry.path), entry);
    }
    return map;
}

function worldOf(relPath) {
    const parts = relPath.split('/');
    if (parts[0] !== 'saves' || parts.length < 2) return null;
    return parts[1];
}

function kindOf(relPath) {
    if (worldOf(relPath)) return KIND.WORLD;
    if (relPath.startsWith('mods/')) return KIND.MOD;
    if (relPath.startsWith('config/') || !relPath.includes('/')) return KIND.CONFIG;
    return KIND.OTHER;
}

function hashOf(entry) {
    return entry ? entry.sha256 : null;
}

function diffManifests(base, local, remote) {
    const baseMap = entryMap(base);
    const localMap = entryMap(local);
    const remoteMap = entryMap(remote);

    const paths = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);

    const autoLocal = [];
    const autoRemote = [];
    const conflicts = [];
    const worlds = new Map();

    for (const relPath of paths) {
        const b = hashOf(baseMap.get(relPath));
        const l = hashOf(localMap.get(relPath));
        const r = hashOf(remoteMap.get(relPath));

        if (l === r) continue;

        const localChanged = l !== b;
        const remoteChanged = r !== b;

        if (localChanged && !remoteChanged) {
            autoLocal.push(relPath);
            continue;
        }
        if (remoteChanged && !localChanged) {
            autoRemote.push(relPath);
            continue;
        }

        const kind = kindOf(relPath);

        if (kind === KIND.WORLD) {
            const world = worldOf(relPath);
            if (!worlds.has(world)) worlds.set(world, { world, paths: [] });
            worlds.get(world).paths.push(relPath);
            continue;
        }

        if (l === null || r === null) {
            conflicts.push({
                path: relPath,
                kind,
                reason: 'delete-vs-modify',
                suggested: l === null ? RESOLUTION.REMOTE : RESOLUTION.LOCAL,
                automatic: true
            });
            continue;
        }

        if (kind === KIND.MOD && b === null) {
            conflicts.push({
                path: relPath,
                kind,
                reason: 'both-added',
                suggested: RESOLUTION.BOTH,
                automatic: true
            });
            continue;
        }

        conflicts.push({
            path: relPath,
            kind,
            reason: 'both-modified',
            suggested: RESOLUTION.LOCAL,
            automatic: false
        });
    }

    const worldConflicts = [...worlds.values()].map((entry) => ({
        world: entry.world,
        kind: KIND.WORLD,
        reason: 'both-modified',
        fileCount: entry.paths.length,
        paths: entry.paths,
        suggested: null,
        automatic: false
    }));

    const needsUser = conflicts.some((entry) => !entry.automatic) || worldConflicts.length > 0;

    return {
        autoLocal,
        autoRemote,
        conflicts,
        worldConflicts,
        needsUser,
        clean: autoLocal.length === 0 && autoRemote.length === 0
            && conflicts.length === 0 && worldConflicts.length === 0,
        summary: {
            localChanges: autoLocal.length,
            remoteChanges: autoRemote.length,
            conflictingFiles: conflicts.length,
            conflictingWorlds: worldConflicts.length
        }
    };
}

async function scanLocalState(instanceDir, options = {}) {
    const files = [];
    const walk = async (absDir, relDir) => {
        let entries;
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                if (shouldSkipDirectory(relPath, options)) continue;
                await walk(path.join(absDir, entry.name), relPath);
                continue;
            }
            if (!entry.isFile()) continue;

            let stat;
            try {
                stat = await fs.stat(path.join(absDir, entry.name));
            } catch (_) {
                continue;
            }

            if (relPath === INSTANCE_CONFIG) continue;
            if (!classify(relPath, { ...options, size: stat.size }).include) continue;
            files.push({ relPath, size: stat.size, mtimeMs: stat.mtimeMs });
        }
    };

    await walk(instanceDir, '');
    return files;
}

async function isLocallyDirty(instanceDir, instanceId, options = {}) {
    const cache = await new HashCache(options.hashCacheDir || getHashCacheDir(), instanceId).load();
    if (cache.size === 0) return { dirty: true, reason: 'no-cache', changed: [] };

    const files = await scanLocalState(instanceDir, options);
    const seen = new Set();
    const changed = [];

    if (options.instanceConfigHash) {
        const normalized = await buildNormalizedInstanceJson(instanceDir);
        if (normalized && normalized.sha256 !== options.instanceConfigHash) {
            changed.push({ path: INSTANCE_CONFIG, reason: 'modified' });
        }
    }

    for (const file of files) {
        seen.add(file.relPath);
        const cached = cache.entries.get(file.relPath);

        if (!cached) {
            changed.push({ path: file.relPath, reason: 'added' });
            continue;
        }
        if (cached.size !== file.size || Math.abs(cached.mtimeMs - file.mtimeMs) >= 1) {
            changed.push({ path: file.relPath, reason: 'modified' });
        }
    }

    for (const relPath of cache.entries.keys()) {
        if (!seen.has(relPath)) changed.push({ path: relPath, reason: 'removed' });
    }

    return { dirty: changed.length > 0, reason: changed.length > 0 ? 'changed' : 'clean', changed };
}

async function backupLosers(instanceDir, revision, paths) {
    if (paths.length === 0) return { saved: 0, dir: null };

    const target = path.join(instanceDir, CONFLICT_DIR, `rev${revision}-${Date.now()}`);
    await fs.ensureDir(target);

    let saved = 0;
    for (const relPath of paths) {
        const source = path.join(instanceDir, relPath);
        if (!await fs.pathExists(source)) continue;

        const destination = path.join(target, relPath);
        await fs.ensureDir(path.dirname(destination));
        try {
            await fs.copy(source, destination);
            saved += 1;
        } catch (_) {
            continue;
        }
    }

    return { saved, dir: target };
}

function buildPlan(diff, choice) {
    const takeRemote = [...diff.autoRemote];
    const keepLocal = [...diff.autoLocal];

    for (const entry of diff.conflicts) {
        const decision = entry.automatic ? entry.suggested : choice;

        if (decision === RESOLUTION.REMOTE) takeRemote.push(entry.path);
        else if (decision === RESOLUTION.LOCAL) keepLocal.push(entry.path);
        else if (decision === RESOLUTION.BOTH) keepLocal.push(entry.path);
    }

    const worlds = diff.worldConflicts.map((entry) => ({
        world: entry.world,
        decision: choice === RESOLUTION.BOTH ? RESOLUTION.BOTH : (choice || RESOLUTION.LOCAL),
        paths: entry.paths
    }));

    return { takeRemote, keepLocal, worlds };
}

module.exports = {
    CONFLICT_DIR,
    KIND,
    RESOLUTION,
    backupLosers,
    buildPlan,
    diffManifests,
    isLocallyDirty,
    scanLocalState
};
