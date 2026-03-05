/**
 * Utilities for fetching Minecraft player avatars with fallbacks.
 */

const AVATAR_SERVICES = [
    {
        name: 'Crafatar',
        getUrl: (uuid, name, size) => `https://crafatar.com/avatars/${uuid || name || 'steve'}?size=${size}&overlay`
    },
    {
        name: 'MC-Heads',
        getUrl: (uuid, name, size) => `https://mc-heads.net/avatar/${uuid || name || 'steve'}/${size}`
    },
    {
        name: 'Minotar',
        getUrl: (uuid, name, size) => `https://minotar.net/avatar/${uuid || name || 'steve'}/${size}`
    },
    {
        name: 'Visage',
        getUrl: (uuid, name, size) => `https://visage.surgeplay.com/head/${size}/${uuid || name || 'steve'}`
    }
];

/**
 * Get an avatar URL based on the priority index.
 * @param {string} uuid - Player UUID
 * @param {string} name - Player name
 * @param {number} size - Request size
 * @param {number} level - Fallback level (index in AVATAR_SERVICES)
 * @returns {string} The formatted URL
 */
export const getAvatarUrl = (uuid, name, size = 40, level = 0) => {
    const serviceIndex = level % AVATAR_SERVICES.length;
    return AVATAR_SERVICES[serviceIndex].getUrl(uuid, name, size);
};

/**
 * Check if there are more services to try.
 * @param {number} level - Current fallback level
 * @returns {boolean}
 */
export const hasMoreFallbacks = (level) => {
    return level < AVATAR_SERVICES.length - 1;
};

/**
 * Recommended default skin URL (Steve)
 */
export const DEFAULT_SKIN = "https://textures.minecraft.net/texture/1a49ec384931a28a361bc4c25143a57173e6545b74100c5678822003c00ed2d4";
