import React from 'react';
import { useTranslation } from 'react-i18next';
import { CloudDownload, RefreshCw, CloudOff, Check } from 'lucide-react';

export type PreLaunchPhase = 'checking' | 'updating' | 'ready' | 'offline';

type Props = {
    visible: boolean;
    instanceName: string;
    phase: PreLaunchPhase;
    files?: number;
    done?: number;
    downloadedBytes?: number;
};

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function PreLaunchSyncOverlay({
    visible,
    instanceName,
    phase,
    files = 0,
    done = 0,
    downloadedBytes = 0
}: Props) {
    const { t } = useTranslation();
    if (!visible) return null;

    const percent = files > 0 ? Math.min(100, Math.round((done / files) * 100)) : 0;

    const content = {
        checking: {
            icon: <RefreshCw size={18} className="animate-spin" />,
            title: t('cloud.prelaunch.checking', 'Checking the cloud...'),
            hint: t('cloud.prelaunch.checking_hint', 'This takes a moment at most — the game starts either way.')
        },
        updating: {
            icon: <CloudDownload size={18} />,
            title: t('cloud.prelaunch.updating', 'Bringing this instance up to date'),
            hint: files > 0
                ? t('cloud.prelaunch.updating_files', {
                    defaultValue: '{{done}} of {{files}} files · {{size}}',
                    done,
                    files,
                    size: formatBytes(downloadedBytes)
                })
                : t('cloud.prelaunch.updating_hint', 'Loading the newest version...')
        },
        ready: {
            icon: <Check size={18} className="text-emerald-300" />,
            title: t('cloud.prelaunch.ready', 'Up to date'),
            hint: t('cloud.prelaunch.ready_hint', 'Starting the game...')
        },
        offline: {
            icon: <CloudOff size={18} className="text-white/50" />,
            title: t('cloud.prelaunch.offline', 'Cloud not reachable'),
            hint: t('cloud.prelaunch.offline_hint', 'Starting with the local version. Changes are synced later.')
        }
    }[phase];

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161616] p-6 shadow-2xl">
                <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sky-300">
                        {content.icon}
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{content.title}</p>
                        <p className="truncate text-xs text-white/45">{instanceName}</p>
                    </div>
                </div>

                {phase === 'updating' && files > 0 && (
                    <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-sky-400 transition-[width] duration-300"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                )}

                <p className="mt-3 text-xs leading-relaxed text-white/50">{content.hint}</p>
            </div>
        </div>
    );
}
