// Sieht in festen Abstaenden nach, ob sich an einer verknuepften Instanz etwas getan
// hat, und stoesst dann die Warteschlange aus autoSync.js an.
//
// Warum ein Takt und kein fs.watch: ein rekursiver Watcher auf einem Instanzordner
// bedeutet unter Linux einen inotify-Watch je Unterordner. Eine gewachsene Instanz hat
// davon zehntausende (assets, libraries, versions), und in einer Flatpak-Umgebung ist
// das Limit schnell erreicht -- der Watcher faellt dann still aus, also genau dort, wo
// man sich am meisten auf ihn verlassen wuerde. Der Takt hier kostet nur stat-Aufrufe
// auf den Ordnern, die ohnehin synchronisiert werden, und er ueberlebt jeden Neustart:
// der Vergleichswert steht in der lokalen Buchfuehrung, nicht im Arbeitsspeicher.

const { signatureOf } = require('./localChanges');

const DEFAULT_INTERVAL_MS = 45 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;

let timer = null;
let initialTimer = null;
let scanning = false;

let listCandidates = null;
let notify = null;
let intervalMs = DEFAULT_INTERVAL_MS;

// Was bereits gemeldet wurde, je Instanz. Ohne das wuerde jeder Takt dieselbe Aenderung
// erneut melden, und weil ein neuer Anstoss die Wartezeit in autoSync neu startet, haette
// ein Server, der gerade nicht erreichbar ist, seinen Backoff nie zu Ende gewartet.
const announced = new Map();

function configure({ candidates = null, onChanged = null, intervalMs: interval = null } = {}) {
    if (candidates) listCandidates = candidates;
    if (onChanged) notify = onChanged;
    if (Number.isFinite(interval) && interval > 0) intervalMs = interval;
}

function forget(instanceId) {
    return announced.delete(String(instanceId));
}

// Nach einer Aenderung an den Kontoeinstellungen: was beim letzten Mal abgelehnt wurde,
// weil der automatische Sync ausgeschaltet war, bekommt so eine zweite Chance, ohne dass
// der Nutzer die Datei noch einmal anfassen muss.
function forgetAll() {
    const count = announced.size;
    announced.clear();
    return count;
}

async function inspect(candidate) {
    const key = String(candidate.instanceId);

    let scanned;
    try {
        scanned = await signatureOf(candidate.instanceDir, candidate.options || {});
    } catch (err) {
        console.warn(`[LuxCloud] Could not check "${candidate.instanceName}" for changes: ${err.message}`);
        return null;
    }

    // Ein Ordner, in dem ploetzlich nichts Synchronisierbares mehr liegt, ist fast immer
    // ein Ordner, der gerade nicht da ist (externe Platte, Netzlaufwerk, ein Umzug, der
    // noch laeuft) -- und nicht eine Instanz, die der Nutzer leergeraeumt hat. Daraus von
    // selbst eine Revision zu machen, die in der Cloud alles loescht, waere der
    // schlimmste denkbare Ausgang dieser Automatik. Wer wirklich alles entfernt hat,
    // kommt weiterhin ueber "Jetzt synchronisieren" ans Ziel.
    if (scanned.files === 0) return null;

    if (scanned.signature === candidate.lastSignature) {
        announced.delete(key);
        return null;
    }
    if (announced.get(key) === scanned.signature) return null;

    announced.set(key, scanned.signature);
    return {
        ...candidate,
        signature: scanned.signature,
        files: scanned.files,
        // Eine Instanz aus der Zeit vor dieser Kontrolle hat noch keinen Vergleichswert.
        // Der erste Durchgang laedt sie deshalb einmal hoch; hat sich nichts geaendert,
        // endet das ohne neue Revision und der Vergleichswert steht danach.
        firstCheck: !candidate.lastSignature
    };
}

async function scan() {
    if (scanning) return { skipped: true, reason: 'already_running' };
    if (!listCandidates || !notify) return { skipped: true, reason: 'not_configured' };

    scanning = true;
    const changed = [];

    try {
        const candidates = await listCandidates();
        for (const candidate of candidates) {
            const hit = await inspect(candidate);
            if (!hit) continue;

            changed.push(hit);
            try {
                await notify(hit);
            } catch (err) {
                console.warn(`[LuxCloud] Could not queue "${hit.instanceName}": ${err.message}`);
            }
        }
        return { changed };
    } catch (err) {
        console.warn('[LuxCloud] The change check failed:', err.message);
        return { error: err };
    } finally {
        scanning = false;
    }
}

function start({ initialDelayMs = DEFAULT_INITIAL_DELAY_MS } = {}) {
    stop();

    // Der erste Durchgang holt nach, was passiert ist, waehrend der Launcher zu war --
    // aber nicht sofort beim Start, damit er sich nicht mit dem Aufbau des Fensters und
    // den Startmigrationen um die Platte streitet.
    initialTimer = setTimeout(() => { scan(); }, initialDelayMs);
    if (typeof initialTimer.unref === 'function') initialTimer.unref();

    timer = setInterval(() => { scan(); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    return true;
}

function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (timer) clearInterval(timer);
    initialTimer = null;
    timer = null;
    return true;
}

function isRunning() {
    return timer !== null;
}

function reset() {
    stop();
    announced.clear();
    listCandidates = null;
    notify = null;
    intervalMs = DEFAULT_INTERVAL_MS;
    scanning = false;
}

module.exports = {
    DEFAULT_INITIAL_DELAY_MS,
    DEFAULT_INTERVAL_MS,
    configure,
    forget,
    forgetAll,
    isRunning,
    reset,
    scan,
    start,
    stop
};
