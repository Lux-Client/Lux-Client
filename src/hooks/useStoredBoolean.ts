import { useCallback, useState } from 'react';

const read = (key: string, fallback: boolean): boolean => {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    } catch {
        // Storage unavailable: fall back to the default.
    }
    return fallback;
};

/**
 * A boolean state that survives restarts of the launcher (kept in
 * localStorage under `key`). Accepts a value or an updater like useState.
 */
export function useStoredBoolean(key: string, fallback: boolean) {
    const [value, setValue] = useState<boolean>(() => read(key, fallback));

    const update = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
        setValue(prev => {
            const resolved = typeof next === 'function' ? next(prev) : next;
            try {
                window.localStorage.setItem(key, String(resolved));
            } catch {
                // Not persisted; the toggle still works for this session.
            }
            return resolved;
        });
    }, [key]);

    return [value, update] as const;
}
