const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');

const INSTANCE_CONFIG = 'instance.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newInstanceId() {
    // randomUUID gibt es seit Node 14.17 / Electron 13 -- keine zusaetzliche Dependency.
    return crypto.randomUUID();
}

function isValidInstanceId(value) {
    return typeof value === 'string' && UUID_RE.test(value.trim());
}

async function ensureInstanceId(instanceDir, { forceNew = false } = {}) {
    const configPath = path.join(instanceDir, INSTANCE_CONFIG);

    const config = await readJsonSafe(configPath, null);
    if (!config || typeof config !== 'object') {

        return { instanceId: null, changed: false, reason: 'no-config' };
    }

    if (!forceNew && isValidInstanceId(config.instanceId)) {
        return { instanceId: config.instanceId, changed: false, reason: 'existing' };
    }

    const instanceId = newInstanceId();
    config.instanceId = instanceId;
    await writeJsonAtomic(configPath, config);

    return {
        instanceId,
        changed: true,
        reason: forceNew ? 'forced' : 'assigned'
    };
}

// Liest die UUID, ohne etwas zu schreiben.
async function readInstanceId(instanceDir) {
    const config = await readJsonSafe(path.join(instanceDir, INSTANCE_CONFIG), null);
    if (!config || !isValidInstanceId(config.instanceId)) return null;
    return config.instanceId;
}

// Vergibt UUIDs fuer alle Instanzen in den uebergebenen Basisverzeichnissen.
//
// Behandelt dabei auch den Fall, dass jemand einen Instanzordner im Explorer kopiert
// hat: dann haetten zwei Ordner dieselbe UUID und wuerden sich in der Cloud gegenseitig
// ueberschreiben. Der zuerst gefundene Ordner behaelt die UUID, jeder weitere bekommt
// eine neue und gilt damit als eigenstaendige Instanz.
async function ensureAllInstanceIds(baseDirs) {
    const seen = new Map();       // instanceId -> erster Ordner, der sie beansprucht hat
    const assigned = [];
    const deduped = [];
    const skipped = [];

    for (const baseDir of baseDirs) {
        let entries;
        try {
            if (!await fs.pathExists(baseDir)) continue;
            entries = await fs.readdir(baseDir, { withFileTypes: true });
        } catch (error) {
            skipped.push({ baseDir, reason: error.message });
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const instanceDir = path.join(baseDir, entry.name);
            if (!await fs.pathExists(path.join(instanceDir, INSTANCE_CONFIG))) continue;

            try {
                let result = await ensureInstanceId(instanceDir);
                if (!result.instanceId) {
                    skipped.push({ instanceDir, reason: result.reason });
                    continue;
                }

                const claimedBy = seen.get(result.instanceId);
                if (claimedBy && claimedBy !== instanceDir) {
                    // Kopierter Ordner: neue Identitaet vergeben.
                    result = await ensureInstanceId(instanceDir, { forceNew: true });
                    deduped.push({ instanceDir, duplicateOf: claimedBy, instanceId: result.instanceId });
                }

                seen.set(result.instanceId, instanceDir);
                if (result.changed) {
                    assigned.push({ instanceDir, instanceId: result.instanceId });
                }
            } catch (error) {
                skipped.push({ instanceDir, reason: error.message });
            }
        }
    }

    return { assigned, deduped, skipped, total: seen.size };
}

module.exports = {
    INSTANCE_CONFIG,
    newInstanceId,
    isValidInstanceId,
    ensureInstanceId,
    readInstanceId,
    ensureAllInstanceIds
};
