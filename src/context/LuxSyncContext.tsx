import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useLuxAccount as useLuxAccountForSync } from './LuxAccountContext';

export type CloudInstance = {
    instanceUuid: string;
    name: string;
    revision: number;
    manifestHash: string | null;
    mcVersion: string | null;
    loader: string | null;
    loaderVersion: string | null;
    logicalBytes: number;
    playtimeTotalMs: number;
    crossPlatform: boolean;
    syncWorlds: boolean;
    syncScreenshots: boolean;
    originPlatform: string | null;
    status: 'active' | 'trashed';
    lastTouchedAt: string | null;
    expiresAt: number | null;
    everPulledElsewhere: boolean;
    lastForeignPullAt: string | null;
};

// Eine Instanz, an der dieses Konto als Mitglied mitarbeitet (Host ist jemand anderes).
export type SharePermissions = {
    addContent: boolean;
    removeContent: boolean;
    editConfig: boolean;
    rename: boolean;
    manageMembers: boolean;
};

export type SharedInstance = CloudInstance & {
    access: 'member';
    owner: { userId: number; username: string | null; avatar: string | null };
    joinedAt: string | null;
    permissions: SharePermissions;
};

export type SyncPhase = 'idle' | 'manifest' | 'negotiate' | 'upload' | 'commit' | 'download' | 'done' | 'error';

export type SyncStatus =
    | 'local'
    | 'synced'
    | 'syncing'
    | 'pending'
    | 'conflict'
    | 'offline'
    | 'cloud-only'
    | 'trashed';

export type InstanceProgress = {
    phase: SyncPhase;
    files?: number;
    totalBytes?: number;
    sentBytes?: number;
    downloadedBytes?: number;
    done?: number;
    processedBytes?: number;
    networkBytes?: number;
    auto?: boolean;
};

export type TransferFailure = {
    instanceName: string;
    error: string;
    message: string;
    path?: string;
    at: number;
};

export type ConflictInfo = {
    instanceName: string;
    localRevision: number;
    remoteRevision: number;
    changedLocally: number;
    changed: { path: string; reason: string }[];
};

export type PreLaunchState = {
    instanceName: string;
    phase: 'checking' | 'updating' | 'ready' | 'offline';
    files?: number;
    done?: number;
    downloadedBytes?: number;
};

type LuxSyncState = {
    supported: boolean;
    loading: boolean;
    offline: boolean;
    preLaunch: PreLaunchState | null;
    cloudInstances: CloudInstance[];
    sharedInstances: SharedInstance[];
    progress: Record<string, InstanceProgress>;
    statuses: Record<string, SyncStatus>;
    conflicts: Record<string, ConflictInfo>;
    sessionWarning: { instanceName: string; others: { deviceName: string }[] } | null;
    transferFailures: Record<string, TransferFailure>;
    error: { code: string; message: string } | null;
};

type LuxSyncApi = LuxSyncState & {
    refresh: () => Promise<void>;
    syncInstance: (instanceName: string, options?: any) => Promise<any>;
    restoreInstance: (instanceUuid: string, options?: any) => Promise<any>;
    resolveConflict: (instanceName: string, choice: 'local' | 'remote') => Promise<any>;
    dismissConflict: (instanceName: string) => void;
    dismissSessionWarning: () => void;
    dismissTransferFailure: (instanceName: string) => void;
    clearStatus: (instanceName: string) => void;
    cancelTransfer: (instanceName: string) => Promise<any>;
    statusFor: (instanceName: string, instanceId?: string | null) => SyncStatus;
    activeTransfers: { instanceName: string; progress: InstanceProgress }[];
};

const INITIAL: LuxSyncState = {
    supported: true,
    loading: false,
    offline: false,
    preLaunch: null,
    cloudInstances: [],
    sharedInstances: [],
    progress: {},
    statuses: {},
    conflicts: {},
    sessionWarning: null,
    transferFailures: {},
    error: null
};

const LuxSyncContext = createContext<LuxSyncApi | null>(null);

export const useLuxSync = () => useContext(LuxSyncContext);

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

const OFFLINE_CODES = new Set(['offline', 'server_unreachable']);

