import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CloudOff,
    Laptop,
    Loader2,
    LogOut,
    Monitor,
    RefreshCw,
    ShieldCheck,
    UserCircle2,
    KeyRound,
    Camera
} from 'lucide-react';

import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import ToggleBox from '../ToggleBox';
import ConfirmationModal from '../ConfirmationModal';
import PairingCodeModal from './PairingCodeModal';
import CloudDashboard from './CloudDashboard';
import { useLuxAccount, type LuxCloudDevice, type LuxCloudSettings } from '../../context/LuxAccountContext';

const PLATFORM_LABELS: Record<string, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux'
};

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatLastSeen(value: string | null, t: (key: string, fallback: string) => string) {
    if (!value) return t('settings.lux_account.never_seen', 'never');

    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return t('settings.lux_account.never_seen', 'never');

    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 5) return t('settings.lux_account.seen_now', 'just now');
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;

    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

const DeviceRow = ({
    device,
    busy,
    onRevoke,
    t
}: {
    device: LuxCloudDevice;
    busy: boolean;
    onRevoke: (device: LuxCloudDevice) => void;
    t: (key: string, fallback: string) => string;
}) => (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
            <Laptop className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                    {device.name || t('settings.lux_account.unnamed_device', 'Unnamed device')}
                    {device.isCurrent && (
                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {t('settings.lux_account.this_device', 'this device')}
                        </span>
                    )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                    {PLATFORM_LABELS[device.platform] || device.platform}
                    {device.appVersion ? ` · v${device.appVersion}` : ''}
                    {' · '}
                    {formatLastSeen(device.lastSeenAt, t)}
                </p>
            </div>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRevoke(device)}>
            {t('settings.lux_account.sign_out_device', 'Sign out')}
        </Button>
    </div>
);

