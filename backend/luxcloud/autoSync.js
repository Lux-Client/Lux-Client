const { EventEmitter } = require('events');

const DEBOUNCE_MS = 30 * 1000;
const RETRY_BASE_MS = 5 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
const RETRY_STEPS = [5, 15, 60, 300, 900, 3600];

const events = new EventEmitter();

const pending = new Map();
const suspended = new Set();
const attempts = new Map();

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
}

function isSuspended(instanceName) {
    return suspended.has(instanceName);
}

function pendingInstances() {
    return [...pending.keys()];
}

async function execute(instanceName, reason) {
    if (!runner) return { skipped: true, reason: 'no-runner' };

    events.emit('start', { instanceName, reason });
    try {
        const result = await runner(instanceName, { reason });
        attempts.delete(instanceName);
        events.emit('done', { instanceName, reason, result });
        return result;
    } catch (err) {
        const count = (attempts.get(instanceName) || 0) + 1;
        attempts.set(instanceName, count);

        const retryable = err && (err.code === 'offline' || err.code === 'server_unreachable'
            || err.code === 'rate_limited' || err.code === 'server_error');

        events.emit('error', { instanceName, reason, error: err, attempt: count, retryable });

        if (retryable) {
            schedule(instanceName, { reason: `${reason}:retry`, delayMs: backoffFor(count) });
        }
        return { error: err };
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
        if (isSuspended(instanceName)) return;
        execute(instanceName, reason);
    }, delayMs);

    if (typeof timer.unref === 'function') timer.unref();
    pending.set(instanceName, { timer, reason });
    return true;
}

function notifyChanged(instanceName, reason = 'change') {
    return schedule(instanceName, { reason });
}

function cancel(instanceName) {
    const entry = pending.get(instanceName);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(instanceName);
    return true;
}

async function flush(instanceNames) {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;

    const names = Array.isArray(instanceNames) ? instanceNames : pendingInstances();
    const results = [];

    try {
        for (const name of names) {
            cancel(name);
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
    suspended.clear();
    attempts.clear();
    running = false;
    enabled = true;
    runner = null;
}

module.exports = {
    DEBOUNCE_MS,
    RETRY_BASE_MS,
    backoffFor,
    cancel,
    events,
    flush,
    isEnabled,
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
