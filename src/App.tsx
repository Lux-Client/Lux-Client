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
import LoadingOverlay from './components/LoadingOverlay';
import WindowControls from './components/WindowControls';
import CrashModal from './components/CrashModal';
import { syncCustomFonts } from './services/fontManager';
import { updateShadcnVars } from './lib/utils';
import { useTranslation } from 'react-i18next';
import i18n, { languageMap } from './i18n';

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

function App() {
    const { t, i18n } = useTranslation();
    const [currentView, setCurrentView] = useState('dashboard');
    const [isPending, startTransition] = React.useTransition();
    const [currentMode, setCurrentMode] = useState('launcher');
    const [userProfile, setUserProfile] = useState(null);
    const [isGuest, setIsGuest] = useState(false);
    const [theme, setTheme] = useState({
        primaryColor: '#e26602',
        backgroundColor: '#111111',
        surfaceColor: '#1c1c1c',
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
    });
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
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    const lastClientView = useRef('dashboard');
    const lastServerView = useRef('server-dashboard');
    const appSettingsRef = useRef<any>({});

    useEffect(() => {
        appSettingsRef.current = appSettings;
    }, [appSettings]);

    const resolveFontFamily = (nextTheme) => {
        const builtInFonts = new Set([
            'Poppins', 'Inter', 'Montserrat', 'Roboto', 'Geist',
            'JetBrains Mono', 'Open Sans', 'Nunito', 'Ubuntu', 'Outfit'
        ]);
        const customFonts = (nextTheme.customFonts ?? []).map((font) => font.family);
        const availableFonts = new Set([...builtInFonts, ...customFonts]);
        return availableFonts.has(nextTheme.fontFamily) ? nextTheme.fontFamily : 'Poppins';
    };

    useEffect(() => {
        if (currentMode === 'launcher') lastClientView.current = currentView;
        if (currentMode === 'server') lastServerView.current = currentView;
    }, [currentView, currentMode]);

    useEffect(() => {
        Analytics.init();

        const checkSession = async () => {
            let startPage = 'dashboard';
            try {
                const settingsRes = await window.electronAPI?.getSettings();
                if (settingsRes.success && settingsRes.settings.startPage) {
                    startPage = settingsRes.settings.startPage;
                }
            } catch (e) {}

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
            setCurrentView(startPage);
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
                    const t = res.settings.theme;
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
                } catch (e) {}
            }
        };

        const init = async () => {
            await Promise.all([checkSession(), loadTheme(), loadVersion()]);
            setIsInitialLoading(false);
        };

        init();

        const removeThemeListener = window.electronAPI?.onThemeUpdated((newTheme) => {
            setTheme(newTheme);
            applyTheme(newTheme);
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

        const removeInstallListener = window.electronAPI?.onInstallProgress(({ instanceName, progress, status }) => {
            setActiveDownloads(prev => {
                const next = { ...prev };
                if (progress >= 100) {
                    delete next[instanceName];
                } else {
                    next[instanceName] = { progress: progress || prev[instanceName]?.progress || 0, status, type: 'install' };
                }
                return next;
            });
        });

        const removeLaunchProgressListener = window.electronAPI?.onLaunchProgress((e) => {});

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

        return () => {
            if (removeInstallListener) removeInstallListener();
            if (removeLaunchProgressListener) removeLaunchProgressListener();
            if (removeStatusListener) removeStatusListener();
            if (removeServerStatusListener) removeServerStatusListener();
            if (removeThemeListener) removeThemeListener();
            if (removeSettingsListener) removeSettingsListener();
            if (removeWindowStateListener) removeWindowStateListener();
            if (removeCrashReportListener) removeCrashReportListener();
        };
    }, []);

    const handleAcceptAgreement = async () => {
        const newSettings = { ...appSettings, hasAcceptedToS: true };
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
        let startPage = 'dashboard';
        try {
            const settingsRes = await window.electronAPI.getSettings();
            if (settingsRes.success && settingsRes.settings.startPage) {
                startPage = settingsRes.settings.startPage;
            }
        } catch (e) {}

        startTransition(() => {
            setUserProfile(profile);
            Analytics.setProfile(profile);
            setCurrentView(startPage);
            setCurrentMode('launcher');
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
            setCurrentView(lastClientView.current || 'dashboard');
        } else if (mode === 'server') {
            setCurrentView(lastServerView.current || 'server-dashboard');
        } else if (mode === 'client') {
            setCurrentView('open-client');
        }
        setSelectedInstance(null);
        setSelectedServer(null);
    };

    const handleNavigate = (viewId) => {
        startTransition(() => {
            setCurrentView(viewId);
        });
    };

    const isLoginView = !userProfile && !isGuest;
    const isLanguageSelectionOpen = !isInitialLoading && appSettings.hasSelectedLanguage === false;
    const isAgreementModalOpen = !isInitialLoading && appSettings.hasSelectedLanguage === true && appSettings.hasAcceptedToS === false;
    const isCommandPaletteAvailable = !isLoginView && !isLanguageSelectionOpen && !isAgreementModalOpen;
    const canAccessSkins = Boolean(userProfile) && !isGuest;

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
                                {currentMode === 'launcher' && (
                                    <>
                                        {currentView === 'dashboard' && <Home onInstanceClick={handleInstanceClick} runningInstances={runningInstances} isGuest={isGuest} userProfile={userProfile} activeDownloads={activeDownloads} onNavigateSearch={(category) => { setSearchCategory(category); setCurrentView('search'); }} />}
                                        {currentView === 'library' && <Dashboard onInstanceClick={handleInstanceClick} runningInstances={runningInstances} activeDownloads={activeDownloads} triggerCreate={triggerCreateInstance} onCreateHandled={() => setTriggerCreateInstance(false)} isGuest={isGuest} />}
                                        {currentView === 'search' && <Search initialCategory={searchCategory} onCategoryConsumed={() => setSearchCategory(null)} />}
                                        {currentView === 'skins' && !isGuest && <Skins onLogout={handleLogout} onProfileUpdate={setUserProfile} />}
                                        {currentView === 'styling' && <Styling />}
                                        {currentView === 'settings' && <Settings />}
                                        {currentView === 'instance-details' && selectedInstance && (
                                            <InstanceDetails instance={selectedInstance} onBack={handleBackToDashboard} runningInstances={runningInstances} onInstanceUpdate={handleInstanceUpdate} isGuest={isGuest} />
                                        )}
                                        {currentView === 'extensions' && <Extensions />}
                                    </>
                                )}

                                {currentMode === 'server' && (
                                    <>
                                        {currentView === 'server-dashboard' && <ServerDashboard onServerClick={handleServerClick} runningInstances={runningInstances} isGuest={isGuest} />}
                                        {currentView === 'server-details' && selectedServer && (
                                            <ServerDetails
                                                server={selectedServer}
                                                onBack={handleBackToDashboard}
                                                runningInstances={runningInstances}
                                                onServerUpdate={handleServerUpdate}
                                                isGuest={isGuest}
                                            />
                                        )}
                                        {currentView === 'search' && <ServerSearch />}
                                        {currentView === 'styling' && <Styling />}
                                        {currentView === 'server-library' && <ServerLibrary />}
                                        {currentView === 'server-settings' && <ServerSettings />}
                                    </>
                                )}

                                {currentMode === 'client' && isFeatureEnabled('openClientPage') && (
                                    <>
                                        {currentView === 'open-client' && <Client />}
                                        {currentView === 'skins' && !isGuest && <Skins onLogout={handleLogout} onProfileUpdate={setUserProfile} />}
                                        {currentView === 'extensions' && <Extensions />}
                                        {currentView === 'styling' && <Styling />}
                                        {currentView === 'mods' && <ClientMods />}
                                        {currentView === 'settings' && <Settings mode="client" />}
                                    </>
                                )}

                                {currentView === 'news' && <News />}
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
