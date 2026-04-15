import React, { useEffect, useMemo, useState } from 'react';
import { Gamepad2, Loader2, Rocket, Server, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isFeatureEnabled } from '../config/featureFlags';
import { getDefaultStartupValueForMode, getStartupModes } from '../lib/startupPages';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const MODE_VISUALS = {
    launcher: {
        icon: Rocket,
        accentClass: 'from-orange-500/35 to-orange-700/10',
        previewClass: 'bg-[linear-gradient(135deg,#1a1208_0%,#2d1d10_45%,#4a2f18_100%)]'
    },
    client: {
        icon: Gamepad2,
        accentClass: 'from-cyan-400/30 to-blue-500/10',
        previewClass: 'bg-[linear-gradient(135deg,#0f1f2e_0%,#1b3248_45%,#2a4f72_100%)]'
    },
    server: {
        icon: Server,
        accentClass: 'from-emerald-500/30 to-teal-600/10',
        previewClass: 'bg-[linear-gradient(135deg,#102418_0%,#1b3b29_45%,#2b5b40_100%)]'
    },
    tools: {
        icon: Wrench,
        accentClass: 'from-violet-500/30 to-sky-500/10',
        previewClass: 'bg-[linear-gradient(135deg,#1a1328_0%,#2a1f42_45%,#3f2f63_100%)]'
    }
};

export default function StartupModeSelectionModal({ onSelect, canAccessSkins = true }) {
    const { t } = useTranslation();
    const [pendingMode, setPendingMode] = useState<string | null>(null);

    const options = useMemo(() => (
        getStartupModes({
            openClientEnabled: isFeatureEnabled('openClientPage'),
            canAccessSkins
        })
    ), [canAccessSkins]);
    const startupPageOptions = useMemo(() => ({
        openClientEnabled: isFeatureEnabled('openClientPage'),
        canAccessSkins
    }), [canAccessSkins]);
    const [selectedMode, setSelectedMode] = useState<string>(options[0]?.id ?? 'launcher');
    const [selectedPage, setSelectedPage] = useState<string>(() => getDefaultStartupValueForMode(options[0]?.id ?? 'launcher', startupPageOptions));
    const selectedOption = options.find((option) => option.id === selectedMode) ?? options[0];
    const visual = selectedOption ? MODE_VISUALS[selectedOption.id] : MODE_VISUALS.launcher;
    const Icon = selectedOption ? visual.icon : Rocket;
    const activePage = selectedOption?.pages.find((page) => page.value === selectedPage) ?? selectedOption?.pages[0];

    useEffect(() => {
        if (!selectedOption) {
            return;
        }

        if (selectedOption.id !== selectedMode) {
            setSelectedMode(selectedOption.id);
            return;
        }

        const validPages = new Set(selectedOption.pages.map((page) => page.value));
        if (!validPages.has(selectedPage)) {
            setSelectedPage(getDefaultStartupValueForMode(selectedOption.id, startupPageOptions));
        }
    }, [selectedMode, selectedOption, selectedPage, startupPageOptions]);

    const handleModeChange = (modeId) => {
        setSelectedMode(modeId);
        setSelectedPage(getDefaultStartupValueForMode(modeId, startupPageOptions));
    };

    const handleSelect = async (modeId, value) => {
        if (pendingMode) {
            return;
        }

        setPendingMode(modeId);
        try {
            await onSelect(value);
        } finally {
            setPendingMode(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/70 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.15),transparent_24%)]" />
            <Card className="relative w-full max-w-3xl overflow-hidden border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-300">
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

                    {selectedOption && (
                        <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-background/55 p-5 sm:p-6">
                            <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90', visual.accentClass)} />
                            <div className="relative space-y-5">
                                <div className={cn('h-28 rounded-2xl border border-border/60 shadow-inner', visual.previewClass)} />
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-semibold text-foreground">
                                            {t(selectedOption.titleKey, selectedOption.titleFallback)}
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {t(selectedOption.descriptionKey, selectedOption.descriptionFallback)}
                                        </p>
                                    </div>
                                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-primary">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                            {t('settings.general.startup_section', 'Section')}
                                        </div>
                                        <Select
                                            value={selectedOption.id}
                                            onValueChange={handleModeChange}
                                            disabled={Boolean(pendingMode)}
                                        >
                                            <SelectTrigger className="w-full rounded-xl border-border/70 bg-background/80">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {options.map((option) => (
                                                    <SelectItem key={option.id} value={option.id}>
                                                        {t(option.titleKey, option.titleFallback)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                            {t('settings.general.startup_subpage', 'Page')}
                                        </div>
                                        <Select
                                            value={selectedPage}
                                            onValueChange={setSelectedPage}
                                            disabled={Boolean(pendingMode)}
                                        >
                                            <SelectTrigger className="w-full rounded-xl border-border/70 bg-background/80">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {selectedOption.pages.map((page) => (
                                                    <SelectItem key={page.value} value={page.value}>
                                                        {t(page.labelKey, page.labelFallback)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground">
                                    {t('setup.startupSelectedTab', 'Selected tab')}: {activePage ? t(activePage.labelKey, activePage.labelFallback) : t('common.dashboard', 'Dashboard')}
                                </p>

                                <Button
                                    className="w-full rounded-xl"
                                    disabled={Boolean(pendingMode)}
                                    onClick={() => handleSelect(selectedOption.id, selectedPage)}
                                >
                                    {pendingMode ? (
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
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
