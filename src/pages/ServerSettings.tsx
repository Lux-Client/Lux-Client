import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import LoadingOverlay from '../components/LoadingOverlay';
import { Compass } from 'lucide-react';

function ServerSettings({ onRestartGuide = null }) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [settings, setSettings] = useState({
        serverPath: '',
        backupPath: '',
        autoBackup: false,
        backupInterval: 24,
        maxBackups: 5,
        defaultMemory: '4096',
        defaultPort: '25565',
        defaultMaxPlayers: '20',
        autoop: false
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setIsLoading(true);
        try {
            const result = await window.electronAPI.getServerSettings();
            if (result.success) {
                setSettings(result.settings);
            }
        } catch (e) {
            addNotification(t('server.settings.load_failed'), 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const result = await window.electronAPI.saveServerSettings(settings);
            if (result.success) {
                addNotification(t('server.settings.save_success'), 'success');
            } else {
                addNotification(t('server.settings.save_failed', { error: result.error }), 'error');
            }
        } catch (e) {
            addNotification(t('server.settings.save_failed', { error: e.message }), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleRestartGuideNow = () => {
        if (typeof onRestartGuide !== 'function') {
            return;
        }
        onRestartGuide();
        addNotification(t('guide.restart_guide_started', 'Guide started.'), 'info');
    };

    const selectFolder = async (key) => {
        const result = await window.electronAPI.selectFolder();
        if (result && !result.canceled && result.filePaths[0]) {
            handleChange(key, result.filePaths[0]);
        }
    };

    return (
        <div className="p-8 h-full overflow-y-auto custom-scrollbar">
            {isLoading && <LoadingOverlay message={t('common.loading')} />}

            <div className="mb-8">
                <h1 className="text-3xl font-bold text-foreground mb-1">{t('server.settings.global_title')}</h1>
                <p className="text-muted-foreground text-sm">{t('server.settings.global_desc')}</p>
            </div>

            <div className="space-y-6 max-w-2xl">
                { }
                <div className="bg-card/40 backdrop-blur-sm border border-border rounded-xl p-6">
                    <h2 className="text-lg font-bold text-foreground mb-4">{t('server.settings.paths_title')}</h2>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                {t('server.settings.directory_label')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={settings.serverPath}
                                    onChange={(e) => handleChange('serverPath', e.target.value)}
                                    className="flex-1 bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                    placeholder="%appdata%\Lux\servers"
                                />
                                <button
                                    onClick={() => selectFolder('serverPath')}
                                    className="px-4 py-2 bg-muted hover:bg-accent rounded-xl text-foreground transition-colors"
                                >
                                    {t('server.settings.browse_btn')}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                {t('server.settings.backup_directory_label')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={settings.backupPath}
                                    onChange={(e) => handleChange('backupPath', e.target.value)}
                                    className="flex-1 bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                    placeholder="C:/Backups"
                                />
                                <button
                                    onClick={() => selectFolder('backupPath')}
                                    className="px-4 py-2 bg-muted hover:bg-accent rounded-xl text-foreground transition-colors"
                                >
                                    {t('server.settings.browse_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                { }
                <div className="bg-card/40 backdrop-blur-sm border border-border rounded-xl p-6">
                    <h2 className="text-lg font-bold text-foreground mb-4">{t('server.settings.backups_title')}</h2>

                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="autoBackup"
                                checked={settings.autoBackup}
                                onChange={(e) => handleChange('autoBackup', e.target.checked)}
                                className="w-4 h-4 accent-primary"
                            />
                            <label htmlFor="autoBackup" className="text-foreground">
                                {t('server.settings.auto_backups_enable')}
                            </label>
                        </div>

                        {settings.autoBackup && (
                            <>
                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                        {t('server.settings.interval_label')}
                                    </label>
                                    <input
                                        type="number"
                                        value={settings.backupInterval}
                                        onChange={(e) => handleChange('backupInterval', parseInt(e.target.value))}
                                        className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        min="1"
                                        max="168"
                                    />
                                </div>

                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                        {t('server.settings.max_backups_label')}
                                    </label>
                                    <input
                                        type="number"
                                        value={settings.maxBackups}
                                        onChange={(e) => handleChange('maxBackups', parseInt(e.target.value))}
                                        className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        min="1"
                                        max="50"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                { }
                <div className="bg-card/40 backdrop-blur-sm border border-border rounded-xl p-6">
                    <h2 className="text-lg font-bold text-foreground mb-4">{t('server.settings.defaults_title')}</h2>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                {t('server.settings.default_memory_label')}
                            </label>
                            <input
                                type="number"
                                value={settings.defaultMemory}
                                onChange={(e) => handleChange('defaultMemory', e.target.value)}
                                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                min="512"
                                step="512"
                            />
                        </div>

                        <div>
                            <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                {t('server.settings.default_port_label')}
                            </label>
                            <input
                                type="number"
                                value={settings.defaultPort}
                                onChange={(e) => handleChange('defaultPort', e.target.value)}
                                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                min="1"
                                max="65535"
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                {t('server.settings.default_players_label')}
                            </label>
                            <input
                                type="number"
                                value={settings.defaultMaxPlayers}
                                onChange={(e) => handleChange('defaultMaxPlayers', e.target.value)}
                                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                min="1"
                                max="100"
                            />
                        </div>

                        <div className="col-span-2 flex items-center gap-3 pt-2">
                            <input
                                type="checkbox"
                                id="autoop"
                                checked={settings.autoop}
                                onChange={(e) => handleChange('autoop', e.target.checked)}
                                className="w-4 h-4 accent-primary"
                            />
                            <label htmlFor="autoop" className="text-foreground">
                                {t('server.settings.autoop_label')}
                            </label>
                        </div>
                    </div>
                </div>

                <div className="bg-card/40 backdrop-blur-sm border border-primary/20 rounded-xl p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-foreground">{t('guide.restart_guide')}</h2>
                            <p className="text-muted-foreground text-sm mt-1">{t('guide.restart_guide_desc')}</p>
                        </div>
                        <button
                            onClick={handleRestartGuideNow}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-accent rounded-xl text-foreground transition-colors"
                        >
                            <Compass className="h-4 w-4" />
                            {t('guide.restart_guide')}
                        </button>
                    </div>
                </div>

                { }
                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-primary hover:bg-primary-hover text-black font-bold px-8 py-3 rounded-xl shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>}
                        {isSaving ? t('common.saving') : t('server.settings.save_btn')}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ServerSettings;