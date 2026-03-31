import React from 'react';
import { LoaderCircle } from 'lucide-react';

const LoadingOverlay = ({ message }: { message?: string }) => {
    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background/80 px-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.18),transparent_24%),radial-gradient(circle_at_bottom,hsla(var(--primary),0.08),transparent_30%)]" />
            <LoaderCircle className="relative h-10 w-10 animate-spin text-primary" />
            {message && (
                <p className="relative mt-4 text-sm font-medium text-foreground">{message}</p>
            )}
        </div>
    );
};

export default LoadingOverlay;
