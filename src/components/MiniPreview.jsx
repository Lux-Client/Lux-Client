import React from 'react';

function MiniPreview({ theme }) {
    return (
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
            { }
            <div
                className="absolute inset-0"
                style={{ background: theme.backgroundColor }}
            >
                {theme.bgMedia?.url && (
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{
                            backgroundImage: `url(app-media:///${theme.bgMedia.url.replace(/\\/g, '/')})`,
                            opacity: 1 - (theme.bgOverlay ?? 0.4)
                        }}
                    />
                )}
                <div
                    className="absolute inset-0"
                    style={{
                        background: theme.backgroundColor,
                        opacity: theme.bgOverlay ?? 0.4
                    }}
                />
            </div>

            { }
            <div
                className="absolute left-2 top-2 bottom-2 w-8 rounded-xl flex flex-col items-center py-3 gap-1"
                style={{
                    background: `rgba(${theme.surfaceColor ? hexToRgb(theme.surfaceColor) : '28, 28, 28'}, ${theme.panelOpacity ?? 0.85})`,
                    backdropFilter: `blur(${theme.glassBlur || 10}px)`,
                    border: '1px solid rgba(255, 255, 255, 0.05)'
                }}
            >
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="w-6 h-6 rounded-lg flex items-center justify-center transition-all"
                        style={{
                            background: i === 1 ? theme.primaryColor : 'transparent',
                            boxShadow: i === 1 ? `0 0 ${(theme.sidebarGlow ?? 0) * 20}px ${theme.primaryColor}` : 'none',
                            color: i === 1 ? '#000' : '#666'
                        }}
                    >
                        <div className="w-3 h-3 rounded-sm bg-current opacity-50" />
                    </div>
                ))}
            </div>

            { }
            <div className="absolute left-14 top-2 right-2 bottom-2 flex flex-col gap-2">
                { }
                <div
                    className="flex-1 rounded-xl p-3"
                    style={{
                        background: `rgba(${theme.surfaceColor ? hexToRgb(theme.surfaceColor) : '28, 28, 28'}, ${theme.panelOpacity ?? 0.85})`,
                        backdropFilter: `blur(${theme.glassBlur || 10}px)`,
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: `${theme.borderRadius ?? 12}px`
                    }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div
                            className="w-4 h-4 rounded"
                            style={{
                                background: theme.primaryColor,
                                borderRadius: `${(theme.borderRadius ?? 12) / 2}px`
                            }}
                        />
                        <div className="flex-1 h-2 bg-white/10 rounded-full" />
                    </div>
                    <div className="space-y-1">
                        <div className="h-1.5 bg-white/5 rounded-full w-3/4" />
                        <div className="h-1.5 bg-white/5 rounded-full w-1/2" />
                    </div>
                </div>

                { }
                <div
                    className="h-8 rounded-lg flex items-center justify-center text-[8px] font-bold"
                    style={{
                        background: theme.primaryColor,
                        color: '#000',
                        borderRadius: `${theme.borderRadius ?? 12}px`,
                        boxShadow: `0 0 ${(theme.sidebarGlow ?? 0) * 20}px ${theme.primaryColor}40`
                    }}
                >
                    PREVIEW
                </div>
            </div>

            { }
            <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-md border border-white/10">
                <span className="text-[8px] font-bold text-white uppercase tracking-wider">Live Preview</span>
            </div>
        </div>
    );
}
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

export default MiniPreview;
