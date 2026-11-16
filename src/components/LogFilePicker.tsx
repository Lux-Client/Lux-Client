import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface LogFileEntry {
    name: string;
    date?: string | number | Date;
    size?: number;
}

interface Props {
    files: LogFileEntry[];
    value: string;
    onChange: (name: string) => void;
}

// Minecraft packs every finished session into logs/YYYY-MM-DD-N.log.gz, so a
// long-lived instance ends up with hundreds of them. Rendering all of them in a
// plain dropdown made an endless list, so this picker keeps the live files on
// top, groups the archives by day, filters by text and only renders a page of
// entries at a time.
const PAGE_SIZE = 60;
const ARCHIVE_NAME = /^(?:(.+?)-)?(\d{4})-(\d{2})-(\d{2})-(\d+)\.log\.gz$/;

const formatSize = (bytes?: number) => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatDayLabel = (day: string, t: (key: string, fallback: string) => string) => {
    if (!day) return t('instance_details.logs.picker.unknown_day', 'Unknown date');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (day === dayKey(today)) return t('instance_details.logs.picker.today', 'Today');
    if (day === dayKey(yesterday)) return t('instance_details.logs.picker.yesterday', 'Yesterday');
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};

interface Row {
    name: string;
    compressed: boolean;
    when: Date | null;
    day: string;
    session: number | null;
    prefix: string | null;
    size: string;
}

const toRow = (file: LogFileEntry): Row => {
    const mtime = file.date ? new Date(file.date) : null;
    const when = mtime && !Number.isNaN(mtime.getTime()) ? mtime : null;
    const match = ARCHIVE_NAME.exec(file.name);
    // The file name carries the day the session started, the mtime the moment it
    // was closed. The name is what people search for, so it decides the group.
    const day = match ? `${match[2]}-${match[3]}-${match[4]}` : (when ? dayKey(when) : '');
    return {
        name: file.name,
        compressed: file.name.endsWith('.gz'),
        when,
        day,
        session: match ? Number(match[5]) : null,
        prefix: match ? (match[1] || null) : null,
        size: formatSize(file.size)
    };
};

