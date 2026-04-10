import React, { useState, useEffect, useRef } from 'react';
import { ExtensionProvider } from './context/ExtensionContext';
import { Analytics } from './services/Analytics';
import ExtensionSlot from './components/Extensions/ExtensionSlot';
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Home = React.lazy(() => import('./pages/Home'));
const ServerDashboard = React.lazy(() => import('./pages/ServerDashboard'));
const ServerDetails = React.lazy(() => import('./pages/ServerDetails'));
const Search = React.lazy(() => import('./pages/Search'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Styling = React.lazy(() => import('./pages/Styling'));
const Skins = React.lazy(() => import('./pages/Skins'));
const ServerSettings = React.lazy(() => import('./pages/ServerSettings'));
const ServerSearch = React.lazy(() => import('./pages/ServerSearch'));
const ServerLibrary = React.lazy(() => import('./pages/ServerLibrary'));
const InstanceDetails = React.lazy(() => import('./pages/InstanceDetails'));
const Client = React.lazy(() => import('./pages/Client'));
const ClientMods = React.lazy(() => import('./pages/ClientMods'));
const ToolsDashboard = React.lazy(() => import('./pages/ToolsDashboard'));
const Extensions = React.lazy(() => import('./pages/Extensions'));
const Login = React.lazy(() => import('./pages/Login'));
const News = React.lazy(() => import('./pages/News'));
import { isFeatureEnabled } from './config/featureFlags';

import AppSidebar from './components/AppSidebar';
import TopBar from './components/TopBar';
import CommandPalette from './components/CommandPalette';
import UpdateNotification from './components/UpdateNotification';
import AgreementModal from './components/AgreementModal';
import LanguageSelectionModal from './components/LanguageSelectionModal';
import ThemeModeSelectionModal from './components/ThemeModeSelectionModal';
import StartupModeSelectionModal from './components/StartupDefaultModeModal';
import LoadingOverlay from './components/LoadingOverlay';
import WindowControls from './components/WindowControls';
import CrashModal from './components/CrashModal';
import JavaRequiredModal from './components/JavaRequiredModal';
import GuidePromptModal from './components/GuidePromptModal';
import GuideOverlay from './components/GuideOverlay';
import { syncCustomFonts } from './services/fontManager';
import { updateShadcnVars } from './lib/utils';
import { getGuideDefaultView, getGuideSteps, GuideMode, isGuideMode } from './lib/guideSteps';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n, { languageMap } from './i18n';

const DEFAULT_PAGE_ANIMATION_PRESET = 'cinematic';
const PAGE_TRANSITION_PRESETS = {
    cinematic: {
        duration: 0.34,
        variants: {
            initial: {
                opacity: 0,
                y: 18,
                scale: 0.985,
                filter: 'blur(10px)'
            },
            animate: {
                opacity: 1,
                y: 0,
                scale: 1,
                filter: 'blur(0px)'
            },
            exit: {
                opacity: 0,
                y: -14,
                scale: 0.992,
                filter: 'blur(6px)'
            }
        }
    },
    glide: {
        duration: 0.3,
        variants: {
            initial: {
                opacity: 0,
                x: 32,
                scale: 0.992,
                filter: 'blur(8px)'
            },
            animate: {
                opacity: 1,
                x: 0,
                scale: 1,
                filter: 'blur(0px)'
            },
            exit: {
                opacity: 0,
                x: -26,
                scale: 0.996,
                filter: 'blur(4px)'
            }
        }
    },
    fade: {
        duration: 0.22,
        variants: {
            initial: {
                opacity: 0
            },
            animate: {
                opacity: 1
            },
            exit: {
                opacity: 0
            }
        }
    },
    zoom: {
        duration: 0.28,
        variants: {
            initial: {
                opacity: 0,
                scale: 0.94,
                filter: 'blur(12px)'
            },
            animate: {
                opacity: 1,
                scale: 1,
                filter: 'blur(0px)'
            },
            exit: {
                opacity: 0,
                scale: 1.03,
                filter: 'blur(6px)'
            }
        }
    },
    lift: {
        duration: 0.29,
        variants: {
            initial: {
                opacity: 0,
                y: 28,
                scale: 0.978
            },
            animate: {
                opacity: 1,
                y: 0,
                scale: 1
            },
            exit: {
                opacity: 0,
                y: -20,
                scale: 0.988
            }
        }
    }
};

const getPageTransitionPreset = (preset) => {
    if (typeof preset === 'string' && PAGE_TRANSITION_PRESETS[preset]) {
        return PAGE_TRANSITION_PRESETS[preset];
    }

    return PAGE_TRANSITION_PRESETS[DEFAULT_PAGE_ANIMATION_PRESET];
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }
    componentDidCatch(error: any, errorInfo: any) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return <ErrorFallback />;
        }
        return this.props.children;
    }
}

function ErrorFallback() {
    const { t } = useTranslation();
    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground p-8 text-center">
            <h1 className="text-4xl font-bold mb-4 text-destructive">{t('common.error_title')}</h1>
            <p className="text-muted-foreground mb-8 max-w-md">{t('common.error_desc')}</p>
            <button
                onClick={() => window.location.reload()}
                className="bg-primary text-primary-foreground px-8 py-3 rounded-lg font-bold hover:opacity-90 transition-opacity"
            >
                {t('common.restart_app')}
            </button>
        </div>
    );
}

const LUX_FOREST_THEME_PRESET = {
    primaryColor: '#e26602',
    backgroundColor: '#111111',
    surfaceColor: '#1c1c1c',
    textOnBackground: '#f5f5f5',
    textOnSurface: '#f5f5f5',
    textOnPrimary: '#1a1208'
};

const LIGHT_LUX_THEME_PRESET = {
    primaryColor: '#d24e01',
    backgroundColor: '#f9ddb1',
    surfaceColor: '#f5c77e',
    textOnBackground: '#2a1a0e',
    textOnSurface: '#2c1b0f',
    textOnPrimary: '#fff4ea'
};

