import React, { useEffect, useState } from 'react';
import OptimizedImage from '../components/OptimizedImage';
import { useTranslation } from 'react-i18next';

function News() {
    const { t } = useTranslation();
    const [newsItems, setNewsItems] = useState([]);

    useEffect(() => {
        loadNews();
        const interval = setInterval(loadNews, 60000);
        return () => clearInterval(interval);
    }, []);

    const loadNews = async () => {
        if (!window.electronAPI?.getNews) return;

        const res = await window.electronAPI.getNews();
        if (res.success) {
            setNewsItems(res.news || []);
        } else {
            console.error('Frontend: News failed to load', res.error);
        }
    };

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('common.news', 'News')}</h1>
                <div className="h-[1px] flex-1 bg-border ml-4"></div>
            </div>

            {newsItems.length === 0 ? (
                <div className="text-muted-foreground text-sm text-center py-12">{t('common.no_news_available', 'No news available')}</div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    {newsItems.map((item, index) => (
                        <div
                            key={`${item.title || 'news'}-${index}`}
                            className="group cursor-pointer bg-surface border border-stroke rounded-xl p-3 hover:bg-surface transition-colors"
                            onClick={() => item.link && window.electronAPI.openExternal(item.link)}
                        >
                            <OptimizedImage
                                src={item.image}
                                alt={item.title}
                                className="h-40 w-full object-cover bg-surface rounded-xl border border-stroke mb-3 overflow-hidden"
                                fallback={<div className="h-40 w-full bg-surface rounded-xl" />}
                            />
                            <div className="text-base font-bold text-foreground group-hover:text-primary transition-colors leading-tight">
                                {item.title}
                            </div>
                            {item.description && (
                                <div className="text-xs text-muted-foreground mt-2 line-clamp-3">{item.description}</div>
                            )}
                            {item.date && <div className="text-[11px] text-muted-foreground mt-2">{item.date}</div>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default News;
