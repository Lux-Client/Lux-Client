import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2, CheckSquare, Square } from 'lucide-react';

type World = {
    name: string;
    bytes: number;
    lastPlayed: number | null;
};

type Props = {
    open: boolean;
    instanceName: string;
    instanceId: string | null;
    onClose: () => void;
    onSaved: (worldNames: string[]) => void;
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

export default function WorldSelectionModal({ open, instanceName, instanceId, onClose, onSaved }: Props) {
    const { t } = useTranslation();
    const [worlds, setWorlds] = useState<World[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudListWorlds !== 'function') return;

        setLoading(true);
        setError(null);
        try {
            const [listed, stored] = await Promise.all([
                api.luxCloudListWorlds(instanceName),
                instanceId && typeof api.luxCloudGetWorldSelection === 'function'
                    ? api.luxCloudGetWorldSelection(instanceId)
                    : Promise.resolve(null)
            ]);

            if (listed && listed.success === false) {
                setError(listed.message || listed.error);
                setWorlds([]);
                return;
            }

            const found: World[] = listed?.worlds || [];
            setWorlds(found);

            const previous = stored && stored.success !== false ? stored.worldNames : null;
            setSelected(Array.isArray(previous)
                ? previous.filter((name: string) => found.some((world) => world.name === name))
                : found.map((world) => world.name));
        } finally {
            setLoading(false);
        }
    }, [instanceName, instanceId]);

    useEffect(() => { if (open) load(); }, [open, load]);

    if (!open) return null;

    const toggle = (name: string) => {
        setSelected((prev) => (prev.includes(name) ? prev.filter((entry) => entry !== name) : [...prev, name]));
    };

    const save = async () => {
        const api = bridge();
        if (!api || !instanceId) return;

        setSaving(true);
        setError(null);
        try {
            const result = await api.luxCloudSetWorldSelection(instanceId, selected);
            if (result && result.success === false) {
                setError(result.message || result.error);
                return;
            }
            onSaved(selected);
        } finally {
            setSaving(false);
        }
    };

    const selectedBytes = worlds
        .filter((world) => selected.includes(world.name))
        .reduce((sum, world) => sum + (world.bytes || 0), 0);

    return (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#161616] shadow-2xl">
                <div className="flex items-center gap-3 border-b border-white/10 p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70">
                        <Globe size={17} />
                    </span>
                    <div>
                        <h2 className="text-base font-semibold text-white">
                            {t('cloud.worlds.title', 'Which worlds should be synced?')}
                        </h2>
                        <p className="text-xs text-white/45">
                            {t('cloud.worlds.subtitle',
                                'Worlds are the largest part of an instance. Pick only the ones you play on more than one PC.')}
                        </p>
                    </div>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                    {loading && (
                        <div className="flex justify-center py-8">
                            <Loader2 size={22} className="animate-spin text-white/40" />
                        </div>
                    )}

                    {!loading && worlds.length === 0 && (
                        <p className="py-8 text-center text-sm text-white/40">
                            {t('cloud.worlds.empty', 'This instance has no worlds yet.')}
                        </p>
                    )}

                    {worlds.map((world) => {
                        const checked = selected.includes(world.name);
                        return (
                            <button
                                key={world.name}
                                type="button"
                                onClick={() => toggle(world.name)}
                                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                                    checked
                                        ? 'border-sky-400/30 bg-sky-500/[0.07]'
                                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                                }`}
                            >
                                <span className={checked ? 'text-sky-300' : 'text-white/30'}>
                                    {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-white">{world.name}</span>
                                    <span className="mt-0.5 block text-xs text-white/40">
                                        {formatBytes(world.bytes)}
                                        {world.lastPlayed ? (
                                            <>
                                                <span className="px-1.5 text-white/20">·</span>
                                                {t('cloud.worlds.last_played', {
                                                    defaultValue: 'last played {{date}}',
                                                    date: new Date(world.lastPlayed).toLocaleDateString()
                                                })}
                                            </>
                                        ) : null}
                                    </span>
                                </span>
                            </button>
                        );
                    })}

                    {error && (
                        <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{error}</p>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-white/10 p-4">
                    <p className="text-xs text-white/40">
                        {t('cloud.worlds.summary', {
                            defaultValue: '{{count}} selected · {{size}}',
                            count: selected.length,
                            size: formatBytes(selectedBytes)
                        })}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-3 py-1.5 text-xs text-white/45 transition hover:text-white/75"
                        >
                            {t('cloud.worlds.cancel', 'Cancel')}
                        </button>
                        <button
                            type="button"
                            disabled={saving || loading}
                            onClick={save}
                            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-sky-400 disabled:opacity-50"
                        >
                            {saving
                                ? t('cloud.worlds.saving', 'Saving...')
                                : t('cloud.worlds.save', 'Save selection')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
