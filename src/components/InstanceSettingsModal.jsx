import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import ReinstallModal from './ReinstallModal';
import ConfirmationModal from './ConfirmationModal';
import Dropdown from './Dropdown';
import ToggleBox from './ToggleBox';

function InstanceSettingsModal({ instance, onClose, onSave, onDelete }) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [activeTab, setActiveTab] = useState('general');
    const [config, setConfig] = useState({ ...instance });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showReinstall, setShowReinstall] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [availableVersions, setAvailableVersions] = useState([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [showSnapshots, setShowSnapshots] = useState(false);

    React.useEffect(() => {
        const updateVersions = async () => {
            setLoadingVersions(true);
            try {
                if ((config.loader || 'Vanilla') === 'Vanilla') {
                    const res = await window.electronAPI.getVanillaVersions();
                    if (res.success) {
                        const versions = res.versions.filter(v => showSnapshots ? true : v.type === 'release');
                        setAvailableVersions(versions);
                    }
                } else {
                    const res = await window.electronAPI.getSupportedGameVersions(config.loader);
                    if (res.success) {
                        let versions = res.versions;
                        if (!showSnapshots) {
                            versions = versions.filter(v => /^\d+\.\d+(\.\d+)?$/.test(v));
                        }
                        const versionObjs = versions.map(v => ({ id: v, type: 'release' }));
                        setAvailableVersions(versionObjs);
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingVersions(false);
            }
        };

        updateVersions();
    }, [config.loader, showSnapshots]);

    const handleSave = async () => {
        setLoading(true);
        setError(null);
        try {

            if (config.icon !== instance.icon) {
                await window.electronAPI.updateInstanceConfig(instance.name, { icon: config.icon });
            }
            if (config.name !== instance.name) {
                const renameResult = await window.electronAPI.renameInstance(instance.name, config.name);
                if (!renameResult.success) {
                    setError("Failed to rename: " + renameResult.error);
                    addNotification(`Failed to rename: ${renameResult.error}`, 'error');
                    setLoading(false);
                    return;
                }
            }

            await window.electronAPI.updateInstance(config.name, config);
            addNotification(t('settings.saved_success'), 'success');
            onSave(config);
            onClose();
        } catch (e) {
            setError("Failed to save: " + e.message);
            addNotification(`Failed to save: ${e.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleMigrate = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await window.electronAPI.migrateInstance(instance.name, {
                version: config.version,
                loader: config.loader
            });
            if (res.success) {
                addNotification('Migration started in background', 'success');
                onClose();
            } else {
                setError("Migration failed: " + res.error);
                setLoading(false);
            }
        } catch (e) {
            setError("Migration error: " + e.message);
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        setLoading(true);
        try {
            await window.electronAPI.deleteInstance(instance.name);
            addNotification(t('skins.delete_success'), 'success');
            onClose();
            if (onDelete) onDelete(instance.name);
        } catch (e) {
            setError("Failed to delete: " + e.message);
            setLoading(false);
        }
    };

    const handleReinstall = async (type) => {
        setShowReinstall(false);
        setLoading(true);
        try {
            const res = await window.electronAPI.reinstallInstance(instance.name, type);
            if (res.success) {
                addNotification('Reinstall started', 'success');
                onClose();
            } else {
                setError("Reinstall failed: " + res.error);
                setLoading(false);
            }
        } catch (e) {
            setError("Reinstall error: " + e.message);
            setLoading(false);
        }
    };

    const handleChange = (field, value) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 backdrop-blur-sm">
                <div className="bg-[#151515] w-full max-w-4xl h-[600px] rounded-2xl border border-white/10 flex overflow-hidden shadow-2xl">

                    { }
                    <div className="w-64 bg-[#111] border-r border-white/5 p-4 flex flex-col gap-2">
                        <div className="text-xl font-bold mb-4 px-2 truncate" title={instance.name}>{instance.name}</div>

                        <SettingsTab label={t('instance_settings.tabs.general')} id="general" active={activeTab} onClick={setActiveTab} icon="info" />
                        <SettingsTab label={t('instance_settings.tabs.installation')} id="installation" active={activeTab} onClick={setActiveTab} icon="build" />
                        <SettingsTab label={t('instance_settings.tabs.window')} id="window" active={activeTab} onClick={setActiveTab} icon="desktop_windows" />
                        <SettingsTab label={t('instance_settings.tabs.java')} id="java" active={activeTab} onClick={setActiveTab} icon="memory" />
                        <SettingsTab label={t('instance_settings.tabs.hooks')} id="hooks" active={activeTab} onClick={setActiveTab} icon="code" />

                        <div className="my-2 border-t border-white/5"></div>
                        <SettingsTab label={t('instance_settings.tabs.danger')} id="danger" active={activeTab} onClick={setActiveTab} icon="warning" isDanger />

                        <div className="mt-auto">
                            <button onClick={onClose} className="w-full text-left px-4 py-2 rounded hover:bg-white/5 text-gray-400">{t('common.cancel')}</button>
                        </div>
                    </div>

                    { }
                    <div className="flex-1 p-8 overflow-y-auto bg-background">
                        <div className="max-w-2xl">
                            <h2 className={`text-2xl font-bold mb-6 ${activeTab === 'danger' ? 'text-red-500' : ''}`}>
                                {activeTab === 'general' && t('instance_settings.general.title')}
                                {activeTab === 'installation' && t('instance_settings.installation.title')}
                                {activeTab === 'window' && t('instance_settings.window.title')}
                                {activeTab === 'java' && t('instance_settings.java.title')}
                                {activeTab === 'hooks' && t('instance_settings.hooks.title')}
                                {activeTab === 'danger' && t('instance_settings.danger.title')}
                            </h2>

                            {error && (
                                <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                                    ❌ {error}
                                </div>
                            )}

                            {activeTab === 'general' && (
                                <div className="space-y-6">
                                    <div className="flex flex-col items-center gap-4 mb-8">
                                        <div
                                            className="w-24 h-24 bg-surface rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center overflow-hidden relative group cursor-pointer hover:border-primary/50 transition-colors shadow-inner"
                                            onClick={() => document.getElementById('instance-icon-upload').click()}
                                        >
                                            {config.icon && (config.icon.startsWith('data:') || config.icon.startsWith('app-media://')) ? (
                                                <img src={config.icon} alt="Icon" className="w-full h-full object-cover" />
                                            ) : (
                                                <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                            )}
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                            </div>
                                            <input
                                                id="instance-icon-upload"
                                                type="file"
                                                onChange={(e) => {
                                                    const file = e.target.files[0];
                                                    if (file) {
                                                        const reader = new FileReader();
                                                        reader.onloadend = () => {
                                                            handleChange('icon', reader.result);
                                                        };
                                                        reader.readAsDataURL(file);
                                                    }
                                                }}
                                                accept="image/*"
                                                className="hidden"
                                            />
                                        </div>
                                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('instance_settings.general.icon_label')}</span>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.general.name_label')}</label>
                                        <input
                                            type="text"
                                            value={config.name || ''}
                                            onChange={(e) => handleChange('name', e.target.value)}
                                            className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors"
                                        />
                                        <p className="text-xs text-gray-500">{t('instance_settings.general.rename_note')}</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'installation' && (
                                <div className="space-y-6">
                                    <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-primary text-sm flex items-start gap-3">
                                        <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <div className="space-y-1">
                                            <p className="font-bold">{t('instance_settings.installation.migration_title')}</p>
                                            <p className="text-xs opacity-80">{t('instance_settings.installation.migration_desc')}</p>
                                        </div>
                                    </div>

                                    <div className="pb-4 border-b border-white/5">
                                        <ToggleBox
                                            checked={showSnapshots}
                                            onChange={setShowSnapshots}
                                            label={t('instance_settings.installation.show_snapshots')}
                                            description={t('instance_settings.installation.show_snapshots_desc')}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold text-gray-400 uppercase tracking-wider">{t('instance_settings.installation.game_version')}</label>
                                            {loadingVersions ? (
                                                <div className="p-3 text-gray-500 bg-surface/50 border border-white/10 rounded">{t('common.loading')}</div>
                                            ) : (
                                                <Dropdown
                                                    options={availableVersions.map(v => ({ value: v.id, label: v.id }))}
                                                    value={config.version}
                                                    onChange={(v) => handleChange('version', v)}
                                                />
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold text-gray-400 uppercase tracking-wider">{t('instance_settings.installation.mod_loader')}</label>
                                            <Dropdown
                                                options={[
                                                    { value: 'Vanilla', label: 'Vanilla' },
                                                    { value: 'Fabric', label: 'Fabric' },
                                                    { value: 'Forge', label: 'Forge' },
                                                    { value: 'NeoForge', label: 'NeoForge' },
                                                    { value: 'Quilt', label: 'Quilt' }
                                                ]}
                                                value={config.loader || 'Vanilla'}
                                                onChange={(l) => handleChange('loader', l)}
                                            />
                                        </div>
                                    </div>

                                    {(config.version !== instance.version || config.loader !== instance.loader) && (
                                        <div className="pt-4 border-t border-white/5">
                                            <button
                                                onClick={handleMigrate}
                                                disabled={loading}
                                                className="w-full bg-primary hover:bg-primary-hover text-black font-bold py-3 rounded-lg shadow-primary-glow flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02]"
                                            >
                                                {loading ? <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div> : (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                )}
                                                {t('instance_settings.installation.migrate_btn')}
                                            </button>
                                            <p className="text-[10px] text-gray-500 mt-2 text-center uppercase tracking-tighter">{t('instance_settings.installation.migrate_note')}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'window' && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold text-gray-400">{t('instance_settings.window.width')}</label>
                                            <input
                                                type="number"
                                                value={config.resolutionWidth || 854}
                                                onChange={(e) => handleChange('resolutionWidth', parseInt(e.target.value))}
                                                className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold text-gray-400">{t('instance_settings.window.height')}</label>
                                            <input
                                                type="number"
                                                value={config.resolutionHeight || 480}
                                                onChange={(e) => handleChange('resolutionHeight', parseInt(e.target.value))}
                                                className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'java' && (
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.java.path_label')}</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={config.javaPath || ''}
                                                onChange={(e) => handleChange('javaPath', e.target.value)}
                                                placeholder={t('instance_settings.java.path_placeholder')}
                                                className="flex-1 bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors placeholder:text-gray-600"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.java.memory_label')}</label>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">{t('instance_settings.java.min_memory')}</label>
                                                <input
                                                    type="number"
                                                    value={config.minMemory || 1024}
                                                    onChange={(e) => handleChange('minMemory', parseInt(e.target.value))}
                                                    className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">{t('instance_settings.java.max_memory')}</label>
                                                <input
                                                    type="number"
                                                    value={config.maxMemory || 4096}
                                                    onChange={(e) => handleChange('maxMemory', parseInt(e.target.value))}
                                                    className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.java.profile_label')}</label>
                                        <div className="relative">
                                            <select
                                                value={config.javaProfile || 'default'}
                                                onChange={(e) => handleChange('javaProfile', e.target.value)}
                                                className="w-full bg-surface border border-white/10 rounded p-3 text-sm focus:border-primary outline-none appearance-none cursor-pointer hover:bg-white/5 transition-colors"
                                            >
                                                <option value="default">{t('common.disabled')} / Inherit Global</option>
                                                <option value="performance">Performance (Aikar's Flags)</option>
                                                <option value="low-end">Low-End PC (Aggressive GC)</option>
                                                <option value="zgc">ZGC (Stable FPS - Java 17+)</option>
                                            </select>
                                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-gray-400">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-gray-500 italic px-1">
                                            {t('instance_settings.java.profile_desc')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'hooks' && (
                                <div className="space-y-6">
                                    <p className="text-sm text-gray-400 mb-4">
                                        {t('instance_settings.hooks.desc')}
                                    </p>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.hooks.pre_launch')}</label>
                                        <input
                                            type="text"
                                            value={config.preLaunchHook || ''}
                                            onChange={(e) => handleChange('preLaunchHook', e.target.value)}
                                            placeholder={t('instance_settings.hooks.placeholder')}
                                            className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors placeholder:text-gray-600"
                                        />
                                        <p className="text-xs text-gray-500">{t('instance_settings.hooks.pre_launch_desc')}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-gray-400">{t('instance_settings.hooks.post_exit')}</label>
                                        <input
                                            type="text"
                                            value={config.postExitHook || ''}
                                            onChange={(e) => handleChange('postExitHook', e.target.value)}
                                            placeholder={t('instance_settings.hooks.placeholder')}
                                            className="w-full bg-surface border border-white/10 rounded p-3 focus:border-primary outline-none transition-colors placeholder:text-gray-600"
                                        />
                                        <p className="text-xs text-gray-500">{t('instance_settings.hooks.post_exit_desc')}</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'danger' && (
                                <div className="space-y-6">
                                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                                        <h3 className="font-bold text-red-400 mb-2">{t('instance_settings.danger.reinstall_title')}</h3>
                                        <p className="text-sm text-gray-400 mb-4">
                                            {t('instance_settings.danger.reinstall_desc')}
                                        </p>
                                        <button
                                            onClick={() => setShowReinstall(true)}
                                            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded hover:bg-red-700 hover:text-white transition-all font-bold text-sm"
                                        >
                                            {t('instance_settings.danger.reinstall_btn')}
                                        </button>
                                    </div>

                                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                                        <h3 className="font-bold text-red-500 mb-2">{t('instance_settings.danger.delete_title')}</h3>
                                        <p className="text-sm text-gray-400 mb-4">
                                            {t('instance_settings.danger.delete_desc')}
                                        </p>
                                        <button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-all font-bold text-sm shadow-lg"
                                        >
                                            {t('instance_settings.danger.delete_btn')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {activeTab !== 'danger' && (
                                <div className="mt-8 pt-6 border-t border-white/5 flex justify-end gap-3">
                                    <button onClick={onClose} className="px-6 py-2 rounded text-gray-300 hover:text-white hover:bg-white/5 transition-colors">{t('common.cancel')}</button>
                                    <button
                                        onClick={handleSave}
                                        disabled={loading}
                                        className="px-6 py-2 rounded bg-primary text-black font-bold hover:brightness-110 transition-all disabled:opacity-50"
                                    >
                                        {loading ? t('instance_settings.saving') : t('instance_settings.save_btn')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showReinstall && (
                <ReinstallModal
                    instanceName={instance.name}
                    onClose={() => setShowReinstall(false)}
                    onConfirm={handleReinstall}
                />
            )}

            {showDeleteConfirm && (
                <ConfirmationModal
                    title={t('instance_settings.danger.delete_modal_title')}
                    message={t('instance_settings.danger.delete_modal_msg', { name: instance.name })}
                    onConfirm={handleDelete}
                    onCancel={() => setShowDeleteConfirm(false)}
                    confirmLabel={t('instance_settings.danger.delete_forever_btn')}
                    isDanger
                />
            )}
        </>
    );
}

function SettingsTab({ label, id, active, onClick, icon, isDanger }) {
    return (
        <button
            onClick={() => onClick(id)}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${active === id
                ? (isDanger ? 'bg-red-500/20 text-red-400' : 'bg-primary/20 text-primary')
                : (isDanger ? 'text-red-900/60 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:bg-white/5 hover:text-white')
                }`}
        >
            <span className="font-bold">{label}</span>
        </button>
    );
}

export default InstanceSettingsModal;
