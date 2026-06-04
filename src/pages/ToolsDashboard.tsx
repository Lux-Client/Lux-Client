import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import PageContent from '../components/layout/PageContent';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

import { filterInstancesForMode } from '../utils/instanceTypes';
import {
    Wrench,
    Sparkles,
    Cuboid,
    Loader2,
    RotateCcw,
    ImageUp,
    ShieldCheck,
    Globe,
    PackageSearch,
    Trash2,
    WandSparkles,
    ScrollText,
    X,
    ChevronDown,
    ChevronUp,
    AlertCircle,
} from 'lucide-react';

// ─── constants ────────────────────────────────────────────────────────────────

const DEFAULT_STEVE = {
    name: 'Steve',
    model: 'classic',
    url: './assets/skins/steve-classic.png',
};

const LOADER_OPTIONS = ['Vanilla', 'Fabric', 'Forge', 'NeoForge', 'Quilt'];


const toFileUrl = (filePath: string) =>
    `file:///${`${filePath}`.replace(/\\/g, '/')}`;

function getInstanceSource(instance: any): 'lux' | 'modrinth' | 'curseforge' {
    const type = String(instance?.instanceType || '').toLowerCase();
    const src = String(instance?.externalSource || '').toLowerCase();
    if (type === 'external') {
        if (src === 'modrinth') return 'modrinth';
        if (src === 'curseforge') return 'curseforge';
    }
    return 'lux';
}

function sourcePlatformLabel(source: 'lux' | 'modrinth' | 'curseforge'): string {
    if (source === 'modrinth') return 'Modrinth';
    if (source === 'curseforge') return 'CurseForge';
    return 'Lux';
}

function SourceBadge({ source }: { source: 'lux' | 'modrinth' | 'curseforge' }) {
    if (source === 'modrinth')
        return (
            <Badge className="shrink-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
                Modrinth
            </Badge>
        );
    if (source === 'curseforge')
        return (
            <Badge className="shrink-0 bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/20">
                CurseForge
            </Badge>
        );
    return <Badge variant="secondary" className="shrink-0">Lux</Badge>;
}


interface InstanceSelectorProps {
    instances: any[];
    value: string;
    onChange: (name: string) => void;
    label?: string;
}

function InstanceSelector({ instances, value, onChange, label = 'Instance' }: InstanceSelectorProps) {
    const selected = instances.find((i) => i.name === value);
    const source = selected ? getInstanceSource(selected) : null;

    const groups: Record<string, any[]> = { lux: [], modrinth: [], curseforge: [] };
    for (const inst of instances) groups[getInstanceSource(inst)].push(inst);

    return (
        <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                {label}
            </label>
            <div className="flex items-center gap-2">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    <option value="">— select instance —</option>
                    {(['lux', 'modrinth', 'curseforge'] as const).map((src) => {
                        const group = groups[src];
                        if (group.length === 0) return null;
                        return (
                            <optgroup key={src} label={`——————— ${sourcePlatformLabel(src)} ———————`}>
                                {group.map((inst) => (
                                    <option key={inst.name} value={inst.name}>
                                        {inst.name} [{sourcePlatformLabel(src)}]
                                    </option>
                                ))}
                            </optgroup>
                        );
                    })}
                </select>
                {source && <SourceBadge source={source} />}
            </div>
        </div>
    );
}


function NoInstanceSelected() {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-2xl border border-dashed border-border/60 bg-muted/10">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
                <p className="text-sm font-medium text-foreground">No instance selected</p>
                <p className="text-xs text-muted-foreground mt-1">
                    Select an instance above to use the tools below.
                </p>
            </div>
        </div>
    );
}


