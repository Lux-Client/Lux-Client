import React from 'react';
import { useTranslation } from 'react-i18next';

type JavaRequiredModalProps = {
    isOpen: boolean;
    requiredVersion: number;
    minecraftVersion: string;
    instanceName?: string;
    isInstalling: boolean;
    installError: string;
    onInstall: () => void;
    onClose: () => void;
};

function JavaRequiredModal({
    isOpen,
    requiredVersion,
    minecraftVersion,
    instanceName,
    isInstalling,
    installError,
    onInstall,
    onClose
}: JavaRequiredModalProps) {
    const { t } = useTranslation();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-card w-full max-w-2xl rounded-xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-8 border-b border-border bg-gradient-to-r from-yellow-500/10 to-transparent">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center text-yellow-500">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-foreground">{t('java_required_modal.title', { version: requiredVersion })}</h2>
                            <p className="text-muted-foreground text-sm">
                                {instanceName ? `${instanceName} • ` : ''}{t('java_required_modal.subtitle', { minecraftVersion })}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-8 space-y-4">
                    <p className="text-foreground leading-relaxed">
                        {t('java_required_modal.description', { version: requiredVersion })}
                    </p>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        {t('java_required_modal.settings_hint', { version: requiredVersion })}
                    </p>

                    {installError && (
                        <div className="p-4 rounded-xl text-sm font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                            {installError}
                        </div>
                    )}
                </div>

                <div className="p-8 border-t border-border flex gap-4">
                    <button
                        onClick={onClose}
                        disabled={isInstalling}
                        className="flex-1 px-6 py-3 bg-muted hover:bg-accent rounded-xl text-foreground font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {t('common.close')}
                    </button>
                    <button
                        onClick={onInstall}
                        disabled={isInstalling}
                        className="flex-1 px-6 py-3 bg-primary text-black rounded-xl font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isInstalling ? (
                            <>
                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                {t('java_required_modal.installing', { version: requiredVersion })}
                            </>
                        ) : (
                            t('java_required_modal.install_button', { version: requiredVersion })
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default JavaRequiredModal;