const LuxAccountPanel = () => {
    const { t } = useTranslation();
    const account = useLuxAccount();
    const [pendingRevoke, setPendingRevoke] = useState<LuxCloudDevice | null>(null);
    const [busy, setBusy] = useState(false);
    const [pairingOpen, setPairingOpen] = useState(false);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const [avatarBroken, setAvatarBroken] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [codeBusy, setCodeBusy] = useState(false);
    const [codeError, setCodeError] = useState<string | null>(null);

    const avatarUrl = account && account.user ? account.user.avatar : null;

    useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);

    const reload = account ? account.reload : null;

    useEffect(() => { if (reload) reload(); }, [reload]);

    if (!account || !account.supported) return null;

    const submitManualCode = async () => {
        const api = (window as any).electronAPI;
        if (!api || typeof api.luxCloudRedeemCode !== 'function') return;

        setCodeBusy(true);
        setCodeError(null);
        try {
            const result = await api.luxCloudRedeemCode(manualCode);
            if (!result || result.success === false) {
                setCodeError(result?.message || 'That code did not work.');
                return;
            }
            setManualCode('');
            await account.reload();
        } finally {
            setCodeBusy(false);
        }
    };

    const changeAvatar = async () => {
        const api = (window as any).electronAPI;
        if (!api || typeof api.luxCloudSetAvatar !== 'function') return;

        setAvatarBusy(true);
        setAvatarError(null);
        try {
            const result = await api.luxCloudSetAvatar();
            if (!result || result.success === false) {
                setAvatarError(result?.message || result?.error || 'The picture could not be saved.');
                return;
            }
            if (!result.cancelled) {
                setAvatarBroken(false);
                await account.reload();
            }
        } catch (err: any) {
            setAvatarError(String(err?.message || err));
        } finally {
            setAvatarBusy(false);
        }
    };

    const {
        devices,
        error,
        loading,
        loggedIn,
        offline,
        quota,
        settings,
        signingIn,
        user
    } = account;

    const toggles: Array<{ key: keyof LuxCloudSettings; label: string; description: string }> = [
        {
            key: 'cloudSyncEnabled',
            label: t('settings.lux_account.cloud_sync', 'Cloud Sync'),
            description: t('settings.lux_account.cloud_sync_desc', 'Keep instances in sync with your Lux Cloud.')
        },
        {
            key: 'autoSync',
            label: t('settings.lux_account.auto_sync', 'Auto Sync'),
            description: t('settings.lux_account.auto_sync_desc', 'Upload changes automatically after playing.')
        },
        {
            key: 'crossPlatformDefault',
            label: t('settings.lux_account.cross_platform', 'Cross-Platform'),
            description: t('settings.lux_account.cross_platform_desc', 'Default for new instances: available on Windows, macOS and Linux.')
        },
        {
            key: 'syncWorldsDefault',
            label: t('settings.lux_account.sync_worlds', 'Sync worlds'),
            description: t('settings.lux_account.sync_worlds_desc', 'Off by default. Worlds are large and change constantly.')
        },
        {
            key: 'syncScreenshotsDefault',
            label: t('settings.lux_account.sync_screenshots', 'Sync screenshots'),
            description: t('settings.lux_account.sync_screenshots_desc', 'Off by default.')
        }
    ];

    const handleRevoke = async () => {
        if (!pendingRevoke) return;
        setBusy(true);
        await account.revokeDevice(pendingRevoke.deviceUuid);
        setBusy(false);
        setPendingRevoke(null);
    };

    const quotaPercent = quota && quota.quotaBytes > 0
        ? Math.min(100, Math.round((quota.usedBytes / quota.quotaBytes) * 100))
        : 0;

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                        {t('settings.lux_account.title', 'Lux Account')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    {loading && !loggedIn ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('common.loading', 'Loading...')}
                        </div>
                    ) : !loggedIn ? (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                {t('settings.lux_account.signed_out_desc', 'Optional. Lux works fully without a Lux account — signing in adds cloud sync for your instances across your PCs.')}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                                <Button onClick={() => account.signIn()} disabled={signingIn}>
                                    {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                    <span>
                                        {signingIn
                                            ? t('settings.lux_account.waiting_for_browser', 'Waiting for your browser...')
                                            : t('settings.lux_account.sign_in', 'Sign in with a Lux account')}
                                    </span>
                                </Button>
                                {signingIn && (
                                    <Button variant="ghost" size="sm" onClick={() => account.cancelSignIn()}>
                                        {t('common.cancel', 'Cancel')}
                                    </Button>
                                )}
                                <Button variant="outline" onClick={() => setPairingOpen(true)} disabled={signingIn}>
                                    <KeyRound className="h-4 w-4" />
                                    <span>{t('settings.lux_account.use_code', 'Use a code instead')}</span>
                                </Button>
                            </div>
                            {signingIn && (
                                <div className="space-y-2 rounded-lg border border-border/70 bg-background/50 p-3">
                                    <p className="text-xs text-muted-foreground">
                                        {t('settings.lux_account.browser_hint', 'Approve the request in the browser window that just opened, then come back here.')}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('settings.lux_account.code_hint', 'Nothing happened? The website shows a six-character code after you confirm — enter it here.')}
                                    </p>
                                    <div className="flex gap-2">
                                        <input
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value.toUpperCase().slice(0, 6))}
                                            placeholder="ABC123"
                                            className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-center font-mono text-sm tracking-[0.2em] uppercase outline-none focus:border-primary"
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={manualCode.length !== 6 || codeBusy}
                                            onClick={submitManualCode}
                                        >
                                            {codeBusy
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : t('settings.lux_account.submit_code', 'Sign in')}
                                        </Button>
                                    </div>
                                    {codeError && <p className="text-xs text-destructive">{codeError}</p>}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={changeAvatar}
                                        disabled={avatarBusy}
                                        title={t('settings.lux_account.change_avatar', 'Change profile picture')}
                                        className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-full disabled:opacity-50"
                                    >
                                        {user?.avatar && !avatarBroken ? (
                                            <img
                                                src={user.avatar}
                                                alt=""
                                                onError={() => setAvatarBroken(true)}
                                                className="h-10 w-10 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
                                                <UserCircle2 className="h-5 w-5 text-primary" />
                                            </div>
                                        )}
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100">
                                            {avatarBusy
                                                ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                                                : <Camera className="h-4 w-4 text-white" />}
                                        </span>
                                    </button>
                                    <div>
                                        <p className="font-medium text-foreground">{user?.username}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {offline
                                                ? t('settings.lux_account.offline', 'Offline — showing the last known state')
                                                : t('settings.lux_account.connected', 'Connected to Lux Cloud')}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => account.reload()} disabled={loading}>
                                        <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                                        <span>{t('common.refresh', 'Refresh')}</span>
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => account.signOut()}>
                                        <LogOut className="h-4 w-4" />
                                        <span>{t('settings.lux_account.sign_out', 'Sign out')}</span>
                                    </Button>
                                </div>
                            </div>

                            {offline && (
                                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                    <CloudOff className="h-4 w-4" />
                                    {t('settings.lux_account.offline_hint', 'Lux Cloud is not reachable right now. Your account stays signed in.')}
                                </div>
                            )}

                            {settings && (
                                <>
                                    <Separator />
                                    <div className="space-y-4">
                                        {toggles.map((toggle) => (
                                            <ToggleBox
                                                key={toggle.key}
                                                checked={Boolean(settings[toggle.key])}
                                                onChange={(value: boolean) => account.updateSetting(toggle.key, value)}
                                                label={toggle.label}
                                                description={toggle.description}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}

                            {quota && (
                                <>
                                    <Separator />
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-medium text-foreground">
                                                {t('settings.lux_account.storage', 'Storage')}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatBytes(quota.usedBytes)} / {formatBytes(quota.quotaBytes)}
                                                {' · '}
                                                {quota.instanceCount} / {quota.maxInstances}{' '}
                                                {t('settings.lux_account.instances', 'instances')}
                                            </span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                            <div
                                                className="h-full rounded-full bg-primary transition-all"
                                                style={{ width: `${quotaPercent}%` }}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            {avatarError && (
                                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                    {avatarError}
                                </p>
                            )}

                            <Separator />
                            <CloudDashboard />

                            <Separator />
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Monitor className="h-4 w-4 text-muted-foreground" />
                                    <p className="text-sm font-medium text-foreground">
                                        {t('settings.lux_account.devices', 'Signed-in devices')}
                                    </p>
                                </div>
                                {devices.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {t('settings.lux_account.no_devices', 'No devices could be loaded.')}
                                    </p>
                                ) : (
                                    devices.map((device) => (
                                        <DeviceRow
                                            key={device.deviceUuid}
                                            device={device}
                                            busy={busy}
                                            onRevoke={setPendingRevoke}
                                            t={t as any}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {error.message}
                        </div>
                    )}
                </CardContent>
            </Card>

            {pendingRevoke && (
                <ConfirmationModal
                    onCancel={() => setPendingRevoke(null)}
                    onConfirm={handleRevoke}
                    isDangerous
                    title={t('settings.lux_account.revoke_title', 'Sign out this device?')}
                    message={
                        pendingRevoke.isCurrent
                            ? t('settings.lux_account.revoke_self', 'This is the device you are using right now. You will be signed out of your Lux account here.')
                            : t('settings.lux_account.revoke_other', 'That device will have to sign in again before it can sync.')
                    }
                    confirmText={t('settings.lux_account.sign_out_device', 'Sign out')}
                />
            )}

            <PairingCodeModal
                open={pairingOpen}
                onClose={() => setPairingOpen(false)}
                onSignedIn={() => account.reload()}
            />
        </>
    );
};

export default LuxAccountPanel;
