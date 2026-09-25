import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Crown, Loader2, LogOut, Mail, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { useLuxAccount } from '../../context/LuxAccountContext';
import { useLuxSync } from '../../context/LuxSyncContext';
import type { SharePermissions } from '../../context/LuxSyncContext';

type Person = {
    userId: number;
    username: string | null;
    avatar: string | null;
    email?: string;
    addedAt?: string;
    isMe?: boolean;
    permissions?: SharePermissions;
};

type MembersPayload = {
    access: 'owner' | 'member';
    maxMembers: number;
    permissions?: SharePermissions;
    owner: Person;
    members: Person[];
};

type Props = {
    open: boolean;
    onClose: () => void;
    instanceName: string | null;
    onLeft?: () => void;
};

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;

// Reihenfolge und Texte der Rechte, die der Host pro Mitglied einstellen kann.
const PERMISSION_KEYS: { key: keyof SharePermissions; label: string; hint: string }[] = [
    { key: 'addContent', label: 'Add & update mods, packs and shaders', hint: 'Install new content, update it or turn it on and off.' },
    { key: 'removeContent', label: 'Delete mods, packs and shaders', hint: 'Remove content from the instance for everyone.' },
    { key: 'editConfig', label: 'Edit configs', hint: 'Change files in config/ and defaultconfigs/.' },
    { key: 'rename', label: 'Rename the instance', hint: 'The new name applies for everyone.' },
    { key: 'manageMembers', label: 'Invite people', hint: 'Add people by email and remove them again (not the host, not other inviters).' }
];

function bridge(): any {
    return (typeof window !== 'undefined' ? (window as any).electronAPI : null) || null;
}

