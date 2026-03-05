import React, { useState } from 'react';
import { getAvatarUrl, hasMoreFallbacks, DEFAULT_SKIN } from '../utils/avatarUtils';

/**
 * Renders a Minecraft player head directly from a skin texture
 * @param {Object} props
 * @param {string} props.src - The texture URL (textures.minecraft.net/texture/...)
 * @param {string} props.uuid - Fallback UUID for mc-heads.net
 * @param {string} props.name - Fallback name
 * @param {number} props.size - Display size in pixels (default 40)
 * @param {string} props.className - Optional classes
 */
const PlayerHead = ({ src, uuid, name, size = 40, className = "" }) => {
    const [fallbackLevel, setFallbackLevel] = useState(0);

    const baseStyle = {
        width: size,
        height: size,
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0
    };

    const layerStyle = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundImage: `url(${src || DEFAULT_SKIN})`,
        backgroundSize: '800%',
        imageRendering: 'pixelated',
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
            // Not a valid URL, check if it's a long base64 texture string
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
                // If all services fail, fallback to a local default if possible or Steve
                e.target.src = getAvatarUrl('steve', 'steve', size, 0);
            }
        };

        return (
            <div style={baseStyle} className={className}>
                <img
                    src={getHeadUrl()}
                    alt="Head"
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        imageRendering: 'pixelated'
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