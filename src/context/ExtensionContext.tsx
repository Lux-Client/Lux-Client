import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNotification } from './NotificationContext';
const generateId = () => Math.random().toString(36).substr(2, 9);

const ExtensionContext = createContext<any>(null);
const EXTENSIONS_ENABLED = true;

export const useExtensions = () => useContext(ExtensionContext);

export const ExtensionProvider = ({ children }: { children: React.ReactNode }) => {
    const [installedExtensions, setInstalledExtensions] = useState([]);
    const [activeExtensions, setActiveExtensions] = useState<Record<string, any>>({});
    const [views, setViews] = useState<Record<string, any[]>>({});
    const [hooks, setHooks] = useState<Record<string, any[]>>({});
    const [injectedStyles, setInjectedStyles] = useState<Record<string, HTMLStyleElement>>({});
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const createExtensionApi = (extensionId, localPath) => {
        const api = {
            ui: {
                registerView: (slotName, component) => {
                    setViews(prev => {
                        const slotViews = prev[slotName] || [];

                        const filteredViews = slotViews.filter(v => v.extensionId !== extensionId);
                        return {
                            ...prev,
                            [slotName]: [...filteredViews, { id: generateId(), extensionId, component, api }]
                        };
                    });
                },
                toast: (message, type = 'info') => {
                    console.log(`[Extension:${extensionId}] Toast: ${message} (${type})`);
                    if (addNotification) {
                        addNotification(`[${extensionId}] ${message}`, type);
                    }
                },
                injectStyle: (css: string) => {
                    const styleId = `ext-style-${extensionId}`;
                    let styleEl = document.getElementById(styleId) as HTMLStyleElement;
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = styleId;
                        document.head.appendChild(styleEl);
                    }
                    styleEl.textContent = css;
                    setInjectedStyles(prev => ({ ...prev, [extensionId]: styleEl }));
                }
            },

            hooks: {
                register: (point: string, handler: Function) => {
                    setHooks(prev => {
                        const pointHooks = prev[point] || [];
                        return {
                            ...prev,
                            [point]: [...pointHooks, { extensionId, handler }]
                        };
                    });
                },
                run: async (point: string, data: any) => {
                    const pointHooks = hooks[point] || [];
                    let currentData = data;
                    for (const hook of pointHooks) {
                        try {
                            const result = await hook.handler(currentData);
                            if (result !== undefined) currentData = result;
                        } catch (e) {
                            console.error(`[Extension:${hook.extensionId}] Hook error in ${point}:`, e);
                        }
                    }
                    return currentData;
                }
            },

            ipc: {
                invoke: (channel, ...args) => {
                    const coreMethod = channel.replace(/:/g, '_');
                    if (window.electronAPI[channel]) return window.electronAPI[channel](...args);
                    return window.electronAPI.invokeExtension(extensionId, channel, ...args);
                },
                on: (channel, callback) => {
                    return window.electronAPI.onExtensionMessage(extensionId, channel, callback);
                }
            },

            launcher: {
                getActiveProcesses: () => window.electronAPI.getActiveProcesses(),
                getProcessStats: (pid) => window.electronAPI.getProcessStats(pid),
            },

            storage: {
                get: (key) => {
                    try {
                        const data = localStorage.getItem(`ext:${extensionId}:${key}`);
                        return data ? JSON.parse(data) : null;
                    } catch (e) { return null; }
                },
                set: (key, value) => {
                    localStorage.setItem(`ext:${extensionId}:${key}`, JSON.stringify(value));
                }
            },

            meta: { id: extensionId, localPath: localPath }
        };
        return api;
    };
    const unloadExtension = async (extensionId) => {
        const active = activeExtensions[extensionId];
        if (!active) return;

        console.log(`[Extension] Unloading ${extensionId}...`);
        if (active.exports && typeof active.exports.deactivate === 'function') {
            try {
                await active.exports.deactivate();
            } catch (e) {
                console.error(`[Extension] Error during deactivate for ${extensionId}:`, e);
            }
        }

        // Remove style
        const styleEl = injectedStyles[extensionId];
        if (styleEl) {
            styleEl.remove();
            setInjectedStyles(prev => {
                const next = { ...prev };
                delete next[extensionId];
                return next;
            });
        }

        setViews(prev => {
            const next: Record<string, any[]> = {};
            for (const [slot, items] of Object.entries(prev)) {
                next[slot] = items.filter(item => item.extensionId !== extensionId);
            }
            return next;
        });

        setHooks(prev => {
            const next: Record<string, any[]> = {};
            for (const [point, items] of Object.entries(prev)) {
                next[point] = items.filter(item => item.extensionId !== extensionId);
            }
            return next;
        });
        setActiveExtensions(prev => {
            const next = { ...prev };
            delete next[extensionId];
            return next;
        });
        console.log(`[Extension] ${extensionId} unloaded.`);
    };
    const loadExtension = async (ext) => {
        if (activeExtensions[ext.id]) return;

        try {
            console.log(`[Extension] Loading ${ext.id}...`);
            const entryPath = ext.localPath + '/' + (ext.main || 'index.js');
            const importUrl = `app-media:///${entryPath}`;
            const response = await fetch(importUrl);
            if (!response.ok) throw new Error(`Failed to fetch ${entryPath}`);
            const code = await response.text();
            const customRequire = (moduleName) => {
                if (moduleName === 'react') return window.React;
                if (moduleName === 'react-dom') return window.ReactDOM;
                if (moduleName === 'react-dom/client') return window.ReactDOM;

                throw new Error(`Cannot find module '${moduleName}'`);
            };

            const exports: any = {};
            const module: any = { exports };
            const api = createExtensionApi(ext.id, ext.localPath);

            window.Lux_API = api;
            const wrapper = new Function('require', 'exports', 'module', 'React', 'api', code);
            wrapper(customRequire, exports, module, window.React, api);
            const ExportedModule = module.exports;
            setActiveExtensions(prev => ({
                ...prev,
                [ext.id]: {
                    exports: ExportedModule,
                    api: api
                }
            }));
            if (typeof ExportedModule.activate === 'function') {
                await ExportedModule.activate(api);
                console.log(`[Extension] Activated ${ext.id}`);
            } else if (typeof ExportedModule.register === 'function') {

                ExportedModule.register(api);
                console.log(`[Extension] Registered ${ext.id} (Legacy)`);
            } else if (ExportedModule.default) {
                console.warn(`[Extension] ${ext.id} has no activate/register hook. Default export ignored.`);
            }

        } catch (err) {
            console.error(`[Extension] Failed to load ${ext.id}:`, err);
        }
    };
    const toggleExtension = async (id, enabled) => {
        try {
            console.log(`[ExtensionContext] Toggling ${id} to ${enabled}`);
            const ext = installedExtensions.find(e => e.id === id);
            if (!ext) {
                console.error(`Extension ${id} not found`);
                return;
            }
            const result = await window.electronAPI.toggleExtension(id, enabled);
            if (!result.success) {
                console.error(`Failed to toggle extension in backend: ${result.error}`);
                return;
            }
            setInstalledExtensions(prev => prev.map(e =>
                e.id === id ? { ...e, enabled } : e
            ));
            if (enabled) {

                await loadExtension({ ...ext, enabled: true });
            } else {
                await unloadExtension(id);
            }
        } catch (e) {
            console.error("Failed to toggle extension:", e);
        }
    };

    const refreshExtensions = async () => {
        if (!EXTENSIONS_ENABLED) {
            setLoading(false);
            return;
        }
        if (!window.electronAPI) return;

        try {
            const result = await window.electronAPI.getExtensions();
            if (result.success) {
                setInstalledExtensions(result.extensions);

                for (const ext of result.extensions) {
                    if (ext.enabled && !activeExtensions[ext.id]) {
                        await loadExtension(ext);
                    } else if (!ext.enabled && activeExtensions[ext.id]) {
                        await unloadExtension(ext.id);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to refresh extensions:", e);
        }
        setLoading(false);
    };

    useEffect(() => {
        refreshExtensions();
        if (window.electronAPI && window.electronAPI.onExtensionFile) {
            const cleanup = window.electronAPI.onExtensionFile(async (filePath) => {
                const confirm = window.confirm(`Do you want to install this extension?\n\n${filePath}`);
                if (confirm) {
                    try {
                        const result = await window.electronAPI.installExtension(filePath);
                        if (result.success) {
                            alert(`Extension installed!`);
                            refreshExtensions();
                        } else {
                            alert(`Failed to install: ${result.error}`);
                        }
                    } catch (e: any) {
                        alert(`Error: ${e.message}`);
                    }
                }
            });
            return cleanup;
        }

    }, []);

    const getViews = (slotName) => views[slotName] || [];

    return (
        <ExtensionContext.Provider value={{
            extensionsEnabled: EXTENSIONS_ENABLED,
            installedExtensions,
            activeExtensions,
            loading,
            getViews,
            loadExtension,
            unloadExtension,
            toggleExtension,
            refreshExtensions
        }}>
            {children}
        </ExtensionContext.Provider>
    );
};