export const LuxSyncProvider = ({
    children,
    loggedIn
}: {
    children: React.ReactNode;
    loggedIn: boolean;
}) => {
    const [state, setState] = useState<LuxSyncState>(INITIAL);
    const mounted = useRef(true);

    // StrictMode runs effects mount -> cleanup -> mount in development. Without
    // setting this back to true the second mount would keep a false flag and every
    // state update below would be dropped silently.
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const patch = useCallback((next: Partial<LuxSyncState>) => {
        if (mounted.current) setState((current) => ({ ...current, ...next }));
    }, []);

    const refresh = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudListCloudInstances !== 'function') {
            patch({ supported: false, loading: false });
            return;
        }
        if (!loggedIn) {
            patch({
                cloudInstances: [],
                sharedInstances: [],
                loading: false,
                offline: false,
                progress: {},
                statuses: {},
                conflicts: {},
                transferFailures: {},
                sessionWarning: null
            });
            return;
        }

        patch({ loading: true });
        try {
            const result = await api.luxCloudListCloudInstances('active');
            if (!result || result.success === false) {
                patch({
                    loading: false,
                    offline: OFFLINE_CODES.has(result?.error),
                    error: result ? { code: result.error, message: result.message } : null
                });
                return;
            }
            // Geteilte Instanzen sind eine Zugabe: scheitert ihre Abfrage (etwa weil der
            // Server die Funktion noch nicht kennt), bleibt die eigene Liste trotzdem gueltig.
            const shared = typeof api.luxCloudListShared === 'function'
                ? await api.luxCloudListShared().catch(() => null)
                : null;
            const sharedList = shared && shared.success !== false ? (shared.instances || []) : [];
            patch({
                loading: false,
                offline: false,
                error: null,
                cloudInstances: result.instances || [],
                sharedInstances: sharedList
            });

            // Hat jemand eine gemeinsame Instanz umbenannt, zieht der lokale Ordner nach.
            if (typeof api.luxCloudApplyCloudNames === 'function') {
                const names = [...(result.instances || []), ...sharedList]
                    .map((entry: any) => ({ instanceUuid: entry.instanceUuid, name: entry.name }));
                api.luxCloudApplyCloudNames(names).catch(() => {});
            }
        } catch (err: any) {
            patch({ loading: false, error: { code: 'unknown_error', message: String(err?.message || err) } });
        }
    }, [loggedIn, patch]);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        const api = bridge();
        if (!api) return;

        const unsubscribers: Array<() => void> = [];

        const onProgress = (payload: any) => {
            const name = payload && (payload.instanceName || payload.instanceUuid);
            if (!payload || !name) return;
            payload = { ...payload, instanceName: name };
            setState((current) => {
                const phase = payload.phase as SyncPhase;
                const nextProgress = { ...current.progress };
                const nextStatuses = { ...current.statuses };
                const nextFailures = { ...current.transferFailures };

                if (phase === 'error') {
                    delete nextProgress[payload.instanceName];
                    nextStatuses[payload.instanceName] = 'pending';
                    nextFailures[payload.instanceName] = {
                        instanceName: payload.instanceName,
                        error: payload.error || 'unknown_error',
                        message: payload.message || 'The transfer stopped',
                        path: payload.path,
                        at: Date.now()
                    };
                    return { ...current, progress: nextProgress, statuses: nextStatuses, transferFailures: nextFailures };
                }

                delete nextFailures[payload.instanceName];

                if (phase === 'done') {
                    delete nextProgress[payload.instanceName];
                    nextStatuses[payload.instanceName] = 'synced';
                } else {
                    nextProgress[payload.instanceName] = {
                        phase,
                        files: payload.files,
                        totalBytes: payload.totalBytes,
                        sentBytes: payload.sentBytes,
                        downloadedBytes: payload.downloadedBytes,
                        done: payload.done,
                        processedBytes: payload.processedBytes,
                        networkBytes: payload.networkBytes,
                        auto: payload.auto
                    };
                    nextStatuses[payload.instanceName] = 'syncing';
                }
                return {
                    ...current,
                    progress: nextProgress,
                    statuses: nextStatuses,
                    transferFailures: nextFailures
                };
            });
        };

        const onAutoSync = (payload: any) => {
            if (!payload || !payload.instanceName) return;
            setState((current) => {
                const nextStatuses = { ...current.statuses };
                if (payload.event === 'scheduled') {
                    // Eine erkannte Aenderung wartet auf ihren Upload. Ohne diesen Zustand
                    // sah die Instanz bis zum Start der Uebertragung aus wie eine, an der
                    // nichts zu tun ist.
                    nextStatuses[payload.instanceName] = 'pending';
                } else if (payload.event === 'cancelled') {
                    // Nichts steht mehr an: zurueck zu dem, was die Cloud-Liste sagt.
                    if (nextStatuses[payload.instanceName] === 'pending') delete nextStatuses[payload.instanceName];
                } else if (payload.event === 'error') {
                    nextStatuses[payload.instanceName] = payload.retryable ? 'pending' : 'conflict';
                } else if (payload.event === 'done') {
                    // A skipped run is not a completed sync. Reporting the trashed case as
                    // 'synced' was what made the panel claim everything was up to date.
                    const reason = payload.result?.reason;
                    if (reason === 'instance_trashed') nextStatuses[payload.instanceName] = 'trashed';
                    else if (reason === 'revision_conflict') nextStatuses[payload.instanceName] = 'conflict';
                    else if (reason === 'update_available') nextStatuses[payload.instanceName] = 'pending';
                    else if (reason === 'not_in_cloud') delete nextStatuses[payload.instanceName];
                    else nextStatuses[payload.instanceName] = 'synced';
                }
                return { ...current, statuses: nextStatuses };
            });
            if (payload.event === 'done' && payload.result?.reason !== 'instance_trashed') refresh();
        };

        const onSessionWarning = (payload: any) => {
            if (!payload || !Array.isArray(payload.others) || payload.others.length === 0) return;
            patch({ sessionWarning: { instanceName: payload.instanceName, others: payload.others } });
        };

        // The pre-launch gate speaks its own phases ('checking', 'updating', 'ready',
        // 'conflict') and mixes in the downloader's while it fetches. Routing that through
        // the generic progress handler left the badge stuck on "syncing", because 'ready'
        // arrives after the downloader's 'done' and means the opposite of a new transfer.
        const onPreLaunchProgress = (payload: any) => {
            const name = payload && (payload.instanceName || payload.instanceUuid);
            if (!name) return;

            const phase = payload.phase;

            // Ende des Starttors: Fenster schliessen (bei 'ready' kurz stehen lassen,
            // damit die Meldung lesbar ist) und einen Endstatus setzen.
            if (phase === 'ready' || phase === 'conflict' || phase === 'offline' || phase === 'error') {
                setState((current) => {
                    const nextProgress = { ...current.progress };
                    delete nextProgress[name];

                    const nextStatuses = { ...current.statuses };
                    if (phase === 'ready') nextStatuses[name] = 'synced';
                    else if (phase === 'conflict') nextStatuses[name] = 'conflict';
                    else if (phase === 'offline') nextStatuses[name] = 'offline';
                    else nextStatuses[name] = 'pending';

                    return {
                        ...current,
                        progress: nextProgress,
                        statuses: nextStatuses,
                        preLaunch: phase === 'ready' || phase === 'offline'
                            ? { instanceName: name, phase }
                            : null
                    };
                });

                if (phase === 'ready' || phase === 'offline') {
                    setTimeout(() => {
                        setState((current) => (current.preLaunch && current.preLaunch.instanceName === name
                            ? { ...current, preLaunch: null }
                            : current));
                    }, 1200);
                }
                return;
            }

            setState((current) => ({
                ...current,
                preLaunch: {
                    instanceName: name,
                    phase: phase === 'checking' ? 'checking' : 'updating',
                    files: payload.files ?? current.preLaunch?.files,
                    done: payload.done ?? current.preLaunch?.done,
                    downloadedBytes: payload.networkBytes ?? payload.downloadedBytes ?? current.preLaunch?.downloadedBytes
                }
            }));

            onProgress({ ...payload, instanceName: name });
        };

        // The pre-launch check refused to start the game. Feeding it through the same
        // conflict state means the existing dialog opens no matter which of the many
        // play buttons the user pressed.
        const onLaunchBlocked = (payload: any) => {
            if (!payload || !payload.instanceName) return;
            setState((current) => ({
                ...current,
                statuses: { ...current.statuses, [payload.instanceName]: 'conflict' },
                conflicts: {
                    ...current.conflicts,
                    [payload.instanceName]: {
                        instanceName: payload.instanceName,
                        localRevision: payload.localRevision ?? 0,
                        remoteRevision: payload.remoteRevision ?? 0,
                        changedLocally: payload.changedLocally ?? 0,
                        changed: Array.isArray(payload.changed) ? payload.changed : []
                    }
                }
            }));
        };

        if (typeof api.onLuxCloudSyncProgress === 'function') {
            unsubscribers.push(api.onLuxCloudSyncProgress(onProgress));
        }
        if (typeof api.onLuxCloudRestoreProgress === 'function') {
            unsubscribers.push(api.onLuxCloudRestoreProgress(onProgress));
        }
        if (typeof api.onLuxCloudAutoSync === 'function') {
            unsubscribers.push(api.onLuxCloudAutoSync(onAutoSync));
        }
        if (typeof api.onLuxCloudSessionWarning === 'function') {
            unsubscribers.push(api.onLuxCloudSessionWarning(onSessionWarning));
        }
        if (typeof api.onLuxCloudLaunchBlocked === 'function') {
            unsubscribers.push(api.onLuxCloudLaunchBlocked(onLaunchBlocked));
        }
        if (typeof api.onLuxCloudPreLaunchProgress === 'function') {
            unsubscribers.push(api.onLuxCloudPreLaunchProgress(onPreLaunchProgress));
        }

        return () => {
            for (const off of unsubscribers) {
                try { off(); } catch { /* the window is going away anyway */ }
            }
        };
    }, [patch, refresh]);

    const clearProgress = useCallback((instanceName?: string | null) => {
        if (!instanceName) return;
        setState((current) => {
            if (!current.progress[instanceName]) return current;
            const progress = { ...current.progress };
            delete progress[instanceName];
            return { ...current, progress };
        });
    }, []);

    const syncInstance = useCallback(async (instanceName: string, options: any = {}) => {
        const api = bridge();
        if (!api || typeof api.luxCloudSyncInstance !== 'function') return null;

        let result: any;
        try {
            result = await api.luxCloudSyncInstance(instanceName, options);
        } catch (err: any) {
            // Auch ein geplatzter IPC-Aufruf muss die Anzeige aus dem laufenden Zustand
            // holen, sonst dreht sie sich weiter, obwohl nichts mehr passiert.
            clearProgress(instanceName);
            setState((current) => ({
                ...current,
                statuses: { ...current.statuses, [instanceName]: 'conflict' },
                transferFailures: {
                    ...current.transferFailures,
                    [instanceName]: {
                        instanceName,
                        error: 'unknown_error',
                        message: String(err?.message || err),
                        at: Date.now()
                    }
                }
            }));
            return { success: false, error: 'unknown_error', message: String(err?.message || err) };
        }

        clearProgress(instanceName);
        if (result && result.success === false) {
            if (result.error === 'revision_conflict') {
                setState((current) => ({
                    ...current,
                    statuses: { ...current.statuses, [instanceName]: 'conflict' },
                    conflicts: {
                        ...current.conflicts,
                        [instanceName]: {
                            instanceName,
                            localRevision: result.details?.currentRevision ?? 0,
                            remoteRevision: result.details?.currentRevision ?? 0,
                            changedLocally: 0,
                            changed: []
                        }
                    }
                }));
            } else if (result.error === 'instance_trashed') {
                // A terminal state, not a pending one: nothing will change until the user
                // restores the instance, so the indicator must stop suggesting a retry.
                setState((current) => ({
                    ...current,
                    statuses: { ...current.statuses, [instanceName]: 'trashed' }
                }));
            } else if (OFFLINE_CODES.has(result.error)) {
                setState((current) => ({
                    ...current,
                    offline: true,
                    statuses: { ...current.statuses, [instanceName]: 'pending' }
                }));
            } else {
                // Jeder andere Fehlschlag braucht ebenfalls einen Schlusspunkt. Ohne ihn
                // blieb der zuletzt gemeldete 'syncing'-Status stehen und die Instanz sah
                // aus, als laufe sie ewig weiter.
                setState((current) => ({
                    ...current,
                    statuses: {
                        ...current.statuses,
                        [instanceName]: result.error === 'cancelled' ? 'pending' : 'conflict'
                    },
                    transferFailures: result.error === 'cancelled'
                        ? current.transferFailures
                        : {
                            ...current.transferFailures,
                            [instanceName]: {
                                instanceName,
                                error: result.error || 'unknown_error',
                                message: result.message || 'The sync stopped',
                                at: Date.now()
                            }
                        }
                }));
            }
            return result;
        }

        await refresh();
        return result;
    }, [refresh, clearProgress]);

    const restoreInstance = useCallback(async (instanceUuid: string, options: any = {}) => {
        const api = bridge();
        if (!api || typeof api.luxCloudRestoreInstance !== 'function') return null;

        const result = await api.luxCloudRestoreInstance(instanceUuid, options);
        clearProgress(options.instanceName || instanceUuid);
        await refresh();
        return result;
    }, [refresh, clearProgress]);

    const resolveConflict = useCallback(async (instanceName: string, choice: 'local' | 'remote') => {
        const api = bridge();
        if (!api || typeof api.luxCloudResolveConflict !== 'function') return null;

        const result = await api.luxCloudResolveConflict(instanceName, choice);
        if (result && result.success !== false) {
            setState((current) => {
                const conflicts = { ...current.conflicts };
                delete conflicts[instanceName];
                return {
                    ...current,
                    conflicts,
                    statuses: { ...current.statuses, [instanceName]: 'synced' }
                };
            });
            await refresh();
        }
        return result;
    }, [refresh]);

    const dismissConflict = useCallback((instanceName: string) => {
        setState((current) => {
            const conflicts = { ...current.conflicts };
            delete conflicts[instanceName];
            return { ...current, conflicts };
        });
    }, []);

    const dismissTransferFailure = useCallback((instanceName: string) => {
        setState((current) => {
            const transferFailures = { ...current.transferFailures };
            delete transferFailures[instanceName];
            return { ...current, transferFailures };
        });
    }, []);

    // Stops a running transfer. The backend cuts the pending requests and the loops bail
    // out between two files, so nothing is left half written.
    const cancelTransfer = useCallback(async (instanceName: string) => {
        const api = bridge();
        if (!api || typeof api.luxCloudCancelTransfer !== 'function') return null;

        const result = await api.luxCloudCancelTransfer(instanceName);
        setState((current) => {
            const progress = { ...current.progress };
            delete progress[instanceName];
            return {
                ...current,
                progress,
                statuses: { ...current.statuses, [instanceName]: 'pending' }
            };
        });
        return result;
    }, []);

    // Drops a sticky status (a trashed instance that was restored, for instance) so
    // statusFor falls back to deriving it from the cloud listing again.
    const clearStatus = useCallback((instanceName: string) => {
        setState((current) => {
            if (!(instanceName in current.statuses)) return current;
            const statuses = { ...current.statuses };
            delete statuses[instanceName];
            return { ...current, statuses };
        });
    }, []);

    const dismissSessionWarning = useCallback(() => patch({ sessionWarning: null }), [patch]);

    const statusFor = useCallback((instanceName: string, instanceId?: string | null): SyncStatus => {
        if (state.progress[instanceName]) return 'syncing';
        if (state.conflicts[instanceName]) return 'conflict';
        if (state.statuses[instanceName]) return state.statuses[instanceName];

        const linked = instanceId
            ? state.cloudInstances.some((entry) => entry.instanceUuid === instanceId)
                || state.sharedInstances.some((entry) => entry.instanceUuid === instanceId)
            : state.cloudInstances.some((entry) => entry.name === instanceName);

        if (!linked) return 'local';
        if (state.offline) return 'offline';
        return 'synced';
    }, [state]);

    const activeTransfers = useMemo(
        () => Object.entries(state.progress).map(([instanceName, progress]) => ({ instanceName, progress })),
        [state.progress]
    );

    const value = useMemo<LuxSyncApi>(() => ({
        ...state,
        refresh,
        syncInstance,
        restoreInstance,
        resolveConflict,
        dismissConflict,
        dismissSessionWarning,
        dismissTransferFailure,
        clearStatus,
        cancelTransfer,
        statusFor,
        activeTransfers
    }), [state, refresh, syncInstance, restoreInstance, resolveConflict,
        dismissConflict, dismissSessionWarning, dismissTransferFailure, clearStatus, cancelTransfer, statusFor, activeTransfers]);

    return <LuxSyncContext.Provider value={value}>{children}</LuxSyncContext.Provider>;
};

export const LuxSyncAutoProvider = ({ children }: { children: React.ReactNode }) => {
    const account = useLuxAccountForSync();
    return <LuxSyncProvider loggedIn={Boolean(account && account.loggedIn)}>{children}</LuxSyncProvider>;
};

export default LuxSyncContext;
