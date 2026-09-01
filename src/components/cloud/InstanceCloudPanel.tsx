import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, History, CloudOff, Trash2, Clock, AlertTriangle } from 'lucide-react';

import { useLuxAccount } from '../../context/LuxAccountContext';
import { useLuxSync } from '../../context/LuxSyncContext';
import CloudStatusBadge from './CloudStatusBadge';
import RevisionHistoryModal from './RevisionHistoryModal';
import ToggleBox from '../ToggleBox';

type Props = {
    instanceName: string;
    instanceId?: string | null;
};

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

function formatWhen(value: string | number | null | undefined, t: any) {
    if (!value) return t('cloud.instance.never', 'never');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('cloud.instance.never', 'never');

    const diff = Date.now() - date.getTime();
    if (diff < 60000) return t('cloud.instance.just_now', 'just now');
    if (diff < 86400000) {
        return t('cloud.instance.today_at', {
            defaultValue: 'Today, {{time}}',
            time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    }
    return date.toLocaleDateString();
}

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function InstanceCloudPanel({ instanceName, instanceId }: Props) {
    const { t } = useTranslation();
    const account = useLuxAccount();
    const sync = useLuxSync();

    const [busy, setBusy] = useState(false);
    const [playtime, setPlaytime] = useState<any>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const cloudInstance = (sync?.cloudInstances || []).find(
        (entry) => entry.instanceUuid === instanceId || entry.name === instanceName
    );

    const status = sync ? sync.statusFor(instanceName, instanceId) : 'local';
    const progress = sync?.progress[instanceName];

    const loadPlaytime = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudGetPlaytime !== 'function') return;
        const result = await api.luxCloudGetPlaytime(instanceName);
        if (result && result.success !== false) setPlaytime(result);
    }, [instanceName]);

    useEffect(() => { loadPlaytime(); }, [loadPlaytime]);

    if (!account || !account.loggedIn) return null;

    const runSync = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const result = await sync?.syncInstance(instanceName, {});
            if (result && result.success === false) {
                setMessage(result.message || result.error);
            } else if (result && result.skipped) {
                setMessage(t('cloud.instance.nothing_changed', 'Nothing changed since the last sync.'));
            }
            await loadPlaytime();
        } finally {
            setBusy(false);
        }
    };

    const updateScope = async (key: 'syncWorlds' | 'syncScreenshots' | 'crossPlatform', value: boolean) => {
        const api = bridge();
        if (!api || !cloudInstance) return;
        setBusy(true);
        try {
            await api.luxCloudSyncInstance(instanceName, { [key]: value });
            await sync?.refresh();
        } finally {
            setBusy(false);
        }
    };

    const removeFromCloud = async () => {
        const api = bridge();
        if (!api || !cloudInstance) return;
        setBusy(true);
        try {
            await api.luxCloudListCloudInstances('active');
            setMessage(t('cloud.instance.remove_hint',
                'Removing from the cloud is available in the account settings.'));
        } finally {
            setBusy(false);
        }
    };

    const percent = progress && progress.totalBytes
        ? Math.min(100, ((progress.sentBytes || progress.downloadedBytes || 0) / progress.totalBytes) * 100)
        : null;

    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                        {t('cloud.instance.title', 'Lux Cloud')}
                    </h3>
                    <CloudStatusBadge status={status} percent={percent} />
                </div>

                <button
                    type="button"
                    disabled={busy || status === 'syncing'}
                    onClick={runSync}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-40"
                >
                    <RefreshCw size={12} className={busy || status === 'syncing' ? 'animate-spin' : ''} />
                    {t('cloud.instance.sync_now', 'Sync now')}
                </button>
            </div>

            {progress && progress.totalBytes ? (
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                        className="h-full rounded-full bg-sky-400 transition-[width]"
                        style={{ width: `${percent || 0}%` }}
                    />
                </div>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div>
                    <dt className="text-white/40">{t('cloud.instance.last_sync', 'Last sync')}</dt>
                    <dd className="text-white/80">{formatWhen(cloudInstance?.lastTouchedAt, t)}</dd>
                </div>
                <div>
                    <dt className="text-white/40">{t('cloud.instance.version', 'Version')}</dt>
                    <dd className="text-white/80">
                        {cloudInstance ? `v${cloudInstance.revision}` : t('cloud.instance.not_synced', 'not synced yet')}
                    </dd>
                </div>
                <div>
                    <dt className="flex items-center gap-1 text-white/40">
                        <Clock size={10} />
                        {t('cloud.instance.playtime', 'Playtime')}
                    </dt>
                    <dd className="text-white/80">
                        {formatDuration(playtime?.totalMs || cloudInstance?.playtimeTotalMs || 0)}
                        {playtime && playtime.byDevice && playtime.byDevice.length > 1 && (
                            <span className="text-white/35">
                                {' '}({t('cloud.instance.this_device', {
                                    defaultValue: 'this PC: {{value}}',
                                    value: formatDuration(playtime.deviceTotalMs || 0)
                                })})
                            </span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-white/40">{t('cloud.instance.size', 'Size in the cloud')}</dt>
                    <dd className="text-white/80">{formatBytes(cloudInstance?.logicalBytes || 0)}</dd>
                </div>
            </dl>

            {cloudInstance && (
                <>
                    <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                        <ToggleBox
                            label={t('cloud.instance.cross_platform', 'Cross-platform')}
                            description={t('cloud.instance.cross_platform_hint',
                                'Allow restoring this instance on Windows, macOS and Linux.')}
                            checked={cloudInstance.crossPlatform}
                            onChange={(value: boolean) => updateScope('crossPlatform', value)}
                        />
                        <ToggleBox
                            label={t('cloud.instance.sync_worlds', 'Sync worlds')}
                            description={t('cloud.instance.sync_worlds_hint',
                                'Off by default — worlds are large and the most common source of conflicts.')}
                            checked={cloudInstance.syncWorlds}
                            onChange={(value: boolean) => updateScope('syncWorlds', value)}
                        />
                        <ToggleBox
                            label={t('cloud.instance.sync_screenshots', 'Sync screenshots')}
                            checked={cloudInstance.syncScreenshots}
                            onChange={(value: boolean) => updateScope('syncScreenshots', value)}
                        />
                    </div>

                    <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4">
                        <button
                            type="button"
                            onClick={() => setShowHistory(true)}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:border-white/25 hover:text-white"
                        >
                            <History size={12} />
                            {t('cloud.instance.history', 'Version history')}
                        </button>
                        <button
                            type="button"
                            onClick={removeFromCloud}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/45 transition hover:border-red-400/30 hover:text-red-300"
                        >
                            <Trash2 size={12} />
                            {t('cloud.instance.remove', 'Remove from cloud')}
                        </button>
                    </div>
                </>
            )}

            {cloudInstance && !cloudInstance.everPulledElsewhere && cloudInstance.expiresAt && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200/85">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                        {t('cloud.instance.expiry_warning', {
                            defaultValue:
                                'No other PC has downloaded this instance yet. Lux Cloud moves instances between machines, '
                                + 'so it will be removed from the cloud on {{date}}. Open it on a second PC to keep it.',
                            date: new Date(cloudInstance.expiresAt).toLocaleDateString()
                        })}
                        <strong className="mt-1 block font-medium text-amber-100/90">
                            {t('cloud.instance.expiry_local_safe',
                                'Your local files stay exactly as they are.')}
                        </strong>
                    </span>
                </p>
            )}

            {!cloudInstance && status === 'local' && (
                <p className="mt-3 flex items-center gap-2 text-xs text-white/40">
                    <CloudOff size={12} />
                    {t('cloud.instance.not_linked',
                        'This instance is only on this PC. Sync it to make it available everywhere.')}
                </p>
            )}

            {message && (
                <p className="mt-3 rounded-lg bg-white/[0.04] p-2.5 text-xs text-white/60">{message}</p>
            )}

            <RevisionHistoryModal
                open={showHistory}
                instanceUuid={cloudInstance?.instanceUuid || null}
                currentRevision={cloudInstance?.revision || 0}
                onClose={() => setShowHistory(false)}
                onRolledBack={() => { sync?.refresh(); loadPlaytime(); }}
            />
        </div>
    );
}
