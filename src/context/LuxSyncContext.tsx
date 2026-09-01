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
};

export type SyncPhase = 'idle' | 'manifest' | 'negotiate' | 'upload' | 'commit' | 'download' | 'done';

export type SyncStatus =
    | 'local'
    | 'synced'
    | 'syncing'
    | 'pending'
    | 'conflict'
    | 'offline'
    | 'cloud-only';

export type InstanceProgress = {
    phase: SyncPhase;
    files?: number;
    totalBytes?: number;
    sentBytes?: number;
    downloadedBytes?: number;
    done?: number;
    auto?: boolean;
};

export type ConflictInfo = {
    instanceName: string;
    localRevision: number;
    remoteRevision: number;
    changedLocally: number;
    changed: { path: string; reason: string }[];
};

type LuxSyncState = {
    supported: boolean;
    loading: boolean;
    offline: boolean;
    cloudInstances: CloudInstance[];
    progress: Record<string, InstanceProgress>;
    statuses: Record<string, SyncStatus>;
    conflicts: Record<string, ConflictInfo>;
    sessionWarning: { instanceName: string; others: { deviceName: string }[] } | null;
    error: { code: string; message: string } | null;
};

type LuxSyncApi = LuxSyncState & {
    refresh: () => Promise<void>;
    syncInstance: (instanceName: string, options?: any) => Promise<any>;
    restoreInstance: (instanceUuid: string, options?: any) => Promise<any>;
    resolveConflict: (instanceName: string, choice: 'local' | 'remote') => Promise<any>;
    dismissConflict: (instanceName: string) => void;
    dismissSessionWarning: () => void;
    statusFor: (instanceName: string, instanceId?: string | null) => SyncStatus;
    activeTransfers: { instanceName: string; progress: InstanceProgress }[];
};

const INITIAL: LuxSyncState = {
    supported: true,
    loading: false,
    offline: false,
    cloudInstances: [],
    progress: {},
    statuses: {},
    conflicts: {},
    sessionWarning: null,
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

    useEffect(() => () => { mounted.current = false; }, []);

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
            patch({ cloudInstances: [], loading: false, offline: false });
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
            patch({
                loading: false,
                offline: false,
                error: null,
                cloudInstances: result.instances || []
            });
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
            if (!payload || !payload.instanceName) return;
            setState((current) => {
                const phase = payload.phase as SyncPhase;
                const nextProgress = { ...current.progress };
                const nextStatuses = { ...current.statuses };

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
                        auto: payload.auto
                    };
                    nextStatuses[payload.instanceName] = 'syncing';
                }
                return { ...current, progress: nextProgress, statuses: nextStatuses };
            });
        };

        const onAutoSync = (payload: any) => {
            if (!payload || !payload.instanceName) return;
            setState((current) => {
                const nextStatuses = { ...current.statuses };
                if (payload.event === 'error') {
                    nextStatuses[payload.instanceName] = payload.retryable ? 'pending' : 'conflict';
                } else if (payload.event === 'done') {
                    nextStatuses[payload.instanceName] = 'synced';
                }
                return { ...current, statuses: nextStatuses };
            });
            if (payload.event === 'done') refresh();
        };

        const onSessionWarning = (payload: any) => {
            if (!payload || !Array.isArray(payload.others) || payload.others.length === 0) return;
            patch({ sessionWarning: { instanceName: payload.instanceName, others: payload.others } });
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

        return () => {
            for (const off of unsubscribers) {
                try { off(); } catch { /* the window is going away anyway */ }
            }
        };
    }, [patch, refresh]);

    const syncInstance = useCallback(async (instanceName: string, options: any = {}) => {
        const api = bridge();
        if (!api || typeof api.luxCloudSyncInstance !== 'function') return null;

        const result = await api.luxCloudSyncInstance(instanceName, options);
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
            } else if (OFFLINE_CODES.has(result.error)) {
                setState((current) => ({
                    ...current,
                    offline: true,
                    statuses: { ...current.statuses, [instanceName]: 'pending' }
                }));
            }
            return result;
        }

        await refresh();
        return result;
    }, [refresh]);

    const restoreInstance = useCallback(async (instanceUuid: string, options: any = {}) => {
        const api = bridge();
        if (!api || typeof api.luxCloudRestoreInstance !== 'function') return null;

        const result = await api.luxCloudRestoreInstance(instanceUuid, options);
        await refresh();
        return result;
    }, [refresh]);

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

    const dismissSessionWarning = useCallback(() => patch({ sessionWarning: null }), [patch]);

    const statusFor = useCallback((instanceName: string, instanceId?: string | null): SyncStatus => {
        if (state.progress[instanceName]) return 'syncing';
        if (state.conflicts[instanceName]) return 'conflict';
        if (state.statuses[instanceName]) return state.statuses[instanceName];

        const linked = instanceId
            ? state.cloudInstances.some((entry) => entry.instanceUuid === instanceId)
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
        statusFor,
        activeTransfers
    }), [state, refresh, syncInstance, restoreInstance, resolveConflict,
        dismissConflict, dismissSessionWarning, statusFor, activeTransfers]);

    return <LuxSyncContext.Provider value={value}>{children}</LuxSyncContext.Provider>;
};

export const LuxSyncAutoProvider = ({ children }: { children: React.ReactNode }) => {
    const account = useLuxAccountForSync();
    return <LuxSyncProvider loggedIn={Boolean(account && account.loggedIn)}>{children}</LuxSyncProvider>;
};

export default LuxSyncContext;
