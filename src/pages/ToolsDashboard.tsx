import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import PageContent from '../components/layout/PageContent';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
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

const toFileUrl = (filePath: string) => {
    return `file:///${`${filePath}`.replace(/\\/g, '/')}`;
};

function ToolsDashboard() {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [isStartEditorModalOpen, setIsStartEditorModalOpen] = useState(false);
    const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
    const [isSelectingTexture, setIsSelectingTexture] = useState(false);
    const [editorSessionKey, setEditorSessionKey] = useState(0);
    const [skinSrc, setSkinSrc] = useState<string>(DEFAULT_STEVE.url);
    const [skinModel, setSkinModel] = useState<string>(DEFAULT_STEVE.model);
    const [selectedName, setSelectedName] = useState<string>(DEFAULT_STEVE.name);

    const previewLabel = useMemo(() => {
        if (selectedName === DEFAULT_STEVE.name) {
            return t('tools.steve_default', 'Default: Steve');
        }
        return t('tools.loaded_skin', 'Loaded: {{name}}', { name: selectedName });
    }, [selectedName, t]);

    const openFreshEditorSession = (nextSkinSrc: string, nextModel: string, nextName: string) => {
        setSkinSrc(nextSkinSrc);
        setSkinModel(nextModel);
        setSelectedName(nextName);
        setEditorSessionKey((prev) => prev + 1);
        setShowAdvancedEditor(true);
        setIsStartEditorModalOpen(false);

        logToolsSkinEditorDebug('open-fresh-editor-session', {
            selectedName: nextName,
            skinModel: nextModel,
            ...getToolsSkinSourceDebugInfo(nextSkinSrc)
        });
    };

    const handleOpenSkinEditor = () => {
        setIsStartEditorModalOpen(true);
        logToolsSkinEditorDebug('open-editor-start-modal');
    };

    const handleStartWithSteve = () => {
        openFreshEditorSession(DEFAULT_STEVE.url, DEFAULT_STEVE.model, DEFAULT_STEVE.name);
    };

    const handleStartWithTexture = async () => {
        try {
            setIsSelectingTexture(true);
            const result = await window.electronAPI.openFileDialog({
                properties: ['openFile'],
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            });

            if (result?.canceled || !Array.isArray(result?.filePaths) || result.filePaths.length === 0) {
                logToolsSkinEditorDebug('start-with-texture-cancelled');
                return;
            }

            const selectedPath = `${result.filePaths[0]}`;
            const fileNameWithExt = selectedPath.replace(/\\/g, '/').split('/').pop() || '';
            const selectedSkinName = fileNameWithExt.replace(/\.[^.]+$/, '') || t('common.skins', 'Skin');

            openFreshEditorSession(toFileUrl(selectedPath), 'classic', selectedSkinName);
        } catch (error: any) {
            console.error('Failed to start skin editor with texture', error);
            logToolsSkinEditorDebug('start-with-texture-failed', {
                error: error?.message || 'Unknown'
            });
            addNotification(t('skins.import_failed', { error: error?.message || 'Unknown' }), 'error');
        } finally {
            setIsSelectingTexture(false);
        }
    };

    const handleSaveAdvancedSkin = async (skin: any, nextModel?: string, savedToPath?: string) => {
        const resolvedModel = nextModel || skin.model || 'classic';
        setSkinModel(resolvedModel);
        setSelectedName(skin.name || t('skins.edited_skin', 'Edited Skin'));

        if (skin.data) {
            setSkinSrc(skin.data);
        } else if (skin.path) {
            setSkinSrc(toFileUrl(skin.path));
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
            <Dialog open={isStartEditorModalOpen} onOpenChange={setIsStartEditorModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('tools.start_skin_editor', 'Start Skin Editor')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            {t('tools.skin_editor_start_desc', 'Choose how you want to start: with Steve or with your own texture file.')}
                        </p>

                        <Button type="button" variant="default" className="w-full justify-start" onClick={handleStartWithSteve}>
                            <RotateCcw className="h-4 w-4" />
                            {t('tools.start_with_steve', 'Start with Steve')}
                        </Button>

                        <Button type="button" variant="secondary" className="w-full justify-start" onClick={handleStartWithTexture} disabled={isSelectingTexture}>
                            {isSelectingTexture ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                            {t('tools.start_with_texture', 'Start with Texture')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AdvancedSkinEditorDialog
                key={editorSessionKey}
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
                                    {t('tools.skin_editor_desc', 'Start the skin editor and choose Steve or your own texture as the base, then create your skin.')}
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
