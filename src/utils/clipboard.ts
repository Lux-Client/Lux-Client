/**
 * Copies text to the clipboard. `navigator.clipboard` is unavailable in some packaged
 * Electron contexts, so fall back to the main process and finally to execCommand.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (typeof text !== 'string' || !text) return false;

    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        console.warn('[Clipboard] navigator.clipboard failed, falling back', e);
    }

    try {
        const api = (window as any).electronAPI;
        if (api?.copyToClipboard) {
            const res = await api.copyToClipboard(text);
            if (res?.success) return true;
        }
    } catch (e) {
        console.warn('[Clipboard] electron clipboard failed, falling back', e);
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (e) {
        console.error('[Clipboard] Copy failed', e);
        return false;
    }
};
