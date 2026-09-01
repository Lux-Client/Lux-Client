import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, CloudUpload, CloudDownload, Check, Loader2 } from 'lucide-react';

import { useLuxSync } from '../../context/LuxSyncContext';
import type { CloudInstance } from '../../context/LuxSyncContext';

type LocalInstance = { name: string; instanceId?: string | null };

type Props = {
    open: boolean;
    username: string;
    localInstances: LocalInstance[];
    quota: { usedBytes: number; quotaBytes: number; instanceCount: number; maxInstances: number } | null;
    onClose: () => void;
};

type Estimate = { uploadBytes: number; totalBytes: number; loading: boolean };

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function CloudOnboardingModal({ open, username, localInstances, quota, onClose }: Props) {
    const { t } = useTranslation();
    const sync = useLuxSync();

    const [step, setStep] = useState<'welcome' | 'upload' | 'download' | 'working' | 'done'>('welcome');
    const [selectedUp, setSelectedUp] = useState<Set<string>>(new Set());
    const [selectedDown, setSelectedDown] = useState<Set<string>>(new Set());
    const [estimates, setEstimates] = useState<Record<string, Estimate>>({});
    const [busyName, setBusyName] = useState<string | null>(null);
    const [failures, setFailures] = useState<{ name: string; message: string }[]>([]);

    const cloudNames = useMemo(
        () => new Set((sync?.cloudInstances || []).map((entry) => entry.instanceUuid)),
        [sync?.cloudInstances]
    );

    const notInCloud = useMemo(
        () => localInstances.filter((entry) => !entry.instanceId || !cloudNames.has(entry.instanceId)),
        [localInstances, cloudNames]
    );

    const notLocal = useMemo(() => {
        const localIds = new Set(localInstances.map((entry) => entry.instanceId).filter(Boolean));
        return (sync?.cloudInstances || []).filter((entry) => !localIds.has(entry.instanceUuid));
    }, [localInstances, sync?.cloudInstances]);

    useEffect(() => {
        if (!open || step !== 'upload') return;

        const api = bridge();
        if (!api || typeof api.luxCloudPreviewManifest !== 'function') return;

        let cancelled = false;
        (async () => {
            for (const instance of notInCloud) {
                if (cancelled) return;
                if (estimates[instance.name]) continue;

                setEstimates((current) => ({
                    ...current,
                    [instance.name]: { uploadBytes: 0, totalBytes: 0, loading: true }
                }));

                try {
                    const result = await api.luxCloudPreviewManifest(instance.name, {});
                    if (cancelled) return;
                    setEstimates((current) => ({
                        ...current,
                        [instance.name]: {
                            uploadBytes: result?.summary?.uploadBytes || 0,
                            totalBytes: result?.summary?.totalBytes || 0,
                            loading: false
                        }
                    }));
                } catch {
                    if (cancelled) return;
                    setEstimates((current) => ({
                        ...current,
                        [instance.name]: { uploadBytes: 0, totalBytes: 0, loading: false }
                    }));
                }
            }
        })();

        return () => { cancelled = true; };
    }, [open, step, notInCloud, estimates]);

    if (!open) return null;

    const plannedBytes = [...selectedUp].reduce(
        (sum, name) => sum + (estimates[name]?.uploadBytes || 0),
        0
    );
    const quotaAfter = (quota?.usedBytes || 0) + plannedBytes;
    const overQuota = quota ? quotaAfter > quota.quotaBytes : false;
    const overInstanceLimit = quota
        ? (quota.instanceCount + selectedUp.size) > quota.maxInstances
        : false;

    const toggle = (set: Set<string>, value: string, apply: (next: Set<string>) => void) => {
        const next = new Set(set);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        apply(next);
    };

    const runUploads = async () => {
        setStep('working');
        const problems: { name: string; message: string }[] = [];

        for (const name of selectedUp) {
            setBusyName(name);
            const result = await sync?.syncInstance(name, {});
            if (result && result.success === false) {
                problems.push({ name, message: result.message || result.error });
            }
        }

        for (const uuid of selectedDown) {
            const instance = notLocal.find((entry) => entry.instanceUuid === uuid);
            setBusyName(instance ? instance.name : uuid);
            const result = await sync?.restoreInstance(uuid, { instanceName: instance?.name });
            if (result && result.success === false) {
                problems.push({ name: instance?.name || uuid, message: result.message || result.error });
            }
        }

        setBusyName(null);
        setFailures(problems);
        setStep('done');
    };

    const stepIndicator = (
        <div className="flex items-center gap-1.5">
            {['welcome', 'upload', 'download', 'done'].map((name) => (
                <span
                    key={name}
                    className={`h-1 w-6 rounded-full ${
                        name === step || (step === 'working' && name === 'done')
                            ? 'bg-sky-400'
                            : 'bg-white/15'
                    }`}
                />
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#161616] shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/10 p-5">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
                            <Cloud size={18} />
                        </span>
                        <div>
                            <h2 className="text-base font-semibold text-white">
                                {t('cloud.onboarding.title', 'Set up Lux Cloud')}
                            </h2>
                            <p className="text-xs text-white/45">
                                {t('cloud.onboarding.signed_in', { defaultValue: 'Signed in as {{name}}', name: username })}
                            </p>
                        </div>
                    </div>
                    {stepIndicator}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {step === 'welcome' && (
                        <div className="space-y-4 text-sm text-white/70">
                            <p>
                                {t('cloud.onboarding.welcome',
                                    'Your instances can now follow you between PCs. Nothing is uploaded until you pick it here.')}
                            </p>
                            <ul className="space-y-2 text-xs text-white/50">
                                <li className="flex gap-2">
                                    <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                                    {t('cloud.onboarding.point_mods',
                                        'Mods from Modrinth are not uploaded at all — the other PC fetches them directly.')}
                                </li>
                                <li className="flex gap-2">
                                    <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                                    {t('cloud.onboarding.point_worlds',
                                        'Worlds and screenshots stay off by default. You can turn them on per instance.')}
                                </li>
                                <li className="flex gap-2">
                                    <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                                    {t('cloud.onboarding.point_local',
                                        'Lux keeps working without a Lux account. Nothing here is required.')}
                                </li>
                            </ul>
                        </div>
                    )}

                    {step === 'upload' && (
                        <div className="space-y-3">
                            <p className="text-sm text-white/70">
                                {t('cloud.onboarding.found_local', {
                                    defaultValue: 'We found {{count}} instance that is not in the cloud yet.',
                                    defaultValue_plural: 'We found {{count}} instances that are not in the cloud yet.',
                                    count: notInCloud.length
                                })}
                            </p>

                            {notInCloud.length === 0 && (
                                <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/45">
                                    {t('cloud.onboarding.nothing_local', 'Everything here is already in the cloud.')}
                                </p>
                            )}

                            {notInCloud.map((instance) => {
                                const estimate = estimates[instance.name];
                                const checked = selectedUp.has(instance.name);
                                return (
                                    <label
                                        key={instance.name}
                                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                                            checked
                                                ? 'border-sky-400/40 bg-sky-500/[0.08]'
                                                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggle(selectedUp, instance.name, setSelectedUp)}
                                            className="h-4 w-4 accent-sky-400"
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm text-white">{instance.name}</span>
                                        <span className="shrink-0 text-right text-xs">
                                            {estimate?.loading ? (
                                                <span className="flex items-center gap-1 text-white/35">
                                                    <Loader2 size={11} className="animate-spin" />
                                                    {t('cloud.onboarding.measuring', 'measuring')}
                                                </span>
                                            ) : estimate ? (
                                                <>
                                                    <span className="text-sky-300">{formatBytes(estimate.uploadBytes)}</span>
                                                    <span className="text-white/30"> {t('cloud.onboarding.upload_of', 'upload')}</span>
                                                </>
                                            ) : (
                                                <span className="text-white/25">—</span>
                                            )}
                                        </span>
                                    </label>
                                );
                            })}

                            {quota && (
                                <div className={`rounded-lg p-3 text-xs ${
                                    overQuota || overInstanceLimit
                                        ? 'bg-red-500/10 text-red-200'
                                        : 'bg-white/[0.03] text-white/50'
                                }`}>
                                    {overInstanceLimit
                                        ? t('cloud.onboarding.over_limit', {
                                            defaultValue: 'That would be more than {{max}} cloud instances.',
                                            max: quota.maxInstances
                                        })
                                        : t('cloud.onboarding.after_upload', {
                                            defaultValue: 'Storage after upload: {{used}} of {{total}}',
                                            used: formatBytes(quotaAfter),
                                            total: formatBytes(quota.quotaBytes)
                                        })}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'download' && (
                        <div className="space-y-3">
                            <p className="text-sm text-white/70">
                                {t('cloud.onboarding.found_cloud', {
                                    defaultValue: '{{count}} instance in your cloud is not on this PC.',
                                    defaultValue_plural: '{{count}} instances in your cloud are not on this PC.',
                                    count: notLocal.length
                                })}
                            </p>

                            {notLocal.length === 0 && (
                                <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/45">
                                    {t('cloud.onboarding.nothing_cloud', 'Nothing to bring down.')}
                                </p>
                            )}

                            {notLocal.map((instance: CloudInstance) => {
                                const checked = selectedDown.has(instance.instanceUuid);
                                return (
                                    <label
                                        key={instance.instanceUuid}
                                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                                            checked
                                                ? 'border-violet-400/40 bg-violet-500/[0.08]'
                                                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggle(selectedDown, instance.instanceUuid, setSelectedDown)}
                                            className="h-4 w-4 accent-violet-400"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-white">{instance.name}</span>
                                            <span className="block truncate text-xs text-white/40">
                                                {[instance.mcVersion, instance.loader].filter(Boolean).join(' · ')}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-xs text-white/40">
                                            {formatBytes(instance.logicalBytes)}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}

                    {step === 'working' && (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <Loader2 size={28} className="animate-spin text-sky-300" />
                            <p className="text-sm text-white">{busyName}</p>
                            <p className="text-xs text-white/45">
                                {t('cloud.onboarding.working', 'You can close this window — it keeps running in the background.')}
                            </p>
                        </div>
                    )}

                    {step === 'done' && (
                        <div className="space-y-3 py-6 text-center">
                            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                                <Check size={22} />
                            </span>
                            <p className="text-sm text-white">
                                {failures.length === 0
                                    ? t('cloud.onboarding.done', 'All set.')
                                    : t('cloud.onboarding.done_partial', 'Finished, but some instances had trouble.')}
                            </p>
                            {failures.length > 0 && (
                                <ul className="mx-auto max-w-sm space-y-1 rounded-lg bg-red-500/[0.07] p-3 text-left text-xs text-red-200/80">
                                    {failures.map((failure) => (
                                        <li key={failure.name}>
                                            <span className="font-medium">{failure.name}</span>: {failure.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-white/10 p-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-white/50 transition hover:bg-white/5 hover:text-white/80"
                    >
                        {step === 'done'
                            ? t('cloud.onboarding.close', 'Close')
                            : t('cloud.onboarding.skip', 'Not now')}
                    </button>

                    {step === 'welcome' && (
                        <button
                            type="button"
                            onClick={() => setStep('upload')}
                            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-400"
                        >
                            {t('cloud.onboarding.start', 'Get started')}
                        </button>
                    )}

                    {step === 'upload' && (
                        <button
                            type="button"
                            disabled={overQuota || overInstanceLimit}
                            onClick={() => setStep('download')}
                            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <CloudUpload size={15} />
                            {t('cloud.onboarding.next', 'Continue')}
                        </button>
                    )}

                    {step === 'download' && (
                        <button
                            type="button"
                            disabled={selectedUp.size === 0 && selectedDown.size === 0}
                            onClick={runUploads}
                            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <CloudDownload size={15} />
                            {t('cloud.onboarding.run', {
                                defaultValue: 'Sync {{count}} instance',
                                defaultValue_plural: 'Sync {{count}} instances',
                                count: selectedUp.size + selectedDown.size
                            })}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
