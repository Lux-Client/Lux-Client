import React, { useState } from 'react';
import { getAvatarUrl, hasMoreFallbacks, DEFAULT_SKIN } from '../utils/avatarUtils';

const PlayerHead = ({ src, uuid, name, size = 40, className = "" }: { src?: string; uuid?: string; name?: string; size?: number; className?: string }) => {
    const [fallbackLevel, setFallbackLevel] = useState(0);

    const baseStyle = {
        width: size,
        height: size,
        backgroundColor: 'hsl(var(--muted))',
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative' as const,
        flexShrink: 0
    };

    const layerStyle = {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundImage: `url(${src || DEFAULT_SKIN})`,
        backgroundSize: '800%',
        imageRendering: 'pixelated' as const,
        transition: 'background-image 0.3s ease'
    };
    const headLayer = {
        ...layerStyle,
        backgroundPosition: `-${size}px -${size}px`,
    };
    const headPos = "14.285% 14.285%";
    const hatPos = "71.428% 14.285%";
    let isTextureUrl = false;
    if (src) {
        try {
            const srcUrl = new URL(src);
            isTextureUrl = srcUrl.hostname === 'textures.minecraft.net' || srcUrl.hostname.endsWith('.minecraft.net');
        } catch {
            isTextureUrl = src.length > 100;
        }
    }

    if (!isTextureUrl) {
        const getHeadUrl = () => {
            if (src && src.startsWith('http')) return src;
            return getAvatarUrl(uuid, name, size, fallbackLevel);
        };

        const handleAvatarError = (e) => {
            if (hasMoreFallbacks(fallbackLevel)) {
                setFallbackLevel(prev => prev + 1);
            } else {
                e.target.src = getAvatarUrl('steve', 'steve', size, 0);
            }
        };

        return (
            <div style={baseStyle} className={className}>
                <img
                    src={getHeadUrl()}
                    alt="Head"
                    draggable="false"
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        imageRendering: 'pixelated' as const
                    }}
                    onError={handleAvatarError}
                />
            </div>
        );
    }

    return (
        <div style={baseStyle} className={className} title={name}>
            { }
            <div style={{
                ...layerStyle,
                backgroundPosition: headPos
            }} />
            { }
            <div style={{
                ...layerStyle,
                backgroundPosition: hatPos
            }} />
        </div>
    );
};

export default PlayerHead;
