import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import PageContent from '../components/layout/PageContent';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { AdvancedSkinEditorDialog } from './Skins';
import { Wrench, Sparkles, Cuboid, FlaskConical, Hammer, ImageUp, Loader2, RotateCcw } from 'lucide-react';

const DEFAULT_STEVE = {
    name: 'Steve',
    model: 'classic',
    url: '/assets/skins/steve-classic.png'
};

const TOOLS_SKIN_EDITOR_DEBUG_CONTEXT = 'tools-dashboard';
const TOOLS_SKIN_EDITOR_DEBUG_PREFIX = '[SkinEditorDebug]';

const getToolsSkinSourceDebugInfo = (skinSource: any) => {
    if (typeof skinSource !== 'string') {
        return {
            sourceType: skinSource == null ? 'empty' : typeof skinSource,
            sourcePreview: null,
            sourceLength: 0
        };
    }

    const value = skinSource.trim();
    if (!value) {
        return {
            sourceType: 'empty-string',
            sourcePreview: '',
            sourceLength: 0
        };
    }

    let sourceType = 'unknown';
    if (/^data:image\//i.test(value)) {
        sourceType = 'data-url';
    } else if (/^https?:\/\//i.test(value)) {
        sourceType = 'http-url';
    } else if (/^file:\/\//i.test(value)) {
        sourceType = 'file-url';
    } else if (value.startsWith('/assets/')) {
        sourceType = 'asset-path';
    } else if (/^[a-zA-Z]:\\/.test(value) || value.includes('\\')) {
        sourceType = 'windows-path';
    }

    return {
        sourceType,
        sourcePreview: sourceType === 'data-url' ? `${value.slice(0, 64)}...` : value.slice(0, 256),
        sourceLength: value.length
    };
};

const logToolsSkinEditorDebug = (event: string, details: Record<string, any> = {}) => {
    console.info(TOOLS_SKIN_EDITOR_DEBUG_PREFIX, {
        context: TOOLS_SKIN_EDITOR_DEBUG_CONTEXT,
        event,
        ts: new Date().toISOString(),
        ...details
    });
};

