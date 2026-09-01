import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Cloud, CloudDownload, RefreshCw, HardDrive, Clock, AlertTriangle, Monitor, Trash2
} from 'lucide-react';

import { useLuxAccount } from '../../context/LuxAccountContext';
import { useLuxSync } from '../../context/LuxSyncContext';
import CloudStatusBadge from './CloudStatusBadge';

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms: number) {
    if (!ms || ms < 60000) return '0m';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function daysUntil(timestamp: number | null) {
    if (!timestamp) return null;
    return Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000));
}

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function CloudDashboard({ onOpenInstance }: { onOpenInstance?: (name: string) => void }) {
    const { t } = useTranslation();
    const account = useLuxAccount();
    const sync = useLuxSync();

    const [localNames, setLocalNames] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadLocal = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.getInstances !== 'function') return;
        const list = await api.getInstances();
        if (Array.isArray(list)) {
            setLocalNames(new Set(list.map((entry: any) => entry.instanceId).filter(Boolean)));
        }
    }, []);

    useEffect(() => { loadLocal(); }, [loadLocal]);

    const instances = sync?.cloudInstances || [];

    const totals = useMemo(() => ({
        playtime: instances.reduce((sum, entry) => sum + (entry.playtimeTotalMs || 0), 0),
        expiring: instances.filter((entry) => {
            const days = daysUntil(entry.expiresAt);
            return !entry.everPulledElsewhere && days !== null && days <= 7;
        }).length
    }), [instances]);

    if (!account || !account.loggedIn) return null;

    const quota = account.quota;
    const percent = quota && quota.quotaBytes > 0
        ? Math.min(100, Math.round((quota.usedBytes / quota.quotaBytes) * 100))
        : 0;

    const download = async (instance: any) => {
        setBusy(instance.instanceUuid);
        try {
            await sync?.restoreInstance(instance.instanceUuid, { instanceName: instance.name });
            await loadLocal();
        } finally {
            setBusy(null);
        }
    };

    const removeFromCloud = async (instance: any) => {
        const api = bridge();
        if (!api || typeof api.luxCloudDeleteCloudInstance !== 'function') return;

        setBusy(instance.instanceUuid);
        setError(null);
        try {
            const result = await api.luxCloudDeleteCloudInstance(instance.instanceUuid);
            if (result && result.success === false) {
                setError(result.message || result.error);
                return;
            }
            setConfirmRemove(null);
            await sync?.refresh();
            await account.reload();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="flex items-center gap-1.5 text-xs text-white/40">
                        <HardDrive size={11} />
                        {t('cloud.dashboard.storage', 'Storage')}
                    </p>
                    <p className="mt-1.5 text-lg font-semibold text-white">
                        {quota ? formatBytes(quota.usedBytes) : '—'}
                        <span className="text-sm font-normal text-white/35">
                            {' / '}{quota ? formatBytes(quota.quotaBytes) : '—'}
                        </span>
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                            className={`h-full rounded-full transition-[width] ${percent > 90 ? 'bg-red-400' : 'bg-sky-400'}`}
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="flex items-center gap-1.5 text-xs text-white/40">
                        <Cloud size={11} />
                        {t('cloud.dashboard.instances', 'Cloud instances')}
                    </p>
                    <p className="mt-1.5 text-lg font-semibold text-white">
                        {quota ? quota.instanceCount : instances.length}
                        <span className="text-sm font-normal text-white/35">
                            {' / '}{quota ? quota.maxInstances : '—'}
                        </span>
                    </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="flex items-center gap-1.5 text-xs text-white/40">
                        <Clock size={11} />
                        {t('cloud.dashboard.playtime', 'Playtime in the cloud')}
                    </p>
                    <p className="mt-1.5 text-lg font-semibold text-white">{formatDuration(totals.playtime)}</p>
                </div>
            </div>

            {totals.expiring > 0 && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200/85">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    {t('cloud.dashboard.expiring', {
                        defaultValue:
                            '{{count}} instance has never been downloaded on a second PC and will be removed from the cloud soon. Your local files stay untouched.',
                        defaultValue_plural:
                            '{{count}} instances have never been downloaded on a second PC and will be removed from the cloud soon. Your local files stay untouched.',
                        count: totals.expiring
                    })}
                </p>
            )}

            <div className="rounded-xl border border-white/10 bg-white/[0.02]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">
                        {t('cloud.dashboard.title', 'Your cloud instances')}
                    </h3>
                    <button
                        type="button"
                        onClick={() => { sync?.refresh(); loadLocal(); }}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/25 hover:text-white"
                    >
                        <RefreshCw size={11} className={sync?.loading ? 'animate-spin' : ''} />
                        {t('cloud.dashboard.refresh', 'Refresh')}
                    </button>
                </div>

                {instances.length === 0 && (
                    <p className="px-4 py-10 text-center text-sm text-white/40">
                        {sync?.loading
                            ? t('cloud.dashboard.loading', 'Loading...')
                            : t('cloud.dashboard.empty', 'No instance is in the cloud yet. Open one and turn on Cloud Sync.')}
                    </p>
                )}

                <div className="divide-y divide-white/5">
                    {instances.map((instance) => {
                        const isLocal = localNames.has(instance.instanceUuid);
                        const days = daysUntil(instance.expiresAt);
                        const status = isLocal
                            ? (sync ? sync.statusFor(instance.name, instance.instanceUuid) : 'synced')
                            : 'cloud-only';

                        return (
                            <div key={instance.instanceUuid} className="flex items-center gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            disabled={!isLocal || !onOpenInstance}
                                            onClick={() => onOpenInstance && onOpenInstance(instance.name)}
                                            className="truncate text-sm font-medium text-white enabled:hover:text-sky-300 disabled:cursor-default"
                                        >
                                            {instance.name}
                                        </button>
                                        <CloudStatusBadge status={status} compact />
                                    </div>

                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/40">
                                        <span>{[instance.mcVersion, instance.loader].filter(Boolean).join(' · ') || '—'}</span>
                                        <span className="text-white/20">·</span>
                                        <span>v{instance.revision}</span>
                                        <span className="text-white/20">·</span>
                                        <span>{formatBytes(instance.logicalBytes)}</span>
                                        {instance.playtimeTotalMs > 0 && (
                                            <>
                                                <span className="text-white/20">·</span>
                                                <span>{formatDuration(instance.playtimeTotalMs)}</span>
                                            </>
                                        )}
                                        {!isLocal && (
                                            <>
                                                <span className="text-white/20">·</span>
                                                <span className="text-violet-300/70">
                                                    {t('cloud.dashboard.not_here', 'not on this PC')}
                                                </span>
                                            </>
                                        )}
                                    </p>

                                    {!instance.everPulledElsewhere && days !== null && days <= 7 && (
                                        <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300/80">
                                            <AlertTriangle size={10} />
                                            {t('cloud.dashboard.expires_in', {
                                                defaultValue: 'Removed from the cloud in {{count}} day unless another PC syncs it',
                                                defaultValue_plural: 'Removed from the cloud in {{count}} days unless another PC syncs it',
                                                count: Math.max(days, 0)
                                            })}
                                        </p>
                                    )}
                                </div>

                                {!isLocal && confirmRemove !== instance.instanceUuid && (
                                    <button
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() => download(instance)}
                                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-40"
                                    >
                                        <CloudDownload size={12} />
                                        {busy === instance.instanceUuid
                                            ? t('cloud.dashboard.downloading', 'Downloading...')
                                            : t('cloud.dashboard.download', 'Download')}
                                    </button>
                                )}

                                {confirmRemove === instance.instanceUuid ? (
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <button
                                            type="button"
                                            disabled={busy !== null}
                                            onClick={() => removeFromCloud(instance)}
                                            className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-red-400 disabled:opacity-50"
                                        >
                                            {busy === instance.instanceUuid
                                                ? t('cloud.dashboard.removing', 'Removing...')
                                                : t('cloud.dashboard.remove_confirm', 'Really remove')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmRemove(null)}
                                            className="rounded-lg px-2 py-1.5 text-xs text-white/45 transition hover:text-white/75"
                                        >
                                            {t('cloud.dashboard.remove_cancel', 'Cancel')}
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        title={t('cloud.dashboard.remove_hint',
                                            'Removes the cloud copy only. The folder on this PC stays as it is.')}
                                        onClick={() => setConfirmRemove(instance.instanceUuid)}
                                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/45 transition hover:border-red-400/30 hover:text-red-300"
                                    >
                                        <Trash2 size={12} />
                                        {t('cloud.dashboard.remove', 'Remove')}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {error && (
                    <p className="m-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{error}</p>
                )}
            </div>

            {account.devices && account.devices.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-white">
                        <Monitor size={13} />
                        {t('cloud.dashboard.devices', 'Connected PCs')}
                    </h3>
                    <ul className="space-y-1.5 text-xs">
                        {account.devices.map((device) => (
                            <li key={device.deviceUuid} className="flex items-center justify-between gap-3">
                                <span className="truncate text-white/70">
                                    {device.name || device.deviceUuid}
                                    {device.isCurrent && (
                                        <span className="ml-1.5 text-[10px] text-emerald-300">
                                            {t('cloud.dashboard.this_pc', 'this PC')}
                                        </span>
                                    )}
                                </span>
                                <span className="shrink-0 text-white/30">
                                    {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleDateString() : '—'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
