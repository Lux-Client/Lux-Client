// @ts-nocheck
const path = require('path');
const fs = require('fs');

/**
 * Checks whether targetPath is contained within baseDir.
 * Uses fs.realpath to resolve symlinks before comparison, preventing symlink escapes.
 * Falls back to path.resolve for non-existent paths.
 *
 * @param {string} baseDir - The directory that must contain the target.
 * @param {string} targetPath - The path to verify.
 * @returns {boolean} true if targetPath resolves inside baseDir.
 */
function isPathInside(baseDir, targetPath) {
    // Resolve symlinks to real paths, fall back to path.resolve for non-existent paths
    let resolvedBase;
    let resolvedTarget;

    try {
        resolvedBase = fs.realpathSync(baseDir);
    } catch {
        resolvedBase = path.resolve(baseDir);
    }

    try {
        resolvedTarget = fs.realpathSync(targetPath);
    } catch {
        resolvedTarget = path.resolve(targetPath);
    }

    const relative = path.relative(resolvedBase, resolvedTarget);

    // Empty string means same path — that's inside.
    if (relative === '') return true;

    // If relative doesn't start with ".." and is not absolute, it's inside.
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Validates that an extension ID is a safe directory name.
 * Only allows alphanumeric characters, hyphens, and underscores.
 * Rejects traversal sequences, absolute paths, and null bytes.
 *
 * @param {string} id - The extension ID to validate.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateExtensionId(id) {
    if (typeof id !== 'string' || id.length === 0) {
        return { valid: false, error: 'Extension ID must be a non-empty string' };
    }

    if (id.length > 128) {
        return { valid: false, error: 'Extension ID exceeds maximum length (128)' };
    }

    if (id.includes('\0')) {
        return { valid: false, error: 'Extension ID contains null byte' };
    }

    if (path.isAbsolute(id)) {
        return { valid: false, error: 'Extension ID must not be an absolute path' };
    }

    const normalized = path.normalize(id);
    if (normalized.startsWith('..') || normalized.includes('..')) {
        return { valid: false, error: 'Extension ID must not contain path traversal sequences' };
    }

    if (normalized.includes('/') || normalized.includes('\\')) {
        return { valid: false, error: 'Extension ID must not contain path separators' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return { valid: false, error: 'Extension ID may only contain letters, numbers, hyphens, and underscores' };
    }

    return { valid: true };
}

/**
 * Validates and sanitizes an icon path from an extension manifest.
 * Ensures the resolved path stays inside the extension directory.
 *
 * @param {string} extensionDir - The extension's root directory.
 * @param {string} iconPath - The icon path from manifest.json.
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string }}
 */
function sanitizeIconPath(extensionDir, iconPath) {
    if (typeof iconPath !== 'string' || iconPath.length === 0) {
        return { valid: false, error: 'Icon path must be a non-empty string' };
    }

    if (iconPath.includes('\0')) {
        return { valid: false, error: 'Icon path contains null byte' };
    }

    const resolved = path.resolve(extensionDir, iconPath);

    if (!isPathInside(extensionDir, resolved)) {
        return { valid: false, error: 'Icon path escapes extension directory' };
    }

    return { valid: true, resolvedPath: resolved };
}

module.exports = {
    isPathInside,
    validateExtensionId,
    sanitizeIconPath
};