function ToolsDashboard() {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
    const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
    const [loadSource, setLoadSource] = useState('file');
    const [isImportingSkin, setIsImportingSkin] = useState(false);
    const [localSkins, setLocalSkins] = useState<any[]>([]);
    const [skinSrc, setSkinSrc] = useState<string>(DEFAULT_STEVE.url);
    const [skinModel, setSkinModel] = useState<string>(DEFAULT_STEVE.model);
    const [selectedName, setSelectedName] = useState<string>(DEFAULT_STEVE.name);

    const previewLabel = useMemo(() => {
        if (selectedName === DEFAULT_STEVE.name) {
            return t('tools.steve_default', 'Default: Steve');
        }
        return t('tools.loaded_skin', 'Loaded: {{name}}', { name: selectedName });
    }, [selectedName, t]);

    const loadLocalSkins = async () => {
        try {
            logToolsSkinEditorDebug('load-local-skins-start');
            const skins = await window.electronAPI.getLocalSkins();
            setLocalSkins(skins || []);
            logToolsSkinEditorDebug('load-local-skins-success', {
                count: (skins || []).length
            });
        } catch (error) {
            console.error('Failed to load local skins for tools dashboard', error);
            logToolsSkinEditorDebug('load-local-skins-failed', {
                error: (error as any)?.message || String(error)
            });
        }
    };

    useEffect(() => {
        if (isLoadModalOpen) {
            loadLocalSkins();
        }
    }, [isLoadModalOpen]);

    const handleLoadFromFile = async () => {
        if (!window.electronAPI?.saveLocalSkin) return;
        try {
            setIsImportingSkin(true);
            logToolsSkinEditorDebug('import-file-start');
            const res = await window.electronAPI.saveLocalSkin();
            if (!res.success) {
                logToolsSkinEditorDebug('import-file-failed', {
                    error: res.error || null
                });
                if (res.error !== 'Cancelled') {
                    addNotification(t('skins.import_failed', { error: res.error }), 'error');
                }
                return;
            }

            await loadLocalSkins();

            if (res.skin) {
                const nextSkinSrc = res.skin.data || `file://${res.skin.path}`;
                setSkinSrc(nextSkinSrc);
                setSkinModel(res.skin.model || 'classic');
                setSelectedName(res.skin.name || t('common.skins', 'Skin'));
                logToolsSkinEditorDebug('import-file-success', {
                    skinName: res.skin.name || null,
                    skinModel: res.skin.model || 'classic',
                    ...getToolsSkinSourceDebugInfo(nextSkinSrc)
                });
            }

            addNotification(t('skins.import_success', 'Skin imported successfully.'), 'success');
            setIsLoadModalOpen(false);
        } catch (error: any) {
            console.error('Failed to import skin file in tools dashboard', error);
            logToolsSkinEditorDebug('import-file-error', {
                error: error?.message || 'Unknown'
            });
            addNotification(t('skins.import_failed', { error: error?.message || 'Unknown' }), 'error');
        } finally {
            setIsImportingSkin(false);
        }
    };

    const handleSelectLocalSkin = (skin: any) => {
        const nextSkinSrc = skin.data || `file://${skin.path}`;
        setSkinSrc(nextSkinSrc);
        setSkinModel(skin.model || 'classic');
        setSelectedName(skin.name || t('common.skins', 'Skin'));
        setIsLoadModalOpen(false);
        logToolsSkinEditorDebug('select-local-skin', {
            skinId: skin.id,
            skinName: skin.name || null,
            skinModel: skin.model || 'classic',
            ...getToolsSkinSourceDebugInfo(nextSkinSrc)
        });
        addNotification(t('tools.skin_loaded', 'Skin loaded into editor.'), 'success');
    };

    const handleResetToSteve = () => {
        setSkinSrc(DEFAULT_STEVE.url);
        setSkinModel(DEFAULT_STEVE.model);
        setSelectedName(DEFAULT_STEVE.name);
        logToolsSkinEditorDebug('reset-to-steve', {
            skinName: DEFAULT_STEVE.name,
            skinModel: DEFAULT_STEVE.model,
            ...getToolsSkinSourceDebugInfo(DEFAULT_STEVE.url)
        });
    };

    const handleOpenSkinEditor = () => {
        logToolsSkinEditorDebug('open-skin-editor', {
            selectedName,
            skinModel,
            ...getToolsSkinSourceDebugInfo(skinSrc)
        });
        setShowAdvancedEditor(true);
    };

    const handleSaveAdvancedSkin = async (skin: any, nextModel?: string, savedToPath?: string) => {
        const resolvedModel = nextModel || skin.model || 'classic';
        setSkinModel(resolvedModel);
        setSelectedName(skin.name || t('skins.edited_skin', 'Edited Skin'));

        if (skin.data) {
            setSkinSrc(skin.data);
        } else if (skin.path) {
            setSkinSrc(`file://${skin.path}`);
        }

        logToolsSkinEditorDebug('save-from-editor', {
            skinId: skin.id,
            skinName: skin.name || null,
            skinModel: resolvedModel,
            hasData: !!skin.data,
            hasPath: !!skin.path,
            savedToPath: savedToPath || null
        });

        addNotification(
            savedToPath
                ? `${t('tools.skin_editor_saved', 'Saved from skin editor.')} ${savedToPath}`
                : t('tools.skin_editor_saved', 'Saved from skin editor.'),
            'success'
        );
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <Dialog open={isLoadModalOpen} onOpenChange={setIsLoadModalOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{t('tools.load_skin', 'Load Skin')}</DialogTitle>
                    </DialogHeader>

                    <Tabs value={loadSource} onValueChange={setLoadSource} className="space-y-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="file">{t('skins.source_file', 'File')}</TabsTrigger>
                            <TabsTrigger value="library">{t('tools.library', 'Library')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="file" className="mt-0 space-y-4">
                            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                                {t('tools.load_file_desc', 'Choose a PNG skin file to load it into the 3D editor.')}
                            </div>
                            <Button onClick={handleLoadFromFile} disabled={isImportingSkin} className="w-full">
                                {isImportingSkin ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                                {t('skins.choose_skin_file', 'Choose Skin File')}
                            </Button>
                        </TabsContent>

                        <TabsContent value="library" className="mt-0">
                            <ScrollArea className="h-[360px] pr-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {localSkins.length === 0 && (
                                        <div className="col-span-full rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                                            {t('tools.library_empty', 'No skins in library yet. Import one from file first.')}
                                        </div>
                                    )}

                                    {localSkins.map((skin: any) => (
                                        <button
                                            key={skin.id}
                                            onClick={() => handleSelectLocalSkin(skin)}
                                            className="rounded-lg border border-border bg-card/60 p-3 text-left hover:border-primary/60 transition-colors"
                                        >
                                            <div className="aspect-[1/1] rounded-md bg-muted/40 overflow-hidden mb-2 flex items-center justify-center">
                                                <img
                                                    src={skin.data || `file://${skin.path}`}
                                                    alt={skin.name}
                                                    className="w-full h-full object-contain image-pixelated"
                                                />
                                            </div>
                                            <p className="text-xs font-medium text-foreground truncate">{skin.name}</p>
                                            <p className="text-[11px] text-muted-foreground">{(skin.model || 'classic') === 'slim' ? t('skins.slim', 'Slim') : t('skins.wide', 'Wide')}</p>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>

            <AdvancedSkinEditorDialog
                open={showAdvancedEditor}
                onOpenChange={setShowAdvancedEditor}
                skinSrc={skinSrc}
                model={skinModel}
                onSave={handleSaveAdvancedSkin}
                onNotify={addNotification}
                t={t}
                title={t('tools.skin_editor_title', 'Skin Editor')}
                debugContext={TOOLS_SKIN_EDITOR_DEBUG_CONTEXT}
                saveBehavior="prompt-location"
            />

            <div className="border-b border-border px-6 py-5 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary border border-primary/25 flex items-center justify-center">
                        <Wrench className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight text-foreground">{t('common.useful_tools', 'Useful Tools')}</h1>
                        <p className="text-sm text-muted-foreground">
                            {t('tools.dashboard_desc', 'A central dashboard for practical tools and creators.')}
                        </p>
                    </div>
                </div>
            </div>

            <PageContent>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <div className="xl:col-span-2 rounded-2xl border border-border bg-card/50 p-5">
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <Cuboid className="h-4 w-4 text-primary" />
                                    <h2 className="text-base font-semibold text-foreground">
                                        {t('tools.skin_editor_title', 'Skin Editor')}
                                    </h2>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {t('tools.skin_editor_desc', 'Start with Steve by default. Use Load to import a file or choose a skin from your local library, then edit in the skin editor.')}
                                </p>
                            </div>
                            <Badge variant="secondary" className="shrink-0">{t('common.new', 'New')}</Badge>
                        </div>

                        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                            <div className="flex items-start gap-3">
                                <Sparkles className="h-4 w-4 text-primary mt-0.5" />
                                <div className="text-sm text-muted-foreground">
                                    {t('tools.skin_editor_hint', 'This tool reuses your existing skin editor from Skins.tsx. It does not edit your active account skin unless you upload it later yourself.')}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-medium text-foreground">{previewLabel}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('tools.current_model', 'Model: {{model}}', {
                                            model: skinModel === 'slim' ? t('skins.slim', 'Slim') : t('skins.wide', 'Wide')
                                        })}
                                    </p>
                                </div>
                                <div className="h-16 w-16 rounded-lg border border-border bg-muted/40 overflow-hidden flex items-center justify-center">
                                    <img src={skinSrc} alt={selectedName} className="w-full h-full object-contain image-pixelated" />
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="secondary" onClick={() => setIsLoadModalOpen(true)}>
                                    <ImageUp className="h-4 w-4" />
                                    {t('tools.load_skin', 'Load Skin')}
                                </Button>
                                <Button variant="outline" onClick={handleResetToSteve}>
                                    <RotateCcw className="h-4 w-4" />
                                    {t('tools.reset_to_steve', 'Reset to Steve')}
                                </Button>
                                <Button onClick={handleOpenSkinEditor}>
                                    <Wrench className="h-4 w-4" />
                                    {t('tools.open_skin_editor', 'Open Skin Editor')}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/40 p-5">
                        <h3 className="text-sm font-semibold text-foreground mb-3">{t('tools.upcoming_tools', 'Upcoming Tools')}</h3>
                        <div className="space-y-3">
                            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground flex items-center gap-2">
                                <FlaskConical className="h-4 w-4" />
                                {t('tools.placeholder_one', 'Profile & performance analyzer')}
                            </div>
                            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground flex items-center gap-2">
                                <Hammer className="h-4 w-4" />
                                {t('tools.placeholder_two', 'Resourcepack helper')}
                            </div>
                        </div>
                        <Separator className="my-4" />
                        <p className="text-xs text-muted-foreground">
                            {t('tools.more_soon', 'More utility modules can be added here over time.')}
                        </p>
                    </div>
                </div>
            </PageContent>
        </div>
    );
}

export default ToolsDashboard;
