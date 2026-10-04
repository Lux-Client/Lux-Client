import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';
import { Dialog, DialogContent, DialogTitle, DialogHeader } from './ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';

// Public preview page for a code on the website: shows everything inside the pack
// (mods, packs, shaders, settings) without installing anything first.
const CODE_PREVIEW_BASE_URL = 'https://lux.pluginhub.de/code/';
const getCodePreviewUrl = (code) => `${CODE_PREVIEW_BASE_URL}${encodeURIComponent(code)}`;

// Only admins (role on the Lux account) can pick these; everyone else keeps the default.
const EXPIRY_OPTIONS = [
    { value: 'default', label: 'Default (7 days)' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
    { value: 'never', label: 'Never expires' }
];

const toExpiryValue = (choice) => (choice === 'never' ? 'never' : Number(choice));

function ModpackCodeModal({
    isOpen,
    onClose,
    mode: initialMode,
    instance = null,
    instanceData = null,
    mods = [],
    resourcePacks = [],
    shaders = [],
    initialCode = '',
    onImportComplete
}: any) {
    const [mode, setMode] = useState(initialMode);
    const [code, setCode] = useState('');
    const [modpackName, setModpackName] = useState('');
    const [loading, setLoading] = useState(false);
    const [exportedCode, setExportedCode] = useState('');
    const [myCodes, setMyCodes] = useState([]);
    const [selectedTypes, setSelectedTypes] = useState({
        mods: true,
        resourcePacks: true,
        shaders: true,
        settings: true
    });

    const [isAdmin, setIsAdmin] = useState(false);
    const [liveExport, setLiveExport] = useState(false);
    const [expiryChoice, setExpiryChoice] = useState('default');
    const [busyCode, setBusyCode] = useState('');

    const { addNotification } = useNotification();

    useEffect(() => {
        setMode(initialMode);
        if (isOpen && initialMode === 'export') {
            fetchMyCodes();
            window.electronAPI.getModpackAdminStatus?.()
                .then((result) => setIsAdmin(Boolean(result?.isAdmin)))
                .catch(() => setIsAdmin(false));
        }
    }, [isOpen, initialMode]);

    useEffect(() => {
        if (isOpen && initialCode) {
            setMode('import');
            setCode(String(initialCode).slice(0, 8));
        }
    }, [isOpen, initialCode]);

    const copyPreviewLink = (value) => {
        navigator.clipboard.writeText(getCodePreviewUrl(value));
        addNotification('Preview link copied to clipboard!', 'success');
    };

    const fetchMyCodes = async () => {
        try {
            const result = await window.electronAPI.getModpackCodes();
            if (result.success) {
                setMyCodes(result.codes);
            }
        } catch (e) {
            console.error('Failed to fetch codes:', e);
        }
    };

    const handleDeleteCode = async (codeToDelete) => {
        if (!confirm(`Are you sure you want to delete code ${codeToDelete}?`)) return;

        try {
            const result = await window.electronAPI.deleteModpackCode(codeToDelete);
            if (result.success) {
                addNotification('Code deleted successfully', 'success');
                fetchMyCodes();
            } else {
                addNotification(`Failed to delete code: ${result.error}`, 'error');
            }
        } catch (e) {
            addNotification(`Delete error: ${e.message}`, 'error');
        }
    };

    const buildExportData = () => ({
        name: modpackName || `${instanceData?.name || 'Modpack'} Export`,
        instanceName: instanceData?.name,
        mods: selectedTypes.mods ? mods : [],
        resourcePacks: selectedTypes.resourcePacks ? resourcePacks : [],
        shaders: selectedTypes.shaders ? shaders : [],
        instanceVersion: instanceData?.version,
        instanceLoader: instanceData?.loader,
        includeSettings: selectedTypes.settings,
        icon: instanceData?.icon || null
    });

    // Admins: replace what a live code installs with this instance's current content.
    const handlePushLiveUpdate = async (item) => {
        if (!instanceData) return;
        if (!confirm(`Replace the content of ${item.code} with "${instanceData.name}"? Everyone who installed it gets the update on their next start.`)) return;
        setBusyCode(item.code);
        try {
            const data = { ...buildExportData(), name: modpackName || item.name };
            const result = await window.electronAPI.updateLiveModpackCode(item.code, data);
            if (result?.success) {
                addNotification(`${item.code} updated (revision ${result.revision})`, 'success');
                fetchMyCodes();
            } else {
                addNotification(`Update failed: ${result?.error || 'Unknown error'}`, 'error');
            }
        } catch (e) {
            addNotification(`Update failed: ${e.message}`, 'error');
        } finally {
            setBusyCode('');
        }
    };

    const handleCodeSettings = async (item, settings) => {
        setBusyCode(item.code);
        try {
            const result = await window.electronAPI.setModpackCodeSettings(item.code, settings);
            if (result?.success) {
                addNotification(`${item.code} updated`, 'success');
                fetchMyCodes();
            } else {
                addNotification(`Failed: ${result?.error || 'Unknown error'}`, 'error');
            }
        } catch (e) {
            addNotification(`Failed: ${e.message}`, 'error');
        } finally {
            setBusyCode('');
        }
    };

    const handleExport = async () => {
        if (!mods.length && !resourcePacks.length && !shaders.length) {
            addNotification('No content to export!', 'error');
            return;
        }

        setLoading(true);
        try {
            const exportData: any = buildExportData();
            if (isAdmin) {
                if (liveExport) exportData.live = true;
                if (expiryChoice !== 'default') exportData.expiry = toExpiryValue(expiryChoice);
            }

            const result = await window.electronAPI.exportModpackAsCode(exportData);

            if (result.success) {
                setExportedCode(result.code);
                addNotification(result.live
                    ? `Live code created: ${result.code}. Push updates from "My Codes".`
                    : `Successfully exported! Code: ${result.code}`, 'success');
                fetchMyCodes();
            } else {
                addNotification(`Export failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[ModpackCodeModal] Export error:', error);
            addNotification(`Export error: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        if (!code || code.length !== 8) {
            addNotification('Please enter a valid 8-character code', 'error');
            return;
        }

        setLoading(true);
        try {
            const result = await window.electronAPI.importModpackFromCode(code);

            if (result.success) {
                addNotification(`Successfully loaded modpack: ${result.data.name}`, 'success');
                onImportComplete(result.data);
                onClose();
            } else {
                addNotification(`Import failed: ${result.error}`, 'error');
            }
        } catch (error) {
            addNotification(`Import error: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="p-0 gap-0 overflow-hidden flex flex-col max-h-[90vh] sm:max-w-lg border-border shadow-2xl">
                <DialogPrimitive.Title className="sr-only">Modpack Code Modal</DialogPrimitive.Title>
                <div className="p-6 border-b border-border flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-foreground pr-8">
                            {mode === 'export' ? 'Modpack Sharing' : 'Import from Code'}
                        </h2>
                    </div>

                    {mode === 'export' && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setMode('export'); setExportedCode(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!exportedCode && mode === 'export' ? 'bg-primary text-black' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                            >
                                New Export
                            </button>
                            <button
                                onClick={() => { setMode('my-codes'); setExportedCode(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${mode === 'my-codes' ? 'bg-primary text-black' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                            >
                                My Codes ({myCodes.length}/10)
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {mode === 'export' ? (
                        <>
                            {exportedCode ? (
                                <div className="text-center py-8">
                                    <div className="mb-6">
                                        <div className="text-sm text-muted-foreground mb-2">Your export code:</div>
                                        <div className="text-5xl font-mono font-bold bg-primary/20 text-primary p-6 rounded-xl border border-primary/30 tracking-tight">
                                            {exportedCode}
                                        </div>
                                    </div>
                                    <div className="mb-6 text-left">
                                        <div className="text-sm text-muted-foreground mb-2">Preview in the browser:</div>
                                        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl p-3">
                                            <span className="flex-1 font-mono text-xs text-foreground truncate">{getCodePreviewUrl(exportedCode)}</span>
                                            <button
                                                onClick={() => copyPreviewLink(exportedCode)}
                                                className="px-3 py-1.5 bg-card hover:bg-accent rounded-lg text-xs font-bold text-foreground transition-colors"
                                            >
                                                Copy Link
                                            </button>
                                            <button
                                                onClick={() => window.electronAPI.openExternal(getCodePreviewUrl(exportedCode))}
                                                className="px-3 py-1.5 bg-card hover:bg-accent rounded-lg text-xs font-bold text-foreground transition-colors"
                                            >
                                                Open
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(exportedCode);
                                                addNotification('Code copied to clipboard!', 'success');
                                            }}
                                            className="flex-1 px-6 py-3 bg-muted hover:bg-accent rounded-xl text-foreground font-bold transition-colors flex items-center justify-center gap-2"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                            </svg>
                                            Copy Code
                                        </button>
                                        <button
                                            onClick={() => setExportedCode('')}
                                            className="px-6 py-3 bg-muted hover:bg-accent rounded-xl text-foreground font-bold transition-colors"
                                        >
                                            Back
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-4">
                                        <label className="block text-sm font-bold text-muted-foreground mb-2">
                                            Modpack Name (optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={modpackName}
                                            onChange={(e) => setModpackName(e.target.value)}
                                            placeholder="My Awesome Modpack"
                                            className="w-full bg-card border border-border rounded-xl p-3 text-foreground focus:border-primary outline-none transition-colors"
                                        />
                                    </div>

                                    <div className="mb-6">
                                        <label className="block text-sm font-bold text-muted-foreground mb-2">
                                            Include in export:
                                        </label>
                                        <div className="grid grid-cols-1 gap-2">
                                            {[
                                                { id: 'mods', label: 'Mods', count: mods.length },
                                                { id: 'resourcePacks', label: 'Resource Packs', count: resourcePacks.length },
                                                { id: 'shaders', label: 'Shaders', count: shaders.length },
                                                { id: 'settings', label: 'Settings', hint: 'Keybinds & game options' }
                                            ].map((type: any) => (
                                                <label key={type.id} className="flex items-center gap-3 p-3 bg-muted rounded-xl border border-border cursor-pointer hover:bg-accent transition-colors group">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${selectedTypes[type.id] ? 'bg-primary border-primary' : 'border-border'}`}>
                                                        {selectedTypes[type.id] && (
                                                            <svg className="w-4 h-4 text-black" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTypes[type.id]}
                                                        onChange={() => setSelectedTypes(prev => ({ ...prev, [type.id]: !prev[type.id] }))}
                                                        className="hidden"
                                                    />
                                                    <span className="flex-1 text-sm font-bold text-foreground transition-colors">{type.label}</span>
                                                    {type.count !== undefined ? (
                                                        <span className="text-xs text-muted-foreground font-bold bg-muted px-2 py-1 rounded-md">{type.count}</span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">{type.hint}</span>
                                                    )}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {isAdmin && (
                                        <div className="mb-6 p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                                            <div className="text-xs font-bold uppercase tracking-widest text-primary">Admin</div>
                                            <label className="flex items-start gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={liveExport}
                                                    onChange={(e) => setLiveExport(e.target.checked)}
                                                    className="mt-1 accent-[var(--primary)]"
                                                />
                                                <span>
                                                    <span className="block text-sm font-bold text-foreground">Live code</span>
                                                    <span className="block text-xs text-muted-foreground">
                                                        The code stays the same. Push new mods from "My Codes" and every install updates itself on its next start.
                                                    </span>
                                                </span>
                                            </label>
                                            <div>
                                                <label className="block text-sm font-bold text-foreground mb-1">Expires</label>
                                                <select
                                                    value={expiryChoice}
                                                    onChange={(e) => setExpiryChoice(e.target.value)}
                                                    className="w-full bg-card border border-border rounded-lg p-2 text-sm text-foreground outline-none focus:border-primary"
                                                >
                                                    {EXPIRY_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleExport}
                                        disabled={loading || (!mods.length && !resourcePacks.length && !shaders.length) || (modpackName && !/^[a-zA-Z0-9-_\s]+$/.test(modpackName)) || myCodes.length >= 10}
                                        className="w-full py-4 bg-primary hover:bg-primary-hover text-black font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md"
                                    >
                                        {loading ? (
                                            <>
                                                <div className="w-5 h-5 border-3 border-black/30 border-t-black rounded-full animate-spin"></div>
                                                Generating Code...
                                            </>
                                        ) : (
                                            <>
                                                {myCodes.length >= 10 ? 'Limit Reached (10/10)' : 'Export Modpack'}
                                            </>
                                        )}
                                    </button>
                                    {modpackName && !/^[a-zA-Z0-9-_\s]+$/.test(modpackName) && (
                                        <p className="text-red-400 text-xs mt-3 text-center font-bold">
                                            Invalid characters in name.
                                        </p>
                                    )}
                                </>
                            )}
                        </>
                    ) : mode === 'my-codes' ? (
                        <div className="space-y-2">
                            {myCodes.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                    </svg>
                                    <p className="font-bold">No codes found.</p>
                                    <p className="text-xs mt-1">Export your first modpack to share it!</p>
                                </div>
                            ) : (
                                myCodes.map(item => (
                                    <div key={item.code} className="bg-muted border border-border rounded-xl p-4 group hover:bg-accent transition-all">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-lg font-mono font-bold text-primary mb-1 flex items-center gap-2">
                                                {item.code}
                                                {item.live && (
                                                    <span className="text-[10px] font-sans font-bold uppercase px-2 py-0.5 rounded-md bg-primary/20 text-primary">
                                                        Live · rev {item.revision || 1}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs font-bold text-foreground truncate max-w-[200px] mb-1">{item.name}</div>
                                            <div className="text-[10px] text-muted-foreground uppercase font-bold flex gap-2">
                                                <span>{item.uses} uses</span>
                                                <span className="opacity-30">•</span>
                                                <span>{item.expires ? `Exp: ${new Date(item.expires).toLocaleDateString()}` : 'Never expires'}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(item.code);
                                                    addNotification('Code copied!', 'success');
                                                }}
                                                className="p-2 bg-muted hover:bg-primary hover:text-black rounded-lg transition-colors"
                                                title="Copy Code"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => copyPreviewLink(item.code)}
                                                className="p-2 bg-muted hover:bg-primary hover:text-black rounded-lg transition-colors"
                                                title="Copy Preview Link"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCode(item.code)}
                                                className="p-2 bg-muted hover:bg-red-700 hover:text-white rounded-lg transition-colors"
                                                title="Delete Code"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    {isAdmin && (
                                        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
                                            {item.live ? (
                                                <button
                                                    onClick={() => handlePushLiveUpdate(item)}
                                                    disabled={!instanceData || busyCode === item.code}
                                                    title={instanceData ? `Use the content of "${instanceData.name}"` : 'Open this from an instance to push its content'}
                                                    className="px-3 py-1.5 bg-primary text-black rounded-lg text-xs font-bold disabled:opacity-50"
                                                >
                                                    {busyCode === item.code ? 'Updating...' : 'Push update from this instance'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleCodeSettings(item, { live: true })}
                                                    disabled={busyCode === item.code}
                                                    className="px-3 py-1.5 bg-card hover:bg-accent rounded-lg text-xs font-bold text-foreground disabled:opacity-50"
                                                >
                                                    Make live
                                                </button>
                                            )}
                                            <select
                                                value=""
                                                disabled={busyCode === item.code}
                                                onChange={(e) => e.target.value && handleCodeSettings(item, { expiry: toExpiryValue(e.target.value) })}
                                                className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground outline-none"
                                            >
                                                <option value="">Change expiry...</option>
                                                {EXPIRY_OPTIONS.filter((option) => option.value !== 'default').map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    </div>
                                ))
                            )}
                            <button
                                onClick={() => setMode('export')}
                                className="w-full mt-4 py-3 bg-muted hover:bg-accent text-foreground text-xs font-bold uppercase tracking-widest rounded-xl transition-all border border-border"
                            >
                                Back to Export
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-muted-foreground mb-2">
                                    Enter 8-character code
                                </label>
                                <input
                                    type="text"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.slice(0, 8))}
                                    placeholder="e.g. aB3xY7zP"
                                    maxLength={8}
                                    className="w-full bg-card border border-border rounded-xl p-4 text-foreground font-mono text-center text-3xl tracking-widest focus:border-primary outline-none transition-all shadow-inner"
                                    autoFocus
                                />
                                <p className="text-xs text-muted-foreground mt-3 font-bold text-center">
                                    Import mods, resource packs, shaders and settings instantly.
                                </p>
                            </div>

                            <button
                                onClick={handleImport}
                                disabled={loading || code.length !== 8}
                                className="w-full py-4 bg-primary hover:bg-primary-hover text-black font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md"
                            >
                                {loading ? (
                                    <>
                                        <div className="w-5 h-5 border-3 border-black/30 border-t-black rounded-full animate-spin"></div>
                                        Fetching Data...
                                    </>
                                ) : (
                                    'Import Modpack'
                                )}
                            </button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ModpackCodeModal;
