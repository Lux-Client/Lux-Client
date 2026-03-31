import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '../context/ExtensionContext';
import PageHeader from '../components/layout/PageHeader';
import PageContent from '../components/layout/PageContent';
import EmptyState from '../components/layout/EmptyState';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Switch } from '../components/ui/switch';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import {
  Upload,
  Globe,
  Search,
  Trash2,
  Check,
  Loader2,
  Eye,
  Package,
  ExternalLink,
  Download,
} from 'lucide-react';

const Extensions = () => {
    const { t } = useTranslation();
    const { installedExtensions, refreshExtensions, unloadExtension, toggleExtension } = useExtensions();
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('installed');
    const [onlineExtensions, setOnlineExtensions] = useState([]);
    const [loadingOnline, setLoadingOnline] = useState(false);
    const [onlineStatus, setOnlineStatus] = useState<'ok' | 'maintenance' | 'error'>('ok');
    const [installing, setInstalling] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (activeTab === 'online') {
            fetchOnlineExtensions();
        }
    }, [activeTab]);

    const fetchOnlineExtensions = async () => {
        setLoadingOnline(true);
        setOnlineStatus('ok');
        try {
            const response = await fetch('https://lux.pluginhub.de/api/extensions');
            if (response.ok) {
                const data = await response.json();
                const extsOnly = data.filter(ext => ext.type !== 'theme');
                setOnlineExtensions(extsOnly);
                setOnlineStatus('ok');
            } else {
                console.error('Failed to fetch extensions', response.status);
                setOnlineExtensions([]);
                if (response.status === 503) {
                    setOnlineStatus('maintenance');
                } else {
                    setOnlineStatus('error');
                }
            }
        } catch (error) {
            console.error('Error fetching extensions:', error);
            setOnlineExtensions([]);
            setOnlineStatus('error');
        } finally {
            setLoadingOnline(false);
        }
    };

    const handleInstallOnline = async (ext) => {
        if (!window.electronAPI) return;

        setInstalling(ext.id);

        try {
            const detailResponse = await fetch(`https://lux.pluginhub.de/api/extensions/i/${ext.identifier}`);
            if (!detailResponse.ok) {
                throw new Error('Could not fetch extension details');
            }

            const detailData = await detailResponse.json();
            if (!detailData.versions || detailData.versions.length === 0) {
                throw new Error('No versions available for this extension');
            }

            const latestVersionPath = detailData.versions[0].file_path;
            const downloadUrl = `https://lux.pluginhub.de/uploads/${encodeURIComponent(latestVersionPath)}`;

            const result = await window.electronAPI.installExtension(downloadUrl);

            if (result.success) {
                try {
                    await fetch(`https://lux.pluginhub.de/api/extensions/${ext.id}/download`, {
                        method: 'POST'
                    });
                } catch (e) {
                    console.error('Failed to notify download tracking', e);
                }

                refreshExtensions();
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
            filters: [{ name: 'MC Extension', extensions: ['luxextension', 'zip'] }]
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

    const filtered = onlineExtensions.filter(ext =>
        ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ext.summary && ext.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (ext.developer && ext.developer.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title={t('extensions.title')}
                description={t('extensions.desc')}
            >
                <Button size="sm" onClick={handleUpload} className="gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    {t('extensions.install_file')}
                </Button>
            </PageHeader>

            <PageContent>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-5">
                    <TabsList>
                        <TabsTrigger value="installed">
                            {t('extensions.installed_count', { count: installedExtensions.length })}
                        </TabsTrigger>
                        <TabsTrigger value="online" className="gap-1.5">
                            <Globe className="w-3.5 h-3.5" />
                            {t('extensions.marketplace')}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                {activeTab === 'online' && (
                    <div className="relative mb-5">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <Input
                            type="text"
                            placeholder={t('extensions.search')}
                            className="pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                )}

                <div className="space-y-2">
                    {activeTab === 'installed' ? (
                        installedExtensions.length === 0 ? (
                            <EmptyState
                                icon={Package}
                                title={t('extensions.no_extensions')}
                                description={t('dashboard.import_file')}
                            />
                        ) : (
                            installedExtensions.map(ext => (
                                <div
                                    key={ext.id}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors border border-border ${ext.enabled ? 'bg-card' : 'bg-card/50 opacity-60'}`}
                                >
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-base font-semibold overflow-hidden shrink-0 border border-border ${ext.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                        {ext.iconPath ? (
                                            <img
                                                src={`app-media:///${ext.iconPath}`}
                                                alt={ext.name}
                                                className="w-full h-full object-cover"
                                                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <span>{ext.name.charAt(0).toUpperCase()}</span>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-foreground truncate">{ext.name}</span>
                                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 h-4">{ext.version}</Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">{ext.description || 'No description provided.'}</p>
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                            <span>{ext.author || 'Unknown'}</span>
                                            <span className="text-border">·</span>
                                            <span className="font-mono">{ext.id}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0">
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={!!ext.enabled}
                                                onCheckedChange={(checked) => toggleExtension(ext.id, checked)}
                                            />
                                            <span className="text-xs text-muted-foreground min-w-[52px]">
                                                {ext.enabled ? t('common.enabled') : t('common.disabled')}
                                            </span>
                                        </div>

                                        <Separator orientation="vertical" className="h-6" />

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={() => handleRemove(ext.id)}
                                            title={t('extensions.uninstall')}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )
                    ) : (
                        loadingOnline ? (
                            <div className="space-y-2">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3 border border-border bg-card">
                                        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <Skeleton className="h-4 w-32 mb-1.5" />
                                            <Skeleton className="h-3 w-48 mb-1" />
                                            <Skeleton className="h-3 w-20" />
                                        </div>
                                        <Skeleton className="h-8 w-20 rounded-md" />
                                    </div>
                                ))}
                            </div>
                        ) : onlineStatus === 'maintenance' ? (
                            <EmptyState
                                icon={Globe}
                                title="Marketplace is under maintenance."
                                description="Please try again in a few minutes."
                            />
                        ) : onlineExtensions.length === 0 ? (
                            <EmptyState
                                icon={Globe}
                                title="No extensions found online."
                            />
                        ) : filtered.length === 0 ? (
                            <EmptyState
                                icon={Search}
                                title={t('extensions.no_search_results')}
                            />
                        ) : (
                            filtered.map(ext => {
                                const isInstalled = installedExtensions.some(ie => ie.id === ext.identifier);

                                return (
                                    <div
                                        key={ext.id}
                                        className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors border border-border bg-card hover:bg-accent/50"
                                    >
                                        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-semibold overflow-hidden shrink-0 bg-primary/10 text-primary border border-border">
                                            {ext.banner_path ? (
                                                <img
                                                    src={`https://lux.pluginhub.de/uploads/${ext.banner_path}`}
                                                    alt={ext.name}
                                                    className="w-full h-full object-cover"
                                                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                                />
                                            ) : (
                                                <span>{ext.name.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-foreground truncate">{ext.name}</span>
                                                <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4">
                                                    <Download className="w-2.5 h-2.5" />
                                                    {ext.downloads} {t('common.downloads') || 'downloads'}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate mt-0.5">{ext.summary || ext.description || 'No description provided.'}</p>
                                            <span className="text-[11px] text-muted-foreground mt-0.5">{ext.developer || 'Unknown'}</span>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {isInstalled ? (
                                                <Badge variant="outline" className="gap-1.5 text-xs px-3 py-1">
                                                    <Check className="w-3 h-3 text-emerald-500" />
                                                    Installed
                                                </Badge>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleInstallOnline(ext)}
                                                    disabled={installing === ext.id}
                                                    className="gap-1.5"
                                                >
                                                    {installing === ext.id ? (
                                                        <>
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            Installing...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Download className="w-3.5 h-3.5" />
                                                            Install
                                                        </>
                                                    )}
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => window.electronAPI?.openExternal(`https://lux.pluginhub.de/extensions/${ext.identifier}`)}
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                                {t('extensions.view_online')}
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    )}
                </div>
            </PageContent>
        </div>
    );
};

export default Extensions;