const DEFAULT_THEME = {
    primaryColor: '#e26602',
    backgroundColor: '#111111',
    surfaceColor: '#1c1c1c',
    sidebarColor: '',
    textOnBackground: '#fafafa',
    textOnSurface: '#fafafa',
    textOnPrimary: '#0d0d0d',
    glassBlur: 10,
    glassOpacity: 0.8,
    consoleOpacity: 0.8,
    borderRadius: 12,
    sidebarGlow: 0,
    globalGlow: 0,
    panelOpacity: 0.85,
    bgOverlay: 0.4,
    autoAdaptColor: false,
    fontFamily: 'Poppins',
    customFonts: [],
    bgMedia: { url: '', type: 'none' }
};

const normalizeThemeSchema = (theme: any = {}) => ({
    ...DEFAULT_THEME,
    ...theme,
    primaryColor: theme.primaryColor || theme.primary || DEFAULT_THEME.primaryColor,
    backgroundColor: theme.backgroundColor || theme.bg || theme.background || DEFAULT_THEME.backgroundColor,
    surfaceColor: theme.surfaceColor || theme.surface || DEFAULT_THEME.surfaceColor,
    sidebarColor: typeof theme.sidebarColor === 'string'
        ? theme.sidebarColor
        : (typeof theme.sidebar === 'string' ? theme.sidebar : ''),
    textOnBackground: theme.textOnBackground || theme.foreground || DEFAULT_THEME.textOnBackground,
    textOnSurface: theme.textOnSurface || theme.text || DEFAULT_THEME.textOnSurface,
    textOnPrimary: theme.textOnPrimary || DEFAULT_THEME.textOnPrimary,
});

const GUIDE_PROMPT_DEFAULTS: Record<GuideMode, boolean> = {
    launcher: true,
    server: true,
    client: true,
    tools: true
};

const GUIDE_PROMPT_SESSION_DEFAULTS: Record<GuideMode, boolean> = {
    launcher: false,
    server: false,
    client: false,
    tools: false
};

const resolveStartupDestination = (startPageSetting) => {
    const requestedView = typeof startPageSetting === 'string' ? startPageSetting : 'dashboard';

    switch (requestedView) {
        case 'server-dashboard':
            return { mode: 'server', view: 'server-dashboard' };
        case 'tools-dashboard':
            return { mode: 'tools', view: 'tools-dashboard' };
        case 'open-client':
            if (isFeatureEnabled('openClientPage')) {
                return { mode: 'client', view: 'open-client' };
            }
            return { mode: 'launcher', view: 'dashboard' };
        case 'library':
            return { mode: 'launcher', view: 'library' };
        case 'dashboard':
        default:
            return { mode: 'launcher', view: 'dashboard' };
    }
};

const resolveModeView = (mode, requestedView) => {
    const launcherViews = new Set(['dashboard', 'library', 'search', 'skins', 'styling', 'settings', 'extensions']);
    const serverViews = new Set(['server-dashboard', 'search', 'styling', 'server-library', 'server-settings']);
    const clientViews = new Set(['open-client', 'skins', 'extensions', 'styling', 'mods', 'settings']);
    const toolsViews = new Set(['tools-dashboard', 'settings']);

    if (mode === 'launcher') {
        return launcherViews.has(requestedView) ? requestedView : 'dashboard';
    }

    if (mode === 'server') {
        return serverViews.has(requestedView) ? requestedView : 'server-dashboard';
    }

    if (mode === 'client') {
        return clientViews.has(requestedView) ? requestedView : 'open-client';
    }

    if (mode === 'tools') {
        return toolsViews.has(requestedView) ? requestedView : 'tools-dashboard';
    }

    return requestedView || 'dashboard';
};

