const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');
const { getSessionsDir } = require('./paths');

// Playtime wird heute ausschliesslich im close-Handler des Minecraft-Prozesses gebucht
// (handlers/launcher.js). Das heisst: stuerzt der PC ab, faellt der Strom aus oder wird
// Lux ueber den Task-Manager beendet, ist die komplette Session verloren -- bei einem
// langen Abend also mehrere Stunden.
//
// Hier liegt deshalb waehrend des Spielens eine Sessiondatei mit einem Heartbeat.
// Beim naechsten Start werden verwaiste Sessions gefunden und nachgebucht. Wichtig
// dabei: gebucht wird bis 'lastHeartbeat', NICHT bis jetzt -- sonst wuerde die Zeit,
// in der der PC aus war, als Spielzeit gezaehlt.
//
// Gleichzeitig ist das die lokale Haelfte des spaeteren Cloud-Playtime-Sync
// (siehe docs/cloud-sync/02-ARCHITEKTUR.md, D.9): der Server bekommt spaeter einen
// absoluten Zaehler je Geraet, kein Delta.

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Sessions, die laenger als das dauern, sind mit hoher Wahrscheinlichkeit ein Fehler
// (haengender Prozess, falsch gestellte Uhr). Wir buchen sie gedeckelt, statt eine
// absurde Zahl in die Statistik zu schreiben.
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

const activeTimers = new Map();

function newSessionId() {
    return crypto.randomBytes(12).toString('hex');
}

function sessionFile(sessionId) {
    return path.join(getSessionsDir(), `${sessionId}.json`);
}

// Startet die Sitzungsverfolgung. Gibt die sessionId zurueck; der Aufrufer muss sie
// an endSession() weiterreichen.
async function startSession({ instanceName, instanceId = null, instanceDir = null }) {
    const sessionId = newSessionId();
    const now = Date.now();

    const record = {
        sessionId,
        instanceName,
        instanceId,
        instanceDir,
        startedAt: now,
        lastHeartbeat: now
    };

    try {
        await fs.ensureDir(getSessionsDir());
        await writeJsonAtomic(sessionFile(sessionId), record);
    } catch (error) {
        // Ohne Sessiondatei laeuft die alte Buchung im close-Handler weiterhin --
        // wir verlieren nur die Absturzsicherung. Kein Grund, den Start zu blockieren.
        console.error('[LuxCloud/Playtime] Konnte Session nicht anlegen:', error.message);
        return null;
    }

    const timer = setInterval(async () => {
        try {
            const current = await readJsonSafe(sessionFile(sessionId), null);
            if (!current) return;
            current.lastHeartbeat = Date.now();
            await writeJsonAtomic(sessionFile(sessionId), current);
        } catch (_) {
            // Ein verpasster Heartbeat kostet im schlimmsten Fall eine Minute Playtime.
        }
    }, HEARTBEAT_INTERVAL_MS);

    // Verhindert, dass der Timer das Beenden der App aufhaelt.
    if (typeof timer.unref === 'function') timer.unref();
    activeTimers.set(sessionId, timer);

    console.log(`[LuxCloud/Playtime] Session ${sessionId} gestartet fuer "${instanceName}"`);
    return sessionId;
}

// Beendet eine Sitzung regulaer und raeumt die Sessiondatei weg.
// Die eigentliche Buchung macht weiterhin der Aufrufer (launcher.js), damit sich am
// bestehenden Verhalten nichts aendert -- hier faellt nur die Absturzsicherung weg.
async function endSession(sessionId) {
    if (!sessionId) return;

    const timer = activeTimers.get(sessionId);
    if (timer) {
        clearInterval(timer);
        activeTimers.delete(sessionId);
    }

    await fs.remove(sessionFile(sessionId)).catch(() => {});
}

// Bucht eine Spielzeit auf eine Instanz. Schreibt beide bestehenden Orte fort
// (instance.json.playtime und playtime.txt), damit sich fuer den restlichen Client
// nichts aendert.
async function creditPlaytime(instanceDir, durationMs) {
    if (!instanceDir || !Number.isFinite(durationMs) || durationMs <= 0) return null;

    const configPath = path.join(instanceDir, 'instance.json');
    const config = await readJsonSafe(configPath, null);
    if (!config || typeof config !== 'object') return null;

    const capped = Math.min(durationMs, MAX_SESSION_MS);
    const previous = Number.isFinite(config.playtime) ? config.playtime : 0;
    const total = previous + capped;

    config.playtime = total;
    config.lastPlayed = Date.now();
    await writeJsonAtomic(configPath, config);

    await fs.writeFile(path.join(instanceDir, 'playtime.txt'), String(total)).catch(() => {});

    return { credited: capped, total };
}

// Sucht beim App-Start nach Sessions, die nie sauber beendet wurden, und bucht sie nach.
// Muss vor der ersten Instanzliste laufen, damit der User die korrigierte Zahl sieht.
async function recoverOrphanedSessions({ resolveInstanceDir } = {}) {
    const dir = getSessionsDir();
    const recovered = [];
    const discarded = [];

    let files;
    try {
        if (!await fs.pathExists(dir)) return { recovered, discarded };
        files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch (error) {
        console.error('[LuxCloud/Playtime] Sessionordner nicht lesbar:', error.message);
        return { recovered, discarded };
    }

    for (const file of files) {
        const filePath = path.join(dir, file);
        const record = await readJsonSafe(filePath, null);

        if (!record || !Number.isFinite(record.startedAt)) {
            await fs.remove(filePath).catch(() => {});
            discarded.push({ file, reason: 'unreadable' });
            continue;
        }

        // Bis zum letzten Lebenszeichen, nicht bis jetzt.
        const endedAt = Number.isFinite(record.lastHeartbeat) ? record.lastHeartbeat : record.startedAt;
        const duration = endedAt - record.startedAt;

        if (duration <= 0) {
            await fs.remove(filePath).catch(() => {});
            discarded.push({ file, reason: 'zero-length' });
            continue;
        }

        let instanceDir = record.instanceDir;
        if ((!instanceDir || !await fs.pathExists(instanceDir)) && typeof resolveInstanceDir === 'function') {
            instanceDir = resolveInstanceDir(record.instanceName);
        }

        if (!instanceDir || !await fs.pathExists(instanceDir)) {
            await fs.remove(filePath).catch(() => {});
            discarded.push({ file, reason: 'instance-gone', instanceName: record.instanceName });
            continue;
        }

        try {
            const result = await creditPlaytime(instanceDir, duration);
            await fs.remove(filePath).catch(() => {});

            if (result) {
                recovered.push({
                    instanceName: record.instanceName,
                    creditedMs: result.credited,
                    totalMs: result.total
                });
                console.log(
                    `[LuxCloud/Playtime] Abgebrochene Session nachgebucht: "${record.instanceName}" ` +
                    `+${Math.round(result.credited / 1000)}s`
                );
            }
        } catch (error) {
            discarded.push({ file, reason: error.message });
        }
    }

    return { recovered, discarded };
}

// Fuer den Fall, dass Lux regulaer beendet wird, waehrend noch gespielt wird:
// Timer stoppen, Sessiondateien aber liegen lassen, damit sie beim naechsten Start
// nachgebucht werden.
function stopAllTimers() {
    for (const timer of activeTimers.values()) {
        clearInterval(timer);
    }
    activeTimers.clear();
}

module.exports = {
    HEARTBEAT_INTERVAL_MS,
    MAX_SESSION_MS,
    startSession,
    endSession,
    creditPlaytime,
    recoverOrphanedSessions,
    stopAllTimers
};
