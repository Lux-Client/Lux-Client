import { useState, useEffect, useCallback, useRef } from 'react';

interface WindowSize {
    width: number;
    height: number;
}

interface UseWindowResizeOptions {
    debounceMs?: number;
    initialSize?: WindowSize;
}

export function useWindowSize(options: UseWindowResizeOptions = {}): WindowSize {
    const { debounceMs = 0 } = options;
    const [size, setSize] = useState<WindowSize>({
        width: typeof window !== 'undefined' ? window.innerWidth : 1024,
        height: typeof window !== 'undefined' ? window.innerHeight : 768,
    });

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const updateSize = () => {
            if (debounceMs > 0) {
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    setSize({ width: window.innerWidth, height: window.innerHeight });
                }, debounceMs);
            } else {
                setSize({ width: window.innerWidth, height: window.innerHeight });
            }
        };

        updateSize();

        window.addEventListener('resize', updateSize);
        return () => {
            window.removeEventListener('resize', updateSize);
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [debounceMs]);

    return size;
}

export function useBreakpoint(breakpoint: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'): boolean {
    const { width } = useWindowSize();
    const breakpoints: Record<string, number> = {
        'sm': 640,
        'md': 768,
        'lg': 1024,
        'xl': 1280,
        '2xl': 1536,
        '3xl': 1920,
    };
    return width >= breakpoints[breakpoint];
}

export function useMediaQuery(query: string): boolean {
    const getMatch = (mediaQuery: string): boolean => {
        if (typeof window !== 'undefined') {
            return window.matchMedia(mediaQuery).matches;
        }
        return false;
    };

    const [matches, setMatches] = useState(getMatch(query));

    useEffect(() => {
        const mediaQuery = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
        
        mediaQuery.addEventListener('change', handler);
        setMatches(mediaQuery.matches);
        
        return () => mediaQuery.removeEventListener('change', handler);
    }, [query]);

    return matches;
}

export function useIsTouch(): boolean {
    return useMediaQuery('(pointer: coarse)');
}

export function usePrefersReducedMotion(): boolean {
    return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function usePrefersDark(): boolean {
    return useMediaQuery('(prefers-color-scheme: dark)');
}

interface ResponsiveGridOptions {
    minItemWidth?: number;
    maxColumns?: number;
    gap?: number;
}

export function useResponsiveGrid(options: ResponsiveGridOptions = {}) {
    const { minItemWidth = 200, maxColumns = 6, gap = 16 } = options;
    const { width } = useWindowSize();
    const padding = gap * 2;
    const availableWidth = width - padding;
    const columns = Math.max(1, Math.min(maxColumns, Math.floor(availableWidth / minItemWidth)));
    const itemWidth = Math.floor(availableWidth / columns);
    
    return { columns, itemWidth, availableWidth };
}

export function useSidebarWidth(collapsed: boolean): string {
    const { width } = useWindowSize();
    
    useEffect(() => {
        const root = document.documentElement;
        if (width < 768) {
            root.style.setProperty('--sidebar-width', '0px');
            root.style.setProperty('--sidebar-width-expanded', '100%');
        } else {
            root.style.setProperty('--sidebar-width', '64px');
            root.style.setProperty('--sidebar-width-expanded', '248px');
        }
    }, [width]);
    
    return collapsed ? 'var(--sidebar-width)' : 'var(--sidebar-width-expanded)';
}

export function useFluidText(baseSize = 16, minSize = 12, maxSize = 24) {
    const { width } = useWindowSize();
    const minWidth = 320;
    const maxWidth = 1920;
    const slope = (maxSize - baseSize) / (maxWidth - minWidth);
    const clampedWidth = Math.max(minWidth, Math.min(width, maxWidth));
    const calculatedSize = baseSize + slope * (clampedWidth - minWidth);
    return `${Math.max(minSize, Math.min(maxSize, calculatedSize))}px`;
}

export function useContainerQuery(containerRef: React.RefObject<HTMLElement>) {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef]);

    return dimensions;
}

export default useWindowSize;