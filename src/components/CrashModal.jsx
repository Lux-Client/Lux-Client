import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeLog, getExitCodeDescription } from '../utils/logAnalyzer';

const CrashModal = ({ isOpen, onClose, crashData, onFixApplied }) => {
    const { t } = useTranslation();
    const [issues, setIssues] = useState([]);
    const [isApplyingFix, setIsApplyingFix] = useState(false);
    const [fixStatus, setFixStatus] = useState(null);

    useEffect(() => {
        if (isOpen && crashData?.logFile) {
            const identifiedIssues = analyzeLog(crashData.logFile);
            setIssues(identifiedIssues);
        }
    }, [isOpen, crashData]);

    if (!isOpen || !crashData) return null;

    const handleApplyFix = async (issue) => {
        setIsApplyingFix(true);
        setFixStatus({ type: 'info', message: `Applying fix: ${issue.fixText}...` });

        try {
            let res;
            switch (issue.fixAction) {
                case 'increase_memory':
                    res = await window.electronAPI.updateInstanceConfig(crashData.instanceName, { maxMemory: 4096 });
                    break;
                case 'fix_java_version':
                    // Trigger java auto-install/fix logic
                    res = await window.electronAPI.reinstallInstance(crashData.instanceName, 'java');
                    break;
                case 'reinstall_instance':
                    res = await window.electronAPI.reinstallInstance(crashData.instanceName, 'full');
                    break;
                // Add more cases as needed
                default:
                    setFixStatus({ type: 'error', message: 'Unknown fix action.' });
                    setIsApplyingFix(false);
                    return;
            }

            if (res.success) {
                setFixStatus({ type: 'success', message: 'Fix applied successfully! Try launching again.' });
                if (onFixApplied) onFixApplied();
            } else {
                setFixStatus({ type: 'error', message: `Failed to apply fix: ${res.error}` });
            }
        } catch (err) {
            setFixStatus({ type: 'error', message: `Error applying fix: ${err.message}` });
        } finally {
            setIsApplyingFix(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-[#1a1a1a] w-full max-w-2xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="p-8 border-b border-white/5 bg-gradient-to-r from-red-500/10 to-transparent">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 bg-red-500/20 rounded-2xl flex items-center justify-center text-red-500">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white">{t('crash.title')}</h2>
                            <p className="text-gray-400 text-sm">{crashData.instanceName} • {getExitCodeDescription(crashData.exitCode)}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 max-h-[60vh] overflow-y-auto">
                    {issues.length > 0 ? (
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest">{t('crash.analysis')}</h3>
                            {issues.map((issue) => (
                                <div key={issue.id} className="bg-white/5 rounded-2xl p-6 border border-white/5 hover:border-primary/30 transition-colors group">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="space-y-2">
                                            <h4 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{issue.title}</h4>
                                            <p className="text-gray-400 text-sm leading-relaxed">{issue.description}</p>
                                        </div>
                                        <button
                                            onClick={() => handleApplyFix(issue)}
                                            disabled={isApplyingFix}
                                            className="px-6 py-2.5 bg-primary text-black rounded-xl font-bold text-sm hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 whitespace-nowrap shadow-lg shadow-primary/20"
                                        >
                                            {isApplyingFix ? t('common.applying', 'Applying...') : issue.fixText}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-gray-400 mb-6">{t('crash.no_issues')}</p>
                            {crashData.logUrl ? (
                                <a
                                    href={crashData.logUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold transition-colors"
                                >
                                    {t('crash.view_log')}
                                </a>
                            ) : (
                                <p className="text-xs text-gray-500 italic">{t('crash.check_manually')}</p>
                            )}
                        </div>
                    )}

                    {fixStatus && (
                        <div className={`mt-6 p-4 rounded-xl text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${fixStatus.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                            fixStatus.type === 'error' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                'bg-primary/10 text-primary border border-primary/20'
                            }`}>
                            {fixStatus.message}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-8 border-t border-white/5 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold transition-colors"
                    >
                        {t('common.close', 'Close')}
                    </button>
                    <button
                        onClick={() => window.electronAPI.openInstanceFolder(crashData.instanceName)}
                        className="px-6 py-3 border border-white/10 hover:border-white/30 rounded-xl text-gray-300 font-bold transition-all"
                    >
                        {t('instance.open_folder', 'Open Folder')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CrashModal;