const LogFilePicker: React.FC<Props> = ({ files, value, onChange }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(PAGE_SIZE);
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    useEffect(() => {
        setLimit(PAGE_SIZE);
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [query, open]);

    const rows = useMemo(() => {
        const seen = new Set<string>();
        const list: Row[] = [];
        for (const f of [{ name: 'latest.log' }, ...(files || [])]) {
            if (!f?.name) continue;
            if (seen.has(f.name)) {
                // latest.log was put first as a placeholder; keep its real stats.
                if (f.name === 'latest.log') list[0] = toRow(f);
                continue;
            }
            seen.add(f.name);
            list.push(toRow(f));
        }
        return list;
    }, [files]);

    const formatDay = (day: string) => formatDayLabel(day, t);

    const formatTime = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

    const labelFor = (row: Row) => {
        if (!row.compressed || row.session === null) return row.name;
        const base = t('instance_details.logs.picker.session', { number: row.session, defaultValue: 'Session {{number}}' });
        return row.prefix ? `${row.prefix} · ${base}` : base;
    };

    const { pinned, archived } = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = (row: Row) => !q
            || row.name.toLowerCase().includes(q)
            || row.day.includes(q)
            || formatDayLabel(row.day, t).toLowerCase().includes(q);
        const pinnedRows = rows.filter(r => !r.compressed && matches(r));
        pinnedRows.sort((a, b) => {
            if (a.name === 'latest.log') return -1;
            if (b.name === 'latest.log') return 1;
            return (b.when?.getTime() || 0) - (a.when?.getTime() || 0);
        });
        const archivedRows = rows.filter(r => r.compressed && matches(r));
        archivedRows.sort((a, b) => {
            if (a.day !== b.day) return a.day < b.day ? 1 : -1;
            if (a.session !== null && b.session !== null && a.session !== b.session) return b.session - a.session;
            return (b.when?.getTime() || 0) - (a.when?.getTime() || 0);
        });
        return { pinned: pinnedRows, archived: archivedRows };
    }, [rows, query, t]);

    const dayCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const row of archived) counts.set(row.day, (counts.get(row.day) || 0) + 1);
        return counts;
    }, [archived]);

    const shownArchived = archived.slice(0, limit);
    const groups: { day: string; rows: Row[] }[] = [];
    for (const row of shownArchived) {
        const last = groups[groups.length - 1];
        if (last && last.day === row.day) last.rows.push(row);
        else groups.push({ day: row.day, rows: [row] });
    }

    const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (limit < archived.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
            setLimit(prev => prev + PAGE_SIZE);
        }
    };

    const select = (name: string) => {
        onChange(name);
        setOpen(false);
        setQuery('');
    };

    const selectedRow = rows.find(r => r.name === value);
    const totalArchived = rows.filter(r => r.compressed).length;

    const renderRow = (row: Row, withDay = false) => {
        const active = row.name === value;
        const meta = [withDay && row.day ? formatDay(row.day) : '', formatTime(row.when), row.size].filter(Boolean).join(' · ');
        return (
            <button
                key={row.name}
                type="button"
                onClick={() => select(row.name)}
                title={row.name}
                className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
                <span className="flex-1 min-w-0">
                    <span className={`block truncate text-sm ${active ? 'font-bold' : ''}`}>{labelFor(row)}</span>
                    {(meta || row.compressed) && (
                        <span className="block truncate text-[10px] opacity-70">
                            {row.compressed ? row.name : meta}
                        </span>
                    )}
                </span>
                {row.compressed && meta && <span className="shrink-0 text-[10px] opacity-70 tabular-nums">{meta}</span>}
            </button>
        );
    };

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full bg-background border border-border rounded-xl px-3 py-2 text-left flex justify-between items-center gap-2 transition-colors ${open ? 'border-primary ring-1 ring-primary' : ''}`}
            >
                <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">
                        {selectedRow ? labelFor(selectedRow) : value}
                    </span>
                    {selectedRow?.compressed && (
                        <span className="block truncate text-[10px] text-muted-foreground">{formatDay(selectedRow.day)}</span>
                    )}
                </span>
                <svg className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute z-50 left-0 mt-1 w-[22rem] max-w-[80vw] bg-popover border border-border rounded-xl shadow-xl overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-border">
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t('instance_details.logs.picker.search', 'Search by name or date (2026-11-15)...')}
                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                        />
                    </div>
                    <div ref={listRef} onScroll={onScroll} className="max-h-80 overflow-y-auto custom-scrollbar p-1">
                        {pinned.length > 0 && (
                            <div className="mb-1">
                                <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('instance_details.logs.picker.current', 'Current')}
                                </div>
                                {pinned.map(row => renderRow(row, true))}
                            </div>
                        )}
                        {groups.map(group => (
                            <div key={group.day || 'unknown'} className="mb-1">
                                <div className="sticky top-0 z-10 bg-popover px-3 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                                    <span>{formatDay(group.day)}</span>
                                    <span className="tabular-nums">{dayCounts.get(group.day) || 0}</span>
                                </div>
                                {group.rows.map(row => renderRow(row))}
                            </div>
                        ))}
                        {pinned.length === 0 && archived.length === 0 && (
                            <div className="p-3 text-center text-sm text-muted-foreground">
                                {t('instance_details.logs.picker.no_match', 'No logs match your search')}
                            </div>
                        )}
                        {limit < archived.length && (
                            <button
                                type="button"
                                onClick={() => setLimit(prev => prev + PAGE_SIZE)}
                                className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                {t('instance_details.logs.picker.load_more', { count: archived.length - limit, defaultValue: 'Show more ({{count}} left)' })}
                            </button>
                        )}
                    </div>
                    {totalArchived > 0 && (
                        <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">
                            {t('instance_details.logs.picker.archived_count', { count: totalArchived, defaultValue: '{{count}} archived logs (.log.gz), unpacked when opened' })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LogFilePicker;