function PersonRow({ person, badge, action, children }: { person: Person; badge?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
    const initial = (person.username || '?').slice(0, 1).toUpperCase();
    return (
        <div className="rounded-lg border border-border/70 bg-muted/40">
        <div className="flex items-center gap-3 px-3 py-2">
            {person.avatar ? (
                <img src={person.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {initial}
                </span>
            )}
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    {person.username || '—'}
                    {badge}
                </p>
                {person.email && <p className="truncate text-[11px] text-muted-foreground">{person.email}</p>}
            </div>
            {action}
        </div>
        {children}
        </div>
    );
}

// Weitere Lux-Konten an einer Instanz mitarbeiten lassen. Der Host laedt per E-Mail ein
// und entfernt wieder; Mitglieder sehen, wer dabei ist, und koennen die Instanz verlassen.
export default function CollaborateModal({ open, onClose, instanceName, onLeft }: Props) {
    const { t } = useTranslation();
    const account = useLuxAccount();
    const sync = useLuxSync();

    const [data, setData] = useState<MembersPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
    const [openPermissions, setOpenPermissions] = useState<number | null>(null);

    const load = useCallback(async () => {
        const api = bridge();
        if (!api || !instanceName || typeof api.luxCloudListMembers !== 'function') return;
        setLoading(true);
        setProblem(null);
        try {
            const result = await api.luxCloudListMembers(instanceName);
            if (result && result.success === false) {
                setData(null);
                setProblem({ code: result.error, message: result.message || result.error });
            } else {
                setData(result);
            }
        } finally {
            setLoading(false);
        }
    }, [instanceName]);

    useEffect(() => {
        if (!open) return;
        setEmail('');
        setFeedback(null);
        setData(null);
        if (account?.loggedIn) load();
    }, [open, load, account?.loggedIn]);

    const errorText = (code: string, fallback: string) => {
        switch (code) {
            case 'invalid_email': return t('cloud.collab.error.invalid_email', 'That is not a valid email address.');
            case 'user_not_found': return t('cloud.collab.error.user_not_found', 'No Lux account uses this email address.');
            case 'already_member': return t('cloud.collab.error.already_member', 'This account already works on this instance.');
            case 'member_limit_reached': return t('cloud.collab.error.limit', 'This instance already has the maximum number of people.');
            case 'user_unavailable': return t('cloud.collab.error.unavailable', 'This account cannot use Lux Cloud right now.');
            default: return fallback;
        }
    };

    const addMember = async (event?: React.FormEvent) => {
        event?.preventDefault();
        const value = email.trim();
        if (!EMAIL_RE.test(value)) {
            setFeedback({ tone: 'error', text: errorText('invalid_email', '') });
            return;
        }
        const api = bridge();
        if (!api || !instanceName) return;

        setBusy('add');
        setFeedback(null);
        try {
            const result = await api.luxCloudAddMember(instanceName, value);
            if (result && result.success === false) {
                setFeedback({ tone: 'error', text: errorText(result.error, result.message || result.error) });
                return;
            }
            setData(result);
            setEmail('');
            setFeedback({ tone: 'success', text: t('cloud.collab.added', 'Added. They find the instance under Shared Instances.') });
        } finally {
            setBusy(null);
        }
    };

    const removeMember = async (person: Person) => {
        const api = bridge();
        if (!api || !instanceName) return;
        setBusy(`remove-${person.userId}`);
        setFeedback(null);
        try {
            const result = await api.luxCloudRemoveMember(instanceName, person.userId);
            if (result && result.success === false) {
                setFeedback({ tone: 'error', text: result.message || result.error });
                return;
            }
            await load();
        } finally {
            setBusy(null);
        }
    };

    const setPermission = async (person: Person, key: keyof SharePermissions, value: boolean) => {
        const api = bridge();
        if (!api || !instanceName || !data) return;

        // Sofort anzeigen, bei einer Absage zuruecknehmen.
        const previous = data;
        setData({
            ...data,
            members: data.members.map((member) => (member.userId === person.userId
                ? { ...member, permissions: { ...(member.permissions as SharePermissions), [key]: value } }
                : member))
        });
        setBusy(`perm-${person.userId}-${key}`);
        try {
            const result = await api.luxCloudUpdateMemberPermissions(instanceName, person.userId, { [key]: value });
            if (result && result.success === false) {
                setData(previous);
                setFeedback({ tone: 'error', text: result.message || result.error });
                return;
            }
            setData(result);
        } finally {
            setBusy(null);
        }
    };

    const leave = async () => {
        const api = bridge();
        if (!api || !instanceName) return;
        setBusy('leave');
        try {
            const result = await api.luxCloudLeaveShared(instanceName);
            if (result && result.success === false) {
                setFeedback({ tone: 'error', text: result.message || result.error });
                return;
            }
            await sync?.refresh();
            onLeft?.();
            onClose();
        } finally {
            setBusy(null);
        }
    };

    const uploadFirst = async () => {
        if (!instanceName) return;
        setBusy('sync');
        try {
            const result = await sync?.syncInstance(instanceName, {});
            if (result && result.success === false) {
                setFeedback({ tone: 'error', text: result.message || result.error });
                return;
            }
            await sync?.refresh();
            await load();
        } finally {
            setBusy(null);
        }
    };

    const isOwner = data?.access === 'owner';
    const members = data?.members || [];
    const canInvite = isOwner || Boolean(data?.permissions?.manageMembers);
    const canRemove = (person: Person) => isOwner
        || (Boolean(data?.permissions?.manageMembers) && !person.isMe && !person.permissions?.manageMembers);

    return (
        <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        {t('cloud.collab.title', 'Collaborate')}
                    </DialogTitle>
                    <DialogDescription>
                        {isOwner || !data
                            ? t('cloud.collab.desc_owner', {
                                defaultValue: 'Let other Lux accounts work on "{{name}}" with you. You decide per person what they may do (shield icon). Your worlds, keybinds and other private files always stay yours.',
                                name: instanceName || ''
                            })
                            : t('cloud.collab.desc_member', {
                                defaultValue: 'You work on "{{name}}" together with its host. Your worlds and settings stay on your PC.',
                                name: instanceName || ''
                            })}
                    </DialogDescription>
                </DialogHeader>

                {!account?.loggedIn ? (
                    <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                        {t('cloud.collab.login', 'Sign in to your Lux account to work on instances together.')}
                    </p>
                ) : loading && !data ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : problem ? (
                    <div className="space-y-3">
                        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                            {problem.code === 'not_in_cloud'
                                ? t('cloud.collab.not_in_cloud', 'This instance is not in Lux Cloud yet. Upload it first, then you can invite people.')
                                : problem.message}
                        </p>
                        {problem.code === 'not_in_cloud' && (
                            <Button size="sm" className="w-full" disabled={busy === 'sync'} onClick={uploadFirst}>
                                {busy === 'sync' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                {t('cloud.collab.upload_first', 'Upload to Lux Cloud')}
                            </Button>
                        )}
                    </div>
                ) : data ? (
                    <div className="space-y-4">
                        {canInvite && (
                            <form onSubmit={addMember} className="space-y-1.5">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type="email"
                                            value={email}
                                            onChange={(event) => setEmail(event.target.value)}
                                            placeholder={t('cloud.collab.email_placeholder', 'Email of a Lux account')}
                                            className="pl-8 text-sm"
                                            disabled={members.length >= data.maxMembers}
                                        />
                                    </div>
                                    <Button type="submit" size="sm" disabled={busy === 'add' || !email.trim() || members.length >= data.maxMembers}>
                                        {busy === 'add'
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <UserPlus className="h-3.5 w-3.5" />}
                                        <span className="ml-1.5">{t('cloud.collab.add', 'Add')}</span>
                                    </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    {t('cloud.collab.count', {
                                        defaultValue: '{{count}} of {{max}} people',
                                        count: members.length,
                                        max: data.maxMembers
                                    })}
                                </p>
                            </form>
                        )}

                        {feedback && (
                            <p className={`text-xs ${feedback.tone === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
                                {feedback.text}
                            </p>
                        )}

                        <div className="space-y-2">
                            <PersonRow
                                person={data.owner}
                                badge={(
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                                        <Crown className="h-2.5 w-2.5" />
                                        {t('cloud.collab.host', 'Host')}
                                    </span>
                                )}
                            />
                            {members.map((person) => (
                                <PersonRow
                                    key={person.userId}
                                    person={person}
                                    badge={person.isMe ? (
                                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                            {t('cloud.collab.you', 'You')}
                                        </span>
                                    ) : undefined}
                                    action={(isOwner || canRemove(person)) ? (
                                        <div className="flex items-center gap-1">
                                            {isOwner && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className={`h-7 gap-1 px-2 text-[11px] ${openPermissions === person.userId ? 'text-primary' : 'text-muted-foreground'}`}
                                                    title={t('cloud.collab.permissions', 'Permissions')}
                                                    onClick={() => setOpenPermissions(openPermissions === person.userId ? null : person.userId)}
                                                >
                                                    <ShieldCheck className="h-3.5 w-3.5" />
                                                    <ChevronDown className={`h-3 w-3 transition-transform ${openPermissions === person.userId ? 'rotate-180' : ''}`} />
                                                </Button>
                                            )}
                                            {canRemove(person) && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                                                    title={t('cloud.collab.remove', 'Remove')}
                                                    disabled={busy === `remove-${person.userId}`}
                                                    onClick={() => removeMember(person)}
                                                >
                                                    {busy === `remove-${person.userId}`
                                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        : <Trash2 className="h-3.5 w-3.5" />}
                                                </Button>
                                            )}
                                        </div>
                                    ) : undefined}
                                >
                                    {isOwner && openPermissions === person.userId && person.permissions && (
                                        <div className="space-y-2 border-t border-border/70 px-3 py-2.5">
                                            {PERMISSION_KEYS.map(({ key, label, hint }) => (
                                                <label key={key} className="flex cursor-pointer items-start gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-medium text-foreground">
                                                            {t(`cloud.collab.perm.${key}`, label)}
                                                        </p>
                                                        <p className="text-[10px] leading-snug text-muted-foreground">
                                                            {t(`cloud.collab.perm.${key}_hint`, hint)}
                                                        </p>
                                                    </div>
                                                    <Switch
                                                        checked={Boolean(person.permissions![key])}
                                                        disabled={busy === `perm-${person.userId}-${key}`}
                                                        onCheckedChange={(value) => setPermission(person, key, value)}
                                                        className="mt-0.5"
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </PersonRow>
                            ))}
                            {members.length === 0 && (
                                <p className="py-2 text-center text-xs text-muted-foreground">
                                    {t('cloud.collab.empty', 'Nobody else works on this instance yet.')}
                                </p>
                            )}
                        </div>

                        {!isOwner && data.permissions && (
                            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {t('cloud.collab.your_permissions', 'What you may do')}
                                </p>
                                <ul className="space-y-1">
                                    {PERMISSION_KEYS.map(({ key, label }) => (
                                        <li key={key} className={`flex items-center gap-2 text-xs ${data.permissions![key] ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                                            {data.permissions![key]
                                                ? <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                                                : <X className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                            {t(`cloud.collab.perm.${key}`, label)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {!isOwner && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-red-400 hover:text-red-300"
                                disabled={busy === 'leave'}
                                onClick={leave}
                            >
                                {busy === 'leave'
                                    ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    : <LogOut className="mr-2 h-3.5 w-3.5" />}
                                {t('cloud.collab.leave', 'Leave this instance')}
                            </Button>
                        )}
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
