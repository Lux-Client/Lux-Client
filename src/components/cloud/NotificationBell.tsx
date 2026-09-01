import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Info, CheckCircle2, AlertTriangle, XCircle, CheckCheck } from 'lucide-react';

import { useLuxAccount } from '../../context/LuxAccountContext';

const POLL_MS = 5 * 60 * 1000;

const TYPE_STYLES: Record<string, { icon: any; tone: string }> = {
    info: { icon: Info, tone: 'text-sky-300' },
    success: { icon: CheckCircle2, tone: 'text-emerald-300' },
    warning: { icon: AlertTriangle, tone: 'text-amber-300' },
    error: { icon: XCircle, tone: 'text-red-300' }
};

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

function formatWhen(value: string, t: any) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const diff = Date.now() - date.getTime();
    if (diff < 60000) return t('cloud.bell.just_now', 'just now');
    if (diff < 3600000) return t('cloud.bell.minutes', { defaultValue: '{{count}} min ago', count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('cloud.bell.hours', { defaultValue: '{{count}} h ago', count: Math.floor(diff / 3600000) });
    return date.toLocaleDateString();
}

export default function NotificationBell() {
    const { t } = useTranslation();
    const account = useLuxAccount();

    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<any[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const load = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.luxCloudGetNotifications !== 'function') return;

        setLoading(true);
        try {
            const result = await api.luxCloudGetNotifications(30);
            if (result && result.success !== false) {
                setItems(result.notifications || []);
                setUnread(Number(result.unreadCount) || 0);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!account || !account.loggedIn) {
            setItems([]);
            setUnread(0);
            return undefined;
        }

        load();
        const timer = setInterval(load, POLL_MS);
        return () => clearInterval(timer);
    }, [account?.loggedIn, load]);

    useEffect(() => {
        if (!open) return undefined;

        const onOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onOutside);
        return () => document.removeEventListener('mousedown', onOutside);
    }, [open]);

    if (!account || !account.loggedIn) return null;

    const markAll = async () => {
        const api = bridge();
        if (!api) return;
        await api.luxCloudMarkNotificationsRead();
        setUnread(0);
        setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    };

    const openAndRead = async () => {
        const next = !open;
        setOpen(next);
        if (next) await load();
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={openAndRead}
                aria-label={t('cloud.bell.label', 'Notifications')}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
            >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-full z-[70] mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
                            {t('cloud.bell.title', 'Notifications')}
                        </span>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={markAll}
                                className="flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white/80"
                            >
                                <CheckCheck size={11} />
                                {t('cloud.bell.mark_all', 'Mark all read')}
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {loading && items.length === 0 && (
                            <p className="px-3 py-6 text-center text-xs text-white/35">
                                {t('cloud.bell.loading', 'Loading...')}
                            </p>
                        )}

                        {!loading && items.length === 0 && (
                            <p className="px-3 py-8 text-center text-xs text-white/35">
                                {t('cloud.bell.empty', 'Nothing here yet.')}
                            </p>
                        )}

                        {items.map((item) => {
                            const style = TYPE_STYLES[item.type] || TYPE_STYLES.info;
                            const Icon = style.icon;
                            return (
                                <div
                                    key={item.id}
                                    className={`flex gap-2.5 border-b border-white/5 px-3 py-2.5 last:border-b-0 ${
                                        item.isRead ? '' : 'bg-white/[0.03]'
                                    }`}
                                >
                                    <Icon size={14} className={`mt-0.5 shrink-0 ${style.tone}`} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs leading-relaxed text-white/75">{item.message}</p>
                                        <p className="mt-1 text-[10px] text-white/30">{formatWhen(item.createdAt, t)}</p>
                                    </div>
                                    {!item.isRead && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
