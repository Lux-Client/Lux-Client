import React, { useEffect, useState } from 'react';
import Dropdown from './Dropdown';
import { useAnimationsEnabled } from '../hooks/useAnimationsEnabled';

// Modrinth project id of "Fabric API".
const FABRIC_API_PROJECT_ID = 'P7dR8mSH';

interface ReinstallModalProps {
    instance?: any;
    instanceName?: string;
    onClose: () => void;
    onConfirm: (type: string, options?: { loaderVersion?: string; fabricApiVersion?: string }) => void;
}

function ReinstallModal({ instance, instanceName, onClose, onConfirm }: ReinstallModalProps) {
    const animationsEnabled = useAnimationsEnabled();

    // Support both the new `instance` prop and the legacy `instanceName` string.
    const resolvedInstance = instance || {};
    const name = resolvedInstance.name || instanceName || '';
    const loader = String(resolvedInstance.loader || 'Vanilla');
    const mcVersion = resolvedInstance.version || '';
    const isFabric = loader.toLowerCase() === 'fabric';

    const [type, setType] = useState('soft'); // 'soft' | 'hard' | 'custom'

    // Custom (Fabric) reinstall state.
    const [loadingCustom, setLoadingCustom] = useState(false);
    const [customError, setCustomError] = useState(null);
    const [loaderVersions, setLoaderVersions] = useState([]);
    const [loaderVersion, setLoaderVersion] = useState('');
    const [apiVersions, setApiVersions] = useState([]);
    const [fabricApiVersion, setFabricApiVersion] = useState('');

    // Lazily fetch the available Fabric loader + Fabric API versions the first
    // time the user opens the custom tab.
    useEffect(() => {
        if (type !== 'custom' || !isFabric || !mcVersion) return;
        if (loaderVersions.length > 0 || apiVersions.length > 0) return;

        let active = true;
        (async () => {
            setLoadingCustom(true);
            setCustomError(null);
            try {
                const [loaderRes, apiRes] = await Promise.all([
                    window.electronAPI.getLoaderVersions('Fabric', mcVersion),
                    window.electronAPI.getModVersions(FABRIC_API_PROJECT_ID, ['fabric'], [mcVersion])
                ]);

                if (!active) return;

                if (loaderRes?.success && Array.isArray(loaderRes.versions)) {
                    setLoaderVersions(loaderRes.versions);
                    setLoaderVersion(loaderRes.versions[0]?.version || '');
                }
                if (apiRes?.success && Array.isArray(apiRes.versions)) {
                    setApiVersions(apiRes.versions);
                    setFabricApiVersion(apiRes.versions[0]?.id || '');
                }
            } catch (e) {
                if (active) setCustomError(e.message);
            } finally {
                if (active) setLoadingCustom(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [type, isFabric, mcVersion]);

    const handleConfirm = () => {
        if (type === 'custom') {
            onConfirm('custom', { loaderVersion, fabricApiVersion });
        } else {
            onConfirm(type);
        }
    };

    const confirmDisabled = type === 'custom' && (loadingCustom || (!loaderVersion && !fabricApiVersion));

    return (
        <div className={`fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm ${animationsEnabled ? 'animate-in fade-in duration-200' : ''}`}>
            <div className={`bg-card w-full max-w-md rounded-xl border border-border shadow-2xl overflow-hidden ${animationsEnabled ? 'animate-in zoom-in-95 slide-in-from-bottom-2 duration-300' : ''}`}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-foreground mb-2">Reinstall Instance</h3>
                    <p className="text-muted-foreground text-sm mb-6">
                        Choose how you want to reinstall <span className="text-primary font-bold">{name}</span>.
                    </p>

                    <div className="space-y-4">
                        <label className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${type === 'soft' ? 'border-primary bg-primary/10' : 'border-border bg-muted hover:bg-accent'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <input
                                    type="radio"
                                    name="reinstallType"
                                    value="soft"
                                    checked={type === 'soft'}
                                    onChange={() => setType('soft')}
                                    className="w-5 h-5 text-primary bg-transparent border-border focus:ring-primary"
                                />
                                <span className="font-bold text-foreground">Soft Reinstall</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-8">
                                Re-downloads the game, loader, and libraries. Keeps your <strong className="text-muted-foreground">mods, launching configs, saves, and screenshots</strong> intact. Use this to fix corrupted game files.
                            </p>
                        </label>

                        {isFabric && (
                            <label className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${type === 'custom' ? 'border-primary bg-primary/10' : 'border-border bg-muted hover:bg-accent'}`}>
                                <div className="flex items-center gap-3 mb-2">
                                    <input
                                        type="radio"
                                        name="reinstallType"
                                        value="custom"
                                        checked={type === 'custom'}
                                        onChange={() => setType('custom')}
                                        className="w-5 h-5 text-primary bg-transparent border-border focus:ring-primary"
                                    />
                                    <span className="font-bold text-foreground">Custom Reinstall</span>
                                </div>
                                <p className="text-xs text-muted-foreground pl-8">
                                    Re-installs the game files and lets you pin a specific <strong className="text-muted-foreground">Fabric Loader</strong> and <strong className="text-muted-foreground">Fabric API</strong> version. Keeps your other mods, saves, and configs intact.
                                </p>

                                {type === 'custom' && (
                                    <div className="pl-8 mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                                        {loadingCustom ? (
                                            <div className="flex items-center gap-2 text-muted-foreground text-xs">
                                                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin"></div>
                                                Loading available versions for Minecraft {mcVersion}...
                                            </div>
                                        ) : customError ? (
                                            <p className="text-xs text-red-400">Failed to load versions: {customError}</p>
                                        ) : (
                                            <>
                                                <div className="space-y-1.5">
                                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Fabric Loader</label>
                                                    <Dropdown
                                                        options={loaderVersions.map((v) => ({
                                                            value: v.version,
                                                            label: v.stable === false ? `${v.version} (beta)` : v.version
                                                        }))}
                                                        value={loaderVersion}
                                                        onChange={setLoaderVersion}
                                                        placeholder="Select loader version"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Fabric API</label>
                                                    <Dropdown
                                                        options={apiVersions.map((v) => ({
                                                            value: v.id,
                                                            label: v.version_number || v.name || v.id
                                                        }))}
                                                        value={fabricApiVersion}
                                                        onChange={setFabricApiVersion}
                                                        placeholder="Select Fabric API version"
                                                    />
                                                    {apiVersions.length === 0 && (
                                                        <p className="text-[11px] text-muted-foreground">No Fabric API release found for this Minecraft version.</p>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </label>
                        )}

                        <label className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${type === 'hard' ? 'border-red-500 bg-red-500/10' : 'border-border bg-muted hover:bg-accent'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <input
                                    type="radio"
                                    name="reinstallType"
                                    value="hard"
                                    checked={type === 'hard'}
                                    onChange={() => setType('hard')}
                                    className="w-5 h-5 text-red-500 bg-transparent border-border focus:ring-red-500 accent-red-500"
                                />
                                <span className="font-bold text-red-400">Hard Reinstall</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-8">
                                <span className="text-red-400 font-bold">WARNING:</span> Deletes ALL files in the instance folder (mods, saves, configs, screenshots, etc.) and performs a fresh clean install. Only the instance settings (name, version) are preserved.
                            </p>
                        </label>
                    </div>
                </div>

                <div className="p-4 bg-muted border-t border-border flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors font-medium text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={confirmDisabled}
                        className={`px-6 py-2 rounded-lg font-bold text-black transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${type === 'hard' ? 'bg-red-500 hover:bg-red-400' : 'bg-primary hover:bg-primary-hover'}`}
                    >
                        {type === 'hard' ? 'Wipe & Reinstall' : type === 'custom' ? 'Custom Reinstall' : 'Reinstall'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ReinstallModal;