function ToolsDashboard() {
    const { t } = useTranslation();
    const { addNotification } = useNotification();

    // instances
    const [instances, setInstances] = useState<any[]>([]);
    const [selectedInstance, setSelectedInstance] = useState('');

    // compatibility checker
    const [targetLoader, setTargetLoader] = useState('Fabric');
    const [targetVersion, setTargetVersion] = useState('');
    const [compatibilityResult, setCompatibilityResult] = useState<any>(null);
    const [removeNoMatchOnApply, setRemoveNoMatchOnApply] = useState(false);
    const [scanningCompatibility, setScanningCompatibility] = useState(false);
    const [applyingCompatibility, setApplyingCompatibility] = useState(false);
    const [showCompatLog, setShowCompatLog] = useState(false);
    const [compatLog, setCompatLog] = useState<string[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);
    const compatLogUnsubRef = useRef<(() => void) | null>(null);

    // world manager
    const [worlds, setWorlds] = useState<any[]>([]);
    const [loadingWorlds, setLoadingWorlds] = useState(false);
    const [cloneSourceWorld, setCloneSourceWorld] = useState('');
    const [cloneTargetInstance, setCloneTargetInstance] = useState('');
    const [cloneWorldName, setCloneWorldName] = useState('');
    const [cloningWorld, setCloningWorld] = useState(false);

    // resource pack optimizer
    const [resourcepackReport, setResourcepackReport] = useState<any[]>([]);
    const [loadingResourcepacks, setLoadingResourcepacks] = useState(false);
    const [runningPackAction, setRunningPackAction] = useState('');


    useEffect(() => {
        const load = async () => {
            try {
                const list = await window.electronAPI.getInstances();
                const items = filterInstancesForMode(list, 'launcher');
                setInstances(items);
                if (items.length > 0) setCloneTargetInstance((prev) => prev || items[0].name);
            } catch (err: any) {
                addNotification(err?.message || 'Failed to load instances', 'error');
            }
        };
        load();
    }, []);

    useEffect(() => {
        const loadVersions = async () => {
            try {
                if (targetLoader === 'Vanilla') {
                    const res = await window.electronAPI.getVanillaVersions();
                    if (res?.success && res.versions?.length > 0) {
                        const first = res.versions.find((v: any) => v.type === 'release') || res.versions[0];
                        if (first?.id) setTargetVersion((prev) => prev || first.id);
                    }
                } else {
                    const res = await window.electronAPI.getSupportedGameVersions(targetLoader);
                    if (res?.success && res.versions?.length > 0)
                        setTargetVersion((prev) => prev || res.versions[0]);
                }
            } catch { /* keep manual input */ }
        };
        loadVersions();
    }, [targetLoader]);

    useEffect(() => {
        if (!selectedInstance) {
            setWorlds([]);
            setResourcepackReport([]);
            return;
        }
        void refreshWorldManager(selectedInstance);
        void refreshResourcepackReport(selectedInstance);
    }, [selectedInstance]);

    useEffect(() => {
        if (showCompatLog) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [compatLog, showCompatLog]);

    // subscribe to backend log events for the duration of scanning
    useEffect(() => {
        return () => { compatLogUnsubRef.current?.(); };
    }, []);



    const handleScanCompatibility = async () => {
        if (!selectedInstance || !targetVersion || !targetLoader) {
            addNotification('Please select an instance, target version and loader.', 'error');
            return;
        }
        try {
            setScanningCompatibility(true);
            setCompatLog([]);
            setShowCompatLog(true);

            // subscribe to live log events from backend
            compatLogUnsubRef.current?.();
            compatLogUnsubRef.current = window.electronAPI.onCompatibilityLog(
                (data: { msg: string }) => {
                    setCompatLog((prev) => [...prev, data.msg]);
                }
            );

            const result = await window.electronAPI.toolsScanCompatibility(
                selectedInstance, targetVersion, targetLoader
            );

            // unsubscribe after call resolves
            compatLogUnsubRef.current?.();
            compatLogUnsubRef.current = null;

            if (!result?.success) {
                setCompatLog((prev) => [...prev, `ERROR: ${result?.error || 'Unknown error'}`]);
                addNotification(`Scan failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }
            setCompatibilityResult(result);
            addNotification('Compatibility scan completed.', 'success');
        } catch (err: any) {
            setCompatLog((prev) => [...prev, `ERROR: ${err?.message || 'Unknown error'}`]);
            addNotification(`Scan failed: ${err?.message || 'Unknown error'}`, 'error');
        } finally {
            setScanningCompatibility(false);
        }
    };

    const handleApplyCompatibilityFix = async () => {
        if (!selectedInstance || !targetVersion || !targetLoader) {
            addNotification('Please select an instance, target version and loader.', 'error');
            return;
        }
        try {
            setApplyingCompatibility(true);
            setCompatLog((prev) => [...prev, `[Apply] Starting auto fix (removeNoMatch=${removeNoMatchOnApply})…`]);

            const result = await window.electronAPI.toolsApplyCompatibility(
                selectedInstance, targetVersion, targetLoader,
                { removeNoMatch: removeNoMatchOnApply }
            );
            if (!result?.success) {
                setCompatLog((prev) => [...prev, `[Apply] ERROR: ${result?.error || 'Unknown error'}`]);
                addNotification(`Apply failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }
            setCompatLog((prev) => [
                ...prev,
                `[Apply] Done — queued migration. Updatable: ${result.summary?.updatable ?? '?'}, Unresolved: ${result.summary?.unresolved ?? '?'}, Removed: ${result.summary?.removedUnresolved ?? '?'}`
            ]);
            addNotification('Compatibility fix applied.', 'success');
        } catch (err: any) {
            setCompatLog((prev) => [...prev, `[Apply] ERROR: ${err?.message || 'Unknown error'}`]);
            addNotification(`Apply failed: ${err?.message || 'Unknown error'}`, 'error');
        } finally {
            setApplyingCompatibility(false);
        }
    };


    const refreshWorldManager = async (instanceName = selectedInstance) => {
        if (!instanceName) return;
        try {
            setLoadingWorlds(true);
            const result = await window.electronAPI.toolsListWorlds(instanceName);
            if (!result?.success) {
                addNotification(`World scan failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }
            setWorlds(result.worlds || []);
            if (!cloneSourceWorld && result.worlds?.length > 0)
                setCloneSourceWorld(result.worlds[0].folderName);
        } catch (err: any) {
            addNotification(`World scan failed: ${err?.message || 'Unknown error'}`, 'error');
        } finally {
            setLoadingWorlds(false);
        }
    };

    const handleWorldBackup = async (worldFolderName: string) => {
        try {
            const result = await window.electronAPI.backupWorld(selectedInstance, worldFolderName, false);
            if (result?.success) addNotification(`Backup for "${worldFolderName}" created.`, 'success');
            else addNotification(`Backup failed: ${result?.error || 'Unknown error'}`, 'error');
        } catch (err: any) {
            addNotification(`Backup failed: ${err?.message || 'Unknown error'}`, 'error');
        }
    };

    const handleCloneWorld = async () => {
        if (!selectedInstance || !cloneSourceWorld || !cloneTargetInstance) {
            addNotification('Select source world and target instance.', 'error');
            return;
        }
        try {
            setCloningWorld(true);
            const result = await window.electronAPI.toolsSafeCloneWorld(
                selectedInstance, cloneSourceWorld, cloneTargetInstance, cloneWorldName
            );
            if (!result?.success) {
                addNotification(`Clone failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }
            addNotification(`World cloned as "${result.clonedWorldName}".`, 'success');
        } catch (err: any) {
            addNotification(`Clone failed: ${err?.message || 'Unknown error'}`, 'error');
        } finally {
            setCloningWorld(false);
        }
    };


    const refreshResourcepackReport = async (instanceName = selectedInstance) => {
        if (!instanceName) return;
        try {
            setLoadingResourcepacks(true);
            const result = await window.electronAPI.toolsResourcepackReport(instanceName);
            if (!result?.success) {
                addNotification(`Resourcepack scan failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }
            setResourcepackReport(result.packs || []);
        } catch (err: any) {
            addNotification(`Resourcepack scan failed: ${err?.message || 'Unknown error'}`, 'error');
        } finally {
            setLoadingResourcepacks(false);
        }
    };

    const runResourcepackAction = async (action: 'cleanup' | 'compress', packName: string) => {
        if (!selectedInstance || !packName) return;
        const key = `${action}:${packName}`;
        try {
            setRunningPackAction(key);
            const result =
                action === 'cleanup'
                    ? await window.electronAPI.toolsResourcepackCleanup(selectedInstance, packName)
                    : await window.electronAPI.toolsResourcepackCompressPng(selectedInstance, packName);
            if (!result?.success) {
                addNotification(
                    `${action === 'cleanup' ? 'Cleanup' : 'Compression'} failed: ${result?.error || 'Unknown error'}`,
                    'error'
                );
                return;
            }
            addNotification(
                action === 'cleanup'
                    ? `Cleanup done: ${result.removedFiles || 0} files removed.`
                    : `PNG compression done: ${result.changed || 0}/${result.scanned || 0} optimized, ${result.savedBytes || 0} bytes saved.`,
                'success'
            );
            await refreshResourcepackReport(selectedInstance);
        } catch (err: any) {
            addNotification(
                `${action === 'cleanup' ? 'Cleanup' : 'Compression'} failed: ${err?.message || 'Unknown error'}`,
                'error'
            );
        } finally {
            setRunningPackAction('');
        }
    };


    const hasInstance = Boolean(selectedInstance);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* page header */}
            <div className="border-b border-border px-6 py-5 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary border border-primary/25 flex items-center justify-center">
                        <Wrench className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight text-foreground">
                            {t('common.useful_tools', 'Useful Tools')}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {t('tools.dashboard_desc', 'A central dashboard for practical tools and creators.')}
                        </p>
                    </div>
                </div>
            </div>

            <PageContent>
                {/* ── Section 2: Instance selector ───────────────────────────── */}
                <section className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary/80 mb-2">
                        Instance — required for tools below
                    </p>
                    <InstanceSelector
                        instances={instances}
                        value={selectedInstance}
                        onChange={setSelectedInstance}
                    />
                </section>

                {/* ── Section 3: Instance tools ──────────────────────────────── */}
                {!hasInstance ? (
                    <NoInstanceSelected />
                ) : (
                    <div className="space-y-4">
                        {/* Modpack Compatibility Checker */}
                        <section className="rounded-2xl border border-border bg-card/40 overflow-hidden">
                            <div className="p-5">
                                <div className="flex items-center justify-between gap-2 mb-4">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="h-4 w-4 text-primary" />
                                        <h2 className="text-base font-semibold text-foreground">
                                            Modpack Compatibility Checker
                                        </h2>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowCompatLog((v) => !v)}
                                        className="gap-1.5 text-muted-foreground"
                                    >
                                        <ScrollText className="h-4 w-4" />
                                        Log
                                        {showCompatLog
                                            ? <ChevronUp className="h-3 w-3" />
                                            : <ChevronDown className="h-3 w-3" />}
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* controls */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Target Loader
                                            </label>
                                            <select
                                                value={targetLoader}
                                                onChange={(e) => setTargetLoader(e.target.value)}
                                                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                            >
                                                {LOADER_OPTIONS.map((l) => (
                                                    <option key={l} value={l}>{l}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Target Version
                                            </label>
                                            <input
                                                value={targetVersion}
                                                onChange={(e) => setTargetVersion(e.target.value)}
                                                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                placeholder="e.g. 1.21.1"
                                            />
                                        </div>
                                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={removeNoMatchOnApply}
                                                onChange={(e) => setRemoveNoMatchOnApply(e.target.checked)}
                                                className="rounded"
                                            />
                                            Remove unresolved entries on apply
                                        </label>
                                        <div className="flex gap-2 flex-wrap">
                                            <Button onClick={handleScanCompatibility} disabled={scanningCompatibility}>
                                                {scanningCompatibility
                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                    : <ShieldCheck className="h-4 w-4" />}
                                                Scan
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={handleApplyCompatibilityFix}
                                                disabled={applyingCompatibility || !compatibilityResult}
                                            >
                                                {applyingCompatibility
                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                    : <WandSparkles className="h-4 w-4" />}
                                                Apply Auto Fix
                                            </Button>
                                        </div>
                                    </div>

                                    {/* summary card */}
                                    {compatibilityResult?.summary ? (
                                        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Last Scan Result
                                            </p>
                                            {([
                                                ['Total', compatibilityResult.summary.total, ''],
                                                ['Compatible', compatibilityResult.summary.compatible, 'text-emerald-400'],
                                                ['Update available', compatibilityResult.summary.updateAvailable, 'text-sky-400'],
                                                ['Replaced', compatibilityResult.summary.replaced, 'text-yellow-400'],
                                                ['No match', compatibilityResult.summary.noMatch, 'text-red-400'],
                                            ] as [string, number, string][]).map(([lbl, val, col]) => (
                                                <div key={lbl} className="flex items-center justify-between text-sm">
                                                    <span className="text-muted-foreground">{lbl}</span>
                                                    <span className={`font-semibold tabular-nums ${col}`}>{val ?? 0}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-4 flex items-center justify-center">
                                            <p className="text-xs text-muted-foreground">Run a scan to see results here</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* log panel */}
                            {showCompatLog && (
                                <div className="border-t border-border/60">
                                    <div className="flex items-center justify-between px-5 py-2 bg-muted/20">
                                        <span className="text-xs font-mono font-semibold text-muted-foreground">
                                            Scan Log
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-muted-foreground"
                                            onClick={() => setShowCompatLog(false)}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    <div className="h-52 overflow-auto bg-black/50 px-4 py-3 font-mono text-xs text-green-400 leading-relaxed">
                                        {compatLog.length === 0 ? (
                                            <span className="text-muted-foreground">
                                                No output yet — run a scan first.
                                            </span>
                                        ) : (
                                            compatLog.map((line, i) => (
                                                <div key={i} className="whitespace-pre-wrap">{line}</div>
                                            ))
                                        )}
                                        <div ref={logEndRef} />
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* World Manager + Resource Pack side-by-side */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            {/* World Manager */}
                            <section className="rounded-2xl border border-border bg-card/40 p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Globe className="h-4 w-4 text-primary" />
                                        <h2 className="text-base font-semibold text-foreground">
                                            World Manager + Repair
                                        </h2>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => refreshWorldManager()}
                                        disabled={loadingWorlds}
                                    >
                                        {loadingWorlds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                                        Refresh
                                    </Button>
                                </div>

                                <div className="space-y-2 max-h-60 overflow-auto pr-1 mb-4">
                                    {worlds.length === 0 && !loadingWorlds && (
                                        <p className="text-xs text-muted-foreground py-4 text-center">
                                            No worlds found in this instance.
                                        </p>
                                    )}
                                    {worlds.map((world) => (
                                        <div key={world.folderName} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium truncate">{world.name}</div>
                                                    <div className="text-xs text-muted-foreground">{world.folderName}</div>
                                                </div>
                                                <Badge
                                                    variant={world.health === 'ok' ? 'secondary' : 'destructive'}
                                                    className="shrink-0"
                                                >
                                                    {world.health}
                                                </Badge>
                                            </div>
                                            <div className="mt-1.5 text-xs text-muted-foreground">
                                                Seed: {world.seed ?? 'Unknown'} · Size: {world.size?.toLocaleString() ?? '?'} B
                                            </div>
                                            {Array.isArray(world.issues) && world.issues.length > 0 && (
                                                <div className="mt-1 text-xs text-red-400">
                                                    Issues: {world.issues.map((i: any) => i.type).join(', ')}
                                                </div>
                                            )}
                                            <div className="mt-2">
                                                <Button size="sm" variant="secondary" onClick={() => handleWorldBackup(world.folderName)}>
                                                    Backup
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <Separator className="mb-4" />
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Safe Clone World
                                    </p>
                                    <select
                                        value={cloneSourceWorld}
                                        onChange={(e) => setCloneSourceWorld(e.target.value)}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="">— select world —</option>
                                        {worlds.map((w) => (
                                            <option key={w.folderName} value={w.folderName}>{w.name}</option>
                                        ))}
                                    </select>
                                    <div>
                                        <label className="text-xs text-muted-foreground">Target instance</label>
                                        <div className="mt-1 flex items-center gap-2">
                                            <select
                                                value={cloneTargetInstance}
                                                onChange={(e) => setCloneTargetInstance(e.target.value)}
                                                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
                                            >
                                                {(['lux', 'modrinth', 'curseforge'] as const).map((src) => {
                                                    const grp = instances.filter((i) => getInstanceSource(i) === src);
                                                    if (grp.length === 0) return null;
                                                    return (
                                                        <optgroup key={src} label={`——————— ${sourcePlatformLabel(src)} ———————`}>
                                                            {grp.map((inst) => (
                                                                <option key={inst.name} value={inst.name}>
                                                                    {inst.name} [{sourcePlatformLabel(src)}]
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    );
                                                })}
                                            </select>
                                            {cloneTargetInstance && (
                                                <SourceBadge
                                                    source={getInstanceSource(
                                                        instances.find((i) => i.name === cloneTargetInstance) || {}
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <input
                                        value={cloneWorldName}
                                        onChange={(e) => setCloneWorldName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                                        placeholder="New world name (optional)"
                                    />
                                    <Button
                                        onClick={handleCloneWorld}
                                        disabled={cloningWorld || !cloneSourceWorld || !cloneTargetInstance}
                                    >
                                        {cloningWorld
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <Sparkles className="h-4 w-4" />}
                                        Safe Clone World
                                    </Button>
                                </div>
                            </section>

                            {/* Resource Pack Optimizer */}
                            <section className="rounded-2xl border border-border bg-card/40 p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <PackageSearch className="h-4 w-4 text-primary" />
                                        <h2 className="text-base font-semibold text-foreground">
                                            Resource Pack Optimizer
                                        </h2>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => refreshResourcepackReport()}
                                        disabled={loadingResourcepacks}
                                    >
                                        {loadingResourcepacks
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <PackageSearch className="h-4 w-4" />}
                                        Scan
                                    </Button>
                                </div>

                                <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
                                    {resourcepackReport.length === 0 && !loadingResourcepacks && (
                                        <p className="text-xs text-muted-foreground py-4 text-center">
                                            No resource packs found. Click Scan to check.
                                        </p>
                                    )}
                                    {resourcepackReport.map((pack) => (
                                        <div key={pack.packName} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-medium truncate">{pack.packName}</span>
                                                {!pack.isDirectory && <Badge variant="secondary">zip</Badge>}
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                Files: {pack.totalFiles} · PNG: {pack.pngFiles} · Junk: {pack.junkFiles?.length || 0}
                                            </div>
                                            <div className="mt-2 flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => runResourcepackAction('cleanup', pack.packName)}
                                                    disabled={runningPackAction.length > 0}
                                                >
                                                    {runningPackAction === `cleanup:${pack.packName}`
                                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                                        : <Trash2 className="h-4 w-4" />}
                                                    Cleanup
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    onClick={() => runResourcepackAction('compress', pack.packName)}
                                                    disabled={runningPackAction.length > 0}
                                                >
                                                    {runningPackAction === `compress:${pack.packName}`
                                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                                        : <WandSparkles className="h-4 w-4" />}
                                                    Compress PNG
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </PageContent>
        </div>
    );
}

export default ToolsDashboard;
