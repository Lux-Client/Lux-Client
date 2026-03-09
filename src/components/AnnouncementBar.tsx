import React, { useState, useEffect } from 'react';

const AnnouncementBar = () => {
    const [announcement, setAnnouncement] = useState(null);

    useEffect(() => {
        const fetchAnnouncement = async () => {
            try {
                const res = await fetch('https://lux.pluginhub.de/api/announcement');
                const data = await res.json();
                if (data && data.text) {
                    setAnnouncement(data.text);
                } else {
                    setAnnouncement(null);
                }
            } catch (err) {
                console.error('[AnnouncementBar] Failed to fetch:', err);
            }
        };

        fetchAnnouncement();
        const interval = setInterval(fetchAnnouncement, 60000);
        return () => clearInterval(interval);
    }, []);

    if (!announcement) return null;

    const parseMinecraftColors = (text) => {
        const colorMap = {
            '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
            '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
            '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
            'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
        };

        const parts = text.split(/([§&][0-9a-fklmnor])/i);
        let currentColor = null;
        let isBold = false;
        let isItalic = false;

        return parts.map((part, index) => {
            if (part === '' || part === undefined) return null;

            if (/^[§&][0-9a-f]$/i.test(part)) {
                currentColor = colorMap[part[1].toLowerCase()];
                return null;
            }

            if (/^[§&]l$/i.test(part)) { isBold = true; return null; }
            if (/^[§&]o$/i.test(part)) { isItalic = true; return null; }
            if (/^[§&]r$/i.test(part)) {
                currentColor = null;
                isBold = false;
                isItalic = false;
                return null;
            }
            if (/^[§&][kmn]$/i.test(part)) return null;

            if (part.startsWith('§') || part.startsWith('&')) return null;

            return (
                <span
                    key={index}
                    style={{
                        color: currentColor || 'inherit',
                        fontWeight: isBold ? 'bold' : 'normal',
                        fontStyle: isItalic ? 'italic' : 'normal'
                    }}
                >
                    {part}
                </span>
            );
        });
    };

    return (
        <div className="flex items-center justify-center px-4 py-1.5 bg-primary/10 border border-primary/20 rounded-full shadow-lg max-w-[400px] overflow-hidden">
            <div className="flex items-center gap-2 overflow-hidden truncate whitespace-nowrap text-sm font-medium">
                <span className="flex-shrink-0">📢</span>
                <div className="truncate">
                    {parseMinecraftColors(announcement)}
                </div>
            </div>
        </div>
    );
};

export default AnnouncementBar;
