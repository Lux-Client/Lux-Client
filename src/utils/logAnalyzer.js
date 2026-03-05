/**
 * Smart Log Analyzer for Minecraft Crashes
 * Identifies common crash patterns and suggests "One-Click Fixes".
 */

const CRASH_PATTERNS = [
    {
        id: 'out_of_memory',
        regex: /java\.lang\.OutOfMemoryError/i,
        title: 'Out of Memory',
        description: 'Minecraft ran out of memory. This often happens with modded versions.',
        fixText: 'Increase Memory to 4GB',
        fixAction: 'increase_memory',
        priority: 10
    },
    {
        id: 'unsupported_java_version',
        regex: /java\.lang\.UnsupportedClassVersionError/i,
        title: 'Incompatible Java Version',
        description: 'The version of Java being used is not compatible with this version of Minecraft.',
        fixText: 'Auto-detect & Fix Java',
        fixAction: 'fix_java_version',
        priority: 10
    },
    {
        id: 'duplicate_mods',
        regex: /Duplicate mod ID\s+'([^']+)'\s+found/i,
        title: 'Duplicate Mods Detected',
        description: (match) => `You have two versions of the mod "${match[1]}" installed.`,
        fixText: 'Remove Duplicate Mod',
        fixAction: 'remove_duplicate_mod',
        priority: 9
    },
    {
        id: 'missing_dependency',
        regex: /Mod\s+'([^']+)'\s+requires\s+mod\s+'([^']+)'/i,
        title: 'Missing Mod Dependency',
        description: (match) => `The mod "${match[1]}" requires "${match[2]}" to be installed.`,
        fixText: 'Install Missing Dependency',
        fixAction: 'install_dependency',
        priority: 9
    },
    {
        id: 'gl_error',
        regex: /org\.lwjgl\.opengl\.OpenGLException:\s+Cannot\s+make\s+current/i,
        title: 'Graphics Driver Issue',
        description: 'Minecraft failed to initialize the graphics driver. This is often caused by outdated drivers.',
        fixText: 'Enable Compatibility Mode',
        fixAction: 'enable_compatibility_mode',
        priority: 8
    },
    {
        id: 'mod_conflict',
        regex: /Patching\s+finalized\s+with\s+errors\s+for\s+([^,]+)/i,
        title: 'Mod Conflict Detected',
        description: (match) => `The mod "${match[1]}" failed to load, possibly due to a conflict with another mod.`,
        fixText: 'Disable Conflicting Mod',
        fixAction: 'disable_mod',
        priority: 7
    },
    {
        id: 'general_crash',
        regex: /Exception\s+in\s+thread\s+"main"/i,
        title: 'General Startup Crash',
        description: 'Minecraft failed to start correctly during initialization.',
        fixText: 'Full Reinstall',
        fixAction: 'reinstall_instance',
        priority: 1
    }
];

/**
 * Analyzes the provided log content for known crash patterns.
 * @param {string} logContent - The log content or crash report text.
 * @returns {Array} - A list of identified issues.
 */
export function analyzeLog(logContent) {
    if (!logContent) return [];

    const issues = [];

    for (const pattern of CRASH_PATTERNS) {
        const match = logContent.match(pattern.regex);
        if (match) {
            const issue = {
                id: pattern.id,
                title: pattern.title,
                description: typeof pattern.description === 'function' ? pattern.description(match) : pattern.description,
                fixText: pattern.fixText,
                fixAction: pattern.fixAction,
                priority: pattern.priority,
                match: match[0],
                capturedGroups: match.slice(1)
            };
            issues.push(issue);
        }
    }

    // Sort by priority (highest first)
    return issues.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns a user-friendly summary of the exit code.
 * @param {number} code - The process exit code.
 * @returns {string}
 */
export function getExitCodeDescription(code) {
    switch (code) {
        case 0: return 'Success';
        case 1: return 'General error (check logs)';
        case -1: return 'Process was killed or crashed';
        case 130: return 'Interrupted (Ctrl+C)';
        case 137: return 'Out of memory (Linux OOM killer)';
        case 139: return 'Segmentation fault (core dumped)';
        case 255: return 'Vanilla exit code (common for mods)';
        default: return `Exit code ${code}`;
    }
}
