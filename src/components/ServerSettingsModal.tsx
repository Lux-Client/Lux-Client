import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import { useAnimationsEnabled } from '../hooks/useAnimationsEnabled';
import ServerJavaFields from './ServerJavaFields';

// Mirrors InstanceSettingsModal: a full-screen modal opened from a gear button, with a left
// tab sidebar and a right content pane, so per-server settings feel identical to per-instance
// ones. Changes are written through server:update-config and take effect on the next start.
function ServerSettingsModal({ server, serverStatus, onClose, onSaved }) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const animationsEnabled = useAnimationsEnabled();

    const [activeTab, setActiveTab] = useState('general');
    const [runtimes, setRuntimes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [config, setConfig] = useState({
        memory: String(server.memory || 4096),
        javaPath: server.javaPath || '',
        javaArgs: server.javaArgs || ''
    });

    const isRunning = ['running', 'starting', 'stopping', 'restarting'].includes(String(serverStatus || '').toLowerCase());

    useEffect(() => {
        let cancelled = false;
        window.electronAPI.getJavaRuntimes?.()
            .then((res) => { if (!cancelled && res?.success) setRuntimes(res.runtimes || []); })
            .catch(() => { });
        return () => { cancelled = true; };
    }, []);

    const handleChange = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        setLoading(true);
        try {
            const memory = parseInt(config.memory, 10);
            const updates = {
                memory: Number.isFinite(memory) && memory >= 512 ? memory : 512,
                javaPath: config.javaPath.trim(),
                javaArgs: config.javaArgs.trim()
            };
            const result = await window.electronAPI.updateServerConfig(server.name, updates);
            if (result?.success) {
                addNotification(t('server_settings.saved', { defaultValue: 'Server settings saved. They apply on the next start.' }), 'success');
                if (onSaved && result.config) onSaved(result.config);
                onClose();
            } else {
                addNotification(t('server_settings.save_failed', { defaultValue: 'Could not save server settings.' }), 'error');
            }
        } catch (e) {
            addNotification(t('server_settings.save_failed', { defaultValue: 'Could not save server settings.' }), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 backdrop-blur-sm ${animationsEnabled ? 'animate-in fade-in duration-200' : ''}`}
            onClick={onClose}
        >
            <div
                className={`bg-popover w-full max-w-4xl h-[600px] rounded-xl border border-border flex overflow-hidden shadow-2xl ${animationsEnabled ? 'animate-in zoom-in-95 slide-in-from-bottom-3 duration-300' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Sidebar */}
                <div className="w-64 bg-card border-r border-border p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xl font-bold mb-4 px-2">
                        <span aria-hidden>⚙️</span>
                        <span className="truncate" title={server.name}>{server.name}</span>
                    </div>

                    <SettingsTab label={t('server_settings.tabs.general', { defaultValue: 'General' })} id="general" active={activeTab} onClick={setActiveTab} />
                    <SettingsTab label={t('server_settings.tabs.java', { defaultValue: 'Java' })} id="java" active={activeTab} onClick={setActiveTab} />

                    <div className="mt-auto">
                        <button onClick={onClose} className="w-full text-left px-4 py-2 rounded hover:bg-accent text-muted-foreground">
                            {t('common.cancel', 'Cancel')}
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-8 overflow-y-auto bg-background">
                    <div className="max-w-2xl">
                        <h2 className="text-2xl font-bold mb-6">
                            {activeTab === 'general' && t('server_settings.general.title', { defaultValue: 'General' })}
                            {activeTab === 'java' && t('server_settings.java.title', { defaultValue: 'Java' })}
                        </h2>

                        {activeTab === 'general' && (
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">
                                        {t('server_settings.general.memory', { defaultValue: 'Memory (MB)' })}
                                    </label>
                                    <input
                                        type="number"
                                        value={config.memory}
                                        onChange={(e) => handleChange('memory', e.target.value)}
                                        className="w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        min="512"
                                        step="512"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1.5">
                                        {t('server_settings.general.memory_hint', { defaultValue: 'RAM allocated to this server (-Xms/-Xmx).' })}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'java' && (
                            <ServerJavaFields
                                runtimes={runtimes}
                                javaPath={config.javaPath}
                                javaArgs={config.javaArgs}
                                onJavaPathChange={(v) => handleChange('javaPath', v)}
                                onJavaArgsChange={(v) => handleChange('javaArgs', v)}
                                autoLabel={t('server_settings.java.inherit', { defaultValue: 'Automatic / use global default' })}
                            />
                        )}

                        {isRunning && (
                            <div className="mt-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
                                {t('server_settings.running_note', { defaultValue: 'This server is running. Changes apply the next time it starts.' })}
                            </div>
                        )}

                        <div className="mt-8 pt-6 border-t border-border flex justify-end gap-3">
                            <button onClick={onClose} className="px-6 py-2 rounded text-foreground hover:text-accent-foreground hover:bg-accent transition-colors">
                                {t('common.cancel', 'Cancel')}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={loading}
                                className="px-6 py-2 rounded bg-primary text-black font-bold hover:brightness-110 transition-all disabled:opacity-50"
                            >
                                {loading ? t('server_settings.saving', { defaultValue: 'Saving…' }) : t('server_settings.save_btn', { defaultValue: 'Save' })}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingsTab({ label, id, active, onClick }: { label: string; id: string; active: string; onClick: (id: string) => void }) {
    return (
        <button
            onClick={() => onClick(id)}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${active === id
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
        >
            <span className="font-bold">{label}</span>
        </button>
    );
}

export default ServerSettingsModal;
