import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import ToggleBox from '../ToggleBox';
import BackgroundVideo from '../BackgroundVideo';
import { useNotification } from '../../context/NotificationContext';
import { useLuxAccount } from '../../context/LuxAccountContext';

type BgMedia = { url: string; type: string };

type SyncStatus = { state: string; action?: string; error?: string; message?: string };

const EMPTY_MEDIA: BgMedia = { url: '', type: 'none' };

function mediaSrc(url: string) {
    return `app-media:///${url.replace(/\\/g, '/')}`;
}

function AccountBackgroundCard() {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const account = useLuxAccount();
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [bgMedia, setBgMedia] = useState<BgMedia>(EMPTY_MEDIA);
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [busy, setBusy] = useState(false);

    const applySettings = useCallback((settings) => {
        if (!settings) return;
        setSyncEnabled(Boolean(settings.accountBackgroundSync));
        setBgMedia(settings.theme?.bgMedia || EMPTY_MEDIA);
    }, []);

    useEffect(() => {
        window.electronAPI.getSettings().then((res) => {
            if (res?.success) applySettings(res.settings);
        });
        const removeSettingsListener = window.electronAPI.onSettingsUpdated?.(applySettings);
        const removeStatusListener = window.electronAPI.onAccountBackgroundStatus?.((next) => {
            setStatus(next);
            if (next.state === 'error' && next.error !== 'offline') {
                addNotification(
                    `${t('settings.account_bg.sync_failed', 'Background sync failed')}: ${next.message || next.error}`,
                    'error'
                );
            }
        });
        return () => {
            removeSettingsListener?.();
            removeStatusListener?.();
        };
    }, [applySettings, addNotification, t]);

    const loggedIn = Boolean(account && account.loggedIn);
    const syncing = status?.state === 'uploading' || status?.state === 'downloading';

    const handleToggle = async (enabled: boolean) => {
        setBusy(true);
        try {
            const res = await window.electronAPI.setAccountBackgroundSync(enabled);
            if (res?.success) {
                applySettings(res.settings);
            } else {
                addNotification(res?.error || t('settings.save_failed'), 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const handleSelect = async () => {
        const picked = await window.electronAPI.selectBackgroundMedia();
        if (!picked?.success || !picked.url) return;
        const res = await window.electronAPI.setBackgroundMedia({ url: picked.url, type: picked.type });
        if (res?.success) {
            applySettings(res.settings);
        } else {
            addNotification(res?.error || t('settings.save_failed'), 'error');
        }
    };

    const handleRemove = async () => {
        const res = await window.electronAPI.setBackgroundMedia(null);
        if (res?.success) applySettings(res.settings);
    };

    const handleSyncNow = async () => {
        setBusy(true);
        try {
            await window.electronAPI.syncAccountBackground();
        } finally {
            setBusy(false);
        }
    };

    const statusText = (() => {
        if (!syncEnabled) return t('settings.account_bg.local_only', 'This device keeps its own background.');
        if (!loggedIn) return t('settings.account_bg.signed_out', 'Sign in to your Lux account to sync the background.');
        if (status?.state === 'uploading') return t('settings.account_bg.uploading', 'Uploading to your account...');
        if (status?.state === 'downloading') return t('settings.account_bg.downloading', 'Loading the background from your account...');
        if (status?.state === 'error') {
            return status.error === 'offline'
                ? t('settings.account_bg.offline', 'Lux Cloud is not reachable, the background syncs later.')
                : t('settings.account_bg.sync_failed', 'Background sync failed');
        }
        return t('settings.account_bg.synced', 'Synced with your Lux account.');
    })();

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-primary" />
                    {t('settings.account_bg.title', 'Background')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                <ToggleBox
                    checked={syncEnabled}
                    onChange={(value: boolean) => { if (!busy) handleToggle(value); }}
                    label={t('settings.account_bg.sync', 'Sync background with Lux account')}
                    description={t(
                        'settings.account_bg.sync_desc',
                        'On: the background you pick here or in Styling applies on every device you are signed in on. Off: this device keeps its own background.'
                    )}
                />

                <div
                    onClick={handleSelect}
                    className="aspect-video max-w-md rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/50 hover:border-primary/50 transition-all group overflow-hidden relative"
                >
                    {bgMedia.url ? (
                        <>
                            {bgMedia.type === 'video' ? (
                                <BackgroundVideo
                                    src={mediaSrc(bgMedia.url)}
                                    className="absolute inset-0 w-full h-full object-cover opacity-60"
                                />
                            ) : (
                                <img
                                    key={bgMedia.url}
                                    src={mediaSrc(bgMedia.url)}
                                    className="absolute inset-0 w-full h-full object-cover opacity-60"
                                    alt=""
                                />
                            )}
                            <span className="relative z-10 text-[10px] font-medium uppercase tracking-wider text-foreground bg-background/60 px-3 py-1 rounded-full border border-border">
                                {t('styling.change_bg')}
                            </span>
                        </>
                    ) : (
                        <>
                            <ImageIcon className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase text-center break-words px-4">
                                {t('styling.select_media')}
                            </span>
                        </>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
                        {statusText}
                    </p>
                    <div className="flex gap-2">
                        {syncEnabled && loggedIn && (
                            <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={busy || syncing}>
                                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                {t('settings.account_bg.sync_now', 'Sync now')}
                            </Button>
                        )}
                        {bgMedia.url && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRemove}
                                className="text-destructive hover:text-destructive"
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                {t('styling.remove_bg')}
                            </Button>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default AccountBackgroundCard;
