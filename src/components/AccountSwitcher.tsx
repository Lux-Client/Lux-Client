import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, Trash2, UserPlus, Loader2 } from 'lucide-react';

import AccountHead from './AccountHead';
import WindowControls from './WindowControls';

type Account = { uuid: string; name: string; type?: string };

type Props = {
    accounts: Account[];
    onPicked: (profile: any) => void;
    onAccountsChanged?: (accounts: Account[]) => void;
    onCancel?: (() => void) | null;
    isMaximized?: boolean;
};

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

export default function AccountSwitcher({
    accounts,
    onPicked,
    onAccountsChanged,
    onCancel = null,
    isMaximized = false
}: Props) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [list, setList] = useState<Account[]>(accounts || []);

    useEffect(() => { setList(accounts || []); }, [accounts]);

    const refresh = useCallback(async () => {
        const api = bridge();
        if (!api || typeof api.getAccounts !== 'function') return [];
        const next = (await api.getAccounts()) || [];
        setList(next);
        if (onAccountsChanged) onAccountsChanged(next);
        return next;
    }, [onAccountsChanged]);

    const pick = async (uuid: string) => {
        const api = bridge();
        if (!api) return;

        setBusy(uuid);
        setError(null);
        try {
            const res = await api.switchAccount(uuid);
            if (!res || res.success === false) {
                setError(res?.error || t('login.failed', 'Sign-in failed.'));
                return;
            }

            if (typeof api.validateSession === 'function') {
                const valid = await api.validateSession();
                if (!valid || valid.success === false) {
                    setError(t('login.session_expired', 'This account needs to sign in again.'));
                    return;
                }
                onPicked(await api.getProfile());
                return;
            }
            onPicked(res.profile);
        } catch (err: any) {
            setError(err?.message || t('login.failed', 'Sign-in failed.'));
        } finally {
            setBusy(null);
        }
    };

    const addAccount = async () => {
        const api = bridge();
        if (!api || typeof api.login !== 'function') return;

        setBusy('add');
        setError(null);
        try {
            const res = await api.login();
            if (res?.success) {
                onPicked(res.profile);
                return;
            }
            setError(res?.error || t('login.failed', 'Sign-in failed.'));
        } catch (err: any) {
            setError(err?.message || t('login.failed', 'Sign-in failed.'));
        } finally {
            setBusy(null);
        }
    };

    const remove = async (uuid: string) => {
        const api = bridge();
        if (!api || typeof api.removeAccount !== 'function') return;

        setBusy(uuid);
        try {
            await api.removeAccount(uuid);
            await refresh();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="relative flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
            <WindowControls
                isMaximized={isMaximized}
                className="fixed top-4 right-4 z-[10001] rounded-xl border border-border bg-popover/80 p-1 backdrop-blur-md"
            />

            <div className="w-full max-w-md">
                <div className="mb-6 text-center">
                    <h1 className="text-xl font-semibold tracking-tight">
                        {t('account_switcher.title', 'Choose an account')}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t('account_switcher.subtitle', 'Pick the Minecraft account you want to play with.')}
                    </p>
                </div>

                <div className="space-y-2">
                    {list.map((account) => (
                        <div
                            key={account.uuid}
                            className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
                        >
                            <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => pick(account.uuid)}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                            >
                                <AccountHead uuid={account.uuid} name={account.name} size={36} className="rounded-md shrink-0" />
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{account.name}</div>
                                    <div className="text-[11px] text-muted-foreground">{account.type || 'Microsoft'}</div>
                                </div>
                            </button>

                            {busy === account.uuid ? (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                            ) : (
                                <>
                                    <LogIn className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                                    <button
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() => remove(account.uuid)}
                                        title={t('account_switcher.remove', 'Remove this account')}
                                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100 disabled:opacity-30"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}

                    {list.length === 0 && (
                        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                            {t('account_switcher.empty', 'No saved accounts left. Add one to continue.')}
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    disabled={busy !== null}
                    onClick={addAccount}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                    {busy === 'add'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <UserPlus className="h-4 w-4" />}
                    {t('common.add_account', 'Add Account')}
                </button>

                {error && (
                    <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {error}
                    </p>
                )}

                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="mt-4 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {t('common.cancel', 'Cancel')}
                    </button>
                )}
            </div>
        </div>
    );
}
