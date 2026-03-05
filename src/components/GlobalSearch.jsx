import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const GlobalSearch = ({ isOpen, onClose, onNavigate, onLaunchInstance, theme }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef(null);
    const inputRef = useRef(null);

    // Static Navigation items
    const navItems = [
        { id: 'dashboard', label: t('common.dashboard'), icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', type: 'nav' },
        { id: 'library', label: t('dashboard.title'), icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z', type: 'nav' },
        { id: 'skins', label: t('skins.title'), icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', type: 'nav' },
        { id: 'styling', label: t('styling.title'), icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01', type: 'nav' },
        { id: 'settings', label: t('settings.title'), icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', type: 'nav' },
        { id: 'extensions', label: t('extensions.title'), icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', type: 'nav' },
        { id: 'news', label: t('common.news'), icon: 'M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z M7 8h10M7 12h10M7 16h6', type: 'nav' }
    ];

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            fetchInstances();
        } else {
            setQuery('');
        }
    }, [isOpen]);

    const fetchInstances = async () => {
        try {
            const list = await window.electronAPI.getInstances();
            const formatted = list.map(inst => ({
                id: inst.name,
                label: inst.name,
                sublabel: `${inst.loader || 'Vanilla'} ${inst.version}`,
                icon: inst.icon && inst.icon.startsWith('data:') ? inst.icon : 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
                type: 'instance',
                original: inst
            }));

            const filtered = [...navItems, ...formatted].filter(item =>
                item.label.toLowerCase().includes(query.toLowerCase())
            );
            setResults(filtered);
            setSelectedIndex(0);
        } catch (e) {
            console.error('[GlobalSearch] Failed to fetch instances', e);
        }
    };

    useEffect(() => {
        fetchInstances();
    }, [query]);

    const handleAction = (item) => {
        if (!item) return;
        if (item.type === 'nav') {
            onNavigate(item.id);
        } else if (item.type === 'instance') {
            onLaunchInstance(item.original);
        }
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            handleAction(results[selectedIndex]);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] px-4 animate-in fade-in duration-200">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-md"
                onClick={onClose}
            />

            <div
                ref={containerRef}
                className="w-full max-w-2xl bg-surface/80 border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative animate-in zoom-in-95 slide-in-from-top-4 duration-200"
                style={{ backdropFilter: `blur(${theme.glassBlur * 2}px)` }}
            >
                <div className="p-4 border-b border-white/5 flex items-center gap-3">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('dashboard.search_placeholder')}
                        className="bg-transparent border-none outline-none text-white text-lg flex-1 placeholder-gray-500"
                    />
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                    {results.length > 0 ? (
                        results.map((result, idx) => (
                            <div
                                key={`${result.type}-${result.id}`}
                                onClick={() => handleAction(result)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${idx === selectedIndex
                                    ? 'bg-primary text-black scale-[1.01] shadow-lg global-primary-glow'
                                    : 'text-gray-300 hover:bg-white/5'
                                    }`}
                            >
                                <div className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-lg text-xl shrink-0 overflow-hidden">
                                    {result.icon.startsWith('data:') ? (
                                        <img src={result.icon} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={result.icon} />
                                        </svg>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold truncate">{result.label}</div>
                                    <div className={`text-xs opacity-60 truncate ${idx === selectedIndex ? 'text-black' : 'text-gray-400'}`}>
                                        {result.sublabel || (result.type === 'nav' ? t('common.launcher') : '')}
                                    </div>
                                </div>
                                {idx === selectedIndex && (
                                    <div className="text-[10px] uppercase font-black tracking-widest px-2 py-1 bg-black/20 rounded-md">
                                        {t('common.press_enter')}
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="p-8 text-center text-gray-500 italic">
                            {t('dashboard.no_instances')}
                        </div>
                    )}
                </div>

                <div className="p-3 bg-black/20 border-t border-white/5 flex justify-between items-center text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">↑↓</kbd> {t('common.navigate')}</span>
                        <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">⏎</kbd> {t('common.select')}</span>
                    </div>
                    <div>{results.length} {t('common.results')}</div>
                </div>
            </div>
        </div>
    );
};

export default GlobalSearch;
