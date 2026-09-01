import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, X } from 'lucide-react';

import { useLuxAccount } from '../../context/LuxAccountContext';
import { useLuxSync } from '../../context/LuxSyncContext';
import SyncConflictModal from './SyncConflictModal';
import CloudOnboardingModal from './CloudOnboardingModal';

const ONBOARDING_KEY = 'lux.cloud.onboarding.seen';

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

function readSeen(): Set<string> {
    try {
        const raw = window.localStorage.getItem(ONBOARDING_KEY);
        return new Set(raw ? JSON.parse(raw) : []);
    } catch {
        return new Set();
    }
}

function markSeen(userId: number) {
    try {
        const seen = readSeen();
        seen.add(String(userId));
        window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify([...seen]));
    } catch {
        // A missing localStorage only means the wizard shows again next time.
    }
}

export default function CloudOverlays() {
    const { t } = useTranslation();
    const account = useLuxAccount();
    const sync = useLuxSync();

    const [localInstances, setLocalInstances] = useState<{ name: string; instanceId?: string | null }[]>([]);
    const [onboardingOpen, setOnboardingOpen] = useState(false);

    useEffect(() => {
        if (!account || !account.loggedIn || !account.user) return;
        if (readSeen().has(String(account.user.id))) return;

        const api = bridge();
        if (!api || typeof api.getInstances !== 'function') return;

        let cancelled = false;
        (async () => {
            const list = await api.getInstances();
            if (cancelled || !Array.isArray(list)) return;

            setLocalInstances(list.map((entry: any) => ({
                name: entry.name,
                instanceId: entry.instanceId || null
            })));
            setOnboardingOpen(true);
        })();

        return () => { cancelled = true; };
    }, [account?.loggedIn, account?.user?.id]);

    const firstConflict = useMemo(() => {
        const entries = Object.values(sync?.conflicts || {});
        return entries.length > 0 ? entries[0] : null;
    }, [sync?.conflicts]);

    const closeOnboarding = () => {
        if (account?.user) markSeen(account.user.id);
        setOnboardingOpen(false);
    };

    if (!account || !account.loggedIn) return null;

    return (
        <>
            <CloudOnboardingModal
                open={onboardingOpen}
                username={account.user?.username || ''}
                localInstances={localInstances}
                quota={account.quota}
                onClose={closeOnboarding}
            />

            <SyncConflictModal
                conflict={firstConflict}
                onResolve={async (choice) => {
                    if (!firstConflict) return null;
                    return sync?.resolveConflict(firstConflict.instanceName, choice);
                }}
                onDismiss={() => {
                    if (firstConflict) sync?.dismissConflict(firstConflict.instanceName);
                }}
            />

            {sync?.sessionWarning && (
                <div className="fixed bottom-4 right-4 z-[110] w-80 rounded-xl border border-amber-400/25 bg-[#1a1a1a] p-4 shadow-2xl">
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
                            <Monitor size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">
                                {t('cloud.session.title', 'Also open somewhere else')}
                            </p>
                            <p className="mt-1 text-xs text-white/55">
                                {t('cloud.session.body', {
                                    defaultValue: '"{{instance}}" is currently open on {{device}}. Playing on both can cause a conflict.',
                                    instance: sync.sessionWarning.instanceName,
                                    device: sync.sessionWarning.others[0]?.deviceName || t('cloud.session.other_pc', 'another PC')
                                })}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => sync.dismissSessionWarning()}
                            className="shrink-0 rounded p-1 text-white/35 transition hover:bg-white/10 hover:text-white/70"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
