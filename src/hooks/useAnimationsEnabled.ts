import { useEffect, useState } from 'react';

// Cached across the session so that re-opening a modal respects the user's
// performance preferences instantly (the first resolution primes this).
let cachedAnimationsEnabled: boolean | null = null;

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

/**
 * Returns whether decorative UI animations (modal entrances, etc.) should play.
 *
 * Animations are suppressed when the user runs a performance-oriented mode
 * (Low Graphics), explicitly disabled Page Animations, or has the OS-level
 * "reduce motion" preference set.
 */
export function useAnimationsEnabled(): boolean {
    const [enabled, setEnabled] = useState<boolean>(() =>
        cachedAnimationsEnabled !== null ? cachedAnimationsEnabled : !prefersReducedMotion()
    );

    useEffect(() => {
        let active = true;

        (async () => {
            let lowGraphics = false;
            let pageAnimationsOff = false;
            try {
                const res = await window.electronAPI?.getSettings?.();
                if (res?.success && res.settings) {
                    lowGraphics = res.settings.lowGraphicsMode === true;
                    pageAnimationsOff = res.settings.pageAnimationsEnabled === false;
                }
            } catch {
                // Fall back to motion preference only.
            }

            const result = !(prefersReducedMotion() || lowGraphics || pageAnimationsOff);
            cachedAnimationsEnabled = result;
            if (active) setEnabled(result);
        })();

        return () => {
            active = false;
        };
    }, []);

    return enabled;
}

export default useAnimationsEnabled;
