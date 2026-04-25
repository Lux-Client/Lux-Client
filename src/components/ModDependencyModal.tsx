import React, { useState } from 'react';

function ModDependencyModal({ mods, onConfirm, onCancel }) {
    const [selectedIds, setSelectedIds] = useState(new Set(mods.map(m => m.projectId)));

    const toggleMod = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleAll = () => {
        if (selectedIds.size === mods.length) {

            const primary = mods.find(m => m.isPrimary);
            setSelectedIds(new Set(primary ? [primary.projectId] : []));
        } else {
            setSelectedIds(new Set(mods.map(m => m.projectId)));
        }
    };

    const handleConfirm = () => {
        onConfirm(mods.filter(m => selectedIds.has(m.projectId)));
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-surface w-full max-w-lg rounded-xl border border-stroke shadow-2xl overflow-hidden flex flex-col animate-scale-in">
                { }
                <div className="p-6 border-b border-stroke bg-muted">
                    <h2 className="text-xl font-bold text-foreground tracking-tight">Confirm mods selection</h2>
                    <p className="text-muted-foreground text-sm mt-1">Downloading {mods.length} mods including dependencies</p>
                </div>

                { }
                <div className="flex-1 overflow-y-auto max-h-[50vh] custom-scrollbar p-3 space-y-1">
                    {mods.map((mod) => (
                        <div
                            key={mod.projectId}
                            onClick={() => toggleMod(mod.projectId)}
                            className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all hover:bg-accent group ${selectedIds.has(mod.projectId) ? 'bg-primary/5' : 'opacity-40 grayscale'}`}
                        >
                            <div className="flex items-center justify-center w-6">
                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedIds.has(mod.projectId) ? 'bg-primary border-primary' : 'border-stroke'}`}>
                                    {selectedIds.has(mod.projectId) && (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-black" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </div>

                            <div className="relative">
                                <img
                                    src={mod.iconUrl || 'https://cdn.modrinth.com/placeholder.svg'}
                                    alt=""
                                    className="w-10 h-10 rounded-lg shadow-lg relative z-10"
                                    onError={(e) => (e.target as HTMLImageElement).src = 'https://cdn.modrinth.com/placeholder.svg'}
                                />
                                <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-40 transition-opacity"></div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className={`font-bold truncate text-sm ${selectedIds.has(mod.projectId) ? 'text-foreground' : 'text-muted-foreground'}`}>
                                        {mod.title}
                                    </h3>
                                    {mod.isPrimary && (
                                        <span className="text-[10px] bg-primary/20 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">Primary</span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{mod.filename}</p>
                            </div>
                        </div>
                    ))}
                </div>

                { }
                <div className="p-6 border-t border-stroke bg-muted flex items-center justify-between">
                    <button
                        onClick={toggleAll}
                        className="text-sm font-bold text-muted-foreground hover:text-foreground transition-all flex items-center gap-3 group"
                    >
                        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center transition-all group-hover:bg-primary group-hover:text-black">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                            </svg>
                        </div>
                        <span className="hidden sm:inline">Toggle Dependencies</span>
                    </button>

                    <div className="flex gap-4">
                        <button
                            onClick={onCancel}
                            className="px-6 py-2.5 rounded-xl text-muted-foreground font-bold hover:text-accent-foreground hover:bg-accent transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={selectedIds.size === 0}
                            className="bg-primary text-black font-bold px-8 py-2.5 rounded-xl transition-all shadow-md disabled:opacity-50 disabled:grayscale flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Confirm ({selectedIds.size})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ModDependencyModal;
