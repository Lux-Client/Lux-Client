import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNotification } from './NotificationContext';
import { create } from 'zustand';

const generateId = () => Math.random().toString(36).substr(2, 9);

const ExtensionContext = createContext<any>(null);
const EXTENSIONS_ENABLED = true;

export const useExtensions = () => useContext(ExtensionContext);

export const ExtensionStore = create((set, get) => ({
    extensions: new Map(),
    views: new Map(),
    hooks: new Map(),
    styles: new Map(),
    events: new Map(),
    apiInstances: new Map()
}));

type ExtensionLogger = {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
};

export const ExtensionProvider = ({ children }: { children: React.ReactNode }) => {
    const [installedExtensions, setInstalledExtensions] = useState<any[]>([]);
    const [activeExtensions, setActiveExtensions] = useState<{[key: string]: any}>({});
    const [views, setViews] = useState<{[key: string]: any[]}>({});
    const [hooks, setHooks] = useState<{[key: string]: any[]}>({});
    const [injectedStyles, setInjectedStyles] = useState<{[key: string]: HTMLStyleElement}>({});
    const [eventListeners, setEventListeners] = useState<{[key: string]: Set<Function>}>({});
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const loggerRef = useRef<{ [key: string]: ExtensionLogger }>({});

    const createExtensionApi = useCallback((extensionId: string, localPath: string) => {
        const logger: ExtensionLogger = {
            info: (...args: any[]) => console.log(`[Ext:${extensionId}]`, ...args),
            warn: (...args: any[]) => console.warn(`[Ext:${extensionId}]`, ...args),
            error: (...args: any[]) => console.error(`[Ext:${extensionId}]`, ...args),
            debug: (...args: any[]) => console.debug(`[Ext:${extensionId}]`, ...args),
        };
        loggerRef.current[extensionId] = logger;

        const api = {
            name: extensionId,
            version: '1.0.0',
            lux: {
                version: '1.7.0',
                platform: window.electronAPI?.platform || 'unknown',
                isPackaged: window.electronAPI?.isPackaged || false,
            },

            ui: {
                registerView: (slotName: string, component: React.ComponentType<any>, options?: { priority?: number; label?: string }) => {
                    setViews(prev => {
                        const slotViews = prev[slotName] || [];
                        const filteredViews = slotViews.filter((v: any) => v.extensionId !== extensionId);
                        const newView = { 
                            id: generateId(), 
                            extensionId, 
                            component, 
                            priority: options?.priority || 50,
                            label: options?.label || extensionId,
                            api 
                        };
                        filteredViews.push(newView);
                        filteredViews.sort((a: any, b: any) => b.priority - a.priority);
                        return { ...prev, [slotName]: filteredViews };
                    });
                },
                
                registerDialog: (dialogId: string, component: React.ComponentType<any>, props?: any) => {
                    console.log(`[Ext:${extensionId}] Registered dialog: ${dialogId}`);
                },
                
                toast: (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
                    if (addNotification) {
                        addNotification(`[${extensionId}] ${message}`, type);
                    }
                },
                
                notify: (notification: { title: string; body?: string; icon?: string; actions?: any[] }) => {
                    console.log(`[${extensionId}] Notification:`, notification);
                },
                
                injectStyle: (css: string, scope?: string) => {
                    const styleId = `ext-style-${extensionId}`;
                    let styleEl = document.getElementById(styleId) as HTMLStyleElement;
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = styleId;
                        styleEl.textContent = css;
                        document.head.appendChild(styleEl);
                    }
                    setInjectedStyles(prev => ({ ...prev, [extensionId]: styleEl }));
                    return () => {
                        styleEl.remove();
                        setInjectedStyles(prev => {
                            const next = { ...prev };
                            delete next[extensionId];
                            return next;
                        });
                    };
                },
                
                injectScript: (scriptUrl: string) => {
                    return new Promise<HTMLScriptElement>((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = scriptUrl;
                        script.onload = () => resolve(script);
                        script.onerror = () => reject(new Error(`Failed to load script: ${scriptUrl}`));
                        document.head.appendChild(script);
                    });
                },
                
                registerCommandPaletteCommands: (commands: Array<{
                    id: string;
                    label: string;
                    category?: string;
                    shortcut?: string;
                    action: () => void | Promise<void>;
                }>) => {
                    console.log(`[Ext:${extensionId}] Registered ${commands.length} command palette commands`);
                },
                
                createShortcut: (keys: string, callback: () => void, options?: { description?: string; enabled?: boolean }) => {
                    console.log(`[Ext:${extensionId}] Created shortcut: ${keys}`);
                },
                
                openModal: (component: React.ReactNode, options?: { title?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) => {
                    console.log(`[Ext:${extensionId}] Open modal requested`);
                },
                
                renderIntoSlot: (slotId: string, renderer: () => React.ReactNode) => {
                    setViews(prev => {
                        const slot = prev[slotId] || [];
                        return { ...prev, [slotId]: [...slot, { extensionId, renderer, id: generateId() }] };
                    });
                }
            },

            hooks: {
                register: (point: string, handler: Function, options?: { priority?: number }) => {
                    setHooks(prev => {
                        const pointHooks = prev[point] || [];
                        return {
                            ...prev,
                            [point]: [...pointHooks, { extensionId, handler, priority: options?.priority || 50 }]
                        };
                    });
                },
                
                unregister: (point: string) => {
                    setHooks(prev => {
                        const next: Record<string, any[]> = {};
                        for (const [p, items] of Object.entries(prev)) {
                            next[p] = items.filter((item: any) => item.extensionId !== extensionId);
                        }
                        return next;
                    });
                },
                
                run: async (point: string, data?: any,context?: any) => {
                    const pointHooks = hooks[point] || [];
                    let currentData = data;
                    for (const hook of pointHooks.sort((a: any, b: any) => b.priority - a.priority)) {
                        try {
                            const result = await hook.handler(currentData, context);
                            if (result !== undefined) currentData = result;
                        } catch (e) {
                            logger.error(`Hook error in ${point}:`, e);
                        }
                    }
                    return currentData;
                },
                
                onActivate: (callback: () => void | Promise<void>) => {
                    console.log(`[Ext:${extensionId}] Registered onActivate handler`);
                },
                
                onDeactivate: (callback: () => void | Promise<void>) => {
                    console.log(`[Ext:${extensionId}] Registered onDeactivate handler`);
                }
            },

            events: {
                on: (event: string, callback: (...args: any[]) => void) => {
                    setEventListeners(prev => {
                        const listeners = prev[event] || new Set();
                        listeners.add(callback);
                        return { ...prev, [event]: listeners };
                    });
                    return () => {
                        setEventListeners(prev => {
                            const listeners = prev[event];
                            if (listeners) listeners.delete(callback);
                            return { ...prev };
                        });
                    };
                },
                
                emit: async (event: string, ...args: any[]) => {
                    const listeners = eventListeners[event];
                    if (listeners) {
                        for (const callback of listeners) {
                            try {
                                await callback(...args);
                            } catch (e) {
                                logger.error(`Event error for ${event}:`, e);
                            }
                        }
                    }
                },
                
                broadcast: (event: string, ...args: any[]) => {
                    const listeners = eventListeners[event];
                    if (listeners) {
                        for (const callback of listeners) {
                            try {
                                callback(...args);
                            } catch (e) {
                                logger.error(`Broadcast error for ${event}:`, e);
                            }
                        }
                    }
                }
            },

            ipc: {
                invoke: async (channel: string, ...args: any[]) => {
                    const coreMethod = channel.replace(/:/g, '_');
                    if (window.electronAPI && window.electronAPI[coreMethod]) {
                        return window.electronAPI[coreMethod](...args);
                    }
                    if (window.electronAPI && window.electronAPI.invokeExtension) {
                        return window.electronAPI.invokeExtension(extensionId, channel, ...args);
                    }
                    throw new Error(`IPC channel not found: ${channel}`);
                },
                
                send: (channel: string, ...args: any[]) => {
                    if (window.electronAPI && window.electronAPI.invokeExtension) {
                        window.electronAPI.invokeExtension(extensionId, channel, ...args);
                    }
                },
                
                on: (channel: string, callback: (...args: any[]) => void) => {
                    if (window.electronAPI && window.electronAPI.onExtensionMessage) {
                        return window.electronAPI.onExtensionMessage(extensionId, channel, callback);
                    }
                    return () => {};
                },
                
                handle: (channel: string, handler: (...args: any[]) => any) => {
                    console.log(`[Ext:${extensionId}] IPC handler registered: ${channel}`);
                }
            },

            launcher: {
                getInstances: () => window.electronAPI?.getInstances(),
                launchGame: (instanceName: string, options?: any) => window.electronAPI?.launchGame(instanceName, options),
                getActiveProcesses: () => window.electronAPI?.getActiveProcesses(),
                getProcessStats: (pid: number) => window.electronAPI?.getProcessStats(pid),
                getLogs: (instanceName: string) => window.electronAPI?.getLogFiles(instanceName),
                killGame: (instanceName: string) => window.electronAPI?.killGame(instanceName),
            },

            instances: {
                list: () => window.electronAPI?.getInstances(),
                get: (name: string) => window.electronAPI?.getInstances(),
                create: (config: any) => window.electronAPI?.createInstance(
                    config.name,
                    config.version,
                    config.loader,
                    config.icon,
                    config.loaderVersion,
                    config.options
                ),
                delete: (name: string) => window.electronAPI?.deleteInstance(name),
                launch: (name: string, quickPlay?: any) => window.electronAPI?.launchGame(name, quickPlay),
                openFolder: (name: string) => window.electronAPI?.openInstanceFolder(name),
            },

            mods: {
                list: (instanceName: string) => window.electronAPI?.getMods(instanceName),
                enable: (instanceName: string, fileName: string) => window.electronAPI?.toggleMod(instanceName, fileName),
                disable: (instanceName: string, fileName: string) => window.electronAPI?.toggleMod(instanceName, fileName),
                delete: (instanceName: string, fileName: string, type?: string) => window.electronAPI?.deleteMod(instanceName, fileName, type),
                install: (instanceName: string, data: any) => window.electronAPI?.installMod({ instanceName, ...data }),
            },

            storage: {
                get: (key: string, defaultValue?: any) => {
                    try {
                        const data = localStorage.getItem(`ext:${extensionId}:${key}`);
                        return data ? JSON.parse(data) : defaultValue;
                    } catch (e) { return defaultValue; }
                },
                
                set: (key: string, value: any) => {
                    localStorage.setItem(`ext:${extensionId}:${key}`, JSON.stringify(value));
                },
                
                remove: (key: string) => {
                    localStorage.removeItem(`ext:${extensionId}:${key}`);
                },
                
                clear: () => {
                    const keys = Object.keys(localStorage).filter(k => k.startsWith(`ext:${extensionId}:`));
                    keys.forEach(k => localStorage.removeItem(k));
                },
                
                getFile: async (fileName: string) => {
                    return window.electronAPI?.readInstanceFile(extensionId, fileName);
                },
                
                setFile: async (fileName: string, content: string) => {
                    return window.electronAPI?.writeInstanceFile(extensionId, fileName, content);
                }
            },

            settings: {
                get: (key: string) => {
                    try {
                        const data = localStorage.getItem(`ext:${extensionId}:settings:${key}`);
                        return data ? JSON.parse(data) : null;
                    } catch (e) { return null; }
                },
                
                set: (key: string, value: any) => {
                    localStorage.setItem(`ext:${extensionId}:settings:${key}`, JSON.stringify(value));
                },
                
                registerSetting: (setting: {
                    key: string;
                    type: 'text' | 'number' | 'boolean' | 'select' | 'range';
                    label: string;
                    description?: string;
                    defaultValue: any;
                    options?: any[];
                    min?: number;
                    max?: number;
                    step?: number;
                }) => {
                    console.log(`[Ext:${extensionId}] Registered setting: ${setting.key}`);
                }
            },

            http: {
                fetch: async (url: string, options?: RequestInit) => {
                    return fetch(url, options);
                },
                
                fetchJson: async <T = any>(url: string, options?: RequestInit): Promise<T> => {
                    const res = await fetch(url, options);
                    return res.json();
                }
            },

            utils: {
                logger,
                formatDate: (date: Date | number, locale?: string) => {
                    return new Intl.DateTimeFormat(locale || 'en-US').format(new Date(date));
                },
                formatBytes: (bytes: number) => {
                    if (bytes === 0) return '0 B';
                    const k = 1024;
                    const sizes = ['B', 'KB', 'MB', 'GB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                },
                sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
                debounce: <F extends (...args: any[]) => any>(fn: F, delay: number) => {
                    let timeoutId: NodeJS.Timeout;
                    return (...args: Parameters<F>) => {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => fn(...args), delay);
                    };
                },
                throttle: <F extends (...args: any[]) => any>(fn: F, limit: number) => {
                    let inThrottle = false;
                    return (...args: Parameters<F>) => {
                        if (!inThrottle) {
                            fn(...args);
                            inThrottle = true;
                            setTimeout(() => inThrottle = false, limit);
                        }
                    };
                },
                copyToClipboard: async (text: string) => {
                    await navigator.clipboard.writeText(text);
                }
            },

            meta: {
                id: extensionId,
                localPath: localPath,
                get path() { return localPath; },
                getDataPath: () => `${localPath}/data`,
                getAssetsPath: () => `${localPath}/assets`,
            },

            dependencies: {
                react: window.React,
                reactDOM: window.ReactDOM,
            },

            components: {
                // Access to shared components via import in extension code
            }
        };
    }, []);

    const unloadExtension = async (extensionId: string) => {
        const active = activeExtensions[extensionId];
        if (!active) return;

        loggerRef.current[extensionId]?.info('Unloading...');
        if (active.exports && typeof active.exports.deactivate === 'function') {
            try {
                await active.exports.deactivate();
            } catch (e) {
                loggerRef.current[extensionId]?.error('Deactivate error:', e);
            }
        }

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
                next[slot] = items.filter((item: any) => item.extensionId !== extensionId);
            }
            return next;
        });

        setHooks(prev => {
            const next: Record<string, any[]> = {};
            for (const [point, items] of Object.entries(prev)) {
                next[point] = items.filter((item: any) => item.extensionId !== extensionId);
            }
            return next;
        });

        setActiveExtensions(prev => {
            const next = { ...prev };
            delete next[extensionId];
            return next;
        });
        
        loggerRef.current[extensionId]?.info('Unloaded');
    };

    const loadExtension = async (ext: any) => {
        if (activeExtensions[ext.id]) return;

        try {
            loggerRef.current[ext.id]?.info('Loading...');
            const entryPath = ext.localPath + '/' + (ext.main || 'index.js');
            const importUrl = `app-media:///${entryPath}`;
            const response = await fetch(importUrl);
            if (!response.ok) throw new Error(`Failed to fetch ${entryPath}`);
            const code = await response.text();

            const exports: any = {};
            const module: any = { exports };
            const api = createExtensionApi(ext.id, ext.localPath);

            const customRequire = (moduleName: string) => {
                if (moduleName === 'react') return window.React;
                if (moduleName === 'react-dom') return window.ReactDOM;
                throw new Error(`Cannot find module '${moduleName}'`);
            };

            window.Lux_API = api;
            const wrapper = new Function('require', 'exports', 'module', 'React', 'ReactDOM', 'api', code);
            wrapper(customRequire, exports, module, window.React, window.ReactDOM, api);
            
            const ExportedModule = module.exports;
            setActiveExtensions(prev => ({
                ...prev,
                [ext.id]: { exports: ExportedModule, api }
            }));
            
            if (typeof ExportedModule.activate === 'function') {
                await ExportedModule.activate(api);
                loggerRef.current[ext.id]?.info('Activated');
            } else if (typeof ExportedModule.register === 'function') {
                ExportedModule.register(api);
                loggerRef.current[ext.id]?.info('Registered');
            }
        } catch (err) {
            loggerRef.current[ext.id]?.error('Load failed:', err);
        }
    };

    const toggleExtension = async (id: string, enabled: boolean) => {
        try {
            loggerRef.current[id]?.info(`Toggling to ${enabled}`);
            const ext = installedExtensions.find(e => e.id === id);
            if (!ext) {
                loggerRef.current[id]?.error('Extension not found');
                return;
            }
            
            const result = await window.electronAPI?.toggleExtension(id, enabled);
            if (!result?.success) {
                loggerRef.current[id]?.error('Toggle failed:', result?.error);
                return;
            }
            
            setInstalledExtensions(prev => prev.map(e => e.id === id ? { ...e, enabled } : e));
            
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
        if (!window.electronAPI) {
            setLoading(false);
            return;
        }

        try {
            const result = await window.electronAPI.getExtensions();
            if (result?.success) {
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
        if (window.electronAPI?.onExtensionFile) {
            const cleanup = window.electronAPI.onExtensionFile(async (filePath: string) => {
                const confirm = window.confirm(`Install extension?\n\n${filePath}`);
                if (confirm) {
                    try {
                        const result = await window.electronAPI.installExtension(filePath);
                        if (result?.success) {
                            addNotification(`Extension installed!`, 'success');
                            refreshExtensions();
                        } else {
                            addNotification(`Install failed: ${result?.error}`, 'error');
                        }
                    } catch (e: any) {
                        addNotification(`Error: ${e.message}`, 'error');
                    }
                }
            });
            return cleanup;
        }
    }, []);

    const getViews = useCallback((slotName: string) => views[slotName] || [], [views]);

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
            refreshExtensions,
            hooks,
            eventListeners
        }}>
            {children}
        </ExtensionContext.Provider>
    );
};

export default ExtensionProvider;