import React, { useState } from 'react';
import { FileCode, FileJson, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';

const FORMAT_OPTIONS = [
    {
        id: 'json',
        titleKey: 'setup.formatJson',
        titleFallback: 'JSON',
        descriptionKey: 'setup.formatJsonDesc',
        descriptionFallback: 'JavaScript Object Notation. The default and most widely compatible format.',
        icon: FileJson,
        accentClass: 'from-amber-500/35 to-orange-700/10'
    },
    {
        id: 'yaml',
        titleKey: 'setup.formatYaml',
        titleFallback: 'YAML',
        descriptionKey: 'setup.formatYamlDesc',
        descriptionFallback: 'Human-readable data format. Recommended for easier editing and version control.',
        icon: FileCode,
        accentClass: 'from-green-500/30 to-emerald-700/10',
        recommended: true
    }
];

export default function SettingsFormatModal({ onSelect }) {
    const { t } = useTranslation();
    const [pendingFormat, setPendingFormat] = useState<string | null>(null);

    const handleSelect = async (format) => {
        if (pendingFormat) {
            return;
        }

        setPendingFormat(format);
        try {
            await onSelect(format);
        } finally {
            setPendingFormat(null);
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
                                    {t('setup.chooseFormat', 'Choose Settings Format')}
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                    {t('setup.chooseFormatDesc', 'Select how your settings should be stored. You can change this later in Settings.')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {FORMAT_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const isPending = pendingFormat === option.id;
                            return (
                                <div
                                    key={option.id}
                                    className={cn(
                                        'relative overflow-hidden rounded-2xl border cursor-pointer transition-all',
                                        isPending
                                            ? 'border-primary bg-primary/5'
                                            : option.recommended
                                                ? 'border-primary/50 hover:border-primary'
                                                : 'border-border/70 hover:border-primary/50'
                                    )}
                                    onClick={() => handleSelect(option.id)}
                                >
                                    <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90', option.accentClass)} />
                                    <div className="relative space-y-4 p-5">
                                        <div className="flex items-center justify-between">
                                            <div className={cn(
                                                'flex h-12 w-12 items-center justify-center rounded-xl border border-border/60',
                                                option.recommended ? 'bg-primary/20 text-primary' : 'bg-background/60 text-muted-foreground'
                                            )}>
                                                <Icon className="h-6 w-6" />
                                            </div>
                                            {option.recommended && (
                                                <Badge variant="default" className="bg-primary/20 text-primary border-primary/30">
                                                    {t('setup.recommended', 'Recommended')}
                                                </Badge>
                                            )}
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                                                {t(option.titleKey, option.titleFallback)}
                                                {option.id === 'json' && (
                                                    <span className="text-xs font-normal text-muted-foreground">
                                                        ({t('setup.default', 'Default')})
                                                    </span>
                                                )}
                                            </h2>
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                {t(option.descriptionKey, option.descriptionFallback)}
                                            </p>
                                        </div>
                                        <Button
                                            className="w-full rounded-xl"
                                            variant={option.recommended ? 'default' : 'outline'}
                                            disabled={Boolean(pendingFormat)}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSelect(option.id);
                                            }}
                                        >
                                            {isPending ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {t('common.loading', 'Loading...')}
                                                </>
                                            ) : (
                                                t('setup.useFormat', 'Use Format')
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
