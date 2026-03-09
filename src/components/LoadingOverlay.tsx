import React from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';

const LoadingOverlay = ({ message = 'Loading...' }) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background/80 px-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.18),transparent_24%),radial-gradient(circle_at_bottom,hsla(var(--primary),0.08),transparent_30%)]" />
            <div className="relative w-full max-w-md rounded-3xl border border-border/70 bg-card/90 p-8 text-center shadow-2xl">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-background/70 text-primary shadow-sm">
                    <LoaderCircle className="h-8 w-8 animate-spin" />
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/55 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Lux
                </div>
                <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{message}</p>
                <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;
