// @ts-nocheck
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const JSZip = require('jszip');
const { transform } = require('sucrase');
const { fork } = require('child_process');
const { getAllInstanceDirsSync } = require('../utils/instances-path');
const { isPathInside, validateExtensionId, sanitizeIconPath } = require('../utils/path-safety');
const { validateManifest } = require('../utils/manifest-schema');
const { buildCapabilityConfig, CAPABILITY_DEFINITIONS } = require('../utils/capabilities');

const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_ZIP_FILE_COUNT = 500;
const WORKER_SPAWN_TIMEOUT = 30000; // 30 seconds

module.exports = (ipcMain, mainWindow) => {
    const extensionsDir = path.join(app.getPath('userData'), 'extensions');
    const configPath = path.join(app.getPath('userData'), 'extensions.json');
    fs.ensureDirSync(extensionsDir);

    const activeBackendExtensions = new Map();
    const extensionWorkers = new Map(); // id → worker process
    const pendingWorkerInvokes = new Map(); // invokeId → { resolve, reject, timer }

    /**
     * Get the path to the extension worker script.
     */
    const getWorkerScriptPath = () => {
        return path.join(__dirname, '..', 'workers', 'extensionWorker.js');
    };

    /**
     * Forward an invoke call to the extension worker and wait for the result.
     */
    const forwardToWorker = (id, method, args) => {
        const worker = extensionWorkers.get(id);
        if (!worker || worker.killed) {
            return Promise.reject(new Error(`Extension worker for ${id} is not running`));
        }

        const invokeId = `${id}_${method}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingWorkerInvokes.delete(invokeId);
                reject(new Error(`Worker invoke timeout for ${method}`));
            }, WORKER_SPAWN_TIMEOUT);

            pendingWorkerInvokes.set(invokeId, { resolve, reject, timer });

            worker.send({
                type: 'invoke',
                id,
                method,
                args: args || [],
                invokeId
            });
        });
    };

    /**
     * Handle messages received from an extension worker subprocess.
     */
    const handleWorkerMessage = (id, message) => {
        const type = String(message?.type || '');

        // Forward IPC send calls to the renderer process
        if (type === 'ipc:send') {
            const win = mainWindow || require('electron').BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed()) {
                win.webContents.send(message.channel, ...(message.args || []));
            }
            return;
        }

        // Forward event emissions to ipcMain and renderer
        if (type === 'event:emit') {
            const eventName = message.event;
            const eventArgs = message.args || [];
            ipcMain.emit(`ext-event:${eventName}`, ...eventArgs);
            const win = mainWindow || require('electron').BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed()) {
                win.webContents.send(`ext-event:${eventName}`, ...eventArgs);
            }
            return;
        }

        // Forward console output from worker
        if (type === 'console:log' || type === 'console:error' || type === 'console:warn') {
            const logFn = type === 'console:error' ? console.error
                : type === 'console:warn' ? console.warn
                : console.log;
            logFn(`[Extension ${id}]`, ...(message.args || []));
            return;
        }

        // Handle IPC handler registrations from the worker
        // When the extension calls api.ipc.handle() in the worker, the worker sends this message
        // so the main process can register the actual Electron IPC handler
        if (type === 'ipc:register-handler') {
            const channel = message.channel;
            const fullChannel = `ext:${id}:${channel}`;
            try { ipcMain.removeHandler(fullChannel); } catch (e) { /* ignore */ }
            ipcMain.handle(fullChannel, async (event, ...args) => {
                return forwardToWorker(id, `__ipc_handle_${channel}`, args);
            });
            return;
        }

        // Handle IPC listener registrations from the worker
        if (type === 'ipc:register-listener') {
            const channel = message.channel;
            const fullChannel = `ext:${id}:${channel}`;
            ipcMain.removeAllListeners(fullChannel);
            ipcMain.on(fullChannel, (event, ...args) => {
                forwardToWorker(id, `__ipc_on_${channel}`, args);
            });
            return;
        }

        // Resolve pending invoke calls
        if (type === 'result') {
            const invokeId = message.invokeId;
            if (invokeId && pendingWorkerInvokes.has(invokeId)) {
                const pending = pendingWorkerInvokes.get(invokeId);
                clearTimeout(pending.timer);
                pendingWorkerInvokes.delete(invokeId);
                pending.resolve(message.result);
            }
            return;
        }

        // Handle errors from worker
        if (type === 'error') {
            const invokeId = message.invokeId;
            if (invokeId && pendingWorkerInvokes.has(invokeId)) {
                const pending = pendingWorkerInvokes.get(invokeId);
                clearTimeout(pending.timer);
                pendingWorkerInvokes.delete(invokeId);
                pending.reject(new Error(message.error || 'Worker error'));
            }
            return;
        }
    };

    /**
     * Stop an extension worker process and clean up references.
     */
    const stopExtensionWorker = (id) => {
        const worker = extensionWorkers.get(id);
        if (!worker) return;

        extensionWorkers.delete(id);

        // Reject any pending invokes for this extension
        for (const [invokeId, pending] of pendingWorkerInvokes) {
            if (invokeId.startsWith(`${id}_`)) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Extension worker stopped'));
                pendingWorkerInvokes.delete(invokeId);
            }
        }

        try {
            worker.removeAllListeners();
            if (!worker.killed) {
                worker.kill('SIGTERM');
            }
        } catch (e) {
            console.warn(`[Extensions] Failed to stop worker for ${id}:`, e.message);
        }
    };

    /**
     * Create a proxy API that presents the same surface as the original createBackendApi.
     * IPC calls are forwarded to the worker subprocess; events are proxied between
     * the worker and the main process. The proxy preserves backward compatibility
     * with existing extension APIs.
     */
    const createBackendApi = (id) => {
        const sendToWorker = (message) => {
            const worker = extensionWorkers.get(id);
            if (worker && !worker.killed) {
                worker.send(message);
            }
        };

        return {
            ipc: {
                handle: (channel, listener) => {
                    const fullChannel = `ext:${id}:${channel}`;
                    try { ipcMain.removeHandler(fullChannel); } catch (e) { /* ignore */ }

                    // Register the handler on the main process.
                    // When invoked, it forwards the call to the worker subprocess
                    // where the extension's actual listener runs.
                    ipcMain.handle(fullChannel, async (event, ...args) => {
                        return forwardToWorker(id, `__ipc_handle_${channel}`, args);
                    });

                    // Also register the listener locally as a fallback in case
                    // the worker is not available or doesn't support IPC forwarding.
                    // This ensures backward compatibility for extensions that expect
                    // synchronous handler registration.
                    const fallbackKey = `__fallback_handler_${fullChannel}`;
                    activeBackendExtensions.get(id)?.fallbackHandlers?.set(fallbackKey, listener);
                },
                on: (channel, listener) => {
                    const fullChannel = `ext:${id}:${channel}`;
                    ipcMain.removeAllListeners(fullChannel);

                    // Register the listener on the main process.
                    // When an event arrives, it's forwarded to the worker.
                    ipcMain.on(fullChannel, (event, ...args) => {
                        forwardToWorker(id, `__ipc_on_${channel}`, args);
                    });
                },
                send: (channel, ...args) => {
                    const fullChannel = `ext:${id}:${channel}`;
                    // Forward the send to the worker so it can be relayed to the renderer
                    sendToWorker({
                        type: 'ipc:send',
                        channel: fullChannel,
                        args
                    });
                }
            },
            events: {
                emit: (event, ...args) => {
                    // Forward event emission to the worker
                    sendToWorker({
                        type: 'event:emit',
                        event,
                        args
                    });
                    // Also emit locally and forward to renderer for backward compat
                    ipcMain.emit(`ext-event:${event}`, ...args);
                    const win = mainWindow || require('electron').BrowserWindow.getAllWindows()[0];
                    if (win && !win.isDestroyed()) {
                        win.webContents.send(`ext-event:${event}`, ...args);
                    }
                },
                on: (event, listener) => {
                    const fullEvent = `ext-event:${event}`;
                    ipcMain.on(fullEvent, listener);
                }
            },
            launcher: {
                getInstances: () => {
                    const names = new Set();
                    const baseDirs = getAllInstanceDirsSync();

                    for (const instDir of baseDirs) {
                        if (!fs.existsSync(instDir)) continue;

                        const dirs = fs.readdirSync(instDir);
                        for (const dirName of dirs) {
                            const instancePath = path.join(instDir, dirName);
                            const configPath = path.join(instancePath, 'instance.json');

                            try {
                                if (fs.statSync(instancePath).isDirectory() && fs.existsSync(configPath)) {
                                    names.add(dirName);
                                }
                            } catch (_) {
                                // Ignore read errors for individual instances
                            }
                        }
                    }

                    return Array.from(names);
                }
            },
            app,
            id,
            axios,
            fs,
            path
        };
    };

    /**
     * Load an extension's backend code in an isolated worker subprocess.
     * Reads the extension code, capability config from manifest, forks the worker,
     * and waits for the worker to confirm the extension is loaded.
     */
    const loadBackend = async (id, extensionPath) => {
        const backendPath = path.join(extensionPath, 'backend.js');

        const resolvedBackendPath = path.resolve(backendPath);
        if (!isPathInside(extensionsDir, resolvedBackendPath)) {
            console.error(`[Extensions] Blocked attempt to load backend outside extensions directory: ${resolvedBackendPath}`);
            return;
        }

        if (await fs.pathExists(resolvedBackendPath)) {
            try {
                console.log(`[Extensions] Loading backend for ${id} in worker subprocess...`);

                // Read manifest to build capability config
                const manifestPath = path.join(extensionPath, 'manifest.json');
                let capabilityConfig = null;
                if (await fs.pathExists(manifestPath)) {
                    try {
                        const manifest = await fs.readJson(manifestPath);
                        const result = buildCapabilityConfig(manifest);
                        capabilityConfig = result.capabilities;

                        if (result.warnings.length > 0) {
                            console.warn(`[Extensions] Capability warnings for ${id}:`, result.warnings);
                        }
                        if (result.unknown.length > 0) {
                            console.warn(`[Extensions] Unknown capabilities requested by ${id}:`, result.unknown);
                        }
                    } catch (e) {
                        console.warn(`[Extensions] Failed to read manifest for capability config (${id}):`, e.message);
                    }
                }

                // Read the extension source code to send to the worker
                const backendCode = await fs.readFile(resolvedBackendPath, 'utf-8');

                // Fork the extension worker subprocess
                const workerScript = getWorkerScriptPath();
                const worker = fork(workerScript, [], {
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
                });

                extensionWorkers.set(id, worker);

                // Set up message handler for this worker
                worker.on('message', (message) => {
                    handleWorkerMessage(id, message);
                });

                worker.on('error', (error) => {
                    console.error(`[Extensions] Worker error for ${id}:`, error.message);
                    stopExtensionWorker(id);
                });

                worker.on('exit', (code, signal) => {
                    console.log(`[Extensions] Worker for ${id} exited with code ${code}, signal ${signal}`);
                    extensionWorkers.delete(id);
                });

                // Wait for the worker to confirm the extension is loaded
                const loadResult = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        worker.removeListener('message', onLoadMessage);
                        stopExtensionWorker(id);
                        reject(new Error(`Extension worker spawn timeout for ${id} after ${WORKER_SPAWN_TIMEOUT}ms`));
                    }, WORKER_SPAWN_TIMEOUT);

                    const onLoadMessage = (message) => {
                        if (message.type === 'loaded' && message.id === id) {
                            clearTimeout(timer);
                            worker.removeListener('message', onLoadMessage);
                            resolve({ success: true });
                        } else if (message.type === 'error' && message.id === id) {
                            clearTimeout(timer);
                            worker.removeListener('message', onLoadMessage);
                            reject(new Error(message.error || 'Failed to load extension in worker'));
                        }
                    };

                    worker.on('message', onLoadMessage);

                    // Send the load command to the worker
                    worker.send({
                        type: 'load',
                        id,
                        code: backendCode,
                        apiConfig: capabilityConfig
                    });
                });

                console.log(`[Extensions] Backend for ${id} loaded successfully in worker`);

                // Store the active extension with worker reference
                activeBackendExtensions.set(id, {
                    worker,
                    capabilityConfig,
                    fallbackHandlers: new Map()
                });
            } catch (e) {
                console.error(`[Extensions] Failed to load backend for ${id}:`, e);
                stopExtensionWorker(id);
            }
        }
    };

    /**
     * Unload an extension's backend by sending an unload message to the worker,
     * waiting for confirmation, then killing the worker process.
     */
    const unloadBackend = async (id) => {
        const active = activeBackendExtensions.get(id);
        if (!active) return;

        const worker = active.worker;

        if (worker && !worker.killed) {
            try {
                // Send unload command and wait for confirmation
                await new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        worker.removeListener('message', onUnloadMessage);
                        resolve(); // Proceed with cleanup even on timeout
                    }, 5000); // 5 second timeout for unload

                    const onUnloadMessage = (message) => {
                        if (message.type === 'unloaded' && message.id === id) {
                            clearTimeout(timer);
                            worker.removeListener('message', onUnloadMessage);
                            resolve();
                        }
                    };

                    worker.on('message', onUnloadMessage);

                    worker.send({
                        type: 'unload',
                        id
                    });
                });
            } catch (e) {
                console.error(`[Extensions] Error during unload for ${id}:`, e);
            }
        }

        // Clean up IPC handlers registered by this extension
        const suffix = `:${id}:`;
        const handlerNames = ipcMain._eventsCount ? Object.keys(ipcMain._events || {}) : [];
        for (const name of handlerNames) {
            if (name.includes(suffix) || name.startsWith(`ext-event:`)) {
                try { ipcMain.removeAllListeners(name); } catch (_) { /* ignore */ }
            }
        }

        // Stop the worker process
        stopExtensionWorker(id);

        // Clean up fallback handlers
        active.fallbackHandlers?.clear();

        activeBackendExtensions.delete(id);
        console.log(`[Extensions] Backend for ${id} unloaded`);
    };

    const loadConfig = async () => {
        try {
            if (await fs.pathExists(configPath)) {
                return await fs.readJson(configPath);
            }
        } catch (e) { console.error("Failed to load extensions config", e); }
        return { enabled: {} };
    };
    const saveConfig = async (config) => {
        try {
            await fs.writeJson(configPath, config, { spaces: 2 });
        } catch (e) { console.error("Failed to save extensions config", e); }
    };
    ipcMain.handle('extensions:list', async () => {
        try {
            const dirs = await fs.readdir(extensionsDir);
            const extensions = [];
            const config = await loadConfig();

            for (const dir of dirs) {
                const manifestPath = path.join(extensionsDir, dir, 'manifest.json');
                if (await fs.pathExists(manifestPath)) {
                    try {
                        const manifest = await fs.readJson(manifestPath);

                        if (!manifest.main && manifest.entry) {
                            manifest.main = manifest.entry;
                        }

                        if (manifest.main) {
                            manifest.main = manifest.main.replace(/\.(jsx|tsx)$/, '.js');
                        }
                        const isEnabled = config.enabled[dir] !== false;
                        let iconPath = null;
                        if (manifest.icon) {
                            const iconCheck = sanitizeIconPath(path.join(extensionsDir, dir), manifest.icon);
                            if (iconCheck.valid) {
                                iconPath = iconCheck.resolvedPath.replace(/\\/g, '/');
                            } else {
                                console.warn(`[Extensions] Skipping invalid icon path for ${dir}: ${iconCheck.error}`);
                            }
                        }

                        extensions.push({
                            id: dir,
                            ...manifest,
                            enabled: isEnabled,
                            iconPath: iconPath,
                            localPath: path.join(extensionsDir, dir).replace(/\\/g, '/')
                        });
                    } catch (e) {
                        console.error(`Failed to read manifest for extension ${dir}`, e);
                    }
                }
            }
            return { success: true, extensions };
        } catch (error) {
            console.error('Failed to list extensions:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:toggle', async (_, id, enabled) => {
        try {
            const idCheck = validateExtensionId(id);
            if (!idCheck.valid) {
                return { success: false, error: idCheck.error };
            }

            const config = await loadConfig();
            config.enabled[id] = enabled;
            await saveConfig(config);

            if (enabled) {
                const targetPath = path.join(extensionsDir, id);
                await loadBackend(id, targetPath);
            } else {
                await unloadBackend(id);
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:install', async (_, sourcePath) => {
        try {
            let buffer;
            if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
                // NOTE: SSRF consideration — renderer could pass internal URLs (e.g., http://localhost:xxxx).
                // In production, consider restricting to known domains or requiring user confirmation.
                const response = await axios.get(sourcePath, { responseType: 'arraybuffer' });
                buffer = response.data;
            } else {
                // Local file path validation to prevent arbitrary file reads

                // 1. Reject null bytes (prevents null byte injection attacks)
                if (sourcePath.includes('\0')) {
                    return { success: false, error: 'Invalid source path' };
                }

                // 2. Require .zip extension to prevent reading non-archive files
                if (!sourcePath.toLowerCase().endsWith('.zip')) {
                    return { success: false, error: 'Source file must be a ZIP archive' };
                }

                // 3. Reject path traversal attempts (.. segments)
                const segments = sourcePath.split(/[/\\]/);
                if (segments.some(segment => segment === '..')) {
                    return { success: false, error: 'Invalid source path' };
                }

                // 4. Resolve symlinks to prevent symlink escapes
                let realPath;
                try {
                    realPath = fs.realpathSync(sourcePath);
                } catch (e) {
                    // If file doesn't exist, realpathSync will throw ENOENT.
                    // That's fine - fs.readFile will also throw ENOENT.
                    realPath = sourcePath;
                }

                buffer = await fs.readFile(realPath);
            }

            if (buffer.length > MAX_ZIP_SIZE_BYTES) {
                return { success: false, error: `ZIP file exceeds maximum size of ${MAX_ZIP_SIZE_BYTES / (1024 * 1024)}MB` };
            }

            const zip = await JSZip.loadAsync(buffer);

            const zipFileCount = Object.keys(zip.files).length;
            if (zipFileCount > MAX_ZIP_FILE_COUNT) {
                return { success: false, error: `ZIP contains ${zipFileCount} files, exceeding the maximum of ${MAX_ZIP_FILE_COUNT}` };
            }

            const manifestFile = zip.file('manifest.json');
            if (!manifestFile) {
                return { success: false, error: 'Invalid extension: missing manifest.json' };
            }

            const manifestContent = await manifestFile.async('text');
            const manifest = JSON.parse(manifestContent);

            const manifestValidation = validateManifest(manifest);
            if (!manifestValidation.valid) {
                return { success: false, error: `Invalid manifest: ${manifestValidation.error}` };
            }

            if (!manifest.id) {
                manifest.id = (manifest.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]/g, '-');
            }

            const idCheck = validateExtensionId(manifest.id);
            if (!idCheck.valid) {
                return { success: false, error: `Invalid extension ID: ${idCheck.error}` };
            }

            const entryFile = manifest.main || manifest.entry || 'index.js';
            const entryBasename = entryFile.replace(/\.(js|jsx|tsx)$/, '');
            const hasEntry = zip.file(entryFile) ||
                zip.file(`${entryBasename}.jsx`) ||
                zip.file(`${entryBasename}.tsx`);

            if (!hasEntry) {
                return { success: false, error: `Invalid extension: missing entry file (${entryFile}) in root` };
            }
            const installPath = path.join(extensionsDir, manifest.id);
            await fs.ensureDir(installPath);
            for (const filename of Object.keys(zip.files)) {
                if (zip.files[filename].dir) continue;

                const normalizedFilename = path.normalize(filename);
                if (normalizedFilename.startsWith('..') || path.isAbsolute(normalizedFilename)) {
                    console.warn(`[Extensions] Skipping suspicious file in ZIP: ${filename}`);
                    continue;
                }

                const fileData = await zip.files[filename].async('nodebuffer');
                const destPath = path.join(installPath, normalizedFilename);

                if (!isPathInside(installPath, destPath)) {
                    console.warn(`[Extensions] Blocked attempt to write outside install directory: ${destPath}`);
                    continue;
                }

                await fs.ensureDir(path.dirname(destPath));
                if (filename.endsWith('.jsx') || filename.endsWith('.tsx') || filename.endsWith('.js')) {
                    const code = fileData.toString('utf-8');
                    try {
                        const compiled = transform(code, {
                            transforms: ['jsx', 'imports'],
                            filePath: filename
                        });

                        const jsPath = destPath.replace(/\.(jsx|tsx)$/, '.js');
                        await fs.writeFile(jsPath, compiled.code);
                    } catch (e) {
                        console.error(`Failed to transpile ${filename}:`, e);

                        await fs.writeFile(destPath, fileData);
                    }
                } else {
                    await fs.writeFile(destPath, fileData);
                }
            }
            const config = await loadConfig();
            config.enabled[manifest.id] = true;
            await saveConfig(config);

            return { success: true, id: manifest.id };
        } catch (error) {
            console.error('Failed to install extension:', error);
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('extensions:remove', async (_, extensionId) => {
        try {
            const idCheck = validateExtensionId(extensionId);
            if (!idCheck.valid) {
                return { success: false, error: idCheck.error };
            }

            const targetPath = path.join(extensionsDir, extensionId);
            if (await fs.pathExists(targetPath)) {
                // Unload the extension worker before removing files
                await unloadBackend(extensionId);

                await fs.remove(targetPath);
                const config = await loadConfig();
                delete config.enabled[extensionId];
                await saveConfig(config);

                return { success: true };
            }
            return { success: false, error: 'Extension not found' };
        } catch (error) {
            console.error('Failed to remove extension:', error);
            return { success: false, error: error.message };
        }
    });
    const initBackends = async () => {
        const config = await loadConfig();
        const dirs = await fs.readdir(extensionsDir);
        for (const id of dirs) {
            if (config.enabled[id] !== false) {
                await loadBackend(id, path.join(extensionsDir, id));
            }
        }
    };
    initBackends();

    ipcMain.handle('extensions:fetch-marketplace', async () => {
        return { success: true, extensions: [] };
    });
};
