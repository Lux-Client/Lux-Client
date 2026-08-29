import React from 'react';
import { ArrowRotateLeft } from "@gravity-ui/icons";

const LoadingOverlay = ({ message }: { message?: string }) => {
    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background/80 px-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.18),transparent_24%),radial-gradient(circle_at_bottom,hsla(var(--primary),0.08),transparent_30%)]" />
            <div className="relative flex h-14 w-14 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-border" />
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
                <ArrowRotateLeft className="h-5 w-5 animate-spin text-primary" />
            </div>
            {message && (
                <p className="relative mt-5 animate-in fade-in text-sm font-medium text-foreground duration-300">{message}</p>
            )}
        </div>
    );
};

export default LoadingOverlay;
