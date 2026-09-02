import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

// Matches the 150ms default of the tailwindcss-animate exit utilities, so the
// panel is unmounted exactly when its closing animation has finished.
export const POPOVER_EXIT_MS = 150;

const BODY_FLAG = 'data-titlebar-popover';

// The title bar is an Electron drag region, and Chromium never forwards clicks
// inside a drag region to the renderer. Any popover anchored there therefore
// asks the title bar to drop its drag behaviour while it is open, otherwise a
// click on the bare title bar could not dismiss it. Reference counted because
// two popovers may briefly overlap while one is animating out.
let openPopovers = 0;

function retainNoDrag() {
    openPopovers += 1;
    if (typeof document !== 'undefined') {
        document.body.setAttribute(BODY_FLAG, 'open');
    }
}

function releaseNoDrag() {
    openPopovers = Math.max(0, openPopovers - 1);
    if (openPopovers === 0 && typeof document !== 'undefined') {
        document.body.removeAttribute(BODY_FLAG);
    }
}

export interface TitlebarPopover<T extends HTMLElement> {
    /** Attach to the element wrapping both the trigger and the panel. */
    containerRef: MutableRefObject<T | null>;
    /** Whether the popover should be shown, i.e. its animation target. */
    open: boolean;
    /** Whether the panel belongs in the tree - stays true while it animates out. */
    mounted: boolean;
    /** `data-state` value for the panel, drives the enter/exit animation. */
    state: 'open' | 'closed';
    setOpen: (open: boolean) => void;
    toggle: () => void;
}

/**
 * Open/close state for a popover anchored in the title bar.
 *
 * Keeps the panel mounted for the length of its exit animation and dismisses it
 * on an outside click, on Escape, and when the window loses focus.
 */
export function useTitlebarPopover<T extends HTMLElement>(animationsEnabled: boolean): TitlebarPopover<T> {
    const containerRef = useRef<T | null>(null);
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            return undefined;
        }

        if (!animationsEnabled) {
            setMounted(false);
            return undefined;
        }

        const timer = setTimeout(() => setMounted(false), POPOVER_EXIT_MS);
        return () => clearTimeout(timer);
    }, [open, animationsEnabled]);

    useEffect(() => {
        if (!open) return undefined;

        const close = () => setOpen(false);
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current || !containerRef.current.contains(event.target as Node)) {
                close();
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };

        retainNoDrag();
        // Capture phase, so an overlay that stops propagation cannot swallow the
        // dismiss before it reaches us.
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('blur', close);

        return () => {
            releaseNoDrag();
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('blur', close);
        };
    }, [open]);

    const toggle = useCallback(() => setOpen((value) => !value), []);

    return { containerRef, open, mounted, state: open ? 'open' : 'closed', setOpen, toggle };
}

export default useTitlebarPopover;
