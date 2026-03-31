import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';

const ThemeMarketplace = () => {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [installedThemes, setInstalledThemes] = useState([]);
    const [activeTab, setActiveTab] = useState('online');
    const [onlineThemes, setOnlineThemes] = useState([]);
    const [loadingOnline, setLoadingOnline] = useState(false);
    const [onlineStatus, setOnlineStatus] = useState('ok');
    const [installing, setInstalling] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchInstalledThemes();
        if (activeTab === 'online') {
            fetchOnlineThemes();
        }
    }, [activeTab]);

    const fetchInstalledThemes = async () => {
        if (!window.electronAPI) return;
        const res = await window.electronAPI.getCustomPresets();
        if (res.success) {
            setInstalledThemes(res.presets || []);
        }
    };

    const fetchOnlineThemes = async () => {
        setLoadingOnline(true);
        setOnlineStatus('ok');
        try {
            const response = await fetch('https://lux.pluginhub.de/api/extensions?type=theme');
            if (response.ok) {
                const data = await response.json();
                const themesOnly = data.filter(ext => ext.type === 'theme');
                setOnlineThemes(themesOnly);
                setOnlineStatus('ok');
            } else {
                console.error('Failed to fetch themes', response.status);
                setOnlineThemes([]);
                if (response.status === 503) {
                    setOnlineStatus('maintenance');
                } else {
                    setOnlineStatus('error');
                }
            }
        } catch (error) {
            console.error('Error fetching themes:', error);
            setOnlineThemes([]);
            setOnlineStatus('error');
        } finally {
            setLoadingOnline(false);
        }
    };

    const handleInstallOnline = async (theme) => {
        if (!window.electronAPI) return;

        setInstalling(theme.id);

        try {
            const detailResponse = await fetch(`https://lux.pluginhub.de/api/extensions/i/${theme.identifier}`);
            if (!detailResponse.ok) {
                throw new Error('Could not fetch theme details');
            }

            const detailData = await detailResponse.json();
            if (!detailData.versions || detailData.versions.length === 0) {
                throw new Error('No versions available for this theme');
            }

            const latestVersionPath = detailData.versions[0].file_path;
            const downloadUrl = `https://lux.pluginhub.de/uploads/${encodeURIComponent(latestVersionPath)}`;

            const result = await window.electronAPI.installThemeFromMarketplace(downloadUrl);

            if (result.success) {
                try {
                    await fetch(`https://lux.pluginhub.de/api/extensions/${theme.id}/download`, {
                        method: 'POST'
                    });
                } catch (e) {
                }

                addNotification(t('styling.imported_success', 'Theme installed successfully!'), 'success');
                fetchInstalledThemes();
            } else {
                addNotification(`Failed to install: ${result.error}`, 'error');
            }
        } catch (error) {
            addNotification(`Error installing theme: ${error.message}`, 'error');
        } finally {
            setInstalling(null);
        }
    };

    const handleRemove = async (handle) => {
        if (!window.electronAPI) return;

        const result = await window.electronAPI.deleteCustomPreset(handle);
        if (result.success) {
            fetchInstalledThemes();
            addNotification(t('styling.preset_deleted', 'Theme deleted'), 'success');
        } else {
            addNotification(`Failed to remove: ${result.error}`, 'error');
        }
    };

    return (
        <div className="text-foreground w-full">
            <div className="flex gap-4 mb-6 border-b border-border pb-4">
                <button
                    onClick={() => setActiveTab('installed')}
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${activeTab === 'installed' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-accent-foreground hover:bg-accent'}`}
                >
                    {t('extensions.installed_count', { count: installedThemes.length })}
                </button>
                <button
                    onClick={() => setActiveTab('online')}
                    className={`px-4 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 ${activeTab === 'online' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-accent-foreground hover:bg-accent'}`}
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
                        <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder={t('extensions.search')}
                        className="w-full bg-background border border-border rounded-xl py-3 pl-11 pr-4 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-medium shadow-inner"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            <div className={activeTab === 'online' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6" : "flex flex-col gap-4"}>
                {activeTab === 'installed' ? (
                    installedThemes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-muted rounded-xl border border-border border-dashed">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                            </svg>
                            <p className="text-muted-foreground font-medium text-lg">{t('styling.no_custom_themes', 'No custom themes installed.')}</p>
                        </div>
                    ) : (
                        installedThemes.map(theme => (
                            <div key={theme.handle} className="p-5 rounded-xl border flex items-center gap-5 transition-all group backdrop-blur-md bg-card border-border">
                                <div className="w-14 h-14 rounded-full flex flex-shrink-0 relative overflow-hidden shadow-inner border border-border" style={{ backgroundColor: theme.bg }}>
                                    <div className="absolute inset-0 right-1/2" style={{ backgroundColor: theme.primary }}></div>
                                    <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ backgroundColor: theme.surface }}></div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-lg text-foreground truncate">{theme.name}</h3>
                                    <span className="text-xs text-muted-foreground font-mono">@{theme.handle}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="px-3 py-1 bg-muted text-foreground rounded text-[10px] font-bold uppercase tracking-wider">
                                        {t('common.installed', 'Installed')}
                                    </span>
                                    <button
                                        onClick={() => handleRemove(theme.handle)}
                                        className="p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
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
                        <div className="col-span-full flex flex-col items-center justify-center py-20 bg-muted rounded-xl border border-border border-dashed">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                            <p className="text-muted-foreground font-medium text-lg">Loading themes...</p>
                        </div>
                    ) : onlineStatus === 'maintenance' ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 bg-muted rounded-xl border border-border border-dashed">
                            <p className="text-muted-foreground font-medium text-lg">Marketplace is under maintenance. Please try again later.</p>
                        </div>
                    ) : onlineThemes.length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 bg-muted rounded-xl border border-border border-dashed">
                            <p className="text-muted-foreground font-medium text-lg">No themes found online.</p>
                        </div>
                    ) : (
                        (() => {
                            const filtered = onlineThemes.filter(ext =>
                                ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                (ext.summary && ext.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                (ext.developer && ext.developer.toLowerCase().includes(searchQuery.toLowerCase()))
                            );

                            if (filtered.length === 0) {
                                return (
                                    <div className="col-span-full flex flex-col items-center justify-center py-10 bg-muted rounded-xl border border-border border-dashed">
                                        <p className="text-muted-foreground font-medium">{t('extensions.no_search_results')}</p>
                                    </div>
                                );
                            }

                            return filtered.map(ext => {
                                const isInstalled = installedThemes.some(ie => ie.handle === ext.identifier || ie.name === ext.name);

                                return (
                                    <div key={ext.id} className="rounded-xl border flex flex-col overflow-hidden transition-all group bg-card border-border hover:border-border hover:bg-accent">
                                        <div className="w-full aspect-video bg-muted relative overflow-hidden flex items-center justify-center border-b border-border">
                                            {ext.banner_path ? (
                                                <img
                                                    src={`https://lux.pluginhub.de/uploads/${ext.banner_path}`}
                                                    alt={ext.name}
                                                    className="w-full h-full object-cover transition-transform duration-500"
                                                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                                />
                                            ) : (
                                                <div className="text-4xl font-bold text-muted-foreground uppercase tracking-widest">{ext.name.substring(0, 3)}</div>
                                            )}
                                        </div>

                                        <div className="p-5 flex-1 flex flex-col min-w-0">
                                            <div className="flex items-start justify-between gap-3 mb-2">
                                                <h3 className="font-bold text-lg text-foreground line-clamp-1">{ext.name}</h3>
                                                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-bold border border-primary/20 shrink-0 uppercase tracking-wider">
                                                    {ext.downloads} DL
                                                </span>
                                            </div>
                                            <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">{ext.summary || ext.description || 'No description provided.'}</p>

                                            <div className="flex items-center justify-between mt-auto pt-4 border-t border-border">
                                                <div className="text-xs text-muted-foreground">
                                                    <span>By <span className="text-foreground font-medium">{ext.developer || 'Unknown'}</span></span>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {isInstalled ? (
                                                        <span className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-bold uppercase tracking-wider border border-border flex items-center gap-1">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                            Installed
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleInstallOnline(ext)}
                                                            disabled={installing === ext.id}
                                                            className={`px-3 py-1.5 font-bold uppercase tracking-wider text-xs rounded-lg transition-all flex items-center gap-1 ${installing === ext.id
                                                                ? 'bg-primary/50 text-black/50 cursor-not-allowed'
                                                                : 'bg-primary hover:bg-primary/90 text-black shadow-lg shadow-sm'
                                                                }`}
                                                        >
                                                            {installing === ext.id ? (
                                                                <>
                                                                    <div className="w-3 h-3 border-2 border-black/50 border-t-transparent rounded-full animate-spin"></div>
                                                                    Installing
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                                                    </svg>
                                                                    Install
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
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

export default ThemeMarketplace;
