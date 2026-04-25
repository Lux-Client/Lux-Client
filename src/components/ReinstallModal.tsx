import React, { useState } from 'react';

function ReinstallModal({ instanceName, onClose, onConfirm }) {
    const [type, setType] = useState('soft');

    const handleConfirm = () => {
        onConfirm(type);
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface w-full max-w-md rounded-xl border border-stroke shadow-2xl overflow-hidden">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-foreground mb-2">Reinstall Instance</h3>
                    <p className="text-muted-foreground text-sm mb-6">
                        Choose how you want to reinstall <span className="text-primary font-bold">{instanceName}</span>.
                    </p>

                    <div className="space-y-4">
                        <label className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${type === 'soft' ? 'border-primary bg-primary/10' : 'border-stroke bg-muted hover:bg-accent'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <input
                                    type="radio"
                                    name="reinstallType"
                                    value="soft"
                                    checked={type === 'soft'}
                                    onChange={() => setType('soft')}
                                    className="w-5 h-5 text-primary bg-transparent border-stroke focus:ring-primary"
                                />
                                <span className="font-bold text-foreground">Soft Reinstall</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-8">
                                Re-downloads the game, loader, and libraries. Keeps your <strong className="text-muted-foreground">mods, launching configs, saves, and screenshots</strong> intact. Use this to fix corrupted game files.
                            </p>
                        </label>

                        <label className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${type === 'hard' ? 'border-red-500 bg-red-500/10' : 'border-stroke bg-muted hover:bg-accent'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <input
                                    type="radio"
                                    name="reinstallType"
                                    value="hard"
                                    checked={type === 'hard'}
                                    onChange={() => setType('hard')}
                                    className="w-5 h-5 text-red-500 bg-transparent border-stroke focus:ring-red-500 accent-red-500"
                                />
                                <span className="font-bold text-red-400">Hard Reinstall</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-8">
                                <span className="text-red-400 font-bold">WARNING:</span> Deletes ALL files in the instance folder (mods, saves, configs, screenshots, etc.) and performs a fresh clean install. Only the instance settings (name, version) are preserved.
                            </p>
                        </label>
                    </div>
                </div>

                <div className="p-4 bg-muted border-t border-stroke flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors font-medium text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-6 py-2 rounded-lg font-bold text-black transition-colors shadow-md ${type === 'hard' ? 'bg-red-500 hover:bg-red-400' : 'bg-primary hover:bg-primary-hover'}`}
                    >
                        {type === 'hard' ? 'Wipe & Reinstall' : 'Reinstall'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ReinstallModal;
