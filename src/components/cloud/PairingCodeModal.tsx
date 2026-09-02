import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, ExternalLink, Loader2, X } from 'lucide-react';

type Props = {
    open: boolean;
    onClose: () => void;
    onSignedIn: () => void;
};

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function PairingCodeModal({ open, onClose, onSignedIn }: Props) {
    const { t } = useTranslation();

    const [pairing, setPairing] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const pollTimer = useRef<any>(null);
    const tickTimer = useRef<any>(null);

    const stop = useCallback(() => {
        if (pollTimer.current) clearTimeout(pollTimer.current);
        if (tickTimer.current) clearInterval(tickTimer.current);
        pollTimer.current = null;
        tickTimer.current = null;
    }, []);

    const close = useCallback(() => {
        stop();
        bridge()?.luxCloudCancelPairing?.();
        setPairing(null);
        setError(null);
        onClose();
    }, [onClose, stop]);

    const poll = useCallback(async (intervalMs: number) => {
        const api = bridge();
        if (!api) return;

        const result = await api.luxCloudPollPairing();

        if (result && result.success === false) {
            stop();
            setError(result.message || result.error);
            return;
        }
        if (result && result.status === 'done') {
            stop();
            onSignedIn();
            onClose();
            return;
        }
        pollTimer.current = setTimeout(() => poll(intervalMs), intervalMs);
    }, [onClose, onSignedIn, stop]);

    useEffect(() => {
        if (!open) return undefined;

        let cancelled = false;
        (async () => {
            const api = bridge();
            if (!api || typeof api.luxCloudStartPairing !== 'function') {
                setError(t('cloud.pairing.unsupported', 'This build cannot use pairing codes.'));
                return;
            }

            setError(null);
            setPairing(null);

            const result = await api.luxCloudStartPairing();
            if (cancelled) return;

            if (!result || result.success === false) {
                setError(result?.message || t('cloud.pairing.failed', 'Could not request a code.'));
                return;
            }

            setPairing(result.pairing);
            setSecondsLeft(result.pairing.expiresIn || 600);

            tickTimer.current = setInterval(() => {
                setSecondsLeft((value) => (value > 0 ? value - 1 : 0));
            }, 1000);

            poll((result.pairing.interval || 3) * 1000);
        })();

        return () => { cancelled = true; stop(); };
    }, [open, poll, stop, t]);

    if (!open) return null;

    const copy = async () => {
        if (!pairing) return;
        try {
            await navigator.clipboard.writeText(pairing.userCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            // Clipboard access can be denied; the code is on screen anyway.
        }
    };

    const minutes = Math.floor(secondsLeft / 60);
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    const expired = secondsLeft <= 0 && Boolean(pairing);

    return (
        <div className="fixed inset-0 z-[126] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161616] shadow-2xl">
                <div className="flex items-start justify-between border-b border-white/10 p-5">
                    <div>
                        <h2 className="text-base font-semibold text-white">
                            {t('cloud.pairing.title', 'Sign in with a code')}
                        </h2>
                        <p className="mt-1 text-sm text-white/50">
                            {t('cloud.pairing.subtitle', 'Use this if the browser sign-in does not come back.')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        className="rounded p-1 text-white/35 transition hover:bg-white/10 hover:text-white/70"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="p-6">
                    {error && (
                        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>
                    )}

                    {!error && !pairing && (
                        <div className="flex flex-col items-center gap-3 py-8 text-white/50">
                            <Loader2 size={24} className="animate-spin" />
                            <span className="text-sm">{t('cloud.pairing.requesting', 'Requesting a code...')}</span>
                        </div>
                    )}

                    {!error && pairing && (
                        <>
                            <ol className="mb-5 space-y-1.5 text-sm text-white/65">
                                <li>
                                    1. {t('cloud.pairing.step_open', 'Open this page on any device:')}{' '}
                                    <button
                                        type="button"
                                        onClick={() => bridge()?.openExternal?.(pairing.verificationUri)}
                                        className="inline-flex items-center gap-1 font-medium text-sky-300 hover:underline"
                                    >
                                        {String(pairing.verificationUri).replace(/^https?:\/\//, '')}
                                        <ExternalLink size={11} />
                                    </button>
                                </li>
                                <li>2. {t('cloud.pairing.step_enter', 'Enter the code below and confirm.')}</li>
                            </ol>

                            <button
                                type="button"
                                onClick={copy}
                                disabled={expired}
                                className="group flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-black/40 py-6 transition hover:border-sky-400/40 disabled:opacity-40"
                            >
                                <span className="font-mono text-4xl tracking-[0.35em] text-white">
                                    {pairing.userCode}
                                </span>
                                {copied
                                    ? <Check size={16} className="text-emerald-300" />
                                    : <Copy size={16} className="text-white/30 group-hover:text-white/60" />}
                            </button>

                            <p className="mt-3 text-center text-xs text-white/40">
                                {expired
                                    ? t('cloud.pairing.expired', 'This code has expired. Close and try again.')
                                    : t('cloud.pairing.valid_for', {
                                        defaultValue: 'Valid for {{minutes}}:{{seconds}} · waiting for confirmation',
                                        minutes,
                                        seconds
                                    })}
                            </p>

                            <p className="mt-5 rounded-lg bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200/80">
                                {t('cloud.pairing.warning',
                                    'Never give this code to anyone. Whoever enters it connects their PC to your account.')}
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
