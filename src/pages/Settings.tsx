import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import ExtensionSlot from '../components/Extensions/ExtensionSlot';
import { isFeatureEnabled } from '../config/featureFlags';
import ToggleBox from '../components/ToggleBox';
import ConfirmationModal from '../components/ConfirmationModal';
import PageHeader from '../components/layout/PageHeader';
import PageContent from '../components/layout/PageContent';
import { getDefaultStartupValueForMode, getStartupModes, normalizeStartupPageValue } from '../lib/startupPages';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { getSourceTags } from '../utils/sourceTags';
import { filterInstancesForMode } from '../utils/instanceTypes';
import {
    Save,
    FolderOpen,
    Download,
    Trash2,
    Check,
    Loader2,
    RefreshCw,
    Cloud,
    Info,
    AlertTriangle,
    FlaskConical,
    Search,
    Plus,
    X,
    Monitor,
    Cpu,
    HardDrive,
    Globe,
    Zap,
    Play,
    Shield,
    Settings2,
    RotateCcw,
    Compass
} from 'lucide-react';

function Settings({ mode = 'default', onRestartGuide = null }) {
    const { t, i18n } = useTranslation();
    const { addNotification } = useNotification();
    const isClientSettings = mode === 'client';
    const startupPageOptions = {
        openClientEnabled: isFeatureEnabled('openClientPage')
    };
    const startupModes = getStartupModes(startupPageOptions);
    const animationPresetOptions = [
        {
            id: 'cinematic',
            label: t('settings.general.animations.presets.cinematic', 'Cinematic'),
            description: t('settings.general.animations.presets.cinematic_desc', 'Soft blur, subtle depth and a premium page swap.')
        },
        {
            id: 'glide',
            label: t('settings.general.animations.presets.glide', 'Glide'),
            description: t('settings.general.animations.presets.glide_desc', 'A horizontal slide that feels quick and clean.')
        },
        {
            id: 'fade',
            label: t('settings.general.animations.presets.fade', 'Fade'),
            description: t('settings.general.animations.presets.fade_desc', 'Minimal crossfade with almost no motion.')
        },
        {
            id: 'zoom',
            label: t('settings.general.animations.presets.zoom', 'Zoom'),
            description: t('settings.general.animations.presets.zoom_desc', 'Pages ease in with a tighter zoom effect.')
        },
        {
            id: 'lift',
            label: t('settings.general.animations.presets.lift', 'Lift'),
            description: t('settings.general.animations.presets.lift_desc', 'Content rises in and exits upward with more motion.')
        }
    ];
    const [settings, setSettings] = useState({
        javaPath: '',
        javaArgs: '-Xmx4G',
        gameResolution: { width: 854, height: 480 },
        launcherTheme: 'dark',
        minimizeOnLaunch: true,
        quitOnGameExit: false,
        animationsExaggerated: false,
        copySettingsEnabled: false,
        copySettingsSourceInstance: '',
        instancesPath: '',
        minMemory: 1024,
        maxMemory: 4096,
        resolutionWidth: 854,
        resolutionHeight: 480,
        enableDiscordRPC: true,
        autoUploadLogs: true,
        showDisabledFeatures: false,
        optimization: false,
        focusMode: false,
        minimalMode: false,
        enableAutoInstallMods: false,
        autoInstallMods: [],
        enableSmartLogAnalytics: true,
        language: 'en_us',
        startPage: 'dashboard',
        pageAnimationsEnabled: true,
        pageAnimationPreset: 'cinematic',
        showModrinthInstancesInLibrary: true,
        showCurseforgeInstancesInLibrary: true,
        javaProfile: 'default',
        externalLauncherPaths: [],
        minimizeToTray: false,
        lowGraphicsMode: false,
        legacyGpuSupport: false,
        cloudBackupSettings: {
            enabled: false,
            provider: 'GOOGLE_DRIVE',
            autoRestore: false
        }
    });
    const [externalLauncherPathInput, setExternalLauncherPathInput] = useState('');
    const normalizedStartupPage = normalizeStartupPageValue(settings.startPage, startupPageOptions);
    const selectedStartupModeId = normalizedStartupPage.split(':')[0] || 'launcher';
    const selectedStartupMode = startupModes.find((startupMode) => startupMode.id === selectedStartupModeId) ?? startupModes[0];

    const [cloudStatus, setCloudStatus] = useState({
        GOOGLE_DRIVE: { loggedIn: false, user: null },
        DROPBOX: { loggedIn: false, user: null },
        ONEDRIVE: { loggedIn: false, user: null }
    });

    const [showSoftResetModal, setShowSoftResetModal] = useState(false);
    const [showFactoryResetModal, setShowFactoryResetModal] = useState(false);
    const [showRestartModal, setShowRestartModal] = useState(false);
    const [showUninstallModal, setShowUninstallModal] = useState(false);
    const [instances, setInstances] = useState([]);
    const [isInstallingJava, setIsInstallingJava] = useState(false);
    const [javaInstallProgress, setJavaInstallProgress] = useState(null);
    const [showJavaModal, setShowJavaModal] = useState(false);
    const [installedRuntimes, setInstalledRuntimes] = useState([]);
    const [autoInstallModsInput, setAutoInstallModsInput] = useState('');
    const [searchingAutoInstallMods, setSearchingAutoInstallMods] = useState(false);
    const [autoInstallModsSearchResults, setAutoInstallModsSearchResults] = useState([]);
    const [autoInstallModsMetadata, setAutoInstallModsMetadata] = useState({});
    const [autoInstallModsListSearch, setAutoInstallModsListSearch] = useState('');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadedFilePath, setDownloadedFilePath] = useState(null);
    const [testVersion, setTestVersion] = useState('');
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const hasUnsavedChanges = useRef(false);
    const initialSettingsRef = useRef(null);

    useEffect(() => {
        const cleanupJava = window.electronAPI.onJavaProgress((data) => {
            setJavaInstallProgress(data);
        });
        const cleanupUpdate = window.electronAPI.onUpdaterProgress((progress) => {
            setDownloadProgress(progress);
        });
        return () => {
            cleanupJava();
            cleanupUpdate();
        };
    }, []);

    const handleInstallJava = async (version) => {
        setShowJavaModal(false);
        setIsInstallingJava(true);
        setJavaInstallProgress({ step: 'Starting...', progress: 0 });
        try {
            const result = await window.electronAPI.installJava(version);
            if (result.success) {
                handleChange('javaPath', result.path);
                addNotification(`Java ${version} installed successfully`, 'success');
                loadJavaRuntimes();
            } else {
                addNotification(`Failed to install Java: ${result.error}`, 'error');
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        } finally {
            setIsInstallingJava(false);
            setJavaInstallProgress(null);
        }
    };

    useEffect(() => {
        loadSettings();
        loadInstances();
        loadJavaRuntimes();
        const handleBeforeUnload = (e) => {
            if (hasUnsavedChanges.current) {
                saveSettings(settings);
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);

            if (hasUnsavedChanges.current) {
                saveSettings(settings, true);
            }
        };
    }, []);

    const loadInstances = async () => {
        const list = await window.electronAPI.getInstances();
        const instanceMode = mode === 'client' ? 'client' : 'launcher';
        setInstances(filterInstancesForMode(list, instanceMode));
    };

    const loadJavaRuntimes = async () => {
        try {
            const res = await window.electronAPI.getJavaRuntimes();
            if (res.success) {
                setInstalledRuntimes(res.runtimes);
            }
        } catch (err) {
            console.error("Failed to load Java runtimes", err);
        }
    };

    const handleDeleteRuntime = async (dirPath) => {
        if (!confirm(t('settings.java.delete_confirm'))) return;
        try {
            const res = await window.electronAPI.deleteJavaRuntime(dirPath);
            if (res.success) {
                addNotification(t('settings.java.delete_success'), "success");
                loadJavaRuntimes();
            } else {
                addNotification(t('settings.java.delete_failed', { error: res.error }), "error");
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, "error");
        }
    };

    const loadSettings = async () => {
        const res = await window.electronAPI.getSettings();
        if (res.success) {
            const loadedSettings = {
                ...settings,
                ...res.settings,
                cloudBackupSettings: {
                    ...settings.cloudBackupSettings,
                    ...(res.settings.cloudBackupSettings || {})
                }
            };
            delete loadedSettings.showQuickSwitchButton;
            const languageMap = { 'en': 'en_us', 'de': 'de_de' };
            if (languageMap[loadedSettings.language]) {
                loadedSettings.language = languageMap[loadedSettings.language];
            }

            loadedSettings.startPage = normalizeStartupPageValue(loadedSettings.startPage, startupPageOptions);

            setSettings(loadedSettings);
            initialSettingsRef.current = loadedSettings;
        }
        loadCloudStatus();
    };

    const loadCloudStatus = async () => {
        try {
            const status = await window.electronAPI.cloudGetStatus();
            setCloudStatus(status);
        } catch (e) {
            console.error("Failed to load cloud status", e);
        }
    };

    const handleCloudLogin = async (providerId) => {
        try {
            const res = await window.electronAPI.cloudLogin(providerId);
            if (res.success) {
                addNotification(t('settings.cloud.login_success', { provider: providerId.replace('_', ' ') }), 'success');
                loadCloudStatus();
            } else {
                addNotification(t('login.failed') + ': ' + res.error, 'error');
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        }
    };

    const handleCloudLogout = async (providerId) => {
        try {
            const res = await window.electronAPI.cloudLogout(providerId);
            if (res.success) {
                addNotification(t('settings.cloud.logout_success', { provider: providerId.replace('_', ' ') }), 'success');
                loadCloudStatus();
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        }
    };

    const handleChange = (key, value) => {
        if (key === 'legacyGpuSupport' && value === true) {
            setShowRestartModal(true);
            return;
        }
        setSettings(prev => {
            const newSettings = { ...prev, [key]: value };
            if (initialSettingsRef.current) {
                const hasChanges = Object.keys(newSettings).some(
                    key => newSettings[key] !== initialSettingsRef.current[key]
                );
                hasUnsavedChanges.current = hasChanges;
            }
            saveSettings(newSettings, true);
            return newSettings;
        });
    };

    const handleConfirmRestart = () => {
        setSettings(prev => {
            const newSettings = { ...prev, legacyGpuSupport: true };
            saveSettings(newSettings, true).then(() => {
                window.electronAPI.restartApp();
            });
            return newSettings;
        });
    };

    const saveSettings = async (newSettings, silent = false) => {
        const res = await window.electronAPI.saveSettings(newSettings);
        if (res.success) {

            initialSettingsRef.current = newSettings;
            hasUnsavedChanges.current = false;
            if (!silent) {
                addNotification(t('settings.saved_success'), 'success');
            }
        } else {
            addNotification(t('settings.save_failed'), 'error');
        }
    };

    const handleStartupModeChange = (modeId) => {
        handleChange('startPage', getDefaultStartupValueForMode(modeId, startupPageOptions));
    };
    const handleUpdate = async (key, value) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        try {
            await window.electronAPI.saveSettings(newSettings);

        } catch (error) {
            addNotification('Failed to save settings', 'error');
        }
    };

    const handleSoftReset = async () => {
        addNotification('Initiating Soft Reset...', 'info');
        await window.electronAPI.softReset();
    };

    const handleFactoryReset = async () => {
        addNotification('Initiating Factory Reset... Goodbye!', 'error');
        await window.electronAPI.factoryReset();
    };

    const handleUninstallLauncher = async () => {
        setShowUninstallModal(false);
        const result = await window.electronAPI.uninstallLauncher();
        if (!result?.success) {
            addNotification(result?.error || t('settings.instance.uninstall_failed'), 'error');
        }
    };

    const handleBrowseJava = async () => {
        const result = await window.electronAPI.openFileDialog({
            properties: ['openFile'],
            filters: [{ name: 'Java Executable', extensions: ['exe', 'bin'] }]
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return;
        }
        const selectedPath = result.filePaths[0];
        if (selectedPath && (selectedPath.toLowerCase().endsWith('.exe') || selectedPath.toLowerCase().endsWith('.bin'))) {
            handleChange('javaPath', selectedPath);
        } else {
            addNotification(t('settings.java.select_valid'), 'error');
        }
    };

    const handleSelectInstancesPath = async () => {
        const result = await window.electronAPI.selectFolder();
        if (result && !result.canceled && result.filePaths && result.filePaths[0]) {
            handleChange('instancesPath', result.filePaths[0]);
        }
    };

    const normalizeExternalLauncherPaths = (paths) => {
        if (!Array.isArray(paths)) return [];
        const normalized = paths
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
        return [...new Set(normalized)];
    };

    const handleAddExternalLauncherPath = (pathValue) => {
        const normalizedPath = String(pathValue || '').trim();
        if (!normalizedPath) {
            return;
        }
        const currentPaths = normalizeExternalLauncherPaths(settings.externalLauncherPaths);
        if (currentPaths.includes(normalizedPath)) {
            addNotification(t('settings.instance.external_paths_exists', 'Path already exists.'), 'warning');
            return;
        }
        handleChange('externalLauncherPaths', [...currentPaths, normalizedPath]);
    };

    const handleBrowseExternalLauncherPath = async () => {
        const result = await window.electronAPI.selectFolder();
        if (result && !result.canceled && result.filePaths && result.filePaths[0]) {
            handleAddExternalLauncherPath(result.filePaths[0]);
        }
    };

    const handleAddExternalLauncherPathFromInput = () => {
        handleAddExternalLauncherPath(externalLauncherPathInput);
        setExternalLauncherPathInput('');
    };

    const handleRemoveExternalLauncherPath = (pathToRemove) => {
        const currentPaths = normalizeExternalLauncherPaths(settings.externalLauncherPaths);
        const nextPaths = currentPaths.filter((entry) => entry !== pathToRemove);
        handleChange('externalLauncherPaths', nextPaths);
    };

    const handleManualSave = () => {
        saveSettings(settings, false);
    };

    const handleRestartGuideNow = () => {
        if (typeof onRestartGuide !== 'function') {
            return;
        }
        onRestartGuide();
        addNotification(t('guide.restart_guide_started', 'Guide started.'), 'info');
    };

    const addAutoInstallMod = async () => {
        const input = autoInstallModsInput.trim();
        if (!input) {
            addNotification(t('settings.auto_install.add_failed'), 'error');
            return;
        }
        if (settings.autoInstallMods.includes(input)) {
            addNotification(t('settings.auto_install.already_exists'), 'warning');
            setAutoInstallModsInput('');
            return;
        }
        let modName = input;
        const foundInSearch = autoInstallModsSearchResults.find(m => m.project_id === input);
        if (foundInSearch) {
            modName = foundInSearch.title;
        } else {
            try {
                const response = await window.electronAPI.getModrinthProject(input);
                if (response?.success && response.project?.title) {
                    modName = response.project.title;
                }
            } catch (err) {
                console.error('Failed to fetch mod details:', err);
            }
        }
        const newAutoInstallMods = [...(settings.autoInstallMods || []), input];
        handleChange('autoInstallMods', newAutoInstallMods);
        setAutoInstallModsMetadata(prev => ({ ...prev, [input]: modName }));
        setAutoInstallModsInput('');
        setAutoInstallModsSearchResults([]);
        addNotification(t('settings.auto_install.add_success'), 'success');
    };

    const removeAutoInstallMod = (modId) => {
        const newAutoInstallMods = (settings.autoInstallMods || []).filter(m => m !== modId);
        handleChange('autoInstallMods', newAutoInstallMods);
        setAutoInstallModsMetadata(prev => {
            const newMetadata = { ...prev };
            delete newMetadata[modId];
            return newMetadata;
        });
        addNotification(t('settings.auto_install.remove_success'), 'success');
    };

    const searchModrinthMod = async (query) => {
        if (!query.trim()) {
            setAutoInstallModsSearchResults([]);
            return;
        }

        setSearchingAutoInstallMods(true);
        try {
            const response = await window.electronAPI.searchModrinth(query, [], {
                limit: 5,
                projectType: 'mod',
                includeCurseforge: true
            });
            if (response?.success) {
                setAutoInstallModsSearchResults(response.results || []);
            } else {
                addNotification(t('settings.auto_install.search_failed'), 'error');
                setAutoInstallModsSearchResults([]);
            }
        } catch (err) {
            console.error('Failed to search mods:', err);
            addNotification(t('settings.auto_install.search_failed'), 'error');
            setAutoInstallModsSearchResults([]);
        } finally {
            setSearchingAutoInstallMods(false);
        }
    };

    useEffect(() => {
        const hydrateAutoInstallMetadata = async () => {
            const entries = Array.isArray(settings.autoInstallMods) ? settings.autoInstallMods : [];
            const missing = entries.filter((entry) => !autoInstallModsMetadata[entry]);
            if (missing.length === 0) return;

            const discovered = {};
            await Promise.all(missing.map(async (entry) => {
                try {
                    const response = await window.electronAPI.getModrinthProject(entry);
                    if (response?.success && response.project?.title) {
                        discovered[entry] = response.project.title;
                    }
                } catch (_) {
                }
            }));

            if (Object.keys(discovered).length > 0) {
                setAutoInstallModsMetadata((prev) => ({ ...prev, ...discovered }));
            }
        };

        hydrateAutoInstallMetadata();
    }, [settings.autoInstallMods, autoInstallModsMetadata]);

    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        setUpdateInfo(null);
        setDownloadedFilePath(null);
        try {
            const res = await window.electronAPI.checkForUpdates();
            if (res.error) {
                addNotification(`Update check failed: ${res.error}`, 'error');
            } else {
                setUpdateInfo(res);
                if (!res.needsUpdate) {
                    addNotification(t('settings.update.latest'), 'success');
                }
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const handleDownloadUpdate = async () => {
        if (!updateInfo || !updateInfo.asset) return;
        setIsDownloadingUpdate(true);
        setDownloadProgress(0);
        try {
            const res = await window.electronAPI.downloadUpdate(updateInfo.asset.url, updateInfo.asset.name);
            if (res.success) {
                setDownloadedFilePath(res.path);
                addNotification(t('settings.update.download_success'), 'success');
            } else {
                addNotification(`Download failed: ${res.error}`, 'error');
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        } finally {
            setIsDownloadingUpdate(false);
        }
    };

    const handleInstallUpdate = async () => {
        if (!downloadedFilePath) return;
        try {
            const res = await window.electronAPI.installUpdate(downloadedFilePath);
            if (!res.success) {
                addNotification(`Install failed: ${res.error}`, 'error');
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        }
    };

    const handleSetTestVersion = async () => {
        try {
            const res = await window.electronAPI.setTestVersion(testVersion);
            if (res.success) {
                addNotification(`Test version set to ${res.currentVersion}`, 'success');
                handleCheckUpdate();
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        }
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader title={t('settings.title')} description={t('settings.desc')}>
                <Button onClick={handleManualSave} size="sm">
                    <Save />
                    <span>{t('settings.save_btn')}</span>
                </Button>
            </PageHeader>

            <PageContent>
                <div className="space-y-5">

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-muted-foreground" />
                                {t('settings.general.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {!isClientSettings && (
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div className="flex-1 min-w-[200px]">
                                        <Label className="text-foreground">{t('settings.general.startup_page')}</Label>
                                        <p className="text-xs text-muted-foreground mt-1">{t('settings.general.startup_page_desc')}</p>
                                    </div>
                                    <div className="grid w-full max-w-[540px] grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="text-xs text-muted-foreground">
                                                {t('settings.general.startup_section', 'Section')}
                                            </Label>
                                            <Select
                                                value={selectedStartupMode?.id ?? 'launcher'}
                                                onValueChange={handleStartupModeChange}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {startupModes.map((startupMode) => (
                                                        <SelectItem key={startupMode.id} value={startupMode.id}>
                                                            {t(startupMode.titleKey, startupMode.titleFallback)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs text-muted-foreground">
                                                {t('settings.general.startup_subpage', 'Page')}
                                            </Label>
                                            <Select
                                                value={normalizedStartupPage}
                                                onValueChange={(value) => handleChange('startPage', value)}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(selectedStartupMode?.pages ?? []).map((page) => (
                                                        <SelectItem key={page.value} value={page.value}>
                                                            {t(page.labelKey, page.labelFallback)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!isClientSettings && <Separator />}

                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex-1 min-w-[200px]">
                                    <Label className="text-foreground">{t('settings.general.language')}</Label>
                                    <p className="text-xs text-muted-foreground mt-1">{t('settings.general.language_desc')}</p>
                                </div>
                                <Select
                                    value={settings.language || 'en_us'}
                                    onValueChange={(value) => {
                                        handleChange('language', value);
                                        i18n.changeLanguage(value);
                                    }}
                                >
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="en_us">{t('settings.general.english')}</SelectItem>
                                        <SelectItem value="en_uk">{t('settings.general.english_uk')}</SelectItem>
                                        <SelectItem value="de_de">{t('settings.general.german')}</SelectItem>
                                        <SelectItem value="de_ch">{t('settings.general.swiss_german')}</SelectItem>
                                        <SelectItem value="es_es">{t('settings.general.spanish')}</SelectItem>
                                        <SelectItem value="fr_fr">{t('settings.general.french')}</SelectItem>
                                        <SelectItem value="it_it">{t('settings.general.italian')}</SelectItem>
                                        <SelectItem value="pl_pl">{t('settings.general.polish')}</SelectItem>
                                        <SelectItem value="pt_br">{t('settings.general.portuguese_br')}</SelectItem>
                                        <SelectItem value="pt_pt">{t('settings.general.portuguese_pt')}</SelectItem>
                                        <SelectItem value="ro_ro">{t('settings.general.romanian')}</SelectItem>
                                        <SelectItem value="ru_ru">{t('settings.general.russian')}</SelectItem>
                                        <SelectItem value="sk_sk">{t('settings.general.slovak')}</SelectItem>
                                        <SelectItem value="sl_si">{t('settings.general.slovenian')}</SelectItem>
                                        <SelectItem value="sv_se">{t('settings.general.swedish')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <ToggleBox
                                    checked={settings.pageAnimationsEnabled !== false}
                                    onChange={(val) => handleChange('pageAnimationsEnabled', val)}
                                    label={t('settings.general.animations.title', 'Page Animations')}
                                    description={t('settings.general.animations.desc', 'Animate page and tab switches instead of switching instantly.')}
                                />

                                {settings.pageAnimationsEnabled !== false && (
                                    <div className="rounded-xl border border-border bg-muted/20 p-4">
                                        <div className="mb-3">
                                            <Label className="text-foreground">{t('settings.general.animations.style_label', 'Animation Style')}</Label>
                                            <p className="mt-1 text-xs text-muted-foreground">{t('settings.general.animations.style_desc', 'Choose how pages should move when you switch tabs or sections.')}</p>
                                        </div>

                                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                            {animationPresetOptions.map((option) => {
                                                const isActive = (settings.pageAnimationPreset || 'cinematic') === option.id;

                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        onClick={() => handleChange('pageAnimationPreset', option.id)}
                                                        className={`rounded-xl border p-4 text-left transition-all ${isActive ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(var(--primary-color-rgb),0.15)]' : 'border-border bg-background/50 hover:border-primary/40 hover:bg-accent/30'}`}
                                                    >
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-sm font-semibold text-foreground">{option.label}</span>
                                                            {isActive && <Badge variant="success">{t('common.active', 'Active')}</Badge>}
                                                        </div>
                                                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{option.description}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex-1 min-w-[200px]">
                                    <Label className="text-foreground">{t('guide.restart_guide')}</Label>
                                    <p className="text-xs text-muted-foreground mt-1">{t('guide.restart_guide_desc')}</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleRestartGuideNow}
                                    className="border-primary/30 text-foreground hover:bg-primary/10"
                                >
                                    <Compass className="h-3.5 w-3.5" />
                                    {t('guide.restart_guide')}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Dialog open={showJavaModal} onOpenChange={setShowJavaModal}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{t('settings.java.install')}</DialogTitle>
                            </DialogHeader>
                            <p className="text-sm text-muted-foreground">{t('settings.java.install_desc')}</p>
                            <div className="space-y-2">
                                {[8, 17, 21, 25].map(v => (
                                    <Button
                                        key={v}
                                        variant="outline"
                                        className="w-full justify-between h-auto py-3"
                                        onClick={() => handleInstallJava(v)}
                                    >
                                        <span className="font-medium">Java {v} (LTS)</span>
                                        <span className="text-primary text-xs">{t('settings.java.install')} &rarr;</span>
                                    </Button>
                                ))}
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setShowJavaModal(false)}>
                                    {t('common.cancel')}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Cpu className="h-4 w-4 text-muted-foreground" />
                                {t('settings.java.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="mb-2 block">{t('settings.java.path')}</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={settings.javaPath || ''}
                                        readOnly
                                        placeholder={t('settings.java.detecting')}
                                        className="flex-1 font-mono text-xs"
                                    />
                                    <Button variant="outline" size="sm" onClick={handleBrowseJava}>
                                        <FolderOpen />
                                        {t('settings.java.browse')}
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={() => setShowJavaModal(true)}
                                        disabled={isInstallingJava}
                                    >
                                        {isInstallingJava ? (
                                            <>
                                                <Loader2 className="animate-spin" />
                                                <span>{javaInstallProgress ? `${Math.round(javaInstallProgress.progress)}%` : t('settings.java.installing')}</span>
                                            </>
                                        ) : (
                                            <>
                                                <Download />
                                                <span>{t('settings.java.install')}</span>
                                            </>
                                        )}
                                    </Button>
                                </div>
                                {isInstallingJava && javaInstallProgress && (
                                    <p className="mt-2 text-xs text-primary animate-pulse">
                                        {javaInstallProgress.step}
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                                    <Info className="h-3.5 w-3.5 text-amber-500" />
                                    {t('settings.java.recommended')}
                                </p>
                            </div>

                            {installedRuntimes.length > 0 && (
                                <>
                                    <Separator />
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <Label>{t('settings.java.installed_versions')}</Label>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="h-auto p-0 text-xs"
                                                onClick={() => window.electronAPI.openJavaFolder()}
                                            >
                                                {t('settings.java.open_folder')}
                                            </Button>
                                        </div>
                                        <div className="space-y-2">
                                            {installedRuntimes.map((runtime) => (
                                                <div key={runtime.dirPath} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 group hover:border-border/80 transition">
                                                    <div className="flex-1 min-w-0 mr-4">
                                                        <p className="text-sm font-medium text-foreground truncate">{runtime.name}</p>
                                                        <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">{runtime.path}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {settings.javaPath === runtime.path ? (
                                                            <Badge variant="success">
                                                                <Check className="h-3 w-3 mr-1" />
                                                                {t('settings.java.active')}
                                                            </Badge>
                                                        ) : (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleChange('javaPath', runtime.path)}
                                                            >
                                                                {t('settings.java.select')}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                            onClick={() => handleDeleteRuntime(runtime.dirPath)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4 text-muted-foreground" />
                                {t('settings.memory.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div>
                                <Label className="mb-2 block">{t('settings.memory.java_profile')}</Label>
                                <Select
                                    value={settings.javaProfile || 'default'}
                                    onValueChange={(value) => handleChange('javaProfile', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">{t('common.disabled')}</SelectItem>
                                        <SelectItem value="performance">Performance (Aikar's Flags)</SelectItem>
                                        <SelectItem value="low-end">Low-End PC (Aggressive GC)</SelectItem>
                                        <SelectItem value="zgc">ZGC (Stable FPS - Java 17+)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-[10px] text-muted-foreground mt-2 italic px-1">
                                    {t('settings.memory.java_profile_desc')}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <Label className="mb-2 block">{t('settings.memory.min')}</Label>
                                    <Input
                                        type="number"
                                        value={settings.minMemory}
                                        onChange={(e) => handleChange('minMemory', parseInt(e.target.value) || 0)}
                                        className="font-mono"
                                    />
                                </div>
                                <div>
                                    <Label className="mb-2 block">{t('settings.memory.max')}</Label>
                                    <Input
                                        type="number"
                                        value={settings.maxMemory}
                                        onChange={(e) => handleChange('maxMemory', parseInt(e.target.value) || 0)}
                                        className="font-mono"
                                    />
                                </div>
                            </div>

                            <div>
                                <Slider
                                    min={512}
                                    max={16384}
                                    step={512}
                                    value={[settings.maxMemory]}
                                    onValueChange={(value) => handleChange('maxMemory', value[0])}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground mt-2 font-mono">
                                    <span>512 MB</span>
                                    <span className="text-primary font-bold">{Math.floor(settings.maxMemory / 1024 * 10) / 10} GB</span>
                                    <span>16 GB</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Monitor className="h-4 w-4 text-muted-foreground" />
                                {t('settings.resolution.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <Label className="mb-2 block">{t('settings.resolution.width')}</Label>
                                    <Input
                                        type="number"
                                        value={settings.resolutionWidth}
                                        onChange={(e) => handleChange('resolutionWidth', parseInt(e.target.value) || 0)}
                                        className="font-mono"
                                    />
                                </div>
                                <div>
                                    <Label className="mb-2 block">{t('settings.resolution.height')}</Label>
                                    <Input
                                        type="number"
                                        value={settings.resolutionHeight}
                                        onChange={(e) => handleChange('resolutionHeight', parseInt(e.target.value) || 0)}
                                        className="font-mono"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {!isClientSettings && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Globe className="h-4 w-4 text-muted-foreground" />
                                    {t('settings.instance.title')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label className="mb-2 block">{t('settings.instance.storage_path', 'Instance Folder')}</Label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            value={settings.instancesPath || ''}
                                            onChange={(e) => handleChange('instancesPath', e.target.value)}
                                            placeholder={t('settings.instance.storage_path_placeholder', 'Default: %appdata%\\Lux\\instances')}
                                            className="flex-1 font-mono text-xs"
                                        />
                                        <Button variant="outline" size="sm" onClick={handleSelectInstancesPath}>
                                            <FolderOpen />
                                            {t('settings.java.browse', 'Browse')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleChange('instancesPath', '')}
                                            disabled={!settings.instancesPath}
                                        >
                                            <RotateCcw />
                                            {t('settings.instance.storage_path_reset', 'Default')}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {t('settings.instance.storage_path_desc', 'Leave empty to use the default folder. Restart the launcher after changing this path.')}
                                    </p>
                                </div>

                                <Separator />

                                <div>
                                    <Label className="mb-2 block">{t('settings.instance.external_paths_label', 'External Launcher Paths')}</Label>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        {t('settings.instance.external_paths_desc', 'Add custom folders where Modrinth/CurseForge profiles are stored if you installed them outside default locations.')}
                                    </p>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            value={externalLauncherPathInput}
                                            onChange={(e) => setExternalLauncherPathInput(e.target.value)}
                                            placeholder={t('settings.instance.external_paths_placeholder', 'e.g. D:\\Launchers\\Modrinth\\profiles')}
                                            className="flex-1 font-mono text-xs"
                                        />
                                        <Button variant="outline" size="sm" onClick={handleBrowseExternalLauncherPath}>
                                            <FolderOpen />
                                            {t('settings.java.browse', 'Browse')}
                                        </Button>
                                        <Button variant="default" size="sm" onClick={handleAddExternalLauncherPathFromInput}>
                                            <Plus />
                                            {t('common.add', 'Add')}
                                        </Button>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {normalizeExternalLauncherPaths(settings.externalLauncherPaths).length === 0 && (
                                            <p className="text-xs text-muted-foreground">
                                                {t('settings.instance.external_paths_empty', 'No custom external paths configured.')}
                                            </p>
                                        )}
                                        {normalizeExternalLauncherPaths(settings.externalLauncherPaths).map((externalPath) => (
                                            <div key={externalPath} className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5">
                                                <span className="flex-1 truncate text-xs font-mono" title={externalPath}>{externalPath}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2"
                                                    onClick={() => handleRemoveExternalLauncherPath(externalPath)}
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Separator />

                                <ToggleBox
                                    checked={settings.copySettingsEnabled || false}
                                    onChange={(val) => handleChange('copySettingsEnabled', val)}
                                    label={t('settings.instance.copy_settings')}
                                    description={t('settings.instance.copy_settings_desc')}
                                />

                                <ToggleBox
                                    className="pt-4 border-t border-border"
                                    checked={settings.showModrinthInstancesInLibrary !== false}
                                    onChange={(val) => handleChange('showModrinthInstancesInLibrary', val)}
                                    label={t('settings.instance.show_modrinth_instances')}
                                    description={t('settings.instance.show_modrinth_instances_desc')}
                                />

                                <ToggleBox
                                    className="pt-4 border-t border-border"
                                    checked={settings.showCurseforgeInstancesInLibrary !== false}
                                    onChange={(val) => handleChange('showCurseforgeInstancesInLibrary', val)}
                                    label={t('settings.instance.show_curseforge_instances')}
                                    description={t('settings.instance.show_curseforge_instances_desc')}
                                />

                                {settings.copySettingsEnabled && (
                                    <div>
                                        <Label className="mb-2 block">{t('settings.instance.source_instance')}</Label>
                                        <Select
                                            value={settings.copySettingsSourceInstance || ''}
                                            onValueChange={(value) => handleChange('copySettingsSourceInstance', value)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select an instance..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {instances.map((inst) => (
                                                    <SelectItem key={inst.name} value={inst.name}>{inst.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Zap className="h-4 w-4 text-muted-foreground" />
                                {t('settings.integration.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-0">
                            <ToggleBox
                                checked={settings.enableDiscordRPC}
                                onChange={(val) => handleChange('enableDiscordRPC', val)}
                                label={t('settings.integration.discord_rpc')}
                                description={t('settings.integration.discord_rpc_desc')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.autoUploadLogs || false}
                                onChange={(val) => handleChange('autoUploadLogs', val)}
                                label={t('settings.integration.auto_logs')}
                                description={t('settings.integration.auto_logs_desc')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.showDisabledFeatures || false}
                                onChange={(val) => handleChange('showDisabledFeatures', val)}
                                label={t('settings.integration.disabled_features')}
                                description={t('settings.integration.disabled_features_desc')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.focusMode || false}
                                onChange={(val) => handleChange('focusMode', val)}
                                label={t('settings.integration.focus_mode', 'Focus Mode')}
                                description={t('settings.integration.focus_mode_desc', 'Disables resource-intensive UI elements like skin animations.')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.minimizeToTray || false}
                                onChange={(val) => handleChange('minimizeToTray', val)}
                                label={t('settings.integration.minimize_to_tray', 'Minimize to Tray')}
                                description={t('settings.integration.minimize_to_tray_desc', 'Hide the launcher to the system tray when closing or minimizing.')}
                            />
                            {window.electronAPI && window.electronAPI.platform === 'win32' && (
                                <ToggleBox
                                    className="mt-4 pt-4 border-t border-border"
                                    checked={settings.minimalMode || false}
                                    onChange={(val) => handleChange('minimalMode', val)}
                                    label={t('settings.integration.minimal_mode', 'Minimal Mode')}
                                    description={t('settings.integration.minimal_mode_desc', 'Automatically minimize the launcher to the taskbar when a game starts.')}
                                />
                            )}
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.optimization || false}
                                onChange={(val) => handleChange('optimization', val)}
                                label={'Enable Optimization Mods'}
                                description={t('settings.integration.optimization_desc')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.enableAutoInstallMods || false}
                                onChange={(val) => handleChange('enableAutoInstallMods', val)}
                                label={t('settings.integration.auto_mod_install')}
                                description={t('settings.integration.auto_mod_install_desc')}
                            />
                        </CardContent>
                    </Card>

                    {!isClientSettings && settings.enableAutoInstallMods && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Search className="h-4 w-4 text-muted-foreground" />
                                    {t('settings.auto_install.management_title')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-sm text-muted-foreground">{t('settings.auto_install.management_desc')}</p>

                                <div>
                                    <Label className="mb-2 block">{t('settings.auto_install.add_label')}</Label>
                                    <div className="flex gap-2 mb-2">
                                        <Input
                                            value={autoInstallModsInput}
                                            onChange={(e) => {
                                                setAutoInstallModsInput(e.target.value);
                                                if (e.target.value.trim()) {
                                                    searchModrinthMod(e.target.value);
                                                } else {
                                                    setAutoInstallModsSearchResults([]);
                                                }
                                            }}
                                            placeholder={t('settings.auto_install.input_placeholder')}
                                            className="flex-1"
                                            onKeyPress={(e) => e.key === 'Enter' && addAutoInstallMod()}
                                        />
                                        <Button size="sm" onClick={addAutoInstallMod}>
                                            <Plus />
                                            {t('settings.auto_install.btn_add')}
                                        </Button>
                                    </div>

                                    {autoInstallModsSearchResults.length > 0 && (
                                        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden max-h-48 overflow-y-auto">
                                            {autoInstallModsSearchResults.map((mod) => (
                                                <button
                                                    key={mod.project_id}
                                                    onClick={() => {
                                                        setAutoInstallModsInput(mod.project_id);
                                                        setAutoInstallModsSearchResults([]);
                                                    }}
                                                    className="w-full text-left px-3 py-2 hover:bg-accent transition border-b border-border last:border-b-0"
                                                >
                                                    <p className="font-medium text-sm text-foreground">{mod.title}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{mod.project_id}</p>
                                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                                        {getSourceTags(mod.source, mod.sources).map((sourceTag) => (
                                                            <span key={`${mod.project_id}-${sourceTag}`} className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                                                {sourceTag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {(settings.autoInstallMods || []).length > 0 ? (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <Label>{t('settings.auto_install.count_label', { count: settings.autoInstallMods.length })}</Label>
                                        </div>
                                        <Input
                                            value={autoInstallModsListSearch}
                                            onChange={(e) => setAutoInstallModsListSearch(e.target.value)}
                                            placeholder={t('settings.auto_install.list_search_placeholder')}
                                            className="mb-3"
                                        />
                                        <div className="space-y-2">
                                            {(settings.autoInstallMods || []).filter((mod) => {
                                                const modName = autoInstallModsMetadata[mod] || mod;
                                                const searchQuery = autoInstallModsListSearch.toLowerCase();
                                                return modName.toLowerCase().includes(searchQuery) || mod.toLowerCase().includes(searchQuery);
                                            }).map((mod) => (
                                                <div key={mod} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                                                    <div>
                                                        <p className="text-sm text-foreground font-medium">{autoInstallModsMetadata[mod] || mod}</p>
                                                        <code className="text-xs text-muted-foreground font-mono">{mod}</code>
                                                    </div>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => removeAutoInstallMod(mod)}
                                                    >
                                                        <X className="h-3 w-3 mr-1" />
                                                        {t('settings.auto_install.remove_btn')}
                                                    </Button>
                                                </div>
                                            ))}
                                            {autoInstallModsListSearch && (settings.autoInstallMods || []).filter((mod) => {
                                                const modName = autoInstallModsMetadata[mod] || mod;
                                                const searchQuery = autoInstallModsListSearch.toLowerCase();
                                                return modName.toLowerCase().includes(searchQuery) || mod.toLowerCase().includes(searchQuery);
                                            }).length === 0 && (
                                                    <div className="text-center py-4 text-muted-foreground text-sm">{t('settings.auto_install.no_matches')}</div>
                                                )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-6 rounded-lg border border-border bg-muted/20">
                                        <p className="text-muted-foreground text-sm">{t('settings.auto_install.no_mods')}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-muted-foreground" />
                                {t('settings.compatibility.title', 'Compatibility')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-0">
                            <ToggleBox
                                checked={settings.lowGraphicsMode || false}
                                onChange={(val) => handleChange('lowGraphicsMode', val)}
                                label={t('settings.compatibility.low_graphics', 'Low Graphics Mode')}
                                description={t('settings.compatibility.low_graphics_desc', 'Disables resource-intensive 3D previews (e.g. skin preview) to improve performance on older hardware.')}
                            />
                            <ToggleBox
                                className="mt-4 pt-4 border-t border-border"
                                checked={settings.legacyGpuSupport || false}
                                onChange={(val) => handleChange('legacyGpuSupport', val)}
                                label={t('settings.compatibility.legacy_gpu', 'Legacy GPU Support')}
                                description={t('settings.compatibility.legacy_gpu_desc', 'Disables hardware acceleration and uses basic OpenGL. Enable this if you experience crashes or black screens. (Requires App Restart)')}
                            />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Cloud className="h-4 w-4 text-muted-foreground" />
                                {t('settings.cloud.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <p className="text-sm text-muted-foreground">{t('settings.cloud.desc')}</p>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {[
                                    { id: 'GOOGLE_DRIVE', name: 'Google Drive', icon: 'assets/cloud-backup/drive.svg' },
                                    { id: 'DROPBOX', name: 'Dropbox', icon: 'assets/cloud-backup/dropbox.svg' }
                                ].map((provider) => (
                                    <div key={provider.id} className={`p-4 rounded-lg border transition-all ${cloudStatus[provider.id]?.loggedIn ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border hover:border-border/80'}`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                                                    <img src={provider.icon} alt="" className="w-5 h-5" />
                                                </div>
                                                <span className="font-medium text-sm text-foreground">{provider.name}</span>
                                            </div>
                                            {cloudStatus[provider.id]?.loggedIn && (
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                            )}
                                        </div>

                                        {cloudStatus[provider.id]?.loggedIn ? (
                                            <div className="space-y-2">
                                                <div className="text-xs text-muted-foreground">
                                                    <p className="font-medium text-foreground truncate">{cloudStatus[provider.id].user?.name}</p>
                                                    <p className="truncate">{cloudStatus[provider.id].user?.email}</p>
                                                </div>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={() => handleCloudLogout(provider.id)}
                                                >
                                                    {t('settings.cloud.logout')}
                                                </Button>
                                            </div>
                                        ) : (
                                            <Button
                                                size="sm"
                                                className="w-full"
                                                onClick={() => handleCloudLogin(provider.id)}
                                            >
                                                {t('settings.cloud.login_btn')}
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <ToggleBox
                                    checked={settings.cloudBackupSettings?.enabled || false}
                                    onChange={(val) => handleChange('cloudBackupSettings', { ...settings.cloudBackupSettings, enabled: val })}
                                    label={t('settings.cloud.enable_backup')}
                                    description={t('settings.cloud.enable_backup_desc')}
                                />

                                {settings.cloudBackupSettings?.enabled && (
                                    <div className="ml-10 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-foreground">{t('settings.cloud.default_provider')}</Label>
                                                <p className="text-xs text-muted-foreground">{t('settings.cloud.default_provider_desc')}</p>
                                            </div>
                                            <Select
                                                value={settings.cloudBackupSettings?.provider || 'GOOGLE_DRIVE'}
                                                onValueChange={(value) => handleChange('cloudBackupSettings', { ...settings.cloudBackupSettings, provider: value })}
                                            >
                                                <SelectTrigger className="w-[160px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="GOOGLE_DRIVE">Google Drive</SelectItem>
                                                    <SelectItem value="DROPBOX">Dropbox</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <ToggleBox
                                            checked={settings.cloudBackupSettings?.autoRestore || false}
                                            onChange={(val) => handleChange('cloudBackupSettings', { ...settings.cloudBackupSettings, autoRestore: val })}
                                            label={t('settings.cloud.auto_restore')}
                                            description={t('settings.cloud.auto_restore_desc')}
                                        />
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                                {t('settings.update.title', 'Software Update')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-foreground">{t('settings.update.current_version', 'Current Version')}</p>
                                    <div className="text-sm text-muted-foreground mt-0.5">
                                        {updateInfo?.currentVersion ? (
                                            <Badge variant="secondary">{updateInfo.currentVersion}</Badge>
                                        ) : '...'}
                                    </div>
                                </div>
                                <Button
                                    onClick={handleCheckUpdate}
                                    disabled={isCheckingUpdate}
                                    size="sm"
                                >
                                    {isCheckingUpdate ? (
                                        <Loader2 className="animate-spin" />
                                    ) : (
                                        <RefreshCw />
                                    )}
                                    <span>{isCheckingUpdate ? t('settings.update.checking', 'Checking...') : t('settings.update.check_btn', 'Check for Updates')}</span>
                                </Button>
                            </div>

                            {updateInfo && updateInfo.needsUpdate && (
                                <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <h3 className="font-semibold text-foreground">{t('settings.update.available', 'Update Available!')}</h3>
                                            <Badge className="mt-1">Version {updateInfo.latestVersion}</Badge>
                                        </div>
                                        {!downloadedFilePath && !isDownloadingUpdate && (
                                            <Button onClick={handleDownloadUpdate} size="sm">
                                                <Download />
                                                {t('settings.update.download_btn', 'Download')}
                                            </Button>
                                        )}
                                        {downloadedFilePath && (
                                            <Button
                                                onClick={handleInstallUpdate}
                                                size="sm"
                                                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                                            >
                                                <Play />
                                                {t('settings.update.install_btn', 'Install & Restart')}
                                            </Button>
                                        )}
                                    </div>

                                    {isDownloadingUpdate && (
                                        <div className="mt-3">
                                            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                                                <span>{t('settings.update.downloading', 'Downloading...')}</span>
                                                <span>{Math.round(downloadProgress)}%</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary transition-all duration-300"
                                                    style={{ width: `${downloadProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {updateInfo.releaseNotes && (
                                        <>
                                            <Separator className="my-3" />
                                            <div>
                                                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t('settings.update.changelog', 'Release Notes')}</h4>
                                                <div className="text-sm text-foreground/80 max-h-40 overflow-y-auto whitespace-pre-wrap">
                                                    {updateInfo.releaseNotes}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <Accordion type="single" collapsible>
                            <AccordionItem value="advanced" className="border-b-0">
                                <CardHeader className="p-0">
                                    <AccordionTrigger className="px-5 py-4 hover:no-underline">
                                        <div className="flex items-center gap-2">
                                            <Settings2 className="h-4 w-4 text-muted-foreground" />
                                            <span className="font-semibold">{t('settings.advanced_settings', 'Advanced Settings')}</span>
                                        </div>
                                    </AccordionTrigger>
                                </CardHeader>
                                <AccordionContent className="px-5 pb-5">
                                    <div className="space-y-5">
                                        {isFeatureEnabled('settingsDevelopmentTesting') && (
                                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                                                <h3 className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                    <FlaskConical className="h-3.5 w-3.5" />
                                                    Development Testing
                                                </h3>
                                                <div className="flex gap-2">
                                                    <Input
                                                        value={testVersion}
                                                        onChange={(e) => setTestVersion(e.target.value)}
                                                        placeholder="e.g. 1.0.0"
                                                        className="flex-1"
                                                    />
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                                                        onClick={handleSetTestVersion}
                                                    >
                                                        <FlaskConical className="h-3.5 w-3.5" />
                                                        Set Test Version
                                                    </Button>
                                                </div>
                                                <p className="text-[10px] text-muted-foreground mt-2">Overrides local version string for update check simulation.</p>
                                            </div>
                                        )}

                                        <div>
                                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                                                <FlaskConical className="h-3.5 w-3.5" />
                                                {t('settings.maintenance.title')}
                                            </h3>

                                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 mb-4">
                                                <div className="flex items-start gap-2">
                                                    <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                                    <div>
                                                        <p className="font-medium text-foreground text-sm">{t('settings.maintenance.troubleshooting_title')}</p>
                                                        <p className="text-xs text-muted-foreground mt-0.5">{t('settings.maintenance.troubleshooting_desc')}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col justify-between min-h-[140px]">
                                                    <div>
                                                        <h3 className="font-semibold text-foreground text-sm">{t('settings.maintenance.soft_reset_title')}</h3>
                                                        <p className="text-xs text-muted-foreground mt-2">
                                                            {t('settings.maintenance.soft_reset_desc')}
                                                        </p>
                                                        <p className="text-xs text-primary font-medium mt-1">
                                                            <Check className="h-3 w-3 inline mr-1" />
                                                            {t('settings.maintenance.soft_reset_keep')}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        className="mt-3 w-full"
                                                        onClick={() => setShowSoftResetModal(true)}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                        {t('settings.maintenance.soft_reset_btn')}
                                                    </Button>
                                                </div>

                                                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex flex-col justify-between min-h-[140px]">
                                                    <div>
                                                        <h3 className="font-semibold text-destructive text-sm">{t('settings.maintenance.factory_reset_title')}</h3>
                                                        <p className="text-xs text-muted-foreground mt-2">
                                                            {t('settings.maintenance.factory_reset_desc')}
                                                        </p>
                                                        <p className="text-xs text-destructive font-medium mt-1">
                                                            <AlertTriangle className="h-3 w-3 inline mr-1" />
                                                            {t('settings.maintenance.factory_reset_warning')}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        className="mt-3 w-full"
                                                        onClick={() => setShowFactoryResetModal(true)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        {t('settings.maintenance.factory_reset_btn')}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                                            <h3 className="font-semibold text-foreground text-sm">{t('settings.instance.uninstall_title')}</h3>
                                            <p className="text-xs text-muted-foreground mt-2 mb-3">
                                                {t('settings.instance.uninstall_desc')}
                                            </p>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => setShowUninstallModal(true)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                {t('settings.instance.uninstall_btn')}
                                            </Button>
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </Card>
                    <ExtensionSlot name="settings.bottom" className="mt-4" />
                </div>
            </PageContent >

            {showSoftResetModal && (
                <ConfirmationModal
                    title={t('settings.maintenance.soft_reset_modal_title')}
                    message={t('settings.maintenance.soft_reset_modal_msg')}
                    confirmText={t('settings.maintenance.soft_reset_btn')}
                    isDangerous={false}
                    onConfirm={handleSoftReset}
                    onCancel={() => setShowSoftResetModal(false)}
                />
            )
            }

            {
                showFactoryResetModal && (
                    <ConfirmationModal
                        title={t('settings.maintenance.factory_reset_modal_title')}
                        message={t('settings.maintenance.factory_reset_modal_msg')}
                        confirmText={t('settings.maintenance.factory_reset_confirm_btn')}
                        isDangerous={true}
                        onConfirm={handleFactoryReset}
                        onCancel={() => setShowFactoryResetModal(false)}
                    />
                )
            }

            {
                showRestartModal && (
                    <ConfirmationModal
                        title={t('settings.compatibility.restart_title', 'Restart Required')}
                        message={t('settings.compatibility.restart_msg', 'Enabling Legacy GPU Support requires an application restart to apply changes to the graphics engine. Would you like to restart now?')}
                        confirmText={t('settings.compatibility.restart_confirm', 'Restart Now')}
                        cancelText={t('settings.compatibility.restart_cancel', 'Not Now')}
                        isDangerous={false}
                        onConfirm={handleConfirmRestart}
                        onCancel={() => setShowRestartModal(false)}
                    />
                )
            }

            {
                showUninstallModal && (
                    <ConfirmationModal
                        title={t('settings.instance.uninstall_modal_title')}
                        message={t('settings.instance.uninstall_modal_msg')}
                        confirmText={t('settings.instance.uninstall_confirm_btn')}
                        cancelText={t('common.cancel')}
                        isDangerous={true}
                        onConfirm={handleUninstallLauncher}
                        onCancel={() => setShowUninstallModal(false)}
                    />
                )
            }
        </div >
    );
}

export default Settings;
