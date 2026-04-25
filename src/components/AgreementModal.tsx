import React, { useState } from 'react';
import { ArrowRight, ExternalLink, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const AgreementModal = ({ onAccept, onDecline }) => {
    const { t } = useTranslation();
    const [isChecked, setIsChecked] = useState(false);

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-canvas/70 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.14),transparent_24%)]" />
            <Card className="relative w-full max-w-2xl overflow-hidden border-stroke/70 bg-surface/95 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-6 duration-300">
                <CardContent className="p-6 sm:p-8">
                    <div className="mb-8 flex items-start justify-between gap-4">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-stroke bg-canvas/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                                Lux
                            </div>
                            <div>
                                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('agreement.title')}</h1>
                                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                                    {t('agreement.desc')}
                                </p>
                            </div>
                        </div>
                        <div className="hidden h-12 w-12 items-center justify-center rounded-2xl border border-stroke/70 bg-canvas/60 text-primary sm:flex">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <a
                            href={t('agreement.privacy_url')}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-2xl border border-stroke/70 bg-canvas/55 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-foreground">{t('agreement.privacy')}</p>
                                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                            </div>
                        </a>
                        <a
                            href={t('agreement.opt_out_url')}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-2xl border border-stroke/70 bg-canvas/55 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-foreground">{t('agreement.opt_out')}</p>
                                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                            </div>
                        </a>
                    </div>

                    <label
                        htmlFor="agree-checkbox"
                        className="mt-6 flex cursor-pointer items-start gap-4 rounded-2xl border border-stroke/70 bg-canvas/60 p-4 transition-colors hover:border-primary/40"
                    >
                        <input
                            id="agree-checkbox"
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-stroke bg-canvas text-primary focus:ring-primary"
                            checked={isChecked}
                            onChange={(e) => setIsChecked(e.target.checked)}
                        />
                        <div>
                            <p className="text-sm font-medium text-foreground">{t('agreement.checkbox')}</p>
                        </div>
                    </label>

                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <Button
                            onClick={onDecline}
                            variant="outline"
                            className="h-11 rounded-xl border-stroke/70 bg-canvas/40 text-muted-foreground hover:text-foreground"
                        >
                            {t('agreement.decline')}
                        </Button>
                        <Button
                            disabled={!isChecked}
                            onClick={onAccept}
                            className="h-11 rounded-xl px-5"
                        >
                            {t('agreement.start')}
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default AgreementModal;
