const { Client } = require('minecraft-launcher-core');

let launcher = null;
let started = false;

function sendMessage(type, payload = {}) {
    if (typeof process.send === 'function') {
        process.send({ type, ...payload });
    }
}

async function startLaunch(instanceName, opts) {
    if (started) {
        sendMessage('launch-error', { error: `Launch worker already running for ${instanceName}` });
        return;
    }

    started = true;
    launcher = new Client();

    launcher.on('debug', (line) => {
        sendMessage('debug', { line: String(line ?? '') });
    });

    launcher.on('data', (line) => {
        sendMessage('data', { line: String(line ?? '') });
    });

    launcher.on('stderr', (line) => {
        sendMessage('stderr', { line: String(line ?? '') });
    });

    launcher.on('progress', (payload) => {
        sendMessage('progress', { payload: payload || {} });
    });

    launcher.on('arguments', () => {
        sendMessage('arguments');
    });

    launcher.on('close', (code, signal) => {
        sendMessage('close', { code, signal });
        process.exit(0);
    });

    try {
        const proc = await launcher.launch(opts);
        if (!proc || !proc.pid) {
            sendMessage('launch-error', { error: 'No process returned from launcher.launch.' });
            process.exit(1);
            return;
        }

        proc.on('close', (code, signal) => {
            sendMessage('close', { code, signal });
            process.exit(0);
        });

        proc.on('exit', (code, signal) => {
            sendMessage('close', { code, signal });
            process.exit(0);
        });

        sendMessage('spawn', { pid: proc.pid });
    } catch (error) {
        sendMessage('launch-error', { error: error?.message || 'Unknown launch error in worker' });
        process.exit(1);
    }
}

process.on('message', async (message) => {
    const type = String(message?.type || '');
    if (type === 'start') {
        const instanceName = String(message?.instanceName || 'unknown');
        const opts = message?.opts || {};
        await startLaunch(instanceName, opts);
        return;
    }

    if (type === 'shutdown') {
        process.exit(0);
    }
});

process.on('uncaughtException', (error) => {
    sendMessage('launch-error', { error: error?.message || 'Uncaught exception in launch worker' });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message ? reason.message : String(reason || 'Unhandled rejection in launch worker');
    sendMessage('launch-error', { error: message });
    process.exit(1);
});
