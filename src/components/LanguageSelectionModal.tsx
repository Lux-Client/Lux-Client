import React from 'react';
import { Check, Globe, ArrowRight } from "@gravity-ui/icons";
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';

const languages = [
    { code: 'en_us', name: 'English (US)' },
    { code: 'en_uk', name: 'English (UK)' },
    { code: 'de_de', name: 'Deutsch' },
    { code: 'de_ch', name: 'Deutsch (CH)' },
    { code: 'fr_fr', name: 'Français' },
    { code: 'es_es', name: 'Español' },
    { code: 'it_it', name: 'Italiano' },
    { code: 'pl_pl', name: 'Polski' },
    { code: 'pt_br', name: 'Português (BR)' },
    { code: 'pt_pt', name: 'Português (PT)' },
    { code: 'ru_ru', name: 'Русский' },
    { code: 'sv_se', name: 'Svenska' },
    { code: 'sk_sk', name: 'Slovenčina' },
    { code: 'sl_si', name: 'Slovenščina' },
    { code: 'ro_ro', name: 'Română' }
];

export default function LanguageSelectionModal({ onSelect }) {
    const { t, i18n } = useTranslation();

    const handleSelect = (code) => {
        i18n.changeLanguage(code);
        onSelect(code);
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/70 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsla(var(--primary),0.16),transparent_24%),radial-gradient(circle_at_bottom_left,hsla(var(--primary),0.1),transparent_22%)]" />
            <Card className="relative w-full max-w-4xl overflow-hidden border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-300">
                <CardContent className="p-6 sm:p-8">
                    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                                <Globe className="h-3.5 w-3.5 text-primary" />
                                Lux
                            </div>
                            <div>
                                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('setup.chooseLanguage')}</h1>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{t('setup.chooseLanguageDesc')}</p>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Lux</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                                {languages.find((lang) => lang.code === i18n.language)?.name || i18n.language}
                            </p>
                        </div>
                    </div>

                    <div className="grid max-h-[52vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                        {languages.map((lang) => {
                            const isCurrent = lang.code === i18n.language;
                            return (
                                <button
                                    key={lang.code}
                                    onClick={() => handleSelect(lang.code)}
                                    className={cn(
                                        'group flex items-center justify-between rounded-2xl border p-4 text-left transition-all duration-200',
                                        isCurrent
                                            ? 'border-primary/50 bg-primary/10 shadow-sm'
                                            : 'border-border/70 bg-background/55 hover:border-primary/35 hover:bg-accent/40'
                                    )}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-transform duration-200 group-hover:scale-110">{lang.code.split('_')[1]}</span>
                                        <div>
                                            <p className="text-sm font-medium text-foreground">{lang.name}</p>
                                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{lang.code.replace('_', '-')}</p>
                                        </div>
                                    </div>
                                    <div className={cn(
                                        'flex h-8 w-8 items-center justify-center rounded-full border',
                                        isCurrent ? 'border-primary/40 bg-primary text-primary-foreground' : 'border-border/70 bg-background/70 text-muted-foreground'
                                    )}>
                                        {isCurrent ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-8 flex justify-end">
                        <Button
                            onClick={() => handleSelect(i18n.language)}
                            variant="outline"
                            className="rounded-xl border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
                        >
                            {t('setup.skipSelection')}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
