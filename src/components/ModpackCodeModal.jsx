import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';

function ModpackCodeModal({
    isOpen,
    onClose,
    mode: initialMode,
    instanceData = null,
    mods = [],
    resourcePacks = [],
    shaders = [],
    onImportComplete
}) {
    const [mode, setMode] = useState(initialMode);
    const [code, setCode] = useState('');
    const [modpackName, setModpackName] = useState('');
    const [loading, setLoading] = useState(false);
    const [exportedCode, setExportedCode] = useState('');
    const [myCodes, setMyCodes] = useState([]);
    const [selectedTypes, setSelectedTypes] = useState({
        mods: true,
        resourcePacks: true,
        shaders: true
    });

    const { addNotification } = useNotification();

    useEffect(() => {
        setMode(initialMode);
        if (isOpen && initialMode === 'export') {
            fetchMyCodes();
        }
    }, [isOpen, initialMode]);

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

    const handleExport = async () => {
        console.log('[ModpackCodeModal] handleExport gestartet');

        if (!mods.length && !resourcePacks.length && !shaders.length) {
            addNotification('No content to export!', 'error');
            return;
        }

        setLoading(true);
        try {
            const exportData = {
                name: modpackName || `${instanceData?.name || 'Modpack'} Export`,
                instanceName: instanceData?.name,
                mods: selectedTypes.mods ? mods : [],
                resourcePacks: selectedTypes.resourcePacks ? resourcePacks : [],
                shaders: selectedTypes.shaders ? shaders : [],
                instanceVersion: instanceData?.version,
                instanceLoader: instanceData?.loader
            };

            const result = await window.electronAPI.exportModpackAsCode(exportData);
            console.log('[ModpackCodeModal] Export result:', result);

            if (result.success) {
                setExportedCode(result.code);
                addNotification(`Successfully exported! Code: ${result.code}`, 'success');
                fetchMyCodes(); // Refresh list after export
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-[#151515] w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                {/* Header with Tabs */}
                <div className="p-6 border-b border-white/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-white">
                            {mode === 'export' ? 'Modpack Sharing' : 'Import from Code'}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {mode === 'export' && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setMode('export'); setExportedCode(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!exportedCode && mode === 'export' ? 'bg-primary text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                            >
                                New Export
                            </button>
                            <button
                                onClick={() => { setMode('my-codes'); setExportedCode(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${mode === 'my-codes' ? 'bg-primary text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                            >
                                My Codes ({myCodes.length}/10)
                            </button>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    {mode === 'export' ? (
                        <>
                            {exportedCode ? (
                                <div className="text-center py-8">
                                    <div className="mb-6">
                                        <div className="text-sm text-gray-400 mb-2">Your export code:</div>
                                        <div className="text-5xl font-mono font-bold bg-primary/20 text-primary p-6 rounded-2xl border border-primary/30 tracking-tight">
                                            {exportedCode}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(exportedCode);
                                                addNotification('Code copied to clipboard!', 'success');
                                            }}
                                            className="flex-1 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold transition-colors flex items-center justify-center gap-2"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                            </svg>
                                            Copy Code
                                        </button>
                                        <button
                                            onClick={() => setExportedCode('')}
                                            className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold transition-colors"
                                        >
                                            Back
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-4">
                                        <label className="block text-sm font-bold text-gray-400 mb-2">
                                            Modpack Name (optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={modpackName}
                                            onChange={(e) => setModpackName(e.target.value)}
                                            placeholder="My Awesome Modpack"
                                            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:border-primary outline-none transition-colors"
                                        />
                                    </div>

                                    <div className="mb-6">
                                        <label className="block text-sm font-bold text-gray-400 mb-2">
                                            Include in export:
                                        </label>
                                        <div className="grid grid-cols-1 gap-2">
                                            {[
                                                { id: 'mods', label: 'Mods', count: mods.length },
                                                { id: 'resourcePacks', label: 'Resource Packs', count: resourcePacks.length },
                                                { id: 'shaders', label: 'Shaders', count: shaders.length }
                                            ].map(type => (
                                                <label key={type.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 cursor-pointer hover:bg-white/10 transition-colors group">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${selectedTypes[type.id] ? 'bg-primary border-primary' : 'border-white/20'}`}>
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
                                                    <span className="flex-1 text-sm font-bold text-white transition-colors">{type.label}</span>
                                                    <span className="text-xs text-gray-500 font-bold bg-white/5 px-2 py-1 rounded-md">{type.count}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleExport}
                                        disabled={loading || (!mods.length && !resourcePacks.length && !shaders.length) || (modpackName && !/^[a-zA-Z0-9-_\s]+$/.test(modpackName)) || myCodes.length >= 10}
                                        className="w-full py-4 bg-primary hover:bg-primary-hover text-black font-black rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(27,217,106,0.2)]"
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
                                <div className="text-center py-12 text-gray-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                    </svg>
                                    <p className="font-bold">No codes found.</p>
                                    <p className="text-xs mt-1">Export your first modpack to share it!</p>
                                </div>
                            ) : (
                                myCodes.map(item => (
                                    <div key={item.code} className="bg-white/5 border border-white/5 rounded-xl p-4 flex items-center justify-between group hover:bg-white/10 transition-all">
                                        <div>
                                            <div className="text-lg font-mono font-bold text-primary mb-1">{item.code}</div>
                                            <div className="text-xs font-bold text-white truncate max-w-[200px] mb-1">{item.name}</div>
                                            <div className="text-[10px] text-gray-500 uppercase font-black flex gap-2">
                                                <span>{item.uses} uses</span>
                                                <span className="opacity-30">•</span>
                                                <span>Exp: {new Date(item.expires).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(item.code);
                                                    addNotification('Code copied!', 'success');
                                                }}
                                                className="p-2 bg-white/5 hover:bg-primary hover:text-black rounded-lg transition-colors"
                                                title="Copy Code"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCode(item.code)}
                                                className="p-2 bg-white/5 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                                                title="Delete Code"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                            <button
                                onClick={() => setMode('export')}
                                className="w-full mt-4 py-3 bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                            >
                                Back to Export
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-gray-400 mb-2">
                                    Enter 8-character code
                                </label>
                                <input
                                    type="text"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.slice(0, 8))}
                                    placeholder="e.g. aB3xY7zP"
                                    maxLength="8"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-center text-3xl tracking-widest focus:border-primary outline-none transition-all shadow-inner"
                                    autoFocus
                                />
                                <p className="text-xs text-gray-500 mt-3 font-bold text-center">
                                    Import mods, resource packs, and shaders instantly.
                                </p>
                            </div>

                            <button
                                onClick={handleImport}
                                disabled={loading || code.length !== 8}
                                className="w-full py-4 bg-primary hover:bg-primary-hover text-black font-black rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(27,217,106,0.2)]"
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
            </div>
        </div>
    );
}

export default ModpackCodeModal;