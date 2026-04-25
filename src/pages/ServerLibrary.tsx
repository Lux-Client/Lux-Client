import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import LoadingOverlay from '../components/LoadingOverlay';
import { fetchSupportedPlatforms, fetchVersionsFor, fetchDetailsFor } from '../services/serverJars';

function ServerLibrary() {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [platforms, setPlatforms] = useState([]);
    const [selectedPlatform, setSelectedPlatform] = useState(null);
    const [versions, setVersions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingVersions, setIsLoadingVersions] = useState(false);
    const [downloading, setDownloading] = useState(null);
    const [installedSoftware, setInstalledSoftware] = useState({});

    const platformDetails = {
        vanilla: { logo: './assets/server-software/vanilla.png', name: 'Vanilla', description: 'Official Minecraft server', color: 'from-green-500/20' },
        bukkit: { logo: './assets/server-software/bukkit.png', name: 'Bukkit', description: 'Original plugin API', color: 'from-orange-500/20' },
        spigot: { logo: './assets/server-software/spigot.png', name: 'Spigot', description: 'Most popular server software', color: 'from-yellow-500/20' },
        paper: { logo: './assets/server-software/paper.svg', name: 'Paper', description: 'High-performance fork of Spigot', color: 'from-blue-500/20' },
        purpur: { logo: './assets/server-software/purpur.svg', name: 'Purpur', description: 'Fork of Paper with many features', color: 'from-purple-500/20' },
        folia: { logo: './assets/server-software/folia.png', name: 'Folia', description: 'Regionized multithreaded server', color: 'from-emerald-500/20' },
        forge: { logo: './assets/server-software/forge.jpeg', name: 'Forge', description: 'Modded server for Forge mods', color: 'from-red-500/20' },
        fabric: { logo: './assets/server-software/fabric.png', name: 'Fabric', description: 'Lightweight modding platform', color: 'from-cyan-500/20' },
        neoforge: { logo: './assets/server-software/neoforge.ico', name: 'NeoForge', description: 'Modern fork of Forge', color: 'from-indigo-500/20' },
        quilt: { logo: './assets/server-software/quilt.svg', name: 'Quilt', description: 'Community-driven modding platform', color: 'from-pink-500/20' },
        bungeecord: { logo: './assets/server-software/bungeecord.png', name: 'BungeeCord', description: 'Powerful proxy server', color: 'from-blue-600/20' },
        velocity: { logo: './assets/server-software/velocity.png', name: 'Velocity', description: 'Modern, high-performance proxy', color: 'from-cyan-600/20' }
    };

    useEffect(() => {
        loadPlatforms();
        loadInstalledSoftware();
    }, []);

    const loadPlatforms = async () => {
        setIsLoading(true);
        try {
            const data = fetchSupportedPlatforms();
            const supportedPlatforms = ['vanilla', 'bukkit', 'spigot', 'paper', 'purpur', 'folia', 'forge', 'fabric', 'neoforge', 'quilt', 'bungeecord', 'velocity'];
            const filteredPlatforms = data
                .filter((platform) => supportedPlatforms.includes(platform.key))
                .map((platform) => {
                    if (platform.key === 'craftbukkit') return { ...platform, key: 'bukkit' };
                    if (platform.key === 'waterfall') return { ...platform, key: 'bungeecord', name: 'BungeeCord' };
                    return platform;
                });
            const sortedPlatforms = filteredPlatforms.sort((a, b) => supportedPlatforms.indexOf(a.key) - supportedPlatforms.indexOf(b.key));

            setPlatforms(sortedPlatforms);
        } catch (error) {
            console.error('Failed to load platforms:', error);
            addNotification(t('server_library.load_platforms_failed'), 'error');
            setPlatforms([
                { key: 'vanilla', name: 'Vanilla' },
                { key: 'bukkit', name: 'Bukkit' },
                { key: 'spigot', name: 'Spigot' },
                { key: 'paper', name: 'Paper' },
                { key: 'purpur', name: 'Purpur' },
                { key: 'folia', name: 'Folia' },
                { key: 'forge', name: 'Forge' },
                { key: 'fabric', name: 'Fabric' },
                { key: 'neoforge', name: 'NeoForge' },
                { key: 'quilt', name: 'Quilt' },
                { key: 'bungeecord', name: 'BungeeCord' },
                { key: 'velocity', name: 'Velocity' }
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const loadVersions = async (platform) => {
        setIsLoadingVersions(true);
        setSelectedPlatform(platform);
        try {
            const data = await fetchVersionsFor(platform.key);
            setVersions((data || []).map((version) => ({ version })));
        } catch (error) {
            console.error('Failed to load versions:', error);
            addNotification(t('server_library.load_versions_failed', { name: platform.name }), 'error');
        } finally {
            setIsLoadingVersions(false);
        }
    };

    const loadInstalledSoftware = async () => {
        try {
            const servers = await window.electronAPI.getServers();
            const counts = {};
            servers.forEach(server => {
                if (server.software) {
                    counts[server.software] = (counts[server.software] || 0) + 1;
                }
            });
            setInstalledSoftware(counts);
        } catch (error) {
            console.error('Failed to load installed software:', error);
        }
    };

    const handleDownload = async (platform, version) => {
        try {
            setDownloading(`${platform.key}-${version.version}`);
            const data = await fetchDetailsFor(platform.key, version.version);
            const result = await window.electronAPI.downloadServerSoftware({
                platform: platform.key,
                version: version.version,
                downloadUrl: data.downloadUrl,
                name: platform.name
            });

            if (result.success) {
                addNotification(t('server_library.download_success', { name: platform.name, version: version.version }), 'success');
                await loadInstalledSoftware();
            } else {
                addNotification(t('server_library.download_failed', { error: result.error }), 'error');
            }
        } catch (err) {
            console.error(err);
            addNotification(t('server_library.download_failed', { error: err.message }), 'error');
        } finally {
            setDownloading(null);
        }
    };

    const handleSelectPlatform = (platform) => {
        if (selectedPlatform?.key === platform.key) {
            setSelectedPlatform(null);
            setVersions([]);
        } else {
            loadVersions(platform);
        }
    };

    const getInstallCount = (platformKey) => {
        return installedSoftware[platformKey] || 0;
    };

    return (
        <div className="p-8 h-full overflow-y-auto custom-scrollbar">
            {isLoading && <LoadingOverlay message={t('server_library.loading_platforms')} />}

            <div className="mb-6">
                <h1 className="text-3xl font-bold text-foreground mb-1">{t('server_library.title')}</h1>
                <p className="text-muted-foreground text-sm">{t('server_library.desc')}</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {platforms.map((platform) => {
                    const details = platformDetails[platform.key] || {
                        icon: '📦',
                        name: platform.name,
                        description: 'Minecraft server software',
                        color: 'from-gray-500/20'
                    };
                    const installCount = getInstallCount(platform.key);
                    const isSelected = selectedPlatform?.key === platform.key;

                    return (
                        <div key={platform.key} className="space-y-2">
                            <div
                                onClick={() => handleSelectPlatform(platform)}
                                className={`bg-surface/40 backdrop-blur-sm border ${isSelected ? 'border-primary/50 shadow-md' : 'border-stroke'} rounded-xl overflow-hidden hover:border-primary/50 transition-all cursor-pointer group`}
                            >
                                <div className="p-6">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className={`w-16 h-16 bg-gradient-to-br ${details.color} to-transparent rounded-xl flex items-center justify-center border border-stroke transition-transform overflow-hidden p-3`}>
                                                {details.logo ? (
                                                    <img src={details.logo} alt={details.name} className="w-full h-full object-contain" />
                                                ) : (
                                                    <span className="text-4xl">{details.icon}</span>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <h3 className="font-bold text-foreground text-xl">{details.name}</h3>
                                                    {installCount > 0 && (
                                                        <span className="bg-primary/20 text-primary text-xs px-2 py-1 rounded-full border border-primary/30">
                                                            {t('server_library.installed_count', { count: installCount })}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-muted-foreground text-sm mb-2">{details.description}</p>
                                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                                        </svg>
                                                        {isSelected ? t('server_library.hide_versions') : t('server_library.show_versions')}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className={`transform transition-transform ${isSelected ? 'rotate-180' : ''}`}>
                                                <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {isSelected && (
                                    <div className="pl-24 pr-6 pb-4 space-y-2 animate-in slide-in-from-top-2 duration-200">
                                        {isLoadingVersions ? (
                                            <div className="flex items-center gap-3 py-4 text-muted-foreground text-sm justify-center">
                                                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                                {t('server_library.loading_versions')}
                                            </div>
                                        ) : (
                                            versions.map((version) => {
                                                const isDownloading = downloading === `${platform.key}-${version.version}`;
                                                return (
                                                    <div
                                                        key={version.version}
                                                        className="bg-surface/20 border border-stroke rounded-xl p-4 hover:border-primary/50 transition-all flex items-center justify-between group/version"
                                                    >
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-sm font-mono text-foreground">{version.version}</span>
                                                            {version.release && (
                                                                <span className="text-xs text-muted-foreground capitalize">{version.release}</span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDownload(platform, version);
                                                            }}
                                                            disabled={isDownloading}
                                                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${isDownloading
                                                                ? 'bg-primary/20 text-primary cursor-wait'
                                                                : 'bg-primary/20 text-primary hover:bg-primary/30'
                                                                }`}
                                                        >
                                                            {isDownloading ? (
                                                                <>
                                                                    <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                                                    {t('server_library.downloading_dots')}
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                    </svg>
                                                                    {t('server_library.download_btn')}
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default ServerLibrary;