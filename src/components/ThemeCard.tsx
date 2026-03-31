import React from 'react';

function ThemeCard({ theme, onApply, onDelete, isCustom = false }: { theme: any; onApply: any; onDelete?: any; isCustom?: boolean }) {
    const primary = theme?.primary || theme?.primaryColor || '#22e07a';
    const bg = theme?.bg || theme?.background || theme?.backgroundColor || '#0d1117';
    const surface = theme?.surface || theme?.surfaceColor || '#161b22';

    const hexToRgb = (hex) => {
        const normalized = hex?.replace('#', '');
        if (!normalized || normalized.length !== 6) return '34, 224, 122';
        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    };

    const primaryRgb = hexToRgb(primary);

    return (
        <button
            onClick={onApply}
            className="group relative overflow-hidden rounded-xl border border-border hover:border-primary/30 transition-all duration-300"
        >
            { }
            <div className="h-20 relative overflow-hidden">
                <div
                    className="absolute inset-0 opacity-40"
                    style={{ background: bg }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background: `linear-gradient(135deg, rgba(${primaryRgb}, 0.125) 0%, rgba(${primaryRgb}, calc(0.125 * (1 - var(--global-glow-intensity, 0)))) 100%)`
                    }}
                />
                <div
                    className="absolute bottom-2 left-2 w-8 h-8 rounded-lg shadow-lg border-2 border-border"
                    style={{
                        background: primary,
                        boxShadow: `0 0 calc(20px * var(--global-glow-intensity, 0)) rgba(${primaryRgb}, calc(0.375 * var(--global-glow-intensity, 0)))`
                    }}
                />
                <div
                    className="absolute bottom-2 right-2 w-6 h-6 rounded-md opacity-60"
                    style={{ background: surface }}
                />
            </div>

            { }
            <div className="bg-card backdrop-blur-sm p-3 border-t border-border">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground transition-colors truncate pr-2">
                        {theme.name || theme.handle || 'Theme'}
                    </span>
                    {isCustom && onDelete && (
                        <div
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            className="p-1 hover:bg-red-500/20 rounded-md text-muted-foreground hover:text-red-400 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
}

export default ThemeCard;
