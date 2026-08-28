// @ts-nocheck
const { validateExtensionId } = require('./path-safety');

/**
 * Validates an extension manifest object against the required schema.
 * Collects all validation errors rather than stopping at the first one.
 *
 * @param {object} manifest - The parsed manifest.json object.
 * @returns {{ valid: true, manifest: object } | { valid: false, errors: string[] }}
 */
function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, errors: ['Manifest must be a non-null object'] };
    }

    const errors = [];

    // Validate name: required string, 1-128 chars, no null bytes
    const { name } = manifest;
    if (typeof name !== 'string' || name.length === 0) {
        errors.push('Manifest "name" must be a non-empty string');
    } else {
        if (name.length > 128) {
            errors.push('Manifest "name" exceeds maximum length (128)');
        }
        if (name.includes('\0')) {
            errors.push('Manifest "name" contains null byte');
        }
    }

    // Validate version: required string, must match semver pattern (x.y.z)
    const { version } = manifest;
    if (typeof version !== 'string') {
        errors.push('Manifest "version" must be a string');
    } else if (!/^\d+\.\d+\.\d+$/.test(version)) {
        errors.push('Manifest "version" must be a valid semver (x.y.z)');
    }

    // Validate main/entry: at least one must be present and be a string
    const mainEntry = manifest.main || manifest.entry;
    if (!mainEntry) {
        errors.push('Manifest must contain either "main" or "entry" field');
    } else if (typeof mainEntry !== 'string') {
        errors.push('Manifest "main"/"entry" must be a string');
    }

    // Validate icon: optional string
    if (manifest.icon !== undefined && typeof manifest.icon !== 'string') {
        errors.push('Manifest "icon" must be a string if provided');
    }

    // Validate id: optional string, if present must pass validateExtensionId
    if (manifest.id !== undefined) {
        if (typeof manifest.id !== 'string') {
            errors.push('Manifest "id" must be a string if provided');
        } else {
            const idCheck = validateExtensionId(manifest.id);
            if (!idCheck.valid) {
                errors.push(`Invalid manifest "id": ${idCheck.error}`);
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    return { valid: true, manifest };
}

module.exports = { validateManifest };
