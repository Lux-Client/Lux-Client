import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

function ThemeExportModal({ onClose, onExport, presetData }: { onClose: any; onExport: any; presetData?: any }) {
    const { t } = useTranslation();
    const [name, setName] = useState('');

    const handleExport = (e) => {
        e.preventDefault();
        if (name.trim()) {
            onExport(name.trim());
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface w-full max-w-md rounded-xl border border-stroke shadow-2xl overflow-hidden">
                <form onSubmit={handleExport}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-foreground mb-2">{t('styling.export')}</h3>
                        <p className="text-muted-foreground text-sm mb-6">
                            {t('styling.export_desc', 'Enter a name for your theme before exporting.')}
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2 px-1">
                                    {t('styling.theme_name', 'Theme Name')}
                                </label>
                                <input
                                    type="text"
                                    autoFocus
                                    className="w-full bg-muted border border-stroke rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 transition-all font-medium"
                                    placeholder={t('styling.enter_name', 'My Awesome Theme')}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    maxLength={32}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-muted border-t border-stroke flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors font-medium text-sm"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-6 py-2 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed font-bold text-black transition-colors shadow-md"
                        >
                            {t('styling.export', 'Export')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default ThemeExportModal;
