import { useRef, useEffect, useState, useCallback, ReactNode } from 'react';
import { useWindowSize, useMediaQuery } from './useResponsive';

interface ResponsiveContainerProps {
    children: (size: { width: number; height: number; isMobile: boolean; isTablet: boolean; isDesktop: boolean }) => ReactNode;
    fallback?: ReactNode;
    onResize?: (size: { width: number; height: number }) => void;
}

export function ResponsiveContainer({ children, fallback = null, onResize }: ResponsiveContainerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { width, height } = useWindowSize({ debounceMs: 100 });
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const newDims = {
                    width: Math.round(entry.contentRect.width),
                    height: Math.round(entry.contentRect.height),
                };
                setDimensions(newDims);
                onResize?.(newDims);
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [onResize]);

    if (!containerRef.current) return <div ref={containerRef}>{fallback}</div>;

    const isMobile = dimensions.width < 640;
    const isTablet = dimensions.width >= 640 && dimensions.width < 1024;
    const isDesktop = dimensions.width >= 1024;

    return (
        <div ref={containerRef} className="w-full h-full">
            {children({ width: dimensions.width, height: dimensions.height, isMobile, isTablet, isDesktop })}
        </div>
    );
}

interface FluidGridProps {
    items: any[];
    renderItem: (item: any, index: number) => ReactNode;
    minItemWidth?: number;
    maxColumns?: number;
    gap?: number;
    keyExtractor?: (item: any) => string;
}

export function FluidGrid({ items, renderItem, minItemWidth = 200, maxColumns = 6, gap = 16, keyExtractor }: FluidGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [columns, setColumns] = useState(4);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateColumns = () => {
            const width = container.clientWidth - gap * 2;
            const cols = Math.max(1, Math.min(maxColumns, Math.floor(width / minItemWidth)));
            setColumns(cols);
        };

        updateColumns();

        const observer = new ResizeObserver(updateColumns);
        observer.observe(container);
        return () => observer.disconnect();
    }, [minItemWidth, maxColumns, gap]);

    return (
        <div
            ref={containerRef}
            className="grid"
            style={{
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: `${gap}px`,
            }}
        >
            {items.map((item, index) => (
                <div key={keyExtractor?.(item) || index}>
                    {renderItem(item, index)}
                </div>
            ))}
        </div>
    );
}

interface AspectRatioBoxProps {
    ratio?: number;
    children: ReactNode;
    className?: string;
}

export function AspectRatioBox({ ratio = 16 / 9, children, className }: AspectRatioBoxProps) {
    return (
        <div className={`relative w-full ${className}`} style={{ paddingBottom: `${(1 / ratio) * 100}%` }}>
            <div className="absolute inset-0">
                {children}
            </div>
        </div>
    );
}

interface ScrollSnapContainerProps {
    children: ReactNode;
    direction?: 'x' | 'y';
    className?: string;
}

export function ScrollSnapContainer({ children, direction = 'x', className }: ScrollSnapContainerProps) {
    return (
        <div
            className={`flex ${direction === 'x' ? 'flex-row overflow-x-auto' : 'flex-col overflow-y-auto'} scroll-smooth snap-x snap-mandatory ${className}`}
            style={{ scrollSnapType: `${direction === 'x' ? 'x' : 'y'}-mandatory` }}
        >
            {children}
        </div>
    );
}

interface VirtualizedListProps {
    items: any[];
    height: number;
    itemHeight: number;
    renderItem: (item: any, index: number) => ReactNode;
    keyExtractor?: (item: any) => string;
    overscan?: number;
}

export function VirtualizedList({
    items,
    height,
    itemHeight,
    renderItem,
    keyExtractor,
    overscan = 3,
}: VirtualizedListProps) {
    const [scrollTop, setScrollTop] = useState(0);

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
        items.length - 1,
        Math.floor((scrollTop + height) / itemHeight) + overscan
    );

    const visibleItems = items.slice(startIndex, endIndex + 1);

    return (
        <div
            className="overflow-auto"
            style={{ height: `${height}px` }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
            <div style={{ height: `${items.length * itemHeight}px`, position: 'relative' }}>
                {visibleItems.map((item, index) => (
                    <div
                        key={keyExtractor?.(item) || (startIndex + index)}
                        style={{
                            position: 'absolute',
                            top: `${(startIndex + index) * itemHeight}px`,
                            height: `${itemHeight}px`,
                            width: '100%',
                        }}
                    >
                        {renderItem(item, startIndex + index)}
                    </div>
                ))}
            </div>
        </div>
    );
}

export { useWindowSize, useMediaQuery, useBreakpoint } from './useResponsive';