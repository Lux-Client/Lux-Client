import React, { useEffect, useMemo, useState } from 'react';
import { Compass, MoveRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type GuideStepView = {
    titleKey: string;
    descKey: string;
    selector?: string;
};

type GuideOverlayProps = {
    steps: GuideStepView[];
    stepIndex: number;
    onPrevious: () => void;
    onNext: () => void;
    onFinish: () => void;
    onSkip: () => void;
};

export default function GuideOverlay({
    steps,
    stepIndex,
    onPrevious,
    onNext,
    onFinish,
    onSkip
}: GuideOverlayProps) {
    const { t } = useTranslation();
    const [targetRect, setTargetRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

    const step = steps[stepIndex];
    const hasPrevious = stepIndex > 0;
    const isLastStep = stepIndex >= steps.length - 1;

    const spotlightStyle = useMemo(() => {
        if (!targetRect) {
            return null;
        }

        return {
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: '0 0 0 9999px rgba(4, 6, 8, 0.66)'
        } as React.CSSProperties;
    }, [targetRect]);

    useEffect(() => {
        if (!step?.selector) {
            setTargetRect(null);
            return;
        }

        const measure = () => {
            const element = document.querySelector(step.selector);
            if (!element) {
                setTargetRect(null);
                return;
            }

            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                setTargetRect(null);
                return;
            }

            const padding = 4;
            setTargetRect({
                top: Math.max(0, Math.round(rect.top - padding)),
                left: Math.max(0, Math.round(rect.left - padding)),
                width: Math.round(rect.width + padding * 2),
                height: Math.round(rect.height + padding * 2)
            });
        };

        measure();

        const interval = window.setInterval(measure, 90);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [step?.selector, stepIndex]);

    if (!step) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[10030] pointer-events-none">
            {spotlightStyle ? (
                <div
                    className="absolute rounded-2xl border-2 border-primary/75 bg-transparent shadow-[0_0_35px_hsla(var(--primary),0.45)] transition-all duration-200"
                    style={spotlightStyle}
                />
            ) : (
                <div className="absolute inset-0 bg-black/65" />
            )}

            <Card className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(760px,calc(100%-2rem))] -translate-x-1/2 border-border/70 bg-card/97 shadow-2xl backdrop-blur-xl">
                <CardContent className="p-4 sm:p-6">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                                <Compass className="h-3.5 w-3.5 text-primary" />
                                {t('guide.step_of', { current: stepIndex + 1, total: steps.length })}
                            </div>
                            <h2 className="text-lg font-semibold text-foreground sm:text-xl">
                                {t(step.titleKey)}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                {t(step.descKey)}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg"
                            onClick={onSkip}
                            aria-label={t('common.close', 'Close')}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Button
                            variant="outline"
                            onClick={onSkip}
                            className="border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
                        >
                            {t('guide.skip')}
                        </Button>
                        <div className="flex gap-2 sm:justify-end">
                            <Button
                                variant="outline"
                                onClick={onPrevious}
                                disabled={!hasPrevious}
                                className="border-border/70 bg-background/40"
                            >
                                {t('guide.previous')}
                            </Button>
                            {isLastStep ? (
                                <Button onClick={onFinish}>
                                    {t('guide.finish')}
                                </Button>
                            ) : (
                                <Button onClick={onNext}>
                                    {t('guide.next')}
                                    <MoveRight className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
