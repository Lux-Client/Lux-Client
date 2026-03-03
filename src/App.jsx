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
const Extensions = React.lazy(() => import('./pages/Extensions'));
const Login = React.lazy(() => import('./pages/Login'));

import Sidebar from './components/Sidebar';
import ServerSidebar from './components/ServerSidebar';
import UpdateNotification from './components/UpdateNotification';
import RightPanel from './components/RightPanel';
import AnnouncementBar from './components/AnnouncementBar';
import AgreementModal from './components/AgreementModal';
import LanguageSelectionModal from './components/LanguageSelectionModal';
import LoadingOverlay from './components/LoadingOverlay';
import { syncCustomFonts } from './services/fontManager';
import { useTranslation } from 'react-i18next';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true };
    }
    componentDidCatch(error, errorInfo) {
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
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#111] text-white p-8 text-center">
            <h1 className="text-4xl font-black mb-4 text-red-500">{t('common.error_title')}</h1>
            <p className="text-gray-400 mb-8 max-w-md">{t('common.error_desc')}</p>
            <button
                onClick={() => window.location.reload()}
                className="bg-primary text-black px-8 py-3 rounded-xl font-bold hover:scale-105 transition-transform"
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
    const [currentMode, setCurrentMode] = useState('client');
    const [userProfile, setUserProfile] = useState(null);
    const [isGuest, setIsGuest] = useState(false);
    const [theme, setTheme] = useState({
        primaryColor: '#1bd96a',
        backgroundColor: '#111111',
        surfaceColor: '#1c1c1c',
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

    const [showDownloads, setShowDownloads] = useState(false);
    const [showSessions, setShowSessions] = useState(false);
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [searchCategory, setSearchCategory] = useState(null);
    const [triggerCreateInstance, setTriggerCreateInstance] = useState(false);
    const [appSettings, setAppSettings] = useState({});
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
    const [isInitialLoading, setIsInitialLoading] = useState(true);

    const downloadsRef = useRef(null);
    const sessionsRef = useRef(null);
    const modeMenuRef = useRef(null);
    const logoRef = useRef(null);
    const lastClientView = useRef('dashboard');
    const lastServerView = useRef('server-dashboard');

    useEffect(() => {
        if (currentMode === 'client') lastClientView.current = currentView;
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
            } catch (e) { }

            if (window.electronAPI?.validateSession) {
                const res = await window.electronAPI.validateSession();
                if (res.success) {
                    const profile = await window.electronAPI.getProfile();
                    if (profile) {
                        try {
                            // Try to prefetch skin URL with a small retry
                            let skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                            if (!skinRes.success) {
                                // Small delay then retry once
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
                if (res.settings.theme) {
                    const t = res.settings.theme;
                    setTheme(t);
                    applyTheme(t);
                }
            }
        };

        const init = async () => {
            await Promise.all([checkSession(), loadTheme()]);
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

            if (status === 'stopped' || status === 'error' || status === 'ready' || status === 'deleted' || status === 'running' || status === 'starting' || status === 'stopping') {
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

        const handleClickOutside = (event) => {
            if (downloadsRef.current && !downloadsRef.current.contains(event.target)) {
                setShowDownloads(false);
            }
            if (sessionsRef.current && !sessionsRef.current.contains(event.target)) {
                setShowSessions(false);
            }
            if (modeMenuRef.current && !modeMenuRef.current.contains(event.target) &&
                logoRef.current && !logoRef.current.contains(event.target)) {
                setShowModeMenu(false);
            }
        };

        const removeLaunchProgressListener = window.electronAPI?.onLaunchProgress((e) => {
        });

        const removeWindowStateListener = window.electronAPI?.onWindowStateChange((maximized) => {
            setIsMaximized(maximized);
        });

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            if (removeInstallListener) removeInstallListener();
            if (removeLaunchProgressListener) removeLaunchProgressListener();
            if (removeStatusListener) removeStatusListener();
            if (removeServerStatusListener) removeServerStatusListener();
            if (removeThemeListener) removeThemeListener();
            if (removeSettingsListener) removeSettingsListener();
            if (removeWindowStateListener) removeWindowStateListener();
            document.removeEventListener('mousedown', handleClickOutside);
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
        syncCustomFonts(t.customFonts ?? []);
        root.style.setProperty('--primary-color', t.primaryColor);
        root.style.setProperty('--background-color', t.backgroundColor);
        root.style.setProperty('--surface-color', t.surfaceColor);
        root.style.setProperty('--glass-blur', `${t.glassBlur}px`);
        root.style.setProperty('--glass-opacity', t.glassOpacity);
        root.style.setProperty('--console-opacity', t.consoleOpacity ?? 0.8);
        root.style.setProperty('--border-radius', `${t.borderRadius ?? 12}px`);
        root.style.setProperty('--sidebar-glow-intensity', t.sidebarGlow ?? 0);
        root.style.setProperty('--global-glow-intensity', t.globalGlow ?? 0);
        root.style.setProperty('--panel-opacity', t.panelOpacity ?? 0.85);
        root.style.setProperty('--bg-overlay-opacity', t.bgOverlay ?? 0.4);
        root.style.setProperty('--launcher-font', `'${t.fontFamily ?? 'Poppins'}'`);

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
    };

    const handleLoginSuccess = async (profile) => {
        if (profile && profile.access_token && window.electronAPI.getCurrentSkin) {
            try {
                // Try to prefetch skin URL with a small retry
                let skinRes = await window.electronAPI.getCurrentSkin(profile.access_token);
                if (!skinRes.success) {
                    // Small delay then retry once
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
        } catch (e) { }

        startTransition(() => {
            setUserProfile(profile);
            Analytics.setProfile(profile);
            setCurrentView(startPage);
            setCurrentMode('client');
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
            setCurrentView(currentMode === 'client' ? 'dashboard' : 'server-dashboard');
        });
    };

    const handleModeSelect = (mode) => {
        setCurrentMode(mode);
        if (mode === 'client') {
            setCurrentView(lastClientView.current || 'dashboard');
        } else if (mode === 'server') {
            setCurrentView(lastServerView.current || 'server-dashboard');
        }
        setSelectedInstance(null);
        setSelectedServer(null);
        setShowModeMenu(false);
    };

    const toggleModeMenu = () => {
        setShowModeMenu(!showModeMenu);
    };

    const activeDownloadCount = Object.keys(activeDownloads).length;
    const runningCount = Object.keys(runningInstances).filter(k => runningInstances[k] === 'running').length;
    const isAnyActive = activeDownloadCount > 0;

    return (
        <ExtensionProvider>
            {!userProfile && !isGuest ? (
                <React.Suspense fallback={
                    <div className="h-screen w-screen flex items-center justify-center bg-background">
                        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                }>
                    <Login onLoginSuccess={handleLoginSuccess} onGuestMode={handleGuestMode} />
                </React.Suspense>
            ) : (
                <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-white font-sans selection:bg-primary selection:text-black relative">

                    { }
                    {theme?.bgMedia?.url && theme.bgMedia.url.trim() !== '' && (
                        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                            {theme.bgMedia.type === 'video' ? (
                                <video
                                    key={theme.bgMedia.url}
                                    autoPlay muted loop playsInline
                                    preload="auto"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{ transform: 'translateZ(0)' }} // HW acceleration hint
                                    onCanPlay={(e) => e.target.classList.add('opacity-100')}
                                    onError={(e) => {
                                        console.error("Background video decoding error:", e);
                                        // Fallback to static background or color if video fails
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

                    { }
                    <div
                        className="h-16 w-full titlebar z-[60] flex justify-between items-center pl-6 pr-6 bg-surface/30 border-b border-white/5 flex-none relative"
                        style={{ backdropFilter: `blur(${theme.glassBlur}px)` }}
                    >
                        <div className="flex items-center gap-2 drag no-drag">
                            <div className="relative" ref={logoRef}>
                                <div
                                    onClick={toggleModeMenu}
                                    className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center text-primary font-bold text-2xl hover:bg-primary/30 transition-colors cursor-pointer pointer-events-auto shadow-lg border border-primary/20"
                                >
                                    M
                                </div>

                                {showModeMenu && (
                                    <div
                                        ref={modeMenuRef}
                                        className="absolute top-14 left-0 w-48 bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-2 animate-in fade-in slide-in-from-top-2 duration-100 z-[100]"
                                    >
                                        <button
                                            onClick={() => handleModeSelect('client')}
                                            className={`w-full px-4 py-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3 ${currentMode === 'client' ? 'bg-primary/10 text-primary' : 'text-gray-200'}`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                            </svg>
                                            <span className="font-medium">{t('common.client')}</span>
                                            {currentMode === 'client' && (
                                                <svg className="h-4 w-4 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => handleModeSelect('server')}
                                            className={`w-full px-4 py-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3 ${currentMode === 'server' ? 'bg-primary/10 text-primary' : 'text-gray-200'}`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                                            </svg>
                                            <span className="font-medium">{t('common.server')}</span>
                                            {currentMode === 'server' && (
                                                <svg className="h-4 w-4 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                        { }
                                    </div>
                                )}
                            </div>

                            {appSettings.showQuickSwitchButton !== false && (
                                <button
                                    onClick={() => handleModeSelect(currentMode === 'client' ? 'server' : 'client')}
                                    className="px-3 py-1.5 bg-black/20 hover:bg-black/40 rounded-xl text-sm font-semibold text-gray-300 hover:text-white transition-colors border border-white/5 whitespace-nowrap hidden sm:flex items-center gap-2 ml-2 pointer-events-auto shadow-lg"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                    </svg>
                                    {currentMode === 'client' ? t('common.switch_to_server', 'Switch to Server') : t('common.switch_to_client', 'Switch to Client')}
                                </button>
                            )}
                        </div>

                        { }
                        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto">
                            <AnnouncementBar />
                            <ExtensionSlot name="header.center" className="flex items-center gap-2" />
                        </div>

                        <div className="flex items-center gap-4 no-drag h-full">
                            { }
                            <ExtensionSlot name="header.right" className="flex items-center gap-2 mr-2" />

                            { }
                            <div className="relative h-full flex items-center" ref={sessionsRef}>
                                <button
                                    onClick={() => setShowSessions(!showSessions)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-white/20 hover:bg-[#252525] rounded-full transition-all group shadow-lg"
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full ${runningCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                                    <span className="text-[10px] font-bold text-gray-100">
                                        {runningCount === 0 ? t('common.idle') : `${runningCount} ${t('common.running')}`}
                                    </span>
                                </button>

                                {showSessions && (
                                    <div className="absolute top-14 right-0 w-64 bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-2 animate-in fade-in zoom-in duration-100 z-[100]">
                                        {Object.keys(runningInstances).length === 0 ? (
                                            <div className="px-4 py-2 text-xs text-gray-400 italic">No active sessions</div>
                                        ) : (
                                            Object.entries(runningInstances).map(([name, status]) => (
                                                <div key={name} className="flex items-center justify-between px-4 py-2 hover:bg-white/5 group">
                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                        <div className={`shrink-0 w-2 h-2 rounded-full ${status === 'running' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                                                        <span className="text-sm font-medium truncate text-gray-200">{name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => window.electronAPI.killGame(name)}
                                                            className="p-1 hover:bg-red-500/20 text-red-500 rounded transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="6" y="6" width="12" height="12" strokeWidth={2} /></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>

                            { }
                            <div className="relative h-full flex items-center" ref={downloadsRef}>
                                <button
                                    onClick={() => setShowDownloads(!showDownloads)}
                                    className={`p-1.5 rounded-lg transition-all relative ${isAnyActive ? 'text-primary bg-[#1a1a1a] border border-primary/50' : 'text-gray-200 hover:text-white bg-[#1a1a1a] border border-white/20'}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isAnyActive ? 'animate-bounce' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    {isAnyActive && (
                                        <span className="absolute top-1 right-1 w-2 h-2 bg-primary border border-background rounded-full"></span>
                                    )}
                                </button>

                                {showDownloads && (
                                    <div className="absolute top-14 right-0 w-64 bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-3 animate-in fade-in slide-in-from-top-2 duration-100 z-[100]">
                                        <div className="px-4 pb-2 border-b border-white/5 mb-2">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('common.downloads')}</span>
                                        </div>
                                        <div className="max-h-60 overflow-y-auto px-4 space-y-3">
                                            {Object.keys(activeDownloads).length === 0 ? (
                                                <div className="py-2 text-center text-xs text-gray-500">No active tasks</div>
                                            ) : (
                                                Object.entries(activeDownloads).map(([name, data]) => (
                                                    <div key={name} className="space-y-1">
                                                        <div className="flex justify-between items-center overflow-hidden">
                                                            <span className="text-xs font-bold text-white truncate pr-2">{name}</span>
                                                            <span className="text-[10px] font-mono text-primary">{data.progress}%</span>
                                                        </div>
                                                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                                            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${data.progress}%` }}></div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            { }
                            <div className="flex gap-1 border-l border-white/5 pl-4">
                                <button onClick={() => window.electronAPI.minimize()} className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                                </button>
                                <button onClick={() => window.electronAPI.maximize()} className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors">
                                    {isMaximized ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3.75v4.5m0 0H4.5m4.5 0L3.75 3.75M9 20.25v-4.5m0 0H4.5m4.5 0L3.75 20.25M15 3.75v4.5m0 0h4.5m-4.5 0l5.25-5.25M15 20.25v-4.5m0 0h4.5m-4.5 0l5.25 5.25" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                                        </svg>
                                    )}
                                </button>
                                <button onClick={() => window.electronAPI.close()} className="p-1.5 hover:bg-red-500 rounded text-gray-400 hover:text-white transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-1 overflow-hidden">
                        { }
                        {currentMode === 'client' ? (
                            <Sidebar
                                currentView={currentView}
                                setView={setCurrentView}
                                onLogout={handleLogout}
                                onInstanceClick={handleInstanceClick}
                                onCreateInstance={() => { setCurrentView('library'); setTriggerCreateInstance(true); }}
                                isGuest={isGuest}
                                isCollapsed={isSidebarCollapsed}
                                setIsCollapsed={setIsSidebarCollapsed}
                            />
                        ) : (
                            <ServerSidebar
                                currentView={currentView}
                                setView={setCurrentView}
                                onLogout={handleLogout}
                                isCollapsed={isSidebarCollapsed}
                                setIsCollapsed={setIsSidebarCollapsed}
                            />
                        )}

                        <main className={`flex-1 my-4 ${isSidebarCollapsed ? 'ml-4' : 'ml-2'} mr-2 bg-surface/10 relative overflow-hidden flex flex-col rounded-2xl border border-white/5 shadow-2xl transition-all duration-300`}
                            style={{ backdropFilter: `blur(${theme.glassBlur}px)` }}
                        >

                            <div className="flex-1 overflow-hidden bg-surface/20 rounded-2xl relative flex flex-col">
                                { }
                                {isPending && (
                                    <div className="absolute top-0 left-0 w-full h-1 z-[100] overflow-hidden bg-white/5">
                                        <div className="h-full bg-primary/50 animate-progress-fast"></div>
                                    </div>
                                )}

                                <React.Suspense fallback={
                                    <div className="flex-1 flex items-center justify-center bg-background/50 animate-pulse">
                                        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                    </div>
                                }>
                                    {currentMode === 'client' && (
                                        <>
                                            {currentView === 'dashboard' && <Home onInstanceClick={handleInstanceClick} runningInstances={runningInstances} isGuest={isGuest} onNavigateSearch={(category) => { setSearchCategory(category); setCurrentView('search'); }} />}
                                            {currentView === 'library' && <Dashboard onInstanceClick={handleInstanceClick} runningInstances={runningInstances} triggerCreate={triggerCreateInstance} onCreateHandled={() => setTriggerCreateInstance(false)} isGuest={isGuest} />}
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

                                    { }
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

                                    { }
                                    { }
                                </React.Suspense>
                            </div>
                        </main>

                        <div
                            className="my-4 ml-2 mr-4 bg-surface/10 z-10 flex flex-col rounded-2xl border border-white/5 shadow-2xl"
                            style={{ backdropFilter: `blur(${theme.glassBlur}px)` }}
                        >
                            <div className="flex-1 overflow-hidden">
                                <RightPanel userProfile={userProfile} onProfileUpdate={setUserProfile} />
                            </div>
                        </div>
                    </div>
                    <UpdateNotification />
                </div>
            )}

            { }
            <ExtensionSlot name="app.overlay" className="absolute inset-0 pointer-events-none z-[9999] *:pointer-events-auto" />
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
