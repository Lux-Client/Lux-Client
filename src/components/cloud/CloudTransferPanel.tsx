import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, CloudOff } from 'lucide-react';

import { useLuxSync } from '../../context/LuxSyncContext';

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
    const [open, setOpen] = useState(false);

    if (!sync) return null;

    const transfers = sync.activeTransfers;
    if (transfers.length === 0 && !sync.offline) return null;

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
        (sum, entry) => sum + (entry.progress.sentBytes || entry.progress.downloadedBytes || 0),
        0
    );
    const percent = total > 0 ? Math.min(100, Math.round((moved / total) * 100)) : 0;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 transition hover:bg-sky-500/20"
            >
                <RefreshCw size={11} className="animate-spin" />
                {total > 0
                    ? `${percent}%`
                    : t('cloud.transfer.working', 'Syncing')}
                <ChevronDown size={11} className={open ? 'rotate-180 transition' : 'transition'} />
            </button>

            {open && (
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                        {t('cloud.transfer.title', 'Cloud sync')}
                    </p>

                    <div className="space-y-3">
                        {transfers.map(({ instanceName, progress }) => {
                            const [key, fallback] = PHASE_KEYS[progress.phase] || PHASE_KEYS.manifest;
                            const done = progress.sentBytes || progress.downloadedBytes || 0;
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
