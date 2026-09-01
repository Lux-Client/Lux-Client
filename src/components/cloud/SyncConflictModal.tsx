import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Monitor, Cloud, ShieldCheck } from 'lucide-react';

import type { ConflictInfo } from '../../context/LuxSyncContext';

type Props = {
    conflict: ConflictInfo | null;
    onResolve: (choice: 'local' | 'remote') => Promise<any>;
    onDismiss: () => void;
};

export default function SyncConflictModal({ conflict, onResolve, onDismiss }: Props) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    if (!conflict) return null;

    const choose = async (choice: 'local' | 'remote') => {
        setBusy(choice);
        try {
            await onResolve(choice);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#161616] shadow-2xl">
                <div className="flex items-start gap-3 border-b border-white/10 p-5">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                        <AlertTriangle size={18} />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-white">
                            {t('cloud.conflict.title', 'This instance changed in two places')}
                        </h2>
                        <p className="mt-1 text-sm text-white/55">
                            {t('cloud.conflict.subtitle', {
                                defaultValue:
                                    '"{{name}}" was changed on this PC and in the cloud. Pick which version to keep — the other one is saved as a backup either way.',
                                name: conflict.instanceName
                            })}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 p-5">
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => choose('local')}
                        className="group flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-sky-400/40 hover:bg-sky-500/10 disabled:opacity-50"
                    >
                        <span className="flex items-center gap-2 text-sm font-medium text-white">
                            <Monitor size={15} />
                            {t('cloud.conflict.keep_local', 'Keep this PC')}
                        </span>
                        <span className="text-xs text-white/50">
                            {t('cloud.conflict.keep_local_hint', {
                                defaultValue: '{{count}} file changed here will be uploaded.',
                                defaultValue_plural: '{{count}} files changed here will be uploaded.',
                                count: conflict.changedLocally
                            })}
                        </span>
                        {busy === 'local' && (
                            <span className="text-xs text-sky-300">{t('cloud.conflict.working', 'Working...')}</span>
                        )}
                    </button>

                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => choose('remote')}
                        className="group flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-violet-400/40 hover:bg-violet-500/10 disabled:opacity-50"
                    >
                        <span className="flex items-center gap-2 text-sm font-medium text-white">
                            <Cloud size={15} />
                            {t('cloud.conflict.keep_cloud', 'Keep the cloud')}
                        </span>
                        <span className="text-xs text-white/50">
                            {t('cloud.conflict.keep_cloud_hint', {
                                defaultValue: 'Version {{revision}} from the cloud is restored here.',
                                revision: conflict.remoteRevision
                            })}
                        </span>
                        {busy === 'remote' && (
                            <span className="text-xs text-violet-300">{t('cloud.conflict.working', 'Working...')}</span>
                        )}
                    </button>
                </div>

                <div className="px-5 pb-2">
                    <p className="flex items-start gap-2 rounded-lg bg-emerald-500/[0.07] p-3 text-xs text-emerald-200/80">
                        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                        {t('cloud.conflict.backup_note',
                            'Nothing is lost: whichever side you discard is copied to .lux-sync/conflicts inside the instance folder first.')}
                    </p>
                </div>

                {conflict.changed.length > 0 && (
                    <div className="px-5 pb-3">
                        <button
                            type="button"
                            onClick={() => setShowDetails((value) => !value)}
                            className="text-xs text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
                        >
                            {showDetails
                                ? t('cloud.conflict.hide_details', 'Hide details')
                                : t('cloud.conflict.show_details', 'Show changed files')}
                        </button>

                        {showDetails && (
                            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-white/55">
                                {conflict.changed.map((item) => (
                                    <li key={item.path} className="truncate">
                                        <span className="text-white/30">{item.reason}</span> {item.path}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                <div className="flex justify-end border-t border-white/10 p-4">
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={onDismiss}
                        className="rounded-lg px-3 py-1.5 text-sm text-white/50 transition hover:bg-white/5 hover:text-white/80 disabled:opacity-50"
                    >
                        {t('cloud.conflict.later', 'Decide later')}
                    </button>
                </div>
            </div>
        </div>
    );
}
