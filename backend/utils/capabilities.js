// @ts-nocheck
/**
 * Capability-based API surface for extension isolation.
 *
 * Extensions declare required capabilities in their manifest.json via a
 * "permissions" array. The system validates requested capabilities against
 * a known set of definitions and builds a config object that controls
 * which APIs the extension is allowed to use.
 *
 * Design principle: fail-closed. If no permissions are declared, all
 * capabilities are denied.
 */

/**
 * @typedef {{ name: string, description: string, defaultEnabled: boolean }} CapabilityDefinition
 */

/**
 * @typedef {{ [capability: string]: boolean }} CapabilityConfig
 */

/**
 * All available capabilities that an extension can request.
 * Each capability maps to a specific API surface.
 *
 * @type {{ [key: string]: CapabilityDefinition }}
 */
const CAPABILITY_DEFINITIONS = {
    fs: {
        name: 'fs',
        description: 'File system access (read, write, list files within extension directory)',
        defaultEnabled: false
    },
    network: {
        name: 'network',
        description: 'HTTP/HTTPS requests via axios',
        defaultEnabled: false
    },
    ipc: {
        name: 'ipc',
        description: 'IPC communication with the renderer process',
        defaultEnabled: false
    },
    launcher: {
        name: 'launcher',
        description: 'Minecraft launcher control (get instances, launch game)',
        defaultEnabled: false
    },
    settings: {
        name: 'settings',
        description: 'Access to user settings and configuration',
        defaultEnabled: false
    }
};

/**
 * Default capability configuration — denies everything (fail-closed).
 * Extensions must explicitly opt-in to each capability via manifest permissions.
 *
 * @type {CapabilityConfig}
 */
const DEFAULT_CAPABILITIES = Object.fromEntries(
    Object.keys(CAPABILITY_DEFINITIONS).map((key) => [key, false])
);

/**
 * Validates requested capabilities against the known capability definitions.
 * Returns only the valid, recognized capabilities and warns about unknown ones.
 *
 * @param {string[]|undefined} requested - Array of capability names from manifest.
 * @returns {{ valid: boolean, capabilities: CapabilityConfig, unknown: string[] }}
 */
function validateCapabilities(requested) {
    if (!Array.isArray(requested)) {
        return { valid: true, capabilities: { ...DEFAULT_CAPABILITIES }, unknown: [] };
    }

    const unknown = [];
    /** @type {CapabilityConfig} */
    const capabilities = { ...DEFAULT_CAPABILITIES };

    for (const perm of requested) {
        if (typeof perm !== 'string') {
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(CAPABILITY_DEFINITIONS, perm)) {
            capabilities[perm] = true;
        } else {
            unknown.push(perm);
        }
    }

    return { valid: true, capabilities, unknown };
}

/**
 * Builds a capability config from an extension manifest.
 * Reads the "permissions" field and validates each entry.
 *
 * @param {{ permissions?: string[] }} manifest - The parsed manifest.json object.
 * @returns {{ valid: boolean, capabilities: CapabilityConfig, unknown: string[], warnings: string[] }}
 */
function buildCapabilityConfig(manifest) {
    const warnings = [];

    if (!manifest || typeof manifest !== 'object') {
        return {
            valid: false,
            capabilities: { ...DEFAULT_CAPABILITIES },
            unknown: [],
            warnings: ['Invalid manifest object']
        };
    }

    const { capabilities, unknown } = validateCapabilities(manifest.permissions);

    if (unknown.length > 0) {
        warnings.push(`Unknown capabilities requested: ${unknown.join(', ')}`);
    }

    return {
        valid: true,
        capabilities,
        unknown,
        warnings
    };
}

module.exports = {
    CAPABILITY_DEFINITIONS,
    DEFAULT_CAPABILITIES,
    validateCapabilities,
    buildCapabilityConfig
};
