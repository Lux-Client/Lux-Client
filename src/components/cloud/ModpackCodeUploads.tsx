import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Trash2, RefreshCw, FileArchive } from 'lucide-react';

function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

// Modpack codes of the Lux account. Files that neither Modrinth nor CurseForge know were
// uploaded to the cloud storage for the code; they use the same storage as cloud
// instances and are deleted together with the code.
export default function ModpackCodeUploads({ onChanged }: { onChanged?: () => void }) {
    const { t } = useTranslation();
    const [codes, setCodes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.getModpackCodeUploads !== 'function') {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const result = await api.getModpackCodeUploads();
            if (result && result.success) {
                setCodes(result.codes || []);
                setError(null);
            } else {
                setError(result?.error || null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const remove = async (code: string) => {
        const api = bridge();
        if (!api || typeof api.deleteOwnModpackCode !== 'function') return;
        setBusy(code);
        setError(null);
        try {
            const result = await api.deleteOwnModpackCode(code);
            if (!result || result.success === false) {
                setError(result?.error || 'Could not delete the code');
                return;
            }
            setConfirmDelete(null);
            await load();
            if (onChanged) onChanged();
        } finally {
            setBusy(null);
        }
    };

    if (!loading && codes.length === 0 && !error) return null;

    const totalBytes = codes.reduce((sum, entry) => sum + (entry.filesBytes || 0), 0);

    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
                        <Package size={13} />
                        {t('cloud.codes.title', 'Your modpack codes')}
                    </h3>
                    <p className="mt-0.5 text-xs text-white/40">
                        {t('cloud.codes.hint', {
                            defaultValue: 'Own files in codes use {{size}} of your cloud storage. They are deleted together with the code.',
                            size: formatBytes(totalBytes)
                        })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={load}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/25 hover:text-white"
                >
                    <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                    {t('cloud.dashboard.refresh', 'Refresh')}
                </button>
            </div>

            <div className="divide-y divide-white/5">
                {codes.map((entry) => (
                    <div key={entry.code} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm font-medium text-white">
                                <span className="font-mono text-sky-300">{entry.code}</span>
                                <span className="truncate">{entry.name}</span>
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/40">
                                <span>{[entry.version, entry.loader].filter(Boolean).join(' · ') || '—'}</span>
                                <span className="text-white/20">·</span>
                                <span>{entry.uses || 0} {t('cloud.codes.uses', 'uses')}</span>
                                <span className="text-white/20">·</span>
                                <span>
                                    {entry.expires
                                        ? `${t('cloud.codes.expires', 'expires')} ${new Date(entry.expires).toLocaleDateString()}`
                                        : t('cloud.codes.never', 'never expires')}
                                </span>
                            </p>
                            {entry.files && entry.files.length > 0 ? (
                                <div className="mt-1.5 space-y-0.5">
                                    <p className="text-[11px] text-amber-300/80">
                                        {t('cloud.codes.files', {
                                            defaultValue: '{{count}} own file uploaded · {{size}}',
                                            defaultValue_plural: '{{count}} own files uploaded · {{size}}',
                                            count: entry.files.length,
                                            size: formatBytes(entry.filesBytes)
                                        })}
                                    </p>
                                    {entry.files.map((file: any) => (
                                        <p key={`${file.kind}:${file.fileName}`} className="flex items-center gap-1 truncate text-[11px] text-white/35">
                                            <FileArchive size={10} className="shrink-0" />
                                            <span className="truncate">{file.fileName}</span>
                                            <span className="shrink-0 text-white/25">{formatBytes(file.size)}</span>
                                        </p>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-1 text-[11px] text-white/30">
                                    {t('cloud.codes.no_files', 'Only Modrinth and CurseForge content, no storage used')}
                                </p>
                            )}
                        </div>

                        {confirmDelete === entry.code ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() => remove(entry.code)}
                                    className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-red-400 disabled:opacity-50"
                                >
                                    {busy === entry.code
                                        ? t('cloud.dashboard.removing', 'Removing...')
                                        : t('cloud.codes.delete_confirm', 'Really delete')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDelete(null)}
                                    className="rounded-lg px-2 py-1.5 text-xs text-white/45 transition hover:text-white/75"
                                >
                                    {t('cloud.dashboard.remove_cancel', 'Cancel')}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                title={t('cloud.codes.delete_hint', 'Deletes the code. Nobody can import it anymore and its uploaded files are removed.')}
                                onClick={() => setConfirmDelete(entry.code)}
                                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/45 transition hover:border-red-400/30 hover:text-red-300"
                            >
                                <Trash2 size={12} />
                                {t('cloud.codes.delete', 'Delete')}
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {error && (
                <p className="m-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{error}</p>
            )}
        </div>
    );
}
