import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type LuxAccountUser = {
    id: number;
    username: string;
    avatar: string | null;
};

export type LuxCloudSettings = {
    cloudSyncEnabled: boolean;
    autoSync: boolean;
    crossPlatformDefault: boolean;
    syncWorldsDefault: boolean;
    syncScreenshotsDefault: boolean;
};

export type LuxCloudQuota = {
    usedBytes: number;
    quotaBytes: number;
    instanceCount: number;
    maxInstances: number;
};

export type LuxCloudDevice = {
    deviceUuid: string;
    name: string | null;
    platform: string;
    appVersion: string | null;
    lastSeenAt: string | null;
    createdAt: string | null;
    isCurrent: boolean;
};

type LuxAccountState = {
    supported: boolean;
    loading: boolean;
    signingIn: boolean;
    loggedIn: boolean;
    offline: boolean;
    user: LuxAccountUser | null;
    device: { uuid: string | null; name: string; platform: string } | null;
    settings: LuxCloudSettings | null;
    quota: LuxCloudQuota | null;
    devices: LuxCloudDevice[];
    error: { code: string; message: string } | null;
};

type LuxAccountApi = LuxAccountState & {
    signIn: () => Promise<boolean>;
    signOut: () => Promise<void>;
    cancelSignIn: () => Promise<void>;
    reload: () => Promise<void>;
    updateSetting: (key: keyof LuxCloudSettings, value: boolean) => Promise<boolean>;
    revokeDevice: (deviceUuid: string) => Promise<boolean>;
    clearError: () => void;
};

const INITIAL: LuxAccountState = {
    supported: true,
    loading: true,
    signingIn: false,
    loggedIn: false,
    offline: false,
    user: null,
    device: null,
    settings: null,
    quota: null,
    devices: [],
    error: null
};

const LuxAccountContext = createContext<LuxAccountApi | null>(null);

export const useLuxAccount = () => useContext(LuxAccountContext);

const OFFLINE_CODES = new Set(['offline', 'server_unreachable']);

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export const LuxAccountProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useState<LuxAccountState>(INITIAL);
    const mounted = useRef(true);

    const patch = useCallback((next: Partial<LuxAccountState>) => {
        if (!mounted.current) return;
        setState((prev) => ({ ...prev, ...next }));
    }, []);

    const reload = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudGetAccount !== 'function') {
            patch({ supported: false, loading: false });
            return;
        }

        patch({ loading: true });

        const accountResult = await api.luxCloudGetAccount();
        if (!accountResult || !accountResult.success) {
            patch({ loading: false, error: { code: accountResult?.error || 'unknown_error', message: accountResult?.message || 'Could not read the Lux account.' } });
            return;
        }

        const account = accountResult.account;
        if (!account.loggedIn) {
            patch({
                loading: false,
                loggedIn: false,
                offline: false,
                user: null,
                device: account.device,
                settings: null,
                quota: null,
                devices: []
            });
            return;
        }

        const [meResult, devicesResult] = await Promise.all([
            api.luxCloudGetMe(),
            api.luxCloudListDevices()
        ]);

        const failure = [meResult, devicesResult].find((r) => r && !r.success);
        const offline = Boolean(failure && OFFLINE_CODES.has(failure.error));

        patch({
            loading: false,
            loggedIn: true,
            offline,
            user: (meResult && meResult.success && meResult.me.user) || account.user,
            device: account.device,
            settings: meResult && meResult.success ? meResult.me.settings : null,
            quota: meResult && meResult.success ? meResult.me.quota : null,
            devices: devicesResult && devicesResult.success ? devicesResult.devices : [],
            error: failure && !offline ? { code: failure.error, message: failure.message } : null
        });
    }, [patch]);

    useEffect(() => {
        mounted.current = true;
        reload();

        const api = bridge();
        const unsubscribe = api && typeof api.onLuxCloudAccountChanged === 'function'
            ? api.onLuxCloudAccountChanged(() => { reload(); })
            : null;

        return () => {
            mounted.current = false;
            if (unsubscribe) unsubscribe();
        };
    }, [reload]);

    const signIn = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudLogin !== 'function') return false;

        patch({ signingIn: true, error: null });
        const result = await api.luxCloudLogin();
        patch({ signingIn: false });

        if (!result || !result.success) {
            const silent = ['login_cancelled', 'login_denied'];
            if (result && !silent.includes(result.error)) {
                patch({ error: { code: result.error, message: result.message } });
            }
            return false;
        }

        await reload();
        return true;
    }, [patch, reload]);

    const cancelSignIn = useCallback(async () => {
        const api = bridge();
        if (api && typeof api.luxCloudCancelLogin === 'function') {
            await api.luxCloudCancelLogin();
        }
        patch({ signingIn: false });
    }, [patch]);

    const signOut = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudLogout !== 'function') return;

        patch({ loading: true });
        await api.luxCloudLogout();
        await reload();
    }, [patch, reload]);

    const updateSetting = useCallback(async (key: keyof LuxCloudSettings, value: boolean) => {
        const api = bridge();
        if (!api || typeof api.luxCloudUpdateSettings !== 'function') return false;

        const previous = state.settings;
        if (previous) patch({ settings: { ...previous, [key]: value } });

        const result = await api.luxCloudUpdateSettings({ [key]: value });
        if (!result || !result.success) {
            patch({
                settings: previous,
                error: result && !OFFLINE_CODES.has(result.error)
                    ? { code: result.error, message: result.message }
                    : null,
                offline: Boolean(result && OFFLINE_CODES.has(result.error))
            });
            return false;
        }

        patch({ settings: result.settings, offline: false });
        return true;
    }, [patch, state.settings]);

    const revokeDevice = useCallback(async (deviceUuid: string) => {
        const api = bridge();
        if (!api || typeof api.luxCloudRevokeDevice !== 'function') return false;

        const result = await api.luxCloudRevokeDevice(deviceUuid);
        if (!result || !result.success) {
            patch({ error: { code: result?.error || 'unknown_error', message: result?.message || 'Could not sign out that device.' } });
            return false;
        }

        await reload();
        return true;
    }, [patch, reload]);

    const clearError = useCallback(() => patch({ error: null }), [patch]);

    const value = useMemo<LuxAccountApi>(() => ({
        ...state,
        cancelSignIn,
        clearError,
        reload,
        revokeDevice,
        signIn,
        signOut,
        updateSetting
    }), [state, cancelSignIn, clearError, reload, revokeDevice, signIn, signOut, updateSetting]);

    return (
        <LuxAccountContext.Provider value={value}>
            {children}
        </LuxAccountContext.Provider>
    );
};

export default LuxAccountContext;
