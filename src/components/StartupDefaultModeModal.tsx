import React, { useMemo, useState } from 'react';
import { Gamepad2, Loader2, Rocket, Server, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isFeatureEnabled } from '../config/featureFlags';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const STARTUP_OPTIONS = [
    {
        id: 'dashboard',
        titleKey: 'common.launcher',
        titleFallback: 'Launcher',
        descriptionKey: 'setup.startupLauncherDesc',
        descriptionFallback: 'Open the Launcher dashboard by default.',
        icon: Rocket,
        accentClass: 'from-orange-500/35 to-orange-700/10',
        previewClass: 'bg-[linear-gradient(135deg,#1a1208_0%,#2d1d10_45%,#4a2f18_100%)]'
    },
    {
        id: 'open-client',
        titleKey: 'common.client',
        titleFallback: 'Client',
        descriptionKey: 'setup.startupClientDesc',
        descriptionFallback: 'Open the Client section directly.',
        icon: Gamepad2,
        accentClass: 'from-cyan-400/30 to-blue-500/10',
        previewClass: 'bg-[linear-gradient(135deg,#0f1f2e_0%,#1b3248_45%,#2a4f72_100%)]',
        featureFlag: 'openClientPage'
    },
    {
        id: 'server-dashboard',
        titleKey: 'common.server',
        titleFallback: 'Server',
        descriptionKey: 'setup.startupServerDesc',
        descriptionFallback: 'Open the Server dashboard first.',
        icon: Server,
        accentClass: 'from-emerald-500/30 to-teal-600/10',
        previewClass: 'bg-[linear-gradient(135deg,#102418_0%,#1b3b29_45%,#2b5b40_100%)]'
    },
    {
        id: 'tools-dashboard',
        titleKey: 'common.useful_tools',
        titleFallback: 'Useful Tools',
        descriptionKey: 'setup.startupToolsDesc',
        descriptionFallback: 'Open Useful Tools when Lux starts.',
        icon: Wrench,
        accentClass: 'from-violet-500/30 to-sky-500/10',
        previewClass: 'bg-[linear-gradient(135deg,#1a1328_0%,#2a1f42_45%,#3f2f63_100%)]'
    }
];

export default function StartupModeSelectionModal({ onSelect }) {
    const { t } = useTranslation();
    const [pendingMode, setPendingMode] = useState<string | null>(null);

    const options = useMemo(() => (
        STARTUP_OPTIONS.filter((option) => !option.featureFlag || isFeatureEnabled(option.featureFlag))
    ), []);

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
                                Lux
                            </div>
                            <div>
                                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                                    {t('setup.chooseStartup', 'Choose Your Default Section')}
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                    {t('setup.chooseStartupDesc', 'Pick what should open first when Lux starts. You can change this later in Settings.')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {options.map((option) => {
                            const Icon = option.icon;
                            const isPending = pendingMode === option.id;
                            return (
                                <div
                                    key={option.id}
                                    className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/55 p-4"
                                >
                                    <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90', option.accentClass)} />
                                    <div className="relative space-y-4">
                                        <div className={cn('h-24 rounded-xl border border-border/60 shadow-inner', option.previewClass)} />
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h2 className="text-lg font-semibold text-foreground">
                                                    {t(option.titleKey, option.titleFallback)}
                                                </h2>
                                                <p className="mt-1 text-sm text-muted-foreground">
                                                    {t(option.descriptionKey, option.descriptionFallback)}
                                                </p>
                                            </div>
                                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-primary">
                                                <Icon className="h-4 w-4" />
                                            </div>
                                        </div>
                                        <Button
                                            className="w-full rounded-xl"
                                            disabled={Boolean(pendingMode)}
                                            onClick={() => handleSelect(option.id)}
                                        >
                                            {isPending ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {t('common.loading', 'Loading...')}
                                                </>
                                            ) : (
                                                t('setup.useAsStartup', 'Use as Startup')
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
