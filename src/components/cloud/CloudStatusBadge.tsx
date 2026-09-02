import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Cloud,
    CloudOff,
    CloudDownload,
    RefreshCw,
    Check,
    AlertTriangle,
    ArrowUp
} from 'lucide-react';

import type { SyncStatus } from '../../context/LuxSyncContext';

type Props = {
    status: SyncStatus;
    compact?: boolean;
    percent?: number | null;
    className?: string;
};

const STYLES: Record<SyncStatus, { icon: any; tone: string; spin?: boolean }> = {
    local: { icon: CloudOff, tone: 'text-white/35 bg-white/5 border-white/10' },
    synced: { icon: Check, tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/25' },
    syncing: { icon: RefreshCw, tone: 'text-sky-300 bg-sky-500/10 border-sky-400/25', spin: true },
    pending: { icon: ArrowUp, tone: 'text-amber-300 bg-amber-500/10 border-amber-400/25' },
    conflict: { icon: AlertTriangle, tone: 'text-red-300 bg-red-500/10 border-red-400/30' },
    offline: { icon: CloudOff, tone: 'text-white/45 bg-white/5 border-white/10' },
    'cloud-only': { icon: CloudDownload, tone: 'text-violet-300 bg-violet-500/10 border-violet-400/25' }
};

const LABEL_KEYS: Record<SyncStatus, [string, string]> = {
    local: ['cloud.status.local', 'Local only'],
    synced: ['cloud.status.synced', 'Synced'],
    syncing: ['cloud.status.syncing', 'Syncing...'],
    pending: ['cloud.status.pending', 'Waiting to sync'],
    conflict: ['cloud.status.conflict', 'Conflict'],
    offline: ['cloud.status.offline', 'Offline'],
    'cloud-only': ['cloud.status.cloud_only', 'In the cloud']
};

export default function CloudStatusBadge({ status, compact = false, percent = null, className = '' }: Props) {
    const { t } = useTranslation();
    const style = STYLES[status] || STYLES.local;
    const Icon = style.icon;
    const [key, fallback] = LABEL_KEYS[status] || LABEL_KEYS.local;

    const label = status === 'syncing' && typeof percent === 'number'
        ? `${Math.round(percent)}%`
        : t(key, fallback);

    if (compact) {
        return (
            <span
                title={t(key, fallback)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${style.tone} ${className}`}
            >
                <Icon size={12} className={style.spin ? 'animate-spin' : ''} />
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.tone} ${className}`}
        >
            <Icon size={12} className={style.spin ? 'animate-spin' : ''} />
            {label}
        </span>
    );
}

export function CloudIconOnly({ status }: { status: SyncStatus }) {
    const style = STYLES[status] || STYLES.local;
    const Icon = status === 'local' ? Cloud : style.icon;
    return <Icon size={14} className={style.spin ? 'animate-spin' : ''} />;
}
