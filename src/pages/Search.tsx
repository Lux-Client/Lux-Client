import React, { useState, useEffect, useRef } from 'react';
import { useNotification } from '../context/NotificationContext';
import { useTranslation } from 'react-i18next';
import { Analytics } from '../services/Analytics';
import ModDependencyModal from '../components/ModDependencyModal';
import PageHeader from '../components/layout/PageHeader';
import PageContent from '../components/layout/PageContent';
import EmptyState from '../components/layout/EmptyState';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { filterInstancesForMode } from '../utils/instanceTypes';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '../components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
    Search as SearchIcon,
    Download,
    Plus,
    Check,
    X,
    Eye,
    Image,
    ArrowDownToLine,
    Loader2,
    Package,
    Blocks,
    Paintbrush,
    Box,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { getSourceTags } from '../utils/sourceTags';

function Search({ initialCategory, onCategoryConsumed }) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState({ enableModrinthPackSupport: true, enableCurseForgePackSupport: true });
    const [projectType, setProjectType] = useState(initialCategory || 'mod');
    const [offset, setOffset] = useState(0);
    const limit = 21;
    const [totalHits, setTotalHits] = useState(0);
    const [sortMethod, setSortMethod] = useState('relevance');
    const [provider, setProvider] = useState('modrinth');
    useEffect(() => {
        if (initialCategory) {
            setProjectType(initialCategory);
            if (onCategoryConsumed) onCategoryConsumed();
        }
    }, [initialCategory]);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [selectedMod, setSelectedMod] = useState(null);
    const [instances, setInstances] = useState([]);
    const [selectedInstance, setSelectedInstance] = useState('');
    const [installing, setInstalling] = useState(false);
    const [installedIds, setInstalledIds] = useState(new Set());
    const [instanceInstalledIds, setInstanceInstalledIds] = useState(new Set());
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [previewProject, setPreviewProject] = useState(null);
    const [lightboxIndex, setLightboxIndex] = useState(-1);
    const [showDependencyModal, setShowDependencyModal] = useState(false);
    const [pendingDependencies, setPendingDependencies] = useState([]);
    const [resolvedForInstance, setResolvedForInstance] = useState(null);
    const [jumpPopover, setJumpPopover] = useState(null);
    const [jumpValue, setJumpValue] = useState('');
    const liveSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didInitLiveSearchRef = useRef(false);
    const totalPages = Math.max(1, Math.ceil(totalHits / limit));
    const currentPage = Math.floor(offset / limit) + 1;

    const handleNextImage = (e) => {
        e.stopPropagation();
        if (previewProject && previewProject.gallery) {
            setLightboxIndex((prev) => (prev + 1) % previewProject.gallery.length);
        }
    };

    const handlePrevImage = (e) => {
        e.stopPropagation();
        if (previewProject && previewProject.gallery) {
            setLightboxIndex((prev) => (prev - 1 + previewProject.gallery.length) % previewProject.gallery.length);
        }
    };
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (lightboxIndex === -1) return;
            if (e.key === 'ArrowRight') handleNextImage(e);
            if (e.key === 'ArrowLeft') handlePrevImage(e);
            if (e.key === 'Escape') setLightboxIndex(-1);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxIndex, previewProject]);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await window.electronAPI.getSettings();
                if (res.success) {
                    setSettings(res.settings);
                }
            } catch (e) { }
        };
        loadSettings();
        const cleanup = window.electronAPI.onSettingsUpdated?.((s) => setSettings(s));
        return () => cleanup?.();
    }, []);

    useEffect(() => {
        if (!settings.enableModrinthPackSupport && projectType === 'modpack') {
            setProjectType('mod');
            setOffset(0);
        }
    }, [settings.enableModrinthPackSupport]);

    useEffect(() => {
        if (!settings.enableCurseForgePackSupport && provider === 'curseforge') {
            setProvider('modrinth');
        }
    }, [settings.enableCurseForgePackSupport]);

    const handlePreview = async (mod) => {
        try {
            const projectId = mod.project_id || mod.projectId;
            if (!projectId) {
                addNotification(t('search.error_preview_no_id'), 'error');
                return;
            }

            addNotification(t('search.loading_preview', { title: mod.title }), 'info');
            const res = await window.electronAPI.getModrinthProject(projectId);
            if (res.success) {
                const fullProject = {
                    ...res.project,
                    project_id: res.project.id,
                    project_type: mod.project_type
                };
                setPreviewProject(fullProject);
                setShowPreviewModal(true);
            } else {
                addNotification(t('search.failed_preview', { error: res.error }), 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('search.error_preview'), 'error');
        }
    };
    const formatDownloads = (downloads) => {
        if (downloads === undefined || downloads === null) return '0';

        if (downloads >= 1_000_000_000) {
            return (downloads / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
        }
        if (downloads >= 1_000_000) {
            return (downloads / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (downloads >= 1_000) {
            return (downloads / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return downloads.toString();
    };

    useEffect(() => {
        handleSearch();
    }, [offset, sortMethod, projectType, provider]);

    useEffect(() => {
        if (!didInitLiveSearchRef.current) {
            didInitLiveSearchRef.current = true;
            return;
        }

        if (liveSearchTimeoutRef.current) {
            clearTimeout(liveSearchTimeoutRef.current);
        }

        liveSearchTimeoutRef.current = setTimeout(() => {
            if (offset === 0) {
                handleSearch(null, 0);
                return;
            }
            setOffset(0);
        }, 300);

        return () => {
            if (liveSearchTimeoutRef.current) {
                clearTimeout(liveSearchTimeoutRef.current);
                liveSearchTimeoutRef.current = null;
            }
        };
    }, [query]);

    const handleSearch = async (e?: any, nextOffset = offset) => {
        if (e) e.preventDefault();

        setLoading(true);
        try {
            const res = await window.electronAPI.searchModrinth(query, [], {
                offset: nextOffset,
                limit,
                index: sortMethod,
                projectType,
                provider
            });

            if (res.success) {
                let finalResults = res.results;

                if (projectType === 'modpack' && nextOffset === 0 && !query) {
                    try {
                        const gCraftRes = await window.electronAPI.getModrinthProject('oMskb4v5');
                        if (gCraftRes.success) {
                            const gCraft = {
                                ...gCraftRes.project,
                                project_id: gCraftRes.project.id,
                                project_type: 'modpack'
                            };
                            finalResults = [gCraft, ...finalResults.filter(r => r.project_id !== 'oMskb4v5')];
                        }
                    } catch (err) {
                        console.error("Failed to fetch promoted modpack:", err);
                    }
                }

                setResults(finalResults);
                setTotalHits(res.total_hits);
            } else {
                addNotification(t('search.search_failed', { error: res.error }), 'error');
            }
        } catch (err) {
            addNotification(t('search.search_error', { error: err.message }), 'error');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (showInstallModal && selectedInstance) {
            checkInstanceInstalled();
        } else {
            setInstanceInstalledIds(new Set());
        }
    }, [selectedInstance, showInstallModal, projectType]);

    const checkInstanceInstalled = async () => {
        try {
            let res;
            if (projectType === 'mod') {
                res = await window.electronAPI.getMods(selectedInstance);
                if (res.success) {
                    const ids = new Set(res.mods.filter(m => m.projectId).map(m => m.projectId));
                    setInstanceInstalledIds(ids);
                }
            } else if (projectType === 'resourcepack') {
                res = await window.electronAPI.getResourcePacks(selectedInstance);
                if (res.success) {
                    const ids = new Set(res.packs.filter(p => p.projectId).map(p => p.projectId));
                    setInstanceInstalledIds(ids);
                }
            } else if (projectType === 'shader') {
                res = await window.electronAPI.getShaders(selectedInstance);
                if (res.success) {
                    const ids = new Set(res.shaders.filter(s => s.projectId).map(s => s.projectId));
                    setInstanceInstalledIds(ids);
                }
            }
        } catch (e) {
            console.error("Failed to check installed content", e);
        }
    };

    const handleNext = () => {
        if (offset + limit < totalHits) setOffset(offset + limit);
    };

    const handlePrev = () => {
        if (offset - limit >= 0) setOffset(offset - limit);
    };

    const handlePageChange = (page) => {
        const nextPage = Math.min(Math.max(page, 1), totalPages);
        const nextOffset = (nextPage - 1) * limit;
        if (nextOffset !== offset) {
            setOffset(nextOffset);
        }
    };

    const handleJumpSubmit = (e) => {
        e.preventDefault();
        const parsedPage = Number.parseInt(jumpValue, 10);
        if (Number.isNaN(parsedPage)) {
            return;
        }
        handlePageChange(parsedPage);
        setJumpPopover(null);
        setJumpValue('');
    };

    const getPageItems = () => {
        if (totalPages <= 5) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }

        if (currentPage <= 3) {
            return [1, 2, 3, 4, 'end-ellipsis', totalPages];
        }

        if (currentPage >= totalPages - 2) {
            return [1, 'start-ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        }

        return [1, 'start-ellipsis', currentPage - 1, currentPage, currentPage + 1, 'end-ellipsis', totalPages];
    };

    const toggleProjectType = (type) => {
        setProjectType(type);
        setOffset(0);
        setResults([]);
        setTotalHits(0);
    };

    const handleModpackInstall = async (mod) => {
        if (installing) return;
        setInstalling(true);
        try {
            addNotification(t('search.fetching_versions', { title: mod.title }), 'info');

            const res = await window.electronAPI.getModVersions(mod.slug, [], []);

            if (!res || !res.success || !res.versions || res.versions.length === 0) {
                addNotification(t('search.no_versions'), 'error');
                return;
            }
            const versions = res.versions;
            const latestVersion = versions[0];
            const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];

            if (!primaryFile) {
                addNotification(t('search.no_files'), 'error');
                return;
            }
            addNotification(t('search.starting_install', { title: mod.title }), 'info');
            const installRes = await window.electronAPI.installModpack(primaryFile.url, mod.title, mod.icon_url);

            if (installRes.success) {
                addNotification(t('search.install_success', { title: mod.title }), 'success');

                setInstalledIds(prev => new Set(prev).add(mod.project_id));
                Analytics.trackDownload('modpack', mod.title, mod.project_id);

                Analytics.trackInstanceCreation('modpack', 'latest');
            } else {
                addNotification(t('search.install_failed', { error: installRes.error }), 'error');
            }

        } catch (e) {
            console.error("Modpack install error:", e);
            addNotification(t('common.error_desc'), 'error');
        } finally {
            setInstalling(false);
        }
    };

    const openInstall = async (mod) => {
        if (projectType === 'modpack') {
            await handleModpackInstall(mod);
            return;
        }

        setSelectedMod(mod);
        const list = await window.electronAPI.getInstances();
        const launcherInstances = filterInstancesForMode(list, 'launcher');
        setInstances(launcherInstances);
        setSelectedInstance(launcherInstances.length > 0 ? launcherInstances[0].name : '');
        setShowInstallModal(true);
    };

    const handleInstall = async () => {
        if (!selectedInstance || !selectedMod) return;

        const instance = instances.find(i => i.name === selectedInstance);
        if (!instance) return;

        setInstalling(true);
        try {
            addNotification(t('search.resolving_deps', { title: selectedMod.title }), 'info');
            const loaders = (selectedMod.project_type === 'shader' || selectedMod.project_type === 'resourcepack' || !instance.loader || instance.loader.toLowerCase() === 'vanilla')
                ? []
                : [instance.loader];

            const res = await window.electronAPI.getModVersions(
                selectedMod.project_id,
                loaders,
                [instance.version],
                selectedMod.curseforge_project_id || null
            );

            if (res.success && res.versions.length > 0) {
                const version = res.versions[0];
                const depRes = await window.electronAPI.resolveDependencies(version.id, loaders, [instance.version]);

                if (depRes.success && depRes.dependencies.length > 1) {
                    setPendingDependencies(depRes.dependencies);
                    setResolvedForInstance(instance);
                    setShowDependencyModal(true);
                    setShowInstallModal(false);
                } else {

                    const file = version.files.find(f => f.primary) || version.files[0];
                    const installProjectId = version.project_id || selectedMod.project_id;
                    await executeInstallList([{
                        instanceName: instance.name,
                        projectId: installProjectId,
                        versionId: version.id,
                        filename: file.filename,
                        url: file.url,
                        projectType: selectedMod.project_type,
                        title: selectedMod.title,
                        fallbackCurseForgeProjectId: selectedMod.curseforge_project_id || null
                    }]);
                }
            } else {
                addNotification(t('search.no_compat', { version: instance.version, loader: instance.loader }), 'error');
            }
        } catch (e) {
            addNotification(t('common.error_desc') + ': ' + e.message, 'error');
        } finally {
            setInstalling(false);
        }
    };

    const executeInstallList = async (installList) => {
        if (!installList || installList.length === 0) return;

        setInstalling(true);
        try {
            for (let i = 0; i < installList.length; i++) {
                const item = installList[i];
                addNotification(t('search.installing_item', { title: item.title, current: i + 1, total: installList.length }), 'info');

                const res = await window.electronAPI.installMod({
                    instanceName: item.instanceName,
                    projectId: item.projectId,
                    fallbackCurseForgeProjectId: item.fallbackCurseForgeProjectId || null,
                    versionId: item.versionId,
                    filename: item.filename,
                    url: item.url,
                    projectType: item.projectType
                });

                if (res.success) {
                    setInstalledIds(prev => new Set(prev).add(item.projectId));
                    setInstanceInstalledIds(prev => new Set(prev).add(item.projectId));
                    Analytics.trackDownload(item.projectType, item.title, item.projectId);
                } else {
                    addNotification(t('search.failed_install_single', { title: item.title, error: res.error }), 'error');
                }
            }
            addNotification(t('search.batch_success', { count: installList.length }), 'success');
            setShowInstallModal(false);
            setShowDependencyModal(false);
        } catch (e) {
            addNotification(t('common.error_desc') + ': ' + e.message, 'error');
        } finally {
            setInstalling(false);
        }
    };

    const handleDependencyConfirm = async (selectedMods) => {
        if (!resolvedForInstance) return;

        const installList = selectedMods.map(m => ({
            instanceName: resolvedForInstance.name,
            projectId: m.projectId,
            versionId: m.versionId,
            filename: m.filename,
            url: m.url,
            projectType: m.projectType,
            title: m.title
        }));

        await executeInstallList(installList);
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader title={t('search.title')}>
                <Tabs value={projectType} onValueChange={toggleProjectType}>
                    <TabsList>
                        <TabsTrigger value="mod">
                            <Blocks className="h-3.5 w-3.5 mr-1.5" />
                            {t('instance_details.content.mods')}
                        </TabsTrigger>
                        <TabsTrigger value="resourcepack">
                            <Paintbrush className="h-3.5 w-3.5 mr-1.5" />
                            {t('instance_details.content.resourcepacks')}
                        </TabsTrigger>
                        {settings.enableModrinthPackSupport !== false && (
                            <TabsTrigger value="modpack">
                                <Package className="h-3.5 w-3.5 mr-1.5" />
                                {t('home.discover_modpack')}
                            </TabsTrigger>
                        )}
                        <TabsTrigger value="shader">
                            <Paintbrush className="h-3.5 w-3.5 mr-1.5" />
                            {t('instance_details.content.shaders')}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </PageHeader>

            <PageContent noScroll>
                <div className="flex flex-col h-full gap-4">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (liveSearchTimeoutRef.current) {
                                clearTimeout(liveSearchTimeoutRef.current);
                                liveSearchTimeoutRef.current = null;
                            }
                            if (offset === 0) {
                                handleSearch(null, 0);
                                return;
                            }
                            setOffset(0);
                        }}
                        className="flex items-center gap-3"
                    >
                        <div className="relative flex-1">
                            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={t('search.placeholder', { type: projectType === 'mod' ? t('instance_details.content.mods') : projectType === 'resourcepack' ? t('instance_details.content.resourcepacks') : projectType === 'modpack' ? 'Modpacks' : t('instance_details.content.shaders') })}
                                className="pl-9"
                            />
                        </div>
                        <Button type="submit">
                            <SearchIcon className="h-4 w-4 mr-1.5" />
                            {t('search.search_btn')}
                        </Button>
                    </form>

                    <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                            {t('search.found_results', { count: totalHits, type: projectType === 'mod' ? t('instance_details.content.mods') : t('instance_details.content.packs_short') })}
                        </span>
                        <div className="flex items-center gap-3">
                            <Tabs value={provider} onValueChange={setProvider}>
                                <TabsList>
                                    <TabsTrigger value="modrinth" className="text-xs h-7 px-3">
                                        {t('search.modrinth')}
                                    </TabsTrigger>
                                    {settings.enableCurseForgePackSupport !== false && (
                                        <TabsTrigger value="curseforge" className="text-xs h-7 px-3">
                                            {t('search.curseforge')}
                                        </TabsTrigger>
                                    )}
                                </TabsList>
                            </Tabs>
                            <Select value={sortMethod} onValueChange={setSortMethod}>
                                <SelectTrigger className="w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="relevance">{t('search.relevance')}</SelectItem>
                                    <SelectItem value="downloads">{t('search.downloads')}</SelectItem>
                                    <SelectItem value="newest">{t('search.newest')}</SelectItem>
                                    <SelectItem value="updated">{t('search.updated')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[1, 2, 3, 4, 5, 6].map(i => (
                                    <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <Skeleton className="w-12 h-12 rounded-lg" />
                                            <div className="flex-1 space-y-2">
                                                <Skeleton className="h-4 w-2/3" />
                                                <Skeleton className="h-3 w-1/3" />
                                            </div>
                                        </div>
                                        <Skeleton className="h-3 w-full" />
                                        <Skeleton className="h-3 w-4/5" />
                                        <Skeleton className="h-9 w-full rounded-md" />
                                    </div>
                                ))}
                            </div>
                        ) : results.length === 0 ? (
                            <EmptyState
                                icon={SearchIcon}
                                title={t('search.title')}
                                description={t('search.found_results', { count: 0, type: projectType === 'mod' ? t('instance_details.content.mods') : t('instance_details.content.packs_short') })}
                            />
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {results.map((mod) => (
                                    <div key={mod.project_id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors group flex flex-col">
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden shrink-0">
                                                <img src={mod.icon_url || 'https://cdn.modrinth.com/placeholder.svg'} alt="" className="w-full h-full object-cover" onError={(e) => (e.target as HTMLImageElement).src = 'https://cdn.modrinth.com/placeholder.svg'} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <h3 className="font-semibold text-sm text-foreground truncate" title={mod.title}>{mod.title}</h3>
                                                    {mod.project_id === 'oMskb4v5' && (
                                                        <Badge variant="default" className="text-[10px] shrink-0">
                                                            Made by us
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">{mod.author}</p>
                                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                    <Badge variant="secondary" className="text-[10px] capitalize">{mod.project_type}</Badge>
                                                    {getSourceTags(mod.source, mod.sources).map((sourceTag) => (
                                                        <Badge key={`${mod.project_id}-${sourceTag}`} variant="outline" className="text-[10px] uppercase">{sourceTag}</Badge>
                                                    ))}
                                                    <Badge variant="outline" className="text-[10px]">
                                                        <ArrowDownToLine className="h-3 w-3 mr-1" />
                                                        {formatDownloads(mod.downloads)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2 flex-1 leading-relaxed">{mod.description}</p>
                                        {mod.project_type === 'shader' && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full mb-2"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePreview(mod);
                                                }}
                                            >
                                                <Eye className="h-4 w-4 mr-1.5" />
                                                {t('search.preview')}
                                            </Button>
                                        )}
                                        <Button
                                            variant={installedIds.has(mod.project_id) ? 'default' : 'secondary'}
                                            size="sm"
                                            className={cn(
                                                'w-full',
                                                installedIds.has(mod.project_id) && 'bg-emerald-600 text-white hover:bg-emerald-700'
                                            )}
                                            onClick={() => openInstall(mod)}
                                            disabled={installing}
                                        >
                                            {installedIds.has(mod.project_id) ? (
                                                <>
                                                    <Check className="h-4 w-4 mr-1.5" />
                                                    {projectType === 'modpack' ? t('search.installing_dots') : t('search.installed')}
                                                </>
                                            ) : (
                                                <>
                                                    <Plus className="h-4 w-4 mr-1.5" />
                                                    {projectType === 'modpack' ? t('search.create_instance') : t('search.install')}
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-medium">
                                {t('search.page_of', { current: currentPage })}
                            </span>
                            <span className="text-xs">
                                {t('search.page_of_total', { total: totalPages })}
                            </span>
                        </div>
                        <Pagination className="mx-0 w-auto justify-end">
                            <PaginationContent>
                                <PaginationItem>
                                    <PaginationPrevious
                                        onClick={handlePrev}
                                        disabled={offset === 0}
                                    >
                                        {t('search.previous')}
                                    </PaginationPrevious>
                                </PaginationItem>
                                {getPageItems().map((item) => (
                                    <PaginationItem key={item}>
                                        {typeof item === 'number' ? (
                                            <PaginationLink
                                                isActive={item === currentPage}
                                                onClick={() => handlePageChange(item)}
                                            >
                                                {item}
                                            </PaginationLink>
                                        ) : (
                                            <Popover
                                                open={jumpPopover === item}
                                                onOpenChange={(open) => {
                                                    setJumpPopover(open ? item : null);
                                                    if (open) {
                                                        setJumpValue('');
                                                    }
                                                }}
                                            >
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                                        aria-label="Jump to page"
                                                    >
                                                        <PaginationEllipsis />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-28 p-2" align="center">
                                                    <form onSubmit={handleJumpSubmit} className="flex flex-col gap-2">
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            max={totalPages}
                                                            value={jumpValue}
                                                            onChange={(e) => setJumpValue(e.target.value)}
                                                            placeholder={`${currentPage}/${totalPages}`}
                                                            autoFocus
                                                        />
                                                    </form>
                                                </PopoverContent>
                                            </Popover>
                                        )}
                                    </PaginationItem>
                                ))}
                                <PaginationItem>
                                    <PaginationNext
                                        onClick={handleNext}
                                        disabled={offset + limit >= totalHits}
                                    >
                                        {t('search.next')}
                                    </PaginationNext>
                                </PaginationItem>
                            </PaginationContent>
                        </Pagination>
                    </div>
                </div>
            </PageContent>

            <Dialog open={showInstallModal} onOpenChange={setShowInstallModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('search.install_title', { title: selectedMod?.title })}</DialogTitle>
                        <DialogDescription>{t('search.select_instance')}</DialogDescription>
                    </DialogHeader>
                    <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {instances.map(inst => (
                                <SelectItem key={inst.name} value={inst.name}>
                                    {inst.name} ({inst.loader} {inst.version})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowInstallModal(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={handleInstall}
                            disabled={installing || !selectedInstance}
                            className={instanceInstalledIds.has(selectedMod?.project_id) ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                        >
                            {installing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {installing ? t('search.installing_dots') : (instanceInstalledIds.has(selectedMod?.project_id) ? t('search.already_installed') : t('search.install'))}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showPreviewModal && !!previewProject} onOpenChange={(open) => { if (!open) setShowPreviewModal(false); }}>
                <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
                    <div className="p-6 border-b border-border flex items-start gap-4 shrink-0">
                        <img
                            src={previewProject?.icon_url || 'https://cdn.modrinth.com/placeholder.svg'}
                            className="w-14 h-14 rounded-lg"
                            alt=""
                        />
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-xl">{previewProject?.title}</DialogTitle>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{previewProject?.description}</p>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 min-h-0">
                        {previewProject?.gallery && previewProject.gallery.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {previewProject.gallery.map((img, idx) => (
                                    <div
                                        key={idx}
                                        className="relative group rounded-lg overflow-hidden border border-border bg-muted aspect-video cursor-zoom-in"
                                        onClick={() => setLightboxIndex(idx)}
                                    >
                                        <img
                                            src={img.url}
                                            alt={img.title || 'Gallery Image'}
                                            className="w-full h-full object-cover transition-transform duration-500"
                                        />
                                        {img.title && (
                                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/70 backdrop-blur-sm text-xs text-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                {img.title}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState icon={Image} title={t('search.no_gallery')} />
                        )}
                    </div>

                    <div className="p-4 border-t border-border flex justify-end gap-2 shrink-0">
                        <Button variant="ghost" onClick={() => setShowPreviewModal(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={() => {
                                setShowPreviewModal(false);
                                openInstall(previewProject);
                            }}
                            disabled={installedIds.has(previewProject?.id)}
                            className={installedIds.has(previewProject?.id) ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                        >
                            {installedIds.has(previewProject?.id) ? (
                                <>
                                    <Check className="h-4 w-4 mr-1.5" />
                                    {t('search.installed')}
                                </>
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    {t('search.install')}
                                </>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {lightboxIndex !== -1 && previewProject && previewProject.gallery && (
                <div
                    className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center backdrop-blur-xl select-none"
                    onClick={() => setLightboxIndex(-1)}
                >
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-6 right-6 z-50 rounded-full bg-white/10 hover:bg-white/20 text-white"
                        onClick={() => setLightboxIndex(-1)}
                    >
                        <X className="h-6 w-6" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-6 top-1/2 -translate-y-1/2 z-50 rounded-full bg-black/50 hover:bg-white/10 text-white h-12 w-12 backdrop-blur-sm"
                        onClick={handlePrevImage}
                    >
                        <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-6 top-1/2 -translate-y-1/2 z-50 rounded-full bg-black/50 hover:bg-white/10 text-white h-12 w-12 backdrop-blur-sm"
                        onClick={handleNextImage}
                    >
                        <ChevronRight className="h-6 w-6" />
                    </Button>

                    <div className="absolute top-6 left-6 text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-sm">
                        {lightboxIndex + 1} / {previewProject.gallery.length}
                    </div>

                    <div
                        className="w-full h-full flex items-center justify-center p-4 md:p-20"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={previewProject.gallery[lightboxIndex].url}
                            alt={previewProject.gallery[lightboxIndex].title || "Gallery Image"}
                            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        />
                        {previewProject.gallery[lightboxIndex].title && (
                            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-6 py-3 rounded-full text-white text-sm font-medium">
                                {previewProject.gallery[lightboxIndex].title}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showDependencyModal && (
                <ModDependencyModal
                    mods={pendingDependencies}
                    onConfirm={handleDependencyConfirm}
                    onCancel={() => setShowDependencyModal(false)}
                />
            )}
        </div>
    );
}

export default Search;
