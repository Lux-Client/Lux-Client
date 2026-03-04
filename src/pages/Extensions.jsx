import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '../context/ExtensionContext';

const Extensions = () => {
    const { t } = useTranslation();
    const { installedExtensions, refreshExtensions, unloadExtension, toggleExtension } = useExtensions();
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('installed');
    const [onlineExtensions, setOnlineExtensions] = useState([]);
    const [loadingOnline, setLoadingOnline] = useState(false);
    const [installing, setInstalling] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (activeTab === 'online') {
            fetchOnlineExtensions();
        }
    }, [activeTab]);

    const fetchOnlineExtensions = async () => {
        setLoadingOnline(true);
        try {
            const response = await fetch('https://mclc.pluginhub.de/api/extensions');
            if (response.ok) {
                const data = await response.json();
                const extsOnly = data.filter(ext => ext.type !== 'theme');
                setOnlineExtensions(extsOnly);
            } else {
                console.error('Failed to fetch extensions', response.status);
            }
        } catch (error) {
            console.error('Error fetching extensions:', error);
        } finally {
            setLoadingOnline(false);
        }
    };

    const handleInstallOnline = async (ext) => {
        if (!window.electronAPI) return;

        setInstalling(ext.id);

        try {
            // Fetch detailed extension info to get the latest version file path
            const detailResponse = await fetch(`https://mclc.pluginhub.de/api/extensions/i/${ext.identifier}`);
            if (!detailResponse.ok) {
                throw new Error('Could not fetch extension details');
            }

            const detailData = await detailResponse.json();
            if (!detailData.versions || detailData.versions.length === 0) {
                throw new Error('No versions available for this extension');
            }

            // Get the first (latest) version's file_path
            const latestVersionPath = detailData.versions[0].file_path;
            const downloadUrl = `https://mclc.pluginhub.de/uploads/${encodeURIComponent(latestVersionPath)}`;

            const result = await window.electronAPI.installExtension(downloadUrl);

            if (result.success) {
                // Register the download on the server
                try {
                    await fetch(`https://mclc.pluginhub.de/api/extensions/${ext.id}/download`, {
                        method: 'POST'
                    });
                } catch (e) {
                    console.error('Failed to notify download tracking', e);
                }

                refreshExtensions();
                // Optional: switch back to installed tab after successful install
                // setActiveTab('installed');
            } else {
                alert(`Failed to install: ${result.error}`);
            }
        } catch (error) {
            alert(`Error installing extension: ${error.message}`);
        } finally {
            setInstalling(null);
        }
    };

    const handleUpload = async () => {
        if (!window.electronAPI) return;

        const file = await window.electronAPI.openFileDialog({
            filters: [{ name: 'MC Extension', extensions: ['mclcextension', 'zip'] }]
        });

        if (file && !file.canceled && file.filePaths && file.filePaths.length > 0) {

            const result = await window.electronAPI.installExtension(file.filePaths[0]);
            if (result.success) {
                refreshExtensions();
            } else {
                alert(`Failed to install: ${result.error}`);
            }
        }
    };

    const handleRemove = async (id) => {
        if (!window.electronAPI) return;

        await unloadExtension(id);
        const result = await window.electronAPI.removeExtension(id);
        if (result.success) {
            refreshExtensions();
        } else {
            alert(`Failed to remove: ${result.error}`);
        }
    };

    return (
        <div className="p-8 text-white h-full overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white">{t('extensions.title')}</h1>
                    <p className="text-gray-400 mt-1">{t('extensions.desc')}</p>
                </div>
                <button
                    onClick={handleUpload}
                    className="bg-primary hover:scale-[1.02] text-black font-bold px-5 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 shadow-primary/20 hover:shadow-primary/30"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {t('extensions.install_file')}
                </button>
            </div>

            <div className="flex gap-4 mb-6 border-b border-white/10 pb-4">
                <button
                    onClick={() => setActiveTab('installed')}
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${activeTab === 'installed' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                    {t('extensions.installed_count', { count: installedExtensions.length })}
                </button>
                <button
                    onClick={() => setActiveTab('online')}
                    className={`px-4 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 ${activeTab === 'online' ? 'bg-primary/20 text-primary' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('extensions.marketplace')}
                </button>
            </div>

            {activeTab === 'online' && (
                <div className="mb-6 relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder={t('extensions.search')}
                        className="w-full bg-background border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-medium shadow-inner"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            <div className="flex flex-col gap-4">
                {activeTab === 'installed' ? (
                    installedExtensions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-surface/5 rounded-2xl border border-white/5 border-dashed">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                            <p className="text-gray-500 font-medium text-lg">{t('extensions.no_extensions')}</p>
                            <p className="text-gray-600 text-sm mt-1">{t('dashboard.import_file')}</p>
                        </div>
                    ) : (
                        installedExtensions.map(ext => (
                            <div key={ext.id} className={`p-5 rounded-2xl border flex items-center gap-5 transition-all group backdrop-blur-md ${ext.enabled ? 'bg-surface/20 border-white/10' : 'bg-surface/5 border-white/5 opacity-70'}`}>
                                { }
                                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold shadow-inner overflow-hidden flex-shrink-0 ${ext.enabled ? 'bg-primary/20 text-primary' : 'bg-gray-800 text-gray-500'}`}>
                                    {ext.iconPath ? (
                                        <img
                                            src={`app-media:///${ext.iconPath}`}
                                            alt={ext.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                    ) : (
                                        <span>{ext.name.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3">
                                        <h3 className={`font-bold text-lg truncate ${ext.enabled ? 'text-white' : 'text-gray-400'}`}>{ext.name}</h3>
                                        <span className="text-xs bg-black/30 px-2 py-0.5 rounded text-gray-400 font-mono border border-white/5">{ext.version}</span>
                                    </div>
                                    <p className="text-sm text-gray-400 truncate">{ext.description || 'No description provided.'}</p>
                                    <div className="mt-1 flex gap-4 text-xs text-gray-500">
                                        <span>By <span className="text-gray-300">{ext.author || 'Unknown'}</span></span>
                                        <span>ID: <span className="font-mono">{ext.id}</span></span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    { }
                                    <label className="flex items-center cursor-pointer relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={!!ext.enabled}
                                            onChange={(e) => toggleExtension(ext.id, e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        <span className="ml-3 text-sm font-medium text-gray-300 min-w-[60px]">{ext.enabled ? t('common.enabled') : t('common.disabled')}</span>
                                    </label>

                                    <div className="h-8 w-[1px] bg-white/10"></div>

                                    <button
                                        onClick={() => handleRemove(ext.id)}
                                        className="p-2 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                        title={t('extensions.uninstall')}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    )
                ) : (
                    loadingOnline ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-surface/5 rounded-2xl border border-white/5 border-dashed">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                            <p className="text-gray-500 font-medium text-lg">Loading extensions...</p>
                        </div>
                    ) : onlineExtensions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-surface/5 rounded-2xl border border-white/5 border-dashed">
                            <p className="text-gray-500 font-medium text-lg">No extensions found online.</p>
                        </div>
                    ) : (
                        (() => {
                            const filtered = onlineExtensions.filter(ext =>
                                ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                (ext.summary && ext.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                (ext.developer && ext.developer.toLowerCase().includes(searchQuery.toLowerCase()))
                            );

                            if (filtered.length === 0) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-10 bg-surface/5 rounded-2xl border border-white/5 border-dashed">
                                        <p className="text-gray-500 font-medium">{t('extensions.no_search_results')}</p>
                                    </div>
                                );
                            }

                            return filtered.map(ext => {
                                const isInstalled = installedExtensions.some(ie => ie.id === ext.identifier);

                                return (
                                    <div key={ext.id} className="p-5 rounded-2xl border flex items-center gap-5 transition-all group backdrop-blur-md bg-surface/10 border-white/10">
                                        <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold shadow-inner overflow-hidden flex-shrink-0 bg-primary/20 text-primary">
                                            {ext.banner_path ? (
                                                <img
                                                    src={`https://mclc.pluginhub.de/uploads/${ext.banner_path}`}
                                                    alt={ext.name}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            ) : (
                                                <span>{ext.name.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3">
                                                <h3 className="font-bold text-lg truncate text-white">{ext.name}</h3>
                                                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium border border-primary/20">
                                                    {ext.downloads} {t('common.downloads') || 'downloads'}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-400 truncate">{ext.summary || ext.description || 'No description provided.'}</p>
                                            <div className="mt-1 flex gap-4 text-xs text-gray-500">
                                                <span>By <span className="text-gray-300">{ext.developer || 'Unknown'}</span></span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            {isInstalled ? (
                                                <span className="px-4 py-2 bg-white/5 text-gray-400 rounded-lg text-sm font-medium border border-white/5 flex items-center gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                    Installed
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handleInstallOnline(ext)}
                                                    disabled={installing === ext.id}
                                                    className={`px-4 py-2 font-bold rounded-lg transition-all flex items-center gap-2 ${installing === ext.id
                                                        ? 'bg-primary/50 text-black/50 cursor-not-allowed'
                                                        : 'bg-primary hover:bg-primary/90 text-black shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02]'
                                                        }`}
                                                >
                                                    {installing === ext.id ? (
                                                        <>
                                                            <div className="w-4 h-4 border-2 border-black/50 border-t-transparent rounded-full animate-spin"></div>
                                                            Installing...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                                            </svg>
                                                            Install
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => window.open(`https://mclc.pluginhub.de/extensions/${ext.identifier}`, '_blank')}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white font-medium rounded-lg transition-all flex items-center gap-2 border border-white/5"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                                {t('extensions.view_online')}
                                            </button>
                                        </div>
                                    </div>
                                );
                            });
                        })()
                    )
                )}
            </div>
        </div>
    );
};

export default Extensions;
