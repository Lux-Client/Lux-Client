const { EventEmitter } = require('events');

const DEBOUNCE_MS = 30 * 1000;

// Nach dem Spielen ist laenger zu sammeln sinnlos: das Spiel ist zu und schreibt nichts
// mehr. Wer den Launcher direkt nach dem Beenden mitschliesst, verlor mit den vollen 30
// Sekunden sonst regelmaessig genau die Sitzung, die er gerade gespielt hat.
const AFTER_PLAY_DEBOUNCE_MS = 8 * 1000;
const RETRY_BASE_MS = 5 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
const RETRY_STEPS = [5, 15, 60, 300, 900, 3600];

const events = new EventEmitter();

const pending = new Map();
const suspended = new Set();
const attempts = new Map();
const inFlight = new Set();
// Faellig gewordene Laeufe einer pausierten Instanz. Sie wurden frueher still verworfen --
// die Oberflaeche zeigte weiter "wartet auf Sync", aber nichts kam je wieder.
const deferred = new Map();

let runner = null;
let running = false;
let enabled = true;

function backoffFor(count) {
    const seconds = RETRY_STEPS[Math.min(count, RETRY_STEPS.length - 1)];
    return Math.min(seconds * 1000, RETRY_MAX_MS);
}

function setRunner(fn) {
    runner = fn;
}

function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
        for (const entry of pending.values()) {
            if (entry.timer) clearTimeout(entry.timer);
        }
        pending.clear();
        deferred.clear();
    }
}

function isEnabled() {
    return enabled;
}

function suspend(instanceName) {
    suspended.add(instanceName);
}

function resume(instanceName) {
    suspended.delete(instanceName);

    const reason = deferred.get(instanceName);
    if (reason === undefined) return;
    deferred.delete(instanceName);
    // Laeuft schon ein neuer Anstoss (etwa 'after-play'), traegt der die Aenderung mit.
    if (!pending.has(instanceName)) {
        schedule(instanceName, { reason, delayMs: AFTER_PLAY_DEBOUNCE_MS });
    }
}

function isSuspended(instanceName) {
    return suspended.has(instanceName);
}

function pendingInstances() {
    return [...pending.keys()];
}

// Ob fuer die Instanz schon etwas eingeplant ist, laeuft oder auf das Ende einer Pause wartet.
function isQueued(instanceName) {
    return pending.has(instanceName) || inFlight.has(instanceName) || deferred.has(instanceName);
}

async function execute(instanceName, reason) {
    if (!runner) return { skipped: true, reason: 'no-runner' };

    if (inFlight.has(instanceName)) {
        schedule(instanceName, { reason, delayMs: AFTER_PLAY_DEBOUNCE_MS });
        return { skipped: true, reason: 'already_running' };
    }
    inFlight.add(instanceName);

    events.emit('start', { instanceName, reason });
    console.log(`[LuxCloud] Auto-sync starting for "${instanceName}" (${reason}).`);
    try {
        const result = await runner(instanceName, { reason });
        attempts.delete(instanceName);
        events.emit('done', { instanceName, reason, result });
        console.log(result && result.skipped
            ? `[LuxCloud] Auto-sync for "${instanceName}" did nothing: ${result.reason}.`
            : `[LuxCloud] Auto-sync for "${instanceName}" finished at revision ${result && result.revision}.`);
        return result;
    } catch (err) {
        const count = (attempts.get(instanceName) || 0) + 1;
        attempts.set(instanceName, count);

        const retryable = err && (err.code === 'offline' || err.code === 'server_unreachable'
            || err.code === 'timeout' || err.code === 'rate_limited' || err.code === 'server_error');

        events.emit('error', { instanceName, reason, error: err, attempt: count, retryable });
        console.warn(`[LuxCloud] Auto-sync for "${instanceName}" failed (${err && err.code}): ${err && err.message}`
            + `${retryable ? ` - retrying in ${Math.round(backoffFor(count) / 1000)}s.` : ''}`);

        if (retryable) {
            schedule(instanceName, { reason: `${reason}:retry`, delayMs: backoffFor(count) });
        }
        return { error: err };
    } finally {
        inFlight.delete(instanceName);
    }
}

function schedule(instanceName, { reason = 'change', delayMs = DEBOUNCE_MS, immediate = false } = {}) {
    if (!enabled || !instanceName) return false;
    if (isSuspended(instanceName)) return false;

    const existing = pending.get(instanceName);
    if (existing && existing.timer) clearTimeout(existing.timer);

    if (immediate) {
        pending.delete(instanceName);
        return execute(instanceName, reason);
    }

    const timer = setTimeout(() => {
        pending.delete(instanceName);
        if (isSuspended(instanceName)) {
            deferred.set(instanceName, reason);
            return;
        }
        execute(instanceName, reason);
    }, delayMs);

    if (typeof timer.unref === 'function') timer.unref();
    pending.set(instanceName, { timer, reason });

    // Damit die Oberflaeche sagen kann, dass etwas ansteht. Ohne dieses Ereignis war ein
    // eingeplanter Upload von "es passiert gar nichts" nicht zu unterscheiden -- weder im
    // Statusabzeichen der Instanz noch im Log.
    events.emit('scheduled', { instanceName, reason, delayMs });
    console.log(`[LuxCloud] Auto-sync queued for "${instanceName}" (${reason}) in ${Math.round(delayMs / 1000)}s.`);
    return true;
}

function notifyChanged(instanceName, reason = 'change', { delayMs = DEBOUNCE_MS } = {}) {
    return schedule(instanceName, { reason, delayMs });
}

function cancel(instanceName) {
    const hadDeferred = deferred.delete(instanceName);
    const entry = pending.get(instanceName);
    if (!entry) {
        if (hadDeferred) events.emit('cancelled', { instanceName });
        return hadDeferred;
    }
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(instanceName);
    // Ohne diese Meldung blieb das "wartet auf Sync" in der Oberflaeche einfach stehen.
    events.emit('cancelled', { instanceName, reason: entry.reason });
    return true;
}

async function flush(instanceNames) {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;

    const names = Array.isArray(instanceNames) ? instanceNames : pendingInstances();
    const results = [];

    try {
        for (const name of names) {
            const entry = pending.get(name);
            if (entry && entry.timer) clearTimeout(entry.timer);
            pending.delete(name);
            if (isSuspended(name)) continue;
            results.push({ instanceName: name, result: await execute(name, 'flush') });
        }
        return { results };
    } finally {
        running = false;
    }
}

function reset() {
    for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();
    deferred.clear();
    suspended.clear();
    attempts.clear();
    inFlight.clear();
    running = false;
    enabled = true;
    runner = null;
}

module.exports = {
    AFTER_PLAY_DEBOUNCE_MS,
    DEBOUNCE_MS,
    RETRY_BASE_MS,
    backoffFor,
    cancel,
    events,
    flush,
    isEnabled,
    isQueued,
    isSuspended,
    notifyChanged,
    pendingInstances,
    reset,
    resume,
    schedule,
    setEnabled,
    setRunner,
    suspend
};
