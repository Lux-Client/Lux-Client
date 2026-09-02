import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, CloudOff, AlertTriangle, X } from 'lucide-react';

import { useLuxSync } from '../../context/LuxSyncContext';
import { useAnimationsEnabled } from '../../hooks/useAnimationsEnabled';
import { useTitlebarPopover } from '../../hooks/useTitlebarPopover';

// Kept in sync with the notification bell so both title-bar popovers match.
const PANEL_MOTION =
    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-2 ' +
    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-top-2';

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const PHASE_KEYS: Record<string, [string, string]> = {
    manifest: ['cloud.transfer.phase_manifest', 'Checking files'],
    negotiate: ['cloud.transfer.phase_negotiate', 'Comparing with the cloud'],
    upload: ['cloud.transfer.phase_upload', 'Uploading'],
    commit: ['cloud.transfer.phase_commit', 'Finishing'],
    download: ['cloud.transfer.phase_download', 'Downloading']
};

export default function CloudTransferPanel() {
    const { t } = useTranslation();
    const sync = useLuxSync();
    const animationsEnabled = useAnimationsEnabled();
    const { containerRef, open, mounted, state, toggle } = useTitlebarPopover<HTMLDivElement>(animationsEnabled);

    if (!sync) return null;

    const transfers = sync.activeTransfers;
    const failures = Object.values(sync.transferFailures || {});
    if (transfers.length === 0 && failures.length === 0 && !sync.offline) return null;

    if (transfers.length === 0 && failures.length > 0) {
        return (
            <div ref={containerRef} className="relative">
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className="flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 transition hover:bg-red-500/20"
                >
                    <AlertTriangle size={11} />
                    {t('cloud.transfer.failed_short', 'Sync failed')}
                    <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {mounted && (
                    <div
                        data-state={state}
                        className={`absolute right-0 top-full z-50 mt-2 w-72 origin-top-right rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl data-[state=closed]:pointer-events-none ${
                            animationsEnabled ? PANEL_MOTION : ''
                        }`}
                    >
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                            {t('cloud.transfer.title', 'Cloud sync')}
                        </p>
                        <div className="space-y-2">
                            {failures.map((failure) => (
                                <div key={failure.instanceName} className="rounded-lg border border-red-400/20 bg-red-500/5 p-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="min-w-0 truncate text-xs text-white/80">{failure.instanceName}</span>
                                        <button
                                            type="button"
                                            onClick={() => sync.dismissTransferFailure(failure.instanceName)}
                                            className="shrink-0 text-white/30 transition hover:text-white/70"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-red-300/80">{failure.message}</p>
                                    <p className="mt-0.5 font-mono text-[10px] text-white/30">
                                        {failure.error}{failure.path ? ` · ${failure.path}` : ''}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (transfers.length === 0 && sync.offline) {
        return (
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/45">
                <CloudOff size={11} />
                {t('cloud.transfer.offline', 'Cloud offline')}
            </div>
        );
    }

    const total = transfers.reduce((sum, entry) => sum + (entry.progress.totalBytes || 0), 0);
    const moved = transfers.reduce(
        (sum, entry) => sum + (entry.progress.sentBytes || entry.progress.processedBytes || entry.progress.downloadedBytes || 0),
        0
    );
    const percent = total > 0 ? Math.min(100, Math.round((moved / total) * 100)) : 0;

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 transition hover:bg-sky-500/20"
            >
                <RefreshCw size={11} className="animate-spin" />
                {total > 0
                    ? `${percent}%`
                    : t('cloud.transfer.working', 'Syncing')}
                <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {mounted && (
                <div
                    data-state={state}
                    className={`absolute right-0 top-full z-50 mt-2 w-72 origin-top-right rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl data-[state=closed]:pointer-events-none ${
                        animationsEnabled ? PANEL_MOTION : ''
                    }`}
                >
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                        {t('cloud.transfer.title', 'Cloud sync')}
                    </p>

                    <div className="space-y-3">
                        {transfers.map(({ instanceName, progress }) => {
                            const [key, fallback] = PHASE_KEYS[progress.phase] || PHASE_KEYS.manifest;
                            const done = progress.sentBytes || progress.processedBytes || progress.downloadedBytes || 0;
                            const instancePercent = progress.totalBytes
                                ? Math.min(100, Math.round((done / progress.totalBytes) * 100))
                                : null;

                            return (
                                <div key={instanceName}>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="min-w-0 truncate text-xs text-white/80">{instanceName}</span>
                                        {progress.auto && (
                                            <span className="shrink-0 text-[10px] text-white/25">
                                                {t('cloud.transfer.auto', 'automatic')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-white/40">
                                        {t(key, fallback)}
                                        {progress.totalBytes ? ` · ${formatBytes(done)} / ${formatBytes(progress.totalBytes)}` : ''}
                                    </p>
                                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                                        <div
                                            className={`h-full rounded-full bg-sky-400 ${
                                                instancePercent === null ? 'w-1/3 animate-pulse' : 'transition-[width]'
                                            }`}
                                            style={instancePercent === null ? undefined : { width: `${instancePercent}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
