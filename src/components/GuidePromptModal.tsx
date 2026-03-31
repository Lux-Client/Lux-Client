import React from 'react';
import { Compass, MoveRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { GuideMode } from '../lib/guideSteps';

type GuidePromptModalProps = {
    mode: GuideMode;
    doNotShowAgain: boolean;
    onDoNotShowAgainChange: (checked: boolean) => void;
    onStart: () => void;
    onSkip: () => void;
};

const descriptionKeyByMode: Record<GuideMode, string> = {
    launcher: 'guide.prompt_desc_launcher',
    server: 'guide.prompt_desc_server',
    client: 'guide.prompt_desc_client',
    tools: 'guide.prompt_desc_tools'
};

export default function GuidePromptModal({
    mode,
    doNotShowAgain,
    onDoNotShowAgainChange,
    onStart,
    onSkip
}: GuidePromptModalProps) {
    const { t } = useTranslation();

    return (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-background/70 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsla(var(--primary),0.18),transparent_24%),radial-gradient(circle_at_bottom_left,hsla(var(--primary),0.1),transparent_22%)]" />
            <Card className="relative w-full max-w-2xl overflow-hidden border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-300">
                <CardContent className="p-6 sm:p-8">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                            <Compass className="h-3.5 w-3.5 text-primary" />
                            Lux
                        </div>
                        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                            {t('guide.prompt_title')}
                        </h1>
                        <p className="text-sm leading-6 text-muted-foreground">
                            {t(descriptionKeyByMode[mode], t('guide.prompt_desc'))}
                        </p>
                    </div>

                    <label
                        htmlFor="guide-prompt-suppress"
                        className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-background/55 p-4 transition-colors hover:border-primary/40"
                    >
                        <input
                            id="guide-prompt-suppress"
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
                            checked={doNotShowAgain}
                            onChange={(e) => onDoNotShowAgainChange(e.target.checked)}
                        />
                        <p className="text-sm text-foreground">
                            {t('guide.dont_show_again', "Don't show this again for this mode")}
                        </p>
                    </label>

                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <Button
                            onClick={onSkip}
                            variant="outline"
                            className="h-11 rounded-xl border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
                        >
                            {t('guide.skip')}
                        </Button>
                        <Button
                            onClick={onStart}
                            className="h-11 rounded-xl px-5"
                        >
                            {t('guide.start')}
                            <MoveRight className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
