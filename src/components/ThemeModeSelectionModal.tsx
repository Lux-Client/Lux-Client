import React, { useState } from 'react';
import { Loader2, Moon, Palette, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';

const MODE_OPTIONS = [
    {
        id: 'dark',
        titleKey: 'setup.darkMode',
        descriptionKey: 'setup.darkModeDesc',
        actionKey: 'setup.useDarkMode',
        icon: Moon,
        previewClass: 'bg-[linear-gradient(135deg,#0f0f0f_0%,#1b1b1b_50%,#2a2a2a_100%)]',
        accentClass: 'from-orange-500/35 to-orange-700/10'
    },
    {
        id: 'light',
        titleKey: 'setup.lightMode',
        descriptionKey: 'setup.lightModeDesc',
        actionKey: 'setup.useLightMode',
        icon: Sun,
        previewClass: 'bg-[linear-gradient(135deg,#fff8e9_0%,#f9ddb1_45%,#f1be6f_100%)]',
        accentClass: 'from-amber-400/35 to-orange-400/10'
    }
];

export default function ThemeModeSelectionModal({ onSelect }) {
    const { t } = useTranslation();
    const [pendingMode, setPendingMode] = useState<string | null>(null);

    const handleSelect = async (mode) => {
        if (pendingMode) {
            return;
        }

        setPendingMode(mode);
        try {
            await onSelect(mode);
        } finally {
            setPendingMode(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/70 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.15),transparent_24%)]" />
            <Card className="relative w-full max-w-4xl overflow-hidden border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-300">
                <CardContent className="p-6 sm:p-8">
                    <div className="mb-8 flex items-start justify-between gap-4">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                                <Palette className="h-3.5 w-3.5 text-primary" />
                                Lux
                            </div>
                            <div>
                                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                                    {t('setup.chooseTheme')}
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                    {t('setup.chooseThemeDesc')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {MODE_OPTIONS.map((mode) => {
                            const Icon = mode.icon;
                            const isPending = pendingMode === mode.id;
                            return (
                                <div
                                    key={mode.id}
                                    className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/55 p-4"
                                >
                                    <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90', mode.accentClass)} />
                                    <div className="relative space-y-4">
                                        <div className={cn('h-24 rounded-xl border border-border/60 shadow-inner', mode.previewClass)} />
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h2 className="text-lg font-semibold text-foreground">{t(mode.titleKey)}</h2>
                                                <p className="mt-1 text-sm text-muted-foreground">{t(mode.descriptionKey)}</p>
                                            </div>
                                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-primary">
                                                <Icon className="h-4 w-4" />
                                            </div>
                                        </div>
                                        <Button
                                            className="w-full rounded-xl"
                                            disabled={Boolean(pendingMode)}
                                            onClick={() => handleSelect(mode.id)}
                                        >
                                            {isPending ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {t('common.loading')}
                                                </>
                                            ) : (
                                                t(mode.actionKey)
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