function App() {
    const { t, i18n } = useTranslation();
    const prefersReducedMotion = useReducedMotion();
    const [currentView, setCurrentView] = useState('dashboard');
    const [isPending, startTransition] = React.useTransition();
    const [currentMode, setCurrentMode] = useState('launcher');
    const [userProfile, setUserProfile] = useState(null);
    const [isGuest, setIsGuest] = useState(false);
    const [theme, setTheme] = useState(DEFAULT_THEME);
    const [selectedInstance, setSelectedInstance] = useState(null);
    const [selectedServer, setSelectedServer] = useState(null);
    const [runningInstances, setRunningInstances] = useState({});
    const [activeDownloads, setActiveDownloads] = useState({});
    const [isMaximized, setIsMaximized] = useState(false);
    const [searchCategory, setSearchCategory] = useState(null);
    const [triggerCreateInstance, setTriggerCreateInstance] = useState(false);
    const [appSettings, setAppSettings] = useState<any>({});
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [appVersion, setAppVersion] = useState('');
    const [crashData, setCrashData] = useState(null);
    const [isCrashModalOpen, setIsCrashModalOpen] = useState(false);
    const [javaRequirement, setJavaRequirement] = useState<any>(null);
    const [isInstallingRequiredJava, setIsInstallingRequiredJava] = useState(false);
    const [requiredJavaInstallError, setRequiredJavaInstallError] = useState('');
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [guidePromptMode, setGuidePromptMode] = useState<GuideMode | null>(null);
    const [guidePromptDoNotShowAgain, setGuidePromptDoNotShowAgain] = useState(false);
    const [guideMode, setGuideMode] = useState<GuideMode>('launcher');
    const [guideStepIndex, setGuideStepIndex] = useState(0);
    const [isGuideRunning, setIsGuideRunning] = useState(false);
    const [canNavigateBack, setCanNavigateBack] = useState(false);
    const [canNavigateForward, setCanNavigateForward] = useState(false);

    const lastClientView = useRef('dashboard');
    const lastServerView = useRef('server-dashboard');
    const lastToolsView = useRef('tools-dashboard');
    const appSettingsRef = useRef<any>({});
    const guidePromptShownThisSessionRef = useRef<Record<GuideMode, boolean>>({ ...GUIDE_PROMPT_SESSION_DEFAULTS });
    const navigationHistoryRef = useRef([{ mode: 'launcher', view: 'dashboard' }]);
    const navigationIndexRef = useRef(0);
    const isHistoryNavigationRef = useRef(false);
    const hasInitializedHistoryRef = useRef(false);

    useEffect(() => {
        appSettingsRef.current = appSettings;
    }, [appSettings]);

    const syncNavigationButtons = React.useCallback(() => {
        const canGoBack = navigationIndexRef.current > 0;
        const canGoForward = navigationIndexRef.current < navigationHistoryRef.current.length - 1;
        setCanNavigateBack(canGoBack);
        setCanNavigateForward(canGoForward);
    }, []);

    useEffect(() => {
        if (!hasInitializedHistoryRef.current) {
            navigationHistoryRef.current = [{ mode: currentMode, view: currentView }];
            navigationIndexRef.current = 0;
            hasInitializedHistoryRef.current = true;
            syncNavigationButtons();
            return;
        }

        if (isHistoryNavigationRef.current) {
            isHistoryNavigationRef.current = false;
            syncNavigationButtons();
            return;
        }

        const activeEntry = navigationHistoryRef.current[navigationIndexRef.current];
        if (activeEntry?.mode === currentMode && activeEntry?.view === currentView) {
            syncNavigationButtons();
            return;
        }

        const truncatedHistory = navigationHistoryRef.current.slice(0, navigationIndexRef.current + 1);
        truncatedHistory.push({ mode: currentMode, view: currentView });
        navigationHistoryRef.current = truncatedHistory;
        navigationIndexRef.current = truncatedHistory.length - 1;
        syncNavigationButtons();
    }, [currentMode, currentView, syncNavigationButtons]);

    const resolveFontFamily = (nextTheme) => {
        const builtInFonts = new Set([
            'Poppins', 'Inter', 'Montserrat', 'Roboto', 'Geist',
            'JetBrains Mono', 'Open Sans', 'Nunito', 'Ubuntu', 'Outfit'
        ]);
        const customFonts = (nextTheme.customFonts ?? []).map((font) => font.family);
        const availableFonts = new Set([...builtInFonts, ...customFonts]);
        return availableFonts.has(nextTheme.fontFamily) ? nextTheme.fontFamily : 'Poppins';
    };

    const getGuidePromptPreferences = (settings = appSettingsRef.current) => {
        const persisted = settings?.guidePrompts || {};
        return {
            ...GUIDE_PROMPT_DEFAULTS,
            ...persisted
        };
    };

    const saveGuidePromptPreference = async (mode: GuideMode, enabled: boolean) => {
        const baseSettings = appSettingsRef.current || {};
        const nextSettings = {
            ...baseSettings,
            guidePrompts: {
                ...GUIDE_PROMPT_DEFAULTS,
                ...(baseSettings.guidePrompts || {}),
                [mode]: enabled
            }
        };
        const res = await window.electronAPI.saveSettings(nextSettings);
        if (res.success) {
            setAppSettings(nextSettings);
            appSettingsRef.current = nextSettings;
            return true;
        }
        return false;
    };

    const finishGuide = () => {
        setIsGuideRunning(false);
        setGuideStepIndex(0);
    };

    const startGuide = async (mode: GuideMode, disablePromptForMode = false) => {
        if (disablePromptForMode) {
            await saveGuidePromptPreference(mode, false);
        } else {
            const prefs = getGuidePromptPreferences();
            if (prefs[mode] !== false) {
                await saveGuidePromptPreference(mode, false);
            }
        }

        guidePromptShownThisSessionRef.current[mode] = true;
        setGuidePromptMode(null);
        setGuidePromptDoNotShowAgain(false);
        setIsCommandPaletteOpen(false);

        const defaultView = getGuideDefaultView(mode);
        if (currentMode !== mode) {
            setCurrentMode(mode);
        }

        startTransition(() => {
            setCurrentView(defaultView);
        });

        setSelectedInstance(null);
        setSelectedServer(null);
        setGuideMode(mode);
        setGuideStepIndex(0);
        setIsGuideRunning(true);
    };

    const handleGuidePromptStart = async () => {
        if (!guidePromptMode) {
            return;
        }
        await startGuide(guidePromptMode, guidePromptDoNotShowAgain);
    };

    const handleGuidePromptSkip = async () => {
        if (!guidePromptMode) {
            return;
        }

        await saveGuidePromptPreference(guidePromptMode, false);

        setGuidePromptMode(null);
        setGuidePromptDoNotShowAgain(false);
    };

    const handleRestartGuide = (mode: GuideMode) => {
        void startGuide(mode);
    };

    useEffect(() => {
        if (currentMode === 'launcher' && currentView !== 'instance-details') {
            lastClientView.current = resolveModeView('launcher', currentView);
        }
        if (currentMode === 'server' && currentView !== 'server-details') {
            lastServerView.current = resolveModeView('server', currentView);
        }
        if (currentMode === 'tools') {
            lastToolsView.current = resolveModeView('tools', currentView);
        }
    }, [currentView, currentMode]);

    useEffect(() => {
        Analytics.init();

        const checkSession = async () => {
            let startupDestination = resolveStartupDestination('dashboard');
            try {
                const settingsRes = await window.electronAPI?.getSettings();
                if (settingsRes.success && settingsRes.settings.startPage) {
                    startupDestination = resolveStartupDestination(settingsRes.settings.startPage);
                }
            } catch (e) { }

            if (window.electronAPI?.validateSession) {
                const res = await window.electronAPI.validateSession();
                if (res.success) {
                    const profile = await window.electronAPI.getProfile();
                    if (profile) {
                        try {
                            let skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                            if (!skinRes.success) {
                                await new Promise(r => setTimeout(r, 1000));
                                skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                            }
                            if (skinRes.success) {
                                profile.skinUrl = skinRes.url;
                            }
                        } catch (e) {
                            console.error("Failed to prefetch skin", e);
                        }
                        setUserProfile(profile);
                        Analytics.setProfile(profile);
                    }
                }
            } else {
                const profile = await window.electronAPI?.getProfile();
                if (profile) {
                    setUserProfile(profile);
                    Analytics.setProfile(profile);
                }
            }
            setCurrentMode(startupDestination.mode);
            setCurrentView(startupDestination.view);
        };

        const loadTheme = async () => {
            const res = await window.electronAPI?.getSettings();
            if (res.success) {
                setAppSettings(res.settings);

                if (res.settings.language) {
                    let lang = res.settings.language;
                    if (languageMap[lang as keyof typeof languageMap]) {
                        lang = languageMap[lang as keyof typeof languageMap];
                        window.electronAPI.saveSettings({ ...res.settings, language: lang });
                    }
                    i18n.changeLanguage(lang);
                }

                if (res.settings.theme) {
                    const t = normalizeThemeSchema(res.settings.theme);
                    setTheme(t);
                    applyTheme(t);
                }
            }
        };

        const loadVersion = async () => {
            if (window.electronAPI?.getVersion) {
                try {
                    const v = await window.electronAPI.getVersion();
                    setAppVersion(v);
                } catch (e) { }
            }
        };

        const init = async () => {
            await Promise.all([checkSession(), loadTheme(), loadVersion()]);
            setIsInitialLoading(false);
        };

        init();

        const removeThemeListener = window.electronAPI?.onThemeUpdated((newTheme) => {
            const normalizedTheme = normalizeThemeSchema(newTheme || {});
            setTheme(normalizedTheme);
            applyTheme(normalizedTheme);
        });

        const removeSettingsListener = window.electronAPI.onSettingsUpdated?.((newSettings) => {
            setAppSettings(newSettings);
        });

        const removeStatusListener = window.electronAPI?.onInstanceStatus(({ instanceName, status, loader, version }) => {
            setRunningInstances(prev => {
                const next = { ...prev };
                if (status === 'stopped' || status === 'deleted') {
                    delete next[instanceName];
                    if (status === 'stopped') Analytics.updateStatus(false, instanceName, { loader, version, mode: currentMode });
                } else {
                    next[instanceName] = status;
                    if (status === 'running') Analytics.updateStatus(true, instanceName, { loader, version, mode: currentMode });
                }
                return next;
            });

            if (status === 'stopped' || status === 'error' || status === 'deleted') {
                setActiveDownloads(prev => {
                    const next = { ...prev };
                    delete next[instanceName];
                    return next;
                });
            }
        });

        const removeServerStatusListener = window.electronAPI.onServerStatus?.(({ serverName, status }) => {
            setRunningInstances(prev => {
                const next = { ...prev };
                if (status === 'stopped' || status === 'deleted' || status === 'error') {
                    delete next[serverName];
                } else {
                    next[serverName] = status;
                }
                return next;
            });
            setActiveDownloads(prev => {
                const next = { ...prev };
                if (status === 'stopped' || status === 'error' || status === 'ready' || status === 'deleted' || status === 'running' || status === 'starting' || status === 'stopping') {
                    delete next[serverName];
                }
                return next;
            });
        });

        const removeInstallListener = window.electronAPI?.onInstallProgress(({ instanceName, progress, status, type }) => {
            setActiveDownloads(prev => {
                const next = { ...prev };
                if (progress >= 100) {
                    delete next[instanceName];
                } else {
                    next[instanceName] = { progress: progress || prev[instanceName]?.progress || 0, status, type: type || 'install' };
                }
                return next;
            });
        });

        const removeLaunchProgressListener = window.electronAPI?.onLaunchProgress((e) => { });

        const removeWindowStateListener = window.electronAPI?.onWindowStateChange((maximized) => {
            setIsMaximized(maximized);
        });

        const removeCrashReportListener = window.electronAPI?.onCrashReport((data) => {
            if (appSettingsRef.current?.enableSmartLogAnalytics !== false) {
                console.log('[App] Received crash report:', data);
                setCrashData(data);
                setIsCrashModalOpen(true);
            } else {
                console.log('[App] Crash detected but Smart Log Analytics is disabled.');
            }
        });

        const removeJavaRequiredListener = window.electronAPI?.onJavaRequired((data) => {
            setRequiredJavaInstallError('');
            setIsInstallingRequiredJava(false);
            setJavaRequirement(data || null);
        });

        return () => {
            if (removeInstallListener) removeInstallListener();
            if (removeLaunchProgressListener) removeLaunchProgressListener();
            if (removeStatusListener) removeStatusListener();
            if (removeServerStatusListener) removeServerStatusListener();
            if (removeThemeListener) removeThemeListener();
            if (removeSettingsListener) removeSettingsListener();
            if (removeWindowStateListener) removeWindowStateListener();
            if (removeCrashReportListener) removeCrashReportListener();
            if (removeJavaRequiredListener) removeJavaRequiredListener();
        };
    }, []);

    const handleCloseJavaRequiredModal = () => {
        if (isInstallingRequiredJava) return;
        setJavaRequirement(null);
        setRequiredJavaInstallError('');
    };

    const handleInstallRequiredJava = async () => {
        if (!javaRequirement?.requiredVersion || isInstallingRequiredJava) return;

        setIsInstallingRequiredJava(true);
        setRequiredJavaInstallError('');
        try {
            const version = String(javaRequirement.requiredVersion);
            const installRes = await window.electronAPI.installJava(version);
            if (!installRes?.success || !installRes?.path) {
                setRequiredJavaInstallError(installRes?.error || `Java ${version} konnte nicht installiert werden.`);
                return;
            }

            const settingsRes = await window.electronAPI.getSettings();
            const currentSettings = settingsRes?.success ? settingsRes.settings : (appSettingsRef.current || {});
            const saveRes = await window.electronAPI.saveSettings({
                ...currentSettings,
                javaPath: installRes.path
            });

            if (saveRes?.success) {
                setAppSettings({
                    ...currentSettings,
                    javaPath: installRes.path
                });
                setJavaRequirement(null);
            } else {
                setRequiredJavaInstallError(saveRes?.error || 'Java wurde installiert, aber der Pfad konnte nicht gespeichert werden. Bitte in Settings setzen.');
            }
        } catch (e: any) {
            setRequiredJavaInstallError(e?.message || 'Unbekannter Fehler bei der Java-Installation.');
        } finally {
            setIsInstallingRequiredJava(false);
        }
    };

    const handleAcceptAgreement = async () => {
        const newSettings = { ...appSettings, hasAcceptedToS: true, hasSelectedThemeMode: false };
        const res = await window.electronAPI.saveSettings(newSettings);
        if (res.success) {
            setAppSettings(newSettings);
        }
    };

    const handleDeclineAgreement = async () => {
        const newSettings = { ...appSettings, hasSelectedLanguage: false };
        await window.electronAPI.saveSettings(newSettings);
        window.close();
    };

    const handleLanguageSelect = async (code) => {
        const newSettings = { ...appSettings, language: code, hasSelectedLanguage: true };
        const res = await window.electronAPI.saveSettings(newSettings);
        if (res.success) {
            setAppSettings(newSettings);
        }
    };

    const handleThemeModeSelect = async (mode) => {
        const selectedThemePreset = mode === 'light' ? LIGHT_LUX_THEME_PRESET : LUX_FOREST_THEME_PRESET;
        const nextTheme = {
            ...(appSettings.theme || {}),
            ...selectedThemePreset
        };
        const newSettings = {
            ...appSettings,
            hasSelectedThemeMode: true,
            hasSelectedStartupMode: false,
            theme: nextTheme
        };

        const res = await window.electronAPI.saveSettings(newSettings);
        if (res.success) {
            setAppSettings(newSettings);
            setTheme(nextTheme);
            applyTheme(nextTheme);
        }
    };

    const handleStartupModeSelect = async (startPage) => {
        const newSettings = {
            ...appSettings,
            startPage,
            hasSelectedStartupMode: true
        };
        const res = await window.electronAPI.saveSettings(newSettings);
        if (res.success) {
            const startupDestination = resolveStartupDestination(startPage);
            setAppSettings(newSettings);
            setSelectedInstance(null);
            setSelectedServer(null);
            startTransition(() => {
                setCurrentMode(startupDestination.mode);
                setCurrentView(startupDestination.view);
            });
        }
    };

    const applyTheme = (t) => {
        const root = document.documentElement;
        const fontFamily = resolveFontFamily(t);
        syncCustomFonts(t.customFonts ?? []);
        root.style.setProperty('--primary-color', t.primaryColor);
        root.style.setProperty('--background-color', t.backgroundColor);
        root.style.setProperty('--surface-color', t.surfaceColor);
        root.style.setProperty('--text-on-background', t.textOnBackground ?? '#fafafa');
        root.style.setProperty('--text-on-surface', t.textOnSurface ?? '#fafafa');
        root.style.setProperty('--text-on-primary', t.textOnPrimary ?? '#0d0d0d');
        root.style.setProperty('--glass-blur', `${t.glassBlur}px`);
        root.style.setProperty('--glass-opacity', t.glassOpacity);
        root.style.setProperty('--console-opacity', t.consoleOpacity ?? 0.8);
        root.style.setProperty('--border-radius', `${t.borderRadius ?? 12}px`);
        root.style.setProperty('--sidebar-glow-intensity', t.sidebarGlow ?? 0);
        root.style.setProperty('--global-glow-intensity', t.globalGlow ?? 0);
        root.style.setProperty('--panel-opacity', t.panelOpacity ?? 0.85);
        root.style.setProperty('--bg-overlay-opacity', t.bgOverlay ?? 0.4);
        root.style.setProperty('--launcher-font', `'${fontFamily}'`);

        const adjustColor = (hex, percent) => {
            if (!hex || typeof hex !== 'string') return '#ffffff';
            const num = parseInt(hex.replace('#', ''), 16);
            const amt = Math.round(2.55 * percent);
            const R = (num >> 16) + amt;
            const G = (num >> 8 & 0x00FF) + amt;
            const B = (num & 0x0000FF) + amt;
            return '#' + (0x1000000 + (R < 255 ? R < 0 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 0 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 0 ? 0 : B : 255)).toString(16).slice(1);
        };

        root.style.setProperty('--primary-hover-color', adjustColor(t.primaryColor, 15));

        const hexToRgb = (hex) => {
            if (!hex || typeof hex !== 'string') return '28, 28, 28';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `${r}, ${g}, ${b}`;
        };
        root.style.setProperty('--surface-color-rgb', hexToRgb(t.surfaceColor));
        root.style.setProperty('--primary-color-rgb', hexToRgb(t.primaryColor));

        const darken = (hex, percent) => {
            if (!hex || typeof hex !== 'string') return '#000000';
            const num = parseInt(hex.replace('#', ''), 16);
            const amt = Math.round(2.55 * percent);
            const R = (num >> 16) - amt;
            const G = (num >> 8 & 0x00FF) - amt;
            const B = (num & 0x0000FF) - amt;
            return '#' + (0x1000000 + (R < 255 ? R < 0 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 0 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 0 ? 0 : B : 255)).toString(16).slice(1);
        };
        root.style.setProperty('--background-dark-color', darken(t.backgroundColor, 20));

        if (t.bgMedia && t.bgMedia.url) {
            root.style.setProperty('--bg-url', t.bgMedia.url);
            root.style.setProperty('--bg-type', t.bgMedia.type);
        } else {
            root.style.setProperty('--bg-url', '');
            root.style.setProperty('--bg-type', 'none');
        }

        updateShadcnVars(t);
    };

    const handleLoginSuccess = async (profile) => {
        if (profile && profile.access_token && window.electronAPI.getCurrentSkin) {
            try {
                let skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                if (!skinRes.success) {
                    await new Promise(r => setTimeout(r, 1000));
                    skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                }
                if (skinRes.success) {
                    profile.skinUrl = skinRes.url;
                }
            } catch (e) {
                console.error("Failed to prefetch skin", e);
            }
        }
        let startupDestination = resolveStartupDestination('dashboard');
        try {
            const settingsRes = await window.electronAPI.getSettings();
            if (settingsRes.success && settingsRes.settings.startPage) {
                startupDestination = resolveStartupDestination(settingsRes.settings.startPage);
            }
        } catch (e) { }

        startTransition(() => {
            setUserProfile(profile);
            Analytics.setProfile(profile);
            setCurrentMode(startupDestination.mode);
            setCurrentView(startupDestination.view);
        });
    };

    const handleLogout = () => {
        startTransition(() => {
            setUserProfile(null);
            setIsGuest(false);
        });
    };

    const handleGuestMode = () => {
        startTransition(() => {
            setIsGuest(true);
        });
    };

    const handleInstanceClick = (instance) => {
        setSelectedInstance(instance);
        startTransition(() => {
            setCurrentView('instance-details');
        });
    };

    const handleServerClick = (server) => {
        setSelectedServer(server);
        startTransition(() => {
            setCurrentView('server-details');
        });
    };

    const handleInstanceUpdate = (updatedInstance) => {
        setSelectedInstance(updatedInstance);
    };

    const handleServerUpdate = (updatedServer) => {
        setSelectedServer(updatedServer);
    };

    const handleBackToDashboard = () => {
        setSelectedInstance(null);
        setSelectedServer(null);
        startTransition(() => {
            setCurrentView(currentMode === 'launcher' ? 'dashboard' : 'server-dashboard');
        });
    };

    const handleModeSelect = (mode) => {
        setCurrentMode(mode);
        if (mode === 'launcher') {
            setCurrentView(resolveModeView('launcher', lastClientView.current));
        } else if (mode === 'server') {
            setCurrentView(resolveModeView('server', lastServerView.current));
        } else if (mode === 'client') {
            setCurrentView(resolveModeView('client', 'open-client'));
        } else if (mode === 'tools') {
            setCurrentView(resolveModeView('tools', lastToolsView.current));
        }
        setSelectedInstance(null);
        setSelectedServer(null);
    };

    const handleNavigate = (viewId) => {
        startTransition(() => {
            setCurrentView(viewId);
        });
    };

    const handleHistoryNavigate = (direction: 'back' | 'forward') => {
        const nextIndex = direction === 'back'
            ? navigationIndexRef.current - 1
            : navigationIndexRef.current + 1;

        if (nextIndex < 0 || nextIndex >= navigationHistoryRef.current.length) {
            return;
        }

        const target = navigationHistoryRef.current[nextIndex];
        if (!target) {
            return;
        }

        navigationIndexRef.current = nextIndex;
        isHistoryNavigationRef.current = true;
        syncNavigationButtons();

        startTransition(() => {
            if (target.mode !== currentMode) {
                setCurrentMode(target.mode);
            }
            setCurrentView(target.view);
        });
    };

    const handleNavigateBack = () => {
        handleHistoryNavigate('back');
    };

    const handleNavigateForward = () => {
        handleHistoryNavigate('forward');
    };

    const topBarHistoryProps: any = {
        canNavigateBack,
        canNavigateForward,
        onNavigateBack: handleNavigateBack,
        onNavigateForward: handleNavigateForward
    };

    const handleGuidePrevious = () => {
        setGuideStepIndex((prev) => Math.max(0, prev - 1));
    };

    const handleGuideNext = () => {
        const nextIndex = guideStepIndex + 1;
        if (nextIndex >= guideSteps.length) {
            finishGuide();
            return;
        }
        setGuideStepIndex(nextIndex);
    };

    const handleGuideFinish = () => {
        finishGuide();
    };

    const isLoginView = !userProfile && !isGuest;
    const isLanguageSelectionOpen = !isInitialLoading && appSettings.hasSelectedLanguage === false;
    const isAgreementModalOpen = !isInitialLoading && appSettings.hasSelectedLanguage === true && appSettings.hasAcceptedToS === false;
    const isThemeModeSelectionOpen =
        !isInitialLoading &&
        appSettings.hasSelectedLanguage === true &&
        appSettings.hasAcceptedToS === true &&
        appSettings.hasSelectedThemeMode === false;
    const isStartupModeSelectionOpen =
        !isInitialLoading &&
        appSettings.hasSelectedLanguage === true &&
        appSettings.hasAcceptedToS === true &&
        appSettings.hasSelectedThemeMode === true &&
        appSettings.hasSelectedStartupMode === false;
    const canAccessSkins = Boolean(userProfile) && !isGuest;
    const guideSteps = React.useMemo(() => getGuideSteps(guideMode, { canAccessSkins }), [guideMode, canAccessSkins]);
    const isGuidePromptBlockedBySetup =
        isInitialLoading ||
        isLoginView ||
        isLanguageSelectionOpen ||
        isAgreementModalOpen ||
        isThemeModeSelectionOpen ||
        isStartupModeSelectionOpen;
    const isCommandPaletteAvailable =
        !isGuidePromptBlockedBySetup &&
        !isGuideRunning &&
        guidePromptMode === null;
    const pageAnimationsEnabled = appSettings.pageAnimationsEnabled !== false;
    const pageAnimationPreset = typeof appSettings.pageAnimationPreset === 'string'
        ? appSettings.pageAnimationPreset
        : DEFAULT_PAGE_ANIMATION_PRESET;
    const activePageTransitionPreset = getPageTransitionPreset(pageAnimationPreset);
    const shouldAnimatePages = pageAnimationsEnabled && !prefersReducedMotion;

    useEffect(() => {
        if (!isGuideRunning) {
            return;
        }

        const step = guideSteps[guideStepIndex];
        if (!step) {
            finishGuide();
            return;
        }

        if (step.mode && step.mode !== currentMode) {
            setCurrentMode(step.mode);
        }

        if (step.view && step.view !== currentView) {
            startTransition(() => {
                setCurrentView(step.view);
            });
        }
    }, [isGuideRunning, guideStepIndex, guideSteps, currentMode, currentView]);

    useEffect(() => {
        if (isGuidePromptBlockedBySetup || isGuideRunning || guidePromptMode !== null) {
            return;
        }

        if (!isGuideMode(currentMode)) {
            return;
        }

        const mode = currentMode;
        if (guidePromptShownThisSessionRef.current[mode]) {
            return;
        }

        const guidePromptPreferences = getGuidePromptPreferences();
        if (guidePromptPreferences[mode] === false) {
            return;
        }

        guidePromptShownThisSessionRef.current[mode] = true;
        setGuidePromptMode(mode);
        setGuidePromptDoNotShowAgain(false);
    }, [
        currentMode,
        isGuidePromptBlockedBySetup,
        isGuideRunning,
        guidePromptMode,
        appSettings
    ]);

    const renderCurrentPage = () => {
        if (currentMode === 'launcher') {
            if (currentView === 'dashboard') {
                return <Home onInstanceClick={handleInstanceClick} runningInstances={runningInstances} isGuest={isGuest} userProfile={userProfile} activeDownloads={activeDownloads} onNavigateSearch={(category) => { setSearchCategory(category); setCurrentView('search'); }} />;
            }

            if (currentView === 'library') {
                return <Dashboard onInstanceClick={handleInstanceClick} runningInstances={runningInstances} activeDownloads={activeDownloads} triggerCreate={triggerCreateInstance} onCreateHandled={() => setTriggerCreateInstance(false)} isGuest={isGuest} />;
            }

            if (currentView === 'search') {
                return <Search initialCategory={searchCategory} onCategoryConsumed={() => setSearchCategory(null)} />;
            }

            if (currentView === 'skins' && !isGuest) {
                return <Skins onLogout={handleLogout} onProfileUpdate={setUserProfile} />;
            }

            if (currentView === 'styling') {
                return <Styling />;
            }

            if (currentView === 'settings') {
                return <Settings mode="launcher" onRestartGuide={() => handleRestartGuide('launcher')} />;
            }

            if (currentView === 'instance-details' && selectedInstance) {
                return <InstanceDetails instance={selectedInstance} onBack={handleBackToDashboard} runningInstances={runningInstances} onInstanceUpdate={handleInstanceUpdate} isGuest={isGuest} />;
            }

            if (currentView === 'extensions') {
                return <Extensions />;
            }
        }

        if (currentMode === 'server') {
            if (currentView === 'server-dashboard') {
                return <ServerDashboard onServerClick={handleServerClick} runningInstances={runningInstances} isGuest={isGuest} />;
            }

            if (currentView === 'server-details' && selectedServer) {
                return (
                    <ServerDetails
                        server={selectedServer}
                        onBack={handleBackToDashboard}
                        runningInstances={runningInstances}
                        onServerUpdate={handleServerUpdate}
                        isGuest={isGuest}
                    />
                );
            }

            if (currentView === 'search') {
                return <ServerSearch />;
            }

            if (currentView === 'styling') {
                return <Styling />;
            }

            if (currentView === 'server-library') {
                return <ServerLibrary />;
            }

            if (currentView === 'server-settings') {
                return <ServerSettings onRestartGuide={() => handleRestartGuide('server')} />;
            }
        }

        if (currentMode === 'client' && isFeatureEnabled('openClientPage')) {
            if (currentView === 'open-client') {
                return <Client />;
            }

            if (currentView === 'skins' && !isGuest) {
                return <Skins onLogout={handleLogout} onProfileUpdate={setUserProfile} />;
            }

            if (currentView === 'extensions') {
                return <Extensions />;
            }

            if (currentView === 'styling') {
                return <Styling />;
            }

            if (currentView === 'mods') {
                return <ClientMods />;
            }

            if (currentView === 'settings') {
                return <Settings mode="client" onRestartGuide={() => handleRestartGuide('client')} />;
            }
        }

        if (currentMode === 'tools') {
            if (currentView === 'tools-dashboard') {
                return <ToolsDashboard />;
            }

            if (currentView === 'settings') {
                return <Settings mode="tools" onRestartGuide={() => handleRestartGuide('tools')} />;
            }
        }

        if (currentView === 'news') {
            return <News />;
        }

        return null;
    };

    const currentPage = renderCurrentPage();
    const currentPageKey = [
        currentMode,
        currentView,
        selectedInstance?.name ?? '',
        selectedServer?.name ?? ''
    ].join(':');

    return (
        <ExtensionProvider>
            {isLoginView ? (
                <React.Suspense fallback={
                    <div className="h-screen w-screen flex items-center justify-center bg-background">
                        <div className="w-10 h-10 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                }>
                    <Login onLoginSuccess={handleLoginSuccess} onGuestMode={handleGuestMode} />
                </React.Suspense>
            ) : (
                <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30 selection:text-foreground relative">

                    {theme?.bgMedia?.url && theme.bgMedia.url.trim() !== '' && (
                        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                            {theme.bgMedia.type === 'video' ? (
                                <video
                                    key={theme.bgMedia.url}
                                    autoPlay muted loop playsInline
                                    preload="auto"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{ transform: 'translateZ(0)' }}
                                    onCanPlay={(e) => (e.target as HTMLElement).classList.add('opacity-100')}
                                    onError={(e) => {
                                        console.error("Background video decoding error:", e);
                                        setTheme(prev => ({ ...prev, bgMedia: { ...prev.bgMedia, type: 'none' } }));
                                    }}
                                >
                                    <source src={`app-media:///${theme.bgMedia.url.replace(/\\/g, '/')}`} type="video/mp4" />
                                </video>
                            ) : (
                                <img
                                    key={theme.bgMedia.url}
                                    src={`app-media:///${theme.bgMedia.url.replace(/\\/g, '/')}`}
                                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 opacity-100"
                                    alt=""
                                />
                            )}
                            <div
                                className="absolute inset-0 bg-background pointer-events-none"
                                style={{ opacity: theme.bgOverlay ?? 0.4 }}
                            />
                        </div>
                    )}

                    <TopBar
                        currentMode={currentMode}
                        onModeSelect={handleModeSelect}
                        {...topBarHistoryProps}
                        userProfile={userProfile}
                        onProfileUpdate={setUserProfile}
                        isGuest={isGuest}
                        isMaximized={isMaximized}
                        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                        onNavigate={handleNavigate}
                        runningInstances={runningInstances}
                        activeDownloads={activeDownloads}
                        appSettings={appSettings}
                        isCommandPaletteAvailable={isCommandPaletteAvailable}
                    />

                    <div className="flex flex-1 overflow-hidden relative z-10">
                        <AppSidebar
                            currentView={currentView}
                            setView={(view) => startTransition(() => setCurrentView(view))}
                            currentMode={currentMode}
                            onLogout={handleLogout}
                            onInstanceClick={handleInstanceClick}
                            onCreateInstance={() => { setCurrentView('library'); setTriggerCreateInstance(true); }}
                            isGuest={isGuest}
                            isCollapsed={isSidebarCollapsed}
                            setIsCollapsed={setIsSidebarCollapsed}
                        />

                        <main className="flex-1 overflow-hidden flex flex-col relative">
                            {isPending && (
                                <div className="absolute top-0 left-0 w-full h-0.5 z-[100] overflow-hidden bg-muted">
                                    <div className="h-full bg-primary/60 animate-progress-fast"></div>
                                </div>
                            )}

                            <React.Suspense fallback={
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                </div>
                            }>
                                <div className="page-transition-root flex-1 overflow-hidden">
                                    <AnimatePresence mode="wait" initial={false}>
                                        {currentPage && (
                                            <motion.div
                                                key={currentPageKey}
                                                className="page-transition-stage"
                                                data-page-animation={shouldAnimatePages ? pageAnimationPreset : 'none'}
                                                variants={activePageTransitionPreset.variants}
                                                initial={shouldAnimatePages ? 'initial' : false}
                                                animate="animate"
                                                exit={shouldAnimatePages ? 'exit' : undefined}
                                                transition={shouldAnimatePages ? {
                                                    duration: activePageTransitionPreset.duration,
                                                    ease: [0.22, 1, 0.36, 1]
                                                } : { duration: 0 }}
                                            >
                                                {currentPage}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </React.Suspense>
                        </main>
                    </div>

                    <UpdateNotification />
                </div>
            )}

            <CommandPalette
                open={isCommandPaletteOpen}
                onOpenChange={setIsCommandPaletteOpen}
                onNavigate={handleNavigate}
                onModeSelect={handleModeSelect}
                currentMode={currentMode}
                isAvailable={isCommandPaletteAvailable}
                canAccessSkins={canAccessSkins}
            />

            {appVersion && (
                <div className="absolute bottom-1 left-1 z-[9999] text-muted-foreground font-mono text-[10px] opacity-30 pointer-events-none select-none">
                    v{appVersion}
                </div>
            )}

            {!userProfile && !isGuest && (
                <WindowControls isMaximized={isMaximized} className="fixed top-4 right-4 z-[10001] rounded-xl border border-border bg-popover/80 p-1 backdrop-blur-md" />
            )}

            <ExtensionSlot name="app.overlay" className="absolute inset-0 pointer-events-none z-[9999] *:pointer-events-auto" />

            <CrashModal
                isOpen={isCrashModalOpen}
                onClose={() => setIsCrashModalOpen(false)}
                crashData={crashData}
                onFixApplied={() => {
                    console.log('[App] Fix applied, user may retry launch');
                }}
            />

            <JavaRequiredModal
                isOpen={Boolean(javaRequirement)}
                requiredVersion={javaRequirement?.requiredVersion || 25}
                minecraftVersion={javaRequirement?.minecraftVersion || 'unknown'}
                instanceName={javaRequirement?.instanceName}
                isInstalling={isInstallingRequiredJava}
                installError={requiredJavaInstallError}
                onInstall={handleInstallRequiredJava}
                onClose={handleCloseJavaRequiredModal}
            />

            {isInitialLoading && <LoadingOverlay message="Starting..." />}

            {!isInitialLoading && appSettings.hasSelectedLanguage === false && (
                <LanguageSelectionModal onSelect={handleLanguageSelect} />
            )}

            {!isInitialLoading && appSettings.hasSelectedLanguage === true && appSettings.hasAcceptedToS === false && (
                <AgreementModal
                    onAccept={handleAcceptAgreement}
                    onDecline={handleDeclineAgreement}
                />
            )}

            {isThemeModeSelectionOpen && (
                <ThemeModeSelectionModal onSelect={handleThemeModeSelect} />
            )}

            {isStartupModeSelectionOpen && (
                <StartupModeSelectionModal onSelect={handleStartupModeSelect} />
            )}

            {guidePromptMode && (
                <GuidePromptModal
                    mode={guidePromptMode}
                    doNotShowAgain={guidePromptDoNotShowAgain}
                    onDoNotShowAgainChange={setGuidePromptDoNotShowAgain}
                    onStart={handleGuidePromptStart}
                    onSkip={handleGuidePromptSkip}
                />
            )}

            {isGuideRunning && guideSteps.length > 0 && (
                <GuideOverlay
                    steps={guideSteps}
                    stepIndex={guideStepIndex}
                    onPrevious={handleGuidePrevious}
                    onNext={handleGuideNext}
                    onFinish={handleGuideFinish}
                    onSkip={handleGuideFinish}
                />
            )}

        </ExtensionProvider>
    );
}

export default function AppWithBoundary() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
