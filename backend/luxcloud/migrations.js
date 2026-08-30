const { getAllInstanceDirsSync, resolveInstanceDirByName } = require('../utils/instances-path');
const { ensureAllInstanceIds } = require('./instanceIdentity');
const { extractAllIcons } = require('./instanceIcon');
const { recoverOrphanedSessions } = require('./playtimeSession');

// Einmalige Aufraeumarbeiten beim App-Start. Alle drei Schritte sind idempotent und
// laufen bei jedem Start -- sie kosten bei bereits migrierten Instanzen nur ein paar
// Dateizugriffe und heilen dabei alles, was zwischendurch wieder inkonsistent wurde
// (etwa weil eine aeltere Lux-Version dazwischen lief).
//
// Wichtig: keiner dieser Schritte darf den Start blockieren. Schlaegt etwas fehl,
// wird es geloggt und der Client startet normal weiter -- ohne Cloud-Faehigkeit,
// aber vollstaendig funktionsfaehig.

async function runStartupMigrations({ log = console.log, logError = console.error } = {}) {
    const summary = { instanceIds: null, icons: null, playtime: null, errors: [] };
    const baseDirs = getAllInstanceDirsSync();

    // 1. Stabile Identitaet. Muss vor allem anderen laufen, weil der Hash-Cache und
    //    spaeter das Manifest ueber die instanceId adressiert werden.
    try {
        const result = await ensureAllInstanceIds(baseDirs);
        summary.instanceIds = result;

        if (result.assigned.length > 0) {
            log(`[LuxCloud] ${result.assigned.length} Instanz(en) haben eine UUID erhalten.`);
        }
        if (result.deduped.length > 0) {
            log(`[LuxCloud] ${result.deduped.length} kopierte Instanz(en) haben eine neue UUID bekommen.`);
        }
    } catch (error) {
        logError('[LuxCloud] Vergabe der Instanz-UUIDs fehlgeschlagen:', error.message);
        summary.errors.push({ step: 'instanceIds', message: error.message });
    }

    // 2. Icons aus instance.json auslagern. Reine Optimierung -- ein Fehlschlag ist
    //    folgenlos, das Icon bleibt dann eben inline.
    try {
        const result = await extractAllIcons(baseDirs);
        summary.icons = result;

        if (result.extracted.length > 0) {
            const mb = (result.bytesSaved / (1024 * 1024)).toFixed(1);
            log(`[LuxCloud] ${result.extracted.length} Icon(s) aus instance.json ausgelagert (${mb} MB).`);
        }
    } catch (error) {
        logError('[LuxCloud] Auslagern der Icons fehlgeschlagen:', error.message);
        summary.errors.push({ step: 'icons', message: error.message });
    }

    // 3. Abgebrochene Spielsitzungen nachbuchen. Das ist der Schritt, der dem User
    //    tatsaechlich etwas zurueckgibt: bisher war die Zeit nach einem Absturz weg.
    try {
        const result = await recoverOrphanedSessions({
            resolveInstanceDir: (name) => resolveInstanceDirByName(name)
        });
        summary.playtime = result;

        if (result.recovered.length > 0) {
            const totalMinutes = Math.round(
                result.recovered.reduce((sum, r) => sum + r.creditedMs, 0) / 60000
            );
            log(`[LuxCloud] ${result.recovered.length} abgebrochene Session(s) nachgebucht (${totalMinutes} min).`);
        }
    } catch (error) {
        logError('[LuxCloud] Nachbuchen abgebrochener Sessions fehlgeschlagen:', error.message);
        summary.errors.push({ step: 'playtime', message: error.message });
    }

    return summary;
}

module.exports = { runStartupMigrations };
