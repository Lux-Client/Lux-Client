import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, RotateCcw, Loader2, Monitor, Globe } from 'lucide-react';

type Revision = {
    revision: number;
    parentRevision: number | null;
    entryCount: number;
    logicalBytes: number;
    hasWorlds: boolean;
    createdAt: string;
    device: { deviceUuid: string; name: string | null } | null;
};

type Props = {
    open: boolean;
    instanceUuid: string | null;
    currentRevision: number;
    onClose: () => void;
    onRolledBack: () => void;
};

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function RevisionHistoryModal({
    open,
    instanceUuid,
    currentRevision,
    onClose,
    onRolledBack
}: Props) {
    const { t } = useTranslation();
    const [revisions, setRevisions] = useState<Revision[]>([]);
    const [loading, setLoading] = useState(false);
    const [rollingBack, setRollingBack] = useState<number | null>(null);
    const [confirm, setConfirm] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const api = bridge();
        if (!api || !instanceUuid || typeof api.luxCloudListRevisions !== 'function') return;

        setLoading(true);
        setError(null);
        try {
            const result = await api.luxCloudListRevisions(instanceUuid);
            if (result && result.success === false) setError(result.message || result.error);
            else setRevisions(result?.revisions || []);
        } finally {
            setLoading(false);
        }
    }, [instanceUuid]);

    useEffect(() => { if (open) load(); }, [open, load]);

    if (!open) return null;

    const rollback = async (revision: number) => {
        const api = bridge();
        if (!api || !instanceUuid) return;

        setRollingBack(revision);
        setError(null);
        try {
            const result = await api.luxCloudRollback(instanceUuid, revision);
            if (result && result.success === false) {
                setError(result.message || result.error);
            } else {
                setConfirm(null);
                onRolledBack();
                await load();
            }
        } finally {
            setRollingBack(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[124] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#161616] shadow-2xl">
                <div className="flex items-center gap-3 border-b border-white/10 p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70">
                        <History size={17} />
                    </span>
                    <div>
                        <h2 className="text-base font-semibold text-white">
                            {t('cloud.history.title', 'Version history')}
                        </h2>
                        <p className="text-xs text-white/45">
                            {t('cloud.history.subtitle',
                                'Older versions are kept for a while and can be restored.')}
                        </p>
                    </div>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                    {loading && (
                        <div className="flex justify-center py-8">
                            <Loader2 size={22} className="animate-spin text-white/40" />
                        </div>
                    )}

                    {!loading && revisions.length === 0 && (
                        <p className="py-8 text-center text-sm text-white/40">
                            {t('cloud.history.empty', 'No versions yet.')}
                        </p>
                    )}

                    {revisions.map((revision) => {
                        const isCurrent = revision.revision === currentRevision;
                        return (
                            <div
                                key={revision.revision}
                                className={`rounded-xl border p-3 ${
                                    isCurrent
                                        ? 'border-emerald-400/30 bg-emerald-500/[0.07]'
                                        : 'border-white/10 bg-white/[0.02]'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="flex items-center gap-2 text-sm text-white">
                                            v{revision.revision}
                                            {isCurrent && (
                                                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                                                    {t('cloud.history.current', 'current')}
                                                </span>
                                            )}
                                            {revision.hasWorlds && (
                                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                                                    {t('cloud.history.with_worlds', 'with worlds')}
                                                </span>
                                            )}
                                        </p>
                                        <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-white/40">
                                            {new Date(revision.createdAt).toLocaleString()}
                                            <span className="text-white/20">·</span>
                                            {t('cloud.history.files', {
                                                defaultValue: '{{count}} files',
                                                count: revision.entryCount
                                            })}
                                            <span className="text-white/20">·</span>
                                            {formatBytes(revision.logicalBytes)}
                                        </p>
                                        {revision.device && (
                                            <p className="mt-0.5 flex items-center gap-1 text-xs text-white/30">
                                                <Monitor size={10} />
                                                {revision.device.name || revision.device.deviceUuid}
                                            </p>
                                        )}
                                    </div>

                                    {!isCurrent && (
                                        confirm === revision.revision ? (
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    disabled={rollingBack !== null}
                                                    onClick={() => rollback(revision.revision)}
                                                    className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-black transition hover:bg-amber-400 disabled:opacity-50"
                                                >
                                                    {rollingBack === revision.revision
                                                        ? t('cloud.history.restoring', 'Restoring...')
                                                        : t('cloud.history.confirm', 'Really restore')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirm(null)}
                                                    className="rounded-lg px-2 py-1 text-xs text-white/45 hover:text-white/75"
                                                >
                                                    {t('cloud.history.cancel', 'Cancel')}
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => setConfirm(revision.revision)}
                                                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/25 hover:text-white"
                                            >
                                                <RotateCcw size={11} />
                                                {t('cloud.history.restore', 'Restore')}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {error && (
                        <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{error}</p>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-white/10 p-4">
                    <p className="flex items-center gap-1.5 text-xs text-white/35">
                        <Globe size={11} />
                        {t('cloud.history.rollback_note',
                            'Restoring adds a new version on top — nothing is deleted.')}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
                    >
                        {t('cloud.history.close', 'Close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
