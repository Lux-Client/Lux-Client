// @ts-nocheck
const vm = require('vm');
const path = require('path');

const LOAD_TIMEOUT_MS = 30000;
const INVOKE_TIMEOUT_MS = 60000;

const loadedExtensions = new Map();

function sendMessage(type, payload = {}) {
    if (typeof process.send === 'function') {
        process.send({ type, ...payload });
    }
}

function createRestrictedApi(id, apiConfig) {
    const api = { id };

    if (apiConfig?.ipc) {
        api.ipc = {
            handle: (channel, listener) => {
                const fullChannel = `ext:${id}:${channel}`;
                try {
                    process.removeListener(fullChannel);
                } catch (_) {}
            },
            on: (channel, listener) => {
                const fullChannel = `ext:${id}:${channel}`;
            },
            send: (channel, ...args) => {
                const fullChannel = `ext:${id}:${channel}`;
                sendMessage('ipc:send', { channel: fullChannel, args });
            }
        };
    }

    if (apiConfig?.events) {
        api.events = {
            emit: (event, ...args) => {
                sendMessage('event:emit', { event, args });
            },
            on: (event, listener) => {
            }
        };
    }

    if (apiConfig?.network) {
        try {
            api.axios = require('axios');
        } catch (_) {}
    }

    if (apiConfig?.filesystem) {
        try {
            api.fs = require('fs-extra');
        } catch (_) {}
        api.path = path;
    }

    return api;
}

function runWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        fn()
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

async function loadExtension(id, code, apiConfig) {
    if (loadedExtensions.has(id)) {
        throw new Error(`Extension ${id} already loaded`);
    }

    const sandbox = {
        module: { exports: {} },
        exports: {},
        require: (moduleName) => {
            const allowedModules = ['path', 'events', 'util'];
            if (apiConfig?.network && moduleName === 'axios') {
                return require('axios');
            }
            if (apiConfig?.filesystem && moduleName === 'fs-extra') {
                return require('fs-extra');
            }
            if (allowedModules.includes(moduleName)) {
                return require(moduleName);
            }
            throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
        },
        console: {
            log: (...args) => sendMessage('console:log', { args }),
            error: (...args) => sendMessage('console:error', { args }),
            warn: (...args) => sendMessage('console:warn', { args })
        },
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        Promise: global.Promise,
        JSON: global.JSON,
        Math: global.Math,
        Date: global.Date,
        Array: global.Array,
        Object: global.Object,
        String: global.String,
        Number: global.Number,
        Boolean: global.Boolean,
        RegExp: global.RegExp,
        Error: global.Error,
        TypeError: global.TypeError,
        RangeError: global.RangeError,
        SyntaxError: global.SyntaxError,
        URIError: global.URIError,
        EvalError: global.EvalError,
        ReferenceError: global.ReferenceError,
        isNaN: global.isNaN,
        isFinite: global.isFinite,
        parseInt: global.parseInt,
        parseFloat: global.parseFloat,
        undefined: global.undefined,
        NaN: global.NaN,
        Infinity: global.Infinity
    };

    const context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
        name: `extension-${id}`
    });

    const script = new vm.Script(code, {
        filename: `extension-${id}.js`,
        timeout: LOAD_TIMEOUT_MS
    });

    await runWithTimeout(async () => {
        script.runInContext(context);

        const extensionModule = sandbox.module.exports || sandbox.exports;

        if (typeof extensionModule.activate === 'function') {
            const api = createRestrictedApi(id, apiConfig);
            await extensionModule.activate(api);
        }

        loadedExtensions.set(id, {
            module: extensionModule,
            context,
            apiConfig
        });
    }, LOAD_TIMEOUT_MS);
}

function unloadExtension(id) {
    const extension = loadedExtensions.get(id);
    if (!extension) {
        return false;
    }

    try {
        if (typeof extension.module.deactivate === 'function') {
            extension.module.deactivate();
        }
    } catch (error) {
        sendMessage('error', {
            id,
            error: `Failed to deactivate extension: ${error.message}`
        });
    }

    try {
        vm.destroyContext(extension.context);
    } catch (_) {}

    loadedExtensions.delete(id);
    return true;
}

function invokeExtension(id, method, args) {
    const extension = loadedExtensions.get(id);
    if (!extension) {
        throw new Error(`Extension ${id} not loaded`);
    }

    if (typeof extension.module[method] !== 'function') {
        throw new Error(`Method '${method}' not found on extension ${id}`);
    }

    return extension.module[method](...(args || []));
}

function shutdown() {
    for (const [id] of loadedExtensions) {
        unloadExtension(id);
    }
    process.exit(0);
}

process.on('message', async (message) => {
    const type = String(message?.type || '');

    if (type === 'load') {
        const id = String(message?.id || '');
        const code = String(message?.code || '');
        const apiConfig = message?.apiConfig || {};

        if (!id || !code) {
            sendMessage('error', { error: 'Missing required fields: id, code' });
            return;
        }

        try {
            await loadExtension(id, code, apiConfig);
            sendMessage('loaded', { id });
        } catch (error) {
            sendMessage('error', {
                id,
                error: error?.message || 'Failed to load extension'
            });
        }
        return;
    }

    if (type === 'unload') {
        const id = String(message?.id || '');

        if (!id) {
            sendMessage('error', { error: 'Missing required field: id' });
            return;
        }

        const unloaded = unloadExtension(id);
        if (unloaded) {
            sendMessage('unloaded', { id });
        } else {
            sendMessage('error', {
                id,
                error: `Extension ${id} not found`
            });
        }
        return;
    }

    if (type === 'invoke') {
        const id = String(message?.id || '');
        const method = String(message?.method || '');
        const args = message?.args || [];

        if (!id || !method) {
            sendMessage('error', { error: 'Missing required fields: id, method' });
            return;
        }

        try {
            const result = await runWithTimeout(
                () => Promise.resolve(invokeExtension(id, method, args)),
                INVOKE_TIMEOUT_MS
            );
            sendMessage('result', { id, method, result });
        } catch (error) {
            sendMessage('error', {
                id,
                method,
                error: error?.message || 'Failed to invoke method'
            });
        }
        return;
    }

    if (type === 'shutdown') {
        shutdown();
        return;
    }

    sendMessage('error', { error: `Unknown message type: ${type}` });
});

process.on('uncaughtException', (error) => {
    sendMessage('error', {
        error: error?.message || 'Uncaught exception in extension worker'
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message
        ? reason.message
        : String(reason || 'Unhandled rejection in extension worker');
    sendMessage('error', { error: message });
    process.exit(1);
});
