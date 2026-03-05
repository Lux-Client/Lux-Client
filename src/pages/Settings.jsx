import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import ToggleBox from '../components/ToggleBox';
import ConfirmationModal from '../components/ConfirmationModal';

function Settings() {
    const { t, i18n } = useTranslation();
    const { addNotification } = useNotification();
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
        showQuickSwitchButton: true,
        language: 'en_us',
        cloudBackupSettings: {
            enabled: false,
            provider: 'GOOGLE_DRIVE',
            autoRestore: false
        }
    });

    const [cloudStatus, setCloudStatus] = useState({
        GOOGLE_DRIVE: { loggedIn: false, user: null },
        DROPBOX: { loggedIn: false, user: null },
        ONEDRIVE: { loggedIn: false, user: null }
    });

    const [showSoftResetModal, setShowSoftResetModal] = useState(false);
    const [showFactoryResetModal, setShowFactoryResetModal] = useState(false);
    const [showRestartModal, setShowRestartModal] = useState(false);
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
        setInstances(list || []);
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
            // Map old language codes
            const languageMap = { 'en': 'en_us', 'de': 'de_de' };
            if (languageMap[loadedSettings.language]) {
                loadedSettings.language = languageMap[loadedSettings.language];
            }
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
    const handleManualSave = () => {
        saveSettings(settings, false);
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
                const response = await fetch(`https://api.modrinth.com/v2/project/${input}`);
                if (response.ok) {
                    const data = await response.json();
                    modName = data.title;
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
            const response = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=5`);
            const data = await response.json();
            setAutoInstallModsSearchResults(data.hits || []);
        } catch (err) {
            console.error('Failed to search mods:', err);
            addNotification(t('settings.auto_install.search_failed'), 'error');
            setAutoInstallModsSearchResults([]);
        } finally {
            setSearchingAutoInstallMods(false);
        }
    };

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
        <div className="p-10 text-white h-full overflow-y-auto custom-scrollbar">
            <h1 className="text-3xl font-bold mb-2">{t('settings.title')}</h1>
            <p className="text-gray-400 mb-10">{t('settings.desc')}</p>

            { }
            <div className="w-full mb-6 flex justify-end">
                <button
                    onClick={handleManualSave}
                    className="px-6 py-2 bg-primary hover:bg-primary-hover text-black rounded-lg text-sm font-medium transition flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    <span>{t('settings.save_btn')}</span>
                </button>
            </div>

            <div className="space-y-6 w-full">
                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.general.title')}</h2>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                                <div className="font-medium text-white">{t('settings.general.startup_page')}</div>
                                <div className="text-sm text-gray-500 mt-1">{t('settings.general.startup_page_desc')}</div>
                            </div>
                            <select
                                value={settings.startPage || 'dashboard'}
                                onChange={(e) => handleChange('startPage', e.target.value)}
                                className="bg-background border border-white/10 rounded-xl px-4 pr-10 py-2.5 text-sm focus:border-primary outline-none text-gray-300 cursor-pointer min-w-[180px]"
                            >
                                <option value="dashboard">{t('common.dashboard')}</option>
                                <option value="library">{t('common.library')}</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between pt-6 border-t border-white/5 gap-4 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                                <div className="font-medium text-white">{t('settings.general.language')}</div>
                                <div className="text-sm text-gray-500 mt-1">{t('settings.general.language_desc')}</div>
                            </div>
                            <select
                                value={settings.language || 'en_us'}
                                onChange={(e) => {
                                    const newLang = e.target.value;
                                    handleChange('language', newLang);
                                    i18n.changeLanguage(newLang);
                                }}
                                className="bg-background border border-white/10 rounded-xl px-4 pr-10 py-2.5 text-sm focus:border-primary outline-none text-gray-300 cursor-pointer min-w-[180px]"
                            >
                                <option value="en_us">{t('settings.general.english')}</option>
                                <option value="en_uk">{t('settings.general.english_uk')}</option>
                                <option value="de_de">{t('settings.general.german')}</option>
                                <option value="de_ch">{t('settings.general.swiss_german')}</option>
                                <option value="es_es">{t('settings.general.spanish')}</option>
                                <option value="fr_fr">{t('settings.general.french')}</option>
                                <option value="it_it">{t('settings.general.italian')}</option>
                                <option value="pl_pl">{t('settings.general.polish')}</option>
                                <option value="pt_br">{t('settings.general.portuguese_br')}</option>
                                <option value="pt_pt">{t('settings.general.portuguese_pt')}</option>
                                <option value="ro_ro">{t('settings.general.romanian')}</option>
                                <option value="ru_ru">{t('settings.general.russian')}</option>
                                <option value="sk_sk">{t('settings.general.slovak')}</option>
                                <option value="sl_si">{t('settings.general.slovenian')}</option>
                                <option value="sv_se">{t('settings.general.swedish')}</option>
                            </select>
                        </div>

                        <ToggleBox
                            className="pt-6 border-t border-white/5"
                            checked={settings.showQuickSwitchButton || false}
                            onChange={(val) => handleChange('showQuickSwitchButton', val)}
                            label={t('settings.general.quick_switch_button')}
                            description={t('settings.general.quick_switch_button_desc')}
                        />
                    </div>
                </div>

                { }
                {showJavaModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
                        <div className="bg-[#151515] p-6 rounded-2xl border border-white/10 w-96 shadow-2xl animate-scale-in">
                            <h3 className="text-xl font-bold mb-4">{t('settings.java.install')}</h3>
                            <p className="text-gray-400 mb-6 text-sm">{t('settings.java.install_desc')}</p>

                            <div className="space-y-3">
                                {[8, 17, 21].map(v => (
                                    <button
                                        key={v}
                                        onClick={() => handleInstallJava(v)}
                                        className="w-full p-4 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 transition flex items-center justify-between group"
                                    >
                                        <span className="font-medium">Java {v} (LTS)</span>
                                        <span className="text-primary opacity-0 group-hover:opacity-100 transition">{t('settings.java.install')} &rarr;</span>
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setShowJavaModal(false)}
                                className="mt-6 w-full py-2 text-sm text-gray-400 hover:text-white transition"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                )}

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.java.title')}</h2>

                    <div className="mb-4">
                        <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.java.path')}</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={settings.javaPath || ''}
                                readOnly
                                placeholder={t('settings.java.detecting')}
                                className="flex-1 bg-black/20 border border-white/5 rounded-lg px-4 py-2 text-sm text-gray-300 focus:outline-none focus:border-primary/50"
                            />
                            <button
                                onClick={handleBrowseJava}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition border border-white/5"
                            >
                                {t('settings.java.browse')}
                            </button>
                            <button
                                onClick={() => setShowJavaModal(true)}
                                disabled={isInstallingJava}
                                className={`px-4 py-2 bg-primary hover:bg-primary-hover text-black rounded-lg text-sm font-medium transition flex items-center gap-2 ${isInstallingJava ? 'opacity-50 cursor-wait' : ''}`}
                            >
                                {isInstallingJava ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                        <span>{javaInstallProgress ? `${Math.round(javaInstallProgress.progress)}%` : t('settings.java.installing')}</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        <span>{t('settings.java.install')}</span>
                                    </>
                                )}
                            </button>
                        </div>
                        {isInstallingJava && javaInstallProgress && (
                            <div className="mt-2 text-xs text-primary/80 animate-pulse">
                                {javaInstallProgress.step}
                            </div>
                        )}
                        <p className="text-xs text-gray-500 mt-2 flex items-center gap-2">
                            <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {t('settings.java.recommended')}
                        </p>
                    </div>

                    { }
                    {installedRuntimes.length > 0 && (
                        <div className="mt-6 border-t border-white/5 pt-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-gray-300">{t('settings.java.installed_versions')}</h3>
                                <button
                                    onClick={() => window.electronAPI.openJavaFolder()}
                                    className="text-xs text-primary hover:text-primary-hover transition"
                                >
                                    {t('settings.java.open_folder')}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {installedRuntimes.map((runtime) => (
                                    <div key={runtime.dirPath} className="flex items-center justify-between bg-black/20 p-3 rounded-lg border border-white/5 group hover:border-white/10 transition">
                                        <div className="flex-1 min-w-0 mr-4">
                                            <div className="text-sm font-medium text-gray-200 truncate">{runtime.name}</div>
                                            <div className="text-xs text-gray-500 truncate font-mono mt-0.5">{runtime.path}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {settings.javaPath === runtime.path ? (
                                                <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20">{t('settings.java.active')}</span>
                                            ) : (
                                                <button
                                                    onClick={() => handleChange('javaPath', runtime.path)}
                                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs rounded transition border border-white/5 hover:border-white/10"
                                                >
                                                    {t('settings.java.select')}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDeleteRuntime(runtime.dirPath)}
                                                className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                                                title={t('settings.java.delete_runtime')}
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.memory.title')}</h2>

                    <div className="grid grid-cols-2 gap-8 mb-6">
                        <div>
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.memory.min')}</label>
                            <input
                                type="number"
                                value={settings.minMemory}
                                onChange={(e) => handleChange('minMemory', parseInt(e.target.value) || 0)}
                                className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.memory.max')}</label>
                            <input
                                type="number"
                                value={settings.maxMemory}
                                onChange={(e) => handleChange('maxMemory', parseInt(e.target.value) || 0)}
                                className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none font-mono"
                            />
                        </div>
                    </div>
                    <div>
                        <input
                            type="range"
                            min="512"
                            max="16384"
                            step="512"
                            value={settings.maxMemory}
                            onChange={(e) => handleChange('maxMemory', parseInt(e.target.value))}
                            className="w-full h-1.5 bg-background-dark rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-2 font-mono">
                            <span>512 MB</span>
                            <span className="text-primary font-bold">{Math.floor(settings.maxMemory / 1024 * 10) / 10} GB</span>
                            <span>16 GB</span>
                        </div>
                    </div>
                </div>

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.resolution.title')}</h2>

                    <div className="grid grid-cols-2 gap-8">
                        <div>
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.resolution.width')}</label>
                            <input
                                type="number"
                                value={settings.resolutionWidth}
                                onChange={(e) => handleChange('resolutionWidth', parseInt(e.target.value) || 0)}
                                className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.resolution.height')}</label>
                            <input
                                type="number"
                                value={settings.resolutionHeight}
                                onChange={(e) => handleChange('resolutionHeight', parseInt(e.target.value) || 0)}
                                className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none font-mono"
                            />
                        </div>
                    </div>
                </div>

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.instance.title')}</h2>

                    <ToggleBox
                        checked={settings.copySettingsEnabled || false}
                        onChange={(val) => handleChange('copySettingsEnabled', val)}
                        label={t('settings.instance.copy_settings')}
                        description={t('settings.instance.copy_settings_desc')}
                    />

                    {settings.copySettingsEnabled && (
                        <div>
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.instance.source_instance')}</label>
                            <select
                                value={settings.copySettingsSourceInstance || ''}
                                onChange={(e) => handleChange('copySettingsSourceInstance', e.target.value)}
                                className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none font-mono text-gray-300"
                            >
                                <option value="">Select an instance...</option>
                                {instances.map((inst) => (
                                    <option key={inst.name} value={inst.name}>{inst.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.integration.title')}</h2>

                    <ToggleBox
                        checked={settings.enableDiscordRPC}
                        onChange={(val) => handleChange('enableDiscordRPC', val)}
                        label={t('settings.integration.discord_rpc')}
                        description={t('settings.integration.discord_rpc_desc')}
                    />
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.autoUploadLogs || false}
                        onChange={(val) => handleChange('autoUploadLogs', val)}
                        label={t('settings.integration.auto_logs')}
                        description={t('settings.integration.auto_logs_desc')}
                    />
                    <ToggleBox
                        className="mt-6 pt-6 border-t border-white/5"
                        checked={settings.showDisabledFeatures || false}
                        onChange={(val) => handleChange('showDisabledFeatures', val)}
                        label={t('settings.integration.disabled_features')}
                        description={t('settings.integration.disabled_features_desc')}
                    />
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.focusMode || false}
                        onChange={(val) => handleChange('focusMode', val)}
                        label={t('settings.integration.focus_mode', 'Focus Mode')}
                        description={t('settings.integration.focus_mode_desc', 'Disables resource-intensive UI elements like skin animations.')}
                    />
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.minimizeToTray || false}
                        onChange={(val) => handleChange('minimizeToTray', val)}
                        label={t('settings.integration.minimize_to_tray', 'Minimize to Tray')}
                        description={t('settings.integration.minimize_to_tray_desc', 'Hide the launcher to the system tray when closing or minimizing.')}
                    />
                    {window.electronAPI && window.electronAPI.platform === 'win32' && (
                        <ToggleBox
                            className="mt-4 pt-4 border-t border-white/5"
                            checked={settings.minimalMode || false}
                            onChange={(val) => handleChange('minimalMode', val)}
                            label={t('settings.integration.minimal_mode', 'Minimal Mode')}
                            description={t('settings.integration.minimal_mode_desc', 'Automatically minimize the launcher to the taskbar when a game starts.')}
                        />
                    )}
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.optimization || false}
                        onChange={(val) => handleChange('optimization', val)}
                        label={'Enable Optimization Mods'}
                        description={t('settings.integration.optimization_desc')}
                    />
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.enableAutoInstallMods || false}
                        onChange={(val) => handleChange('enableAutoInstallMods', val)}
                        label={t('settings.integration.auto_mod_install')}
                        description={t('settings.integration.auto_mod_install_desc')}
                    />
                </div>

                { }
                {settings.enableAutoInstallMods && (
                    <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors mt-6">
                        <h2 className="text-lg font-bold mb-6 text-white">{t('settings.auto_install.management_title')}</h2>
                        <p className="text-sm text-gray-400 mb-4">{t('settings.auto_install.management_desc')}</p>

                        <div className="mb-6">
                            <label className="block text-gray-400 text-sm font-medium mb-2">{t('settings.auto_install.add_label')}</label>
                            <div className="flex gap-2 mb-3">
                                <input
                                    type="text"
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
                                    className="flex-1 bg-black/20 border border-white/5 rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-primary/50"
                                    onKeyPress={(e) => e.key === 'Enter' && addAutoInstallMod()}
                                />
                                <button
                                    onClick={addAutoInstallMod}
                                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-black rounded-lg text-sm font-medium transition"
                                >
                                    {t('settings.auto_install.btn_add')}
                                </button>
                            </div>

                            { }
                            {autoInstallModsSearchResults.length > 0 && (
                                <div className="bg-black/20 border border-white/10 rounded-lg overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                                    {autoInstallModsSearchResults.map((mod) => (
                                        <button
                                            key={mod.project_id}
                                            onClick={() => {
                                                setAutoInstallModsInput(mod.project_id);
                                                setAutoInstallModsSearchResults([]);
                                            }}
                                            className="w-full text-left px-4 py-2 hover:bg-white/10 transition border-b border-white/5 last:border-b-0"
                                        >
                                            <div className="font-medium text-sm text-white">{mod.title}</div>
                                            <div className="text-xs text-gray-500 truncate">{mod.project_id}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        { }
                        {(settings.autoInstallMods || []).length > 0 ? (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-gray-400 text-sm font-medium">{t('settings.auto_install.count_label', { count: settings.autoInstallMods.length })}</label>
                                </div>
                                <input
                                    type="text"
                                    value={autoInstallModsListSearch}
                                    onChange={(e) => setAutoInstallModsListSearch(e.target.value)}
                                    placeholder={t('settings.auto_install.list_search_placeholder')}
                                    className="w-full mb-3 bg-black/20 border border-white/5 rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-primary/50"
                                />
                                <div className="space-y-2">
                                    {(settings.autoInstallMods || []).filter((mod) => {
                                        const modName = autoInstallModsMetadata[mod] || mod;
                                        const searchQuery = autoInstallModsListSearch.toLowerCase();
                                        return modName.toLowerCase().includes(searchQuery) || mod.toLowerCase().includes(searchQuery);
                                    }).map((mod) => (
                                        <div key={mod} className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-4 py-3">
                                            <div>
                                                <div className="text-sm text-white font-medium">{autoInstallModsMetadata[mod] || mod}</div>
                                                <code className="text-xs text-gray-500 font-mono">{mod}</code>
                                            </div>
                                            <button
                                                onClick={() => removeAutoInstallMod(mod)}
                                                className="px-3 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/20 transition"
                                            >
                                                {t('settings.auto_install.remove_btn')}
                                            </button>
                                        </div>
                                    ))}
                                    {autoInstallModsListSearch && (settings.autoInstallMods || []).filter((mod) => {
                                        const modName = autoInstallModsMetadata[mod] || mod;
                                        const searchQuery = autoInstallModsListSearch.toLowerCase();
                                        return modName.toLowerCase().includes(searchQuery) || mod.toLowerCase().includes(searchQuery);
                                    }).length === 0 && (
                                            <div className="text-center py-4 text-gray-500 text-sm">{t('settings.auto_install.no_matches')}</div>
                                        )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-6 bg-black/20 border border-white/5 rounded-lg">
                                <p className="text-gray-500 text-sm">{t('settings.auto_install.no_mods')}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Compatibility Section */}
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white">{t('settings.compatibility.title', 'Compatibility')}</h2>

                    <ToggleBox
                        checked={settings.lowGraphicsMode || false}
                        onChange={(val) => handleChange('lowGraphicsMode', val)}
                        label={t('settings.compatibility.low_graphics', 'Low Graphics Mode')}
                        description={t('settings.compatibility.low_graphics_desc', 'Disables resource-intensive 3D previews (e.g. skin preview) to improve performance on older hardware.')}
                    />
                    <ToggleBox
                        className="mt-4 pt-4 border-t border-white/5"
                        checked={settings.legacyGpuSupport || false}
                        onChange={(val) => handleChange('legacyGpuSupport', val)}
                        label={t('settings.compatibility.legacy_gpu', 'Legacy GPU Support')}
                        description={t('settings.compatibility.legacy_gpu_desc', 'Disables hardware acceleration and uses basic OpenGL. Enable this if you experience crashes or black screens. (Requires App Restart)')}
                    />
                </div>

                { }
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white flex items-center gap-2">
                        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                        {t('settings.cloud.title')}
                    </h2>

                    <p className="text-sm text-gray-400 mb-6">{t('settings.cloud.desc')}</p>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { id: 'GOOGLE_DRIVE', name: 'Google Drive', icon: 'assets/cloud-backup/drive.svg' },
                                { id: 'DROPBOX', name: 'Dropbox', icon: 'assets/cloud-backup/dropbox.svg' }
                            ].map((provider) => (
                                <div key={provider.id} className={`p-4 rounded-xl border transition-all ${cloudStatus[provider.id]?.loggedIn ? 'bg-primary/5 border-primary/20' : 'bg-black/20 border-white/5 hover:border-white/10'}`}>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                                                <img src={provider.icon} alt="" className="w-5 h-5" />
                                            </div>
                                            <span className="font-bold text-sm">{provider.name}</span>
                                        </div>
                                        {cloudStatus[provider.id]?.loggedIn && (
                                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                        )}
                                    </div>

                                    {cloudStatus[provider.id]?.loggedIn ? (
                                        <div className="space-y-3">
                                            <div className="text-xs text-gray-400">
                                                <div className="font-medium text-white truncate">{cloudStatus[provider.id].user?.name}</div>
                                                <div className="truncate">{cloudStatus[provider.id].user?.email}</div>
                                            </div>
                                            <button
                                                onClick={() => handleCloudLogout(provider.id)}
                                                className="w-full py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded border border-red-500/10 transition"
                                            >
                                                {t('settings.cloud.logout')}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => handleCloudLogin(provider.id)}
                                            className="w-full py-2 text-xs bg-primary hover:bg-primary-hover text-black rounded font-medium transition"
                                        >
                                            {t('settings.cloud.login_btn')}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        { }
                        <div className="pt-6 border-t border-white/5 space-y-4">
                            <ToggleBox
                                checked={settings.cloudBackupSettings?.enabled || false}
                                onChange={(val) => handleChange('cloudBackupSettings', { ...settings.cloudBackupSettings, enabled: val })}
                                label={t('settings.cloud.enable_backup')}
                                description={t('settings.cloud.enable_backup_desc')}
                            />

                            {settings.cloudBackupSettings?.enabled && (
                                <div className="ml-10 space-y-4 animate-slide-down">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-sm font-medium text-white">{t('settings.cloud.default_provider')}</div>
                                            <div className="text-xs text-gray-500">{t('settings.cloud.default_provider_desc')}</div>
                                        </div>
                                        <select
                                            value={settings.cloudBackupSettings?.provider || 'GOOGLE_DRIVE'}
                                            onChange={(e) => handleChange('cloudBackupSettings', { ...settings.cloudBackupSettings, provider: e.target.value })}
                                            className="bg-background border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-primary outline-none text-gray-300 cursor-pointer"
                                        >
                                            <option value="GOOGLE_DRIVE">Google Drive</option>
                                            <option value="DROPBOX">Dropbox</option>
                                        </select>
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
                    </div>
                </div>

                {/* Update Section */}
                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <h2 className="text-lg font-bold mb-6 text-white flex items-center gap-2">
                        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {t('settings.update.title', 'Software Update')}
                    </h2>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-white">{t('settings.update.current_version', 'Current Version')}</div>
                                <div className="text-sm text-gray-500 mt-1">{updateInfo?.currentVersion || '...'}</div>
                            </div>
                            <button
                                onClick={handleCheckUpdate}
                                disabled={isCheckingUpdate}
                                className="px-6 py-2 bg-primary hover:bg-primary-hover text-black rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50"
                            >
                                {isCheckingUpdate ? (
                                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                )}
                                <span>{isCheckingUpdate ? t('settings.update.checking', 'Checking...') : t('settings.update.check_btn', 'Check for Updates')}</span>
                            </button>
                        </div>

                        {updateInfo && updateInfo.needsUpdate && (
                            <div className="p-6 bg-primary/5 border border-primary/20 rounded-xl animate-scale-in">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="font-bold text-white mb-1">{t('settings.update.available', 'Update Available!')}</h3>
                                        <p className="text-sm text-primary font-bold">Version {updateInfo.latestVersion}</p>
                                    </div>
                                    {!downloadedFilePath && !isDownloadingUpdate && (
                                        <button
                                            onClick={handleDownloadUpdate}
                                            className="px-6 py-2 bg-primary hover:bg-primary-hover text-black rounded-lg text-sm font-bold transition flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                            </svg>
                                            {t('settings.update.download_btn', 'Download')}
                                        </button>
                                    )}
                                    {downloadedFilePath && (
                                        <button
                                            onClick={handleInstallUpdate}
                                            className="px-6 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-bold transition flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            {t('settings.update.install_btn', 'Install & Restart')}
                                        </button>
                                    )}
                                </div>

                                {isDownloadingUpdate && (
                                    <div className="mt-4">
                                        <div className="flex justify-between text-xs text-gray-400 mb-2">
                                            <span>{t('settings.update.downloading', 'Downloading...')}</span>
                                            <span>{Math.round(downloadProgress)}%</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary transition-all duration-300"
                                                style={{ width: `${downloadProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {updateInfo.releaseNotes && (
                                    <div className="mt-4 pt-4 border-t border-white/5">
                                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{t('settings.update.changelog', 'Release Notes')}</h4>
                                        <div className="text-sm text-gray-300 max-h-40 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                                            {updateInfo.releaseNotes}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </div>

                <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <ToggleBox
                        checked={showAdvancedSettings}
                        onChange={setShowAdvancedSettings}
                        label={t('settings.advanced_settings', 'Advanced Settings')}
                    />
                </div>

                {showAdvancedSettings && (
                    <>
                        {!window.electronAPI.isPackaged && (
                            <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                                <h3 className="text-xs font-black text-yellow-500 uppercase tracking-widest mb-4">Development Testing</h3>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={testVersion}
                                        onChange={(e) => setTestVersion(e.target.value)}
                                        placeholder="e.g. 1.0.0"
                                        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50"
                                    />
                                    <button
                                        onClick={handleSetTestVersion}
                                        className="px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg text-xs font-bold border border-yellow-500/20 transition"
                                    >
                                        Set Test Version
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-2">Overrides local version string for update check simulation.</p>
                            </div>
                        )}

                        <div className="bg-surface/50 p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                            <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                {t('settings.maintenance.title')}
                            </h2>

                            <div className="space-y-6">
                                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <svg className="w-5 h-5 text-primary mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <div>
                                            <h3 className="font-bold text-gray-200 text-sm">{t('settings.maintenance.troubleshooting_title')}</h3>
                                            <p className="text-xs text-gray-400 mt-1">{t('settings.maintenance.troubleshooting_desc')}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white/5 rounded-xl p-4 border border-white/5 flex flex-col justify-between h-auto min-h-[140px]">
                                        <div>
                                            <h3 className="font-bold text-white text-sm">{t('settings.maintenance.soft_reset_title')}</h3>
                                            <p className="text-xs text-gray-500 mt-2">
                                                {t('settings.maintenance.soft_reset_desc')}
                                                <span className="block mt-1 text-primary font-bold">✓ {t('settings.maintenance.soft_reset_keep')}</span>
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setShowSoftResetModal(true)}
                                            className="mt-4 w-full bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm font-bold transition-colors"
                                        >
                                            {t('settings.maintenance.soft_reset_btn')}
                                        </button>
                                    </div>

                                    <div className="bg-red-500/5 rounded-xl p-4 border border-red-500/20 flex flex-col justify-between h-auto min-h-[140px]">
                                        <div>
                                            <h3 className="font-bold text-red-400 text-sm">{t('settings.maintenance.factory_reset_title')}</h3>
                                            <p className="text-xs text-gray-500 mt-2">
                                                {t('settings.maintenance.factory_reset_desc')}
                                                <span className="block mt-1 text-red-400 font-bold">⚠ {t('settings.maintenance.factory_reset_warning')}</span>
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setShowFactoryResetModal(true)}
                                            className="mt-4 w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 py-2 rounded-lg text-sm font-bold transition-colors border border-red-500/20"
                                        >
                                            {t('settings.maintenance.factory_reset_btn')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

            </div>

            { }
            {
                showSoftResetModal && (
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

            { }
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
        </div>
    );
}

export default Settings;
