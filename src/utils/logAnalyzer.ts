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
    },
    {
        id: 'incompatible_mod_set',
        regex: /incompatible\s+mods?\s+found|mod\s+resolution\s+encountered\s+an\s+incompatible\s+mod\s+set/i,
        title: 'Incompatible Mods Found',
        description: 'One or more installed mods are incompatible with your current loader or Minecraft version.',
        fixText: 'Install Compatible Mods',
        fixAction: 'install_compatible_mod',
        priority: 11
    }
];

const COMPATIBILITY_LINE_PATTERNS = [
    {
        type: 'missing_dependency',
        regex: /Mod\s+'([^']+)'\s+requires\s+mod\s+'([^']+)'(?:\s+any\s+version)?(?:\s+but\s+it\s+is\s+not\s+present)?/ig,
        mapMatch: (match) => ({
            modName: match[1],
            dependencyName: match[2],
            issueType: 'missing_dependency',
            requiredVersion: null,
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'outdated_dependency',
        regex: /mod\s+'([^']+)'\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([^\s]+)\s+or\s+later\s+of\s+mod\s+'([^']+)'\s+\(([^)]+)\),\s+but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!\r\n]+)/ig,
        mapMatch: (match) => ({
            modName: match[1] || match[2],
            dependencyName: match[5] || match[6],
            issueType: 'outdated_dependency',
            requiredVersion: match[4] || null,
            foundVersion: match[7] || null,
            sourceLine: match[0]
        })
    },
    {
        type: 'missing_required_mod',
        regex: /Could\s+not\s+find\s+required\s+mod:\s*([A-Za-z0-9_.\-]+)/ig,
        mapMatch: (match) => ({
            modName: null,
            dependencyName: match[1],
            issueType: 'missing_dependency',
            requiredVersion: null,
            foundVersion: null,
            sourceLine: match[0]
        })
    },
    {
        type: 'dependency_version_mismatch',
        regex: /([A-Za-z0-9_.\-]+)\s+requires\s+([A-Za-z0-9_.\-]+)\s+([><=~^*0-9A-Za-z.+\-]+)/ig,
        mapMatch: (match) => ({
            modName: match[1],
            dependencyName: match[2],
            issueType: 'outdated_dependency',
            requiredVersion: match[3] || null,
            foundVersion: null,
            sourceLine: match[0]
        })
    }
];

const cleanToken = (value) => {
    if (typeof value !== 'string') return '';
    return value
        .replace(/^['"\s]+|['"\s]+$/g, '')
        .replace(/[\]\[()]/g, '')
        .trim();
};

const normalizeToken = (value) => cleanToken(value).toLowerCase();

const buildCompatibilityDescription = (entry) => {
    const modName = cleanToken(entry.modName);
    const dependencyName = cleanToken(entry.dependencyName);
    const requiredVersion = cleanToken(entry.requiredVersion);
    const foundVersion = cleanToken(entry.foundVersion);

    if (dependencyName && requiredVersion && foundVersion) {
        return `"${modName || 'A mod'}" needs "${dependencyName}" ${requiredVersion}+, but installed is ${foundVersion}.`;
    }

    if (dependencyName && requiredVersion) {
        return `"${modName || 'A mod'}" needs "${dependencyName}" in version ${requiredVersion} or newer.`;
    }

    if (dependencyName) {
        return `Missing required dependency "${dependencyName}" for "${modName || 'a mod'}".`;
    }

    return 'A mod dependency conflict was detected.';
};

const toCompatibilityIssue = (entry, index) => {
    const dependencyName = cleanToken(entry.dependencyName);
    const modName = cleanToken(entry.modName);
    const targetMod = dependencyName || modName;
    const requiredVersion = cleanToken(entry.requiredVersion);
    const foundVersion = cleanToken(entry.foundVersion);

    return {
        id: `compat_${normalizeToken(targetMod) || index}`,
        title: entry.issueType === 'outdated_dependency' ? 'Outdated Mod Dependency' : 'Missing Mod Dependency',
        description: buildCompatibilityDescription(entry),
        fixText: 'Install Compatible Mod',
        fixAction: 'install_compatible_mod',
        priority: entry.issueType === 'outdated_dependency' ? 12 : 11,
        compatibility: {
            issueType: entry.issueType,
            modName,
            dependencyName,
            targetMod,
            requiredVersion: requiredVersion || null,
            foundVersion: foundVersion || null,
            sourceLine: entry.sourceLine || ''
        }
    };
};

const extractCompatibilityIssuesFromLog = (logContent) => {
    if (!logContent || typeof logContent !== 'string') return [];

    const found = [];

    for (const rule of COMPATIBILITY_LINE_PATTERNS) {
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(logContent)) !== null) {
            const candidate = rule.mapMatch(match);
            if (!candidate) continue;
            found.push(candidate);
        }
    }

    const deduped = [];
    const seen = new Set();

    for (const entry of found) {
        const key = [
            normalizeToken(entry.issueType),
            normalizeToken(entry.modName),
            normalizeToken(entry.dependencyName),
            normalizeToken(entry.requiredVersion),
            normalizeToken(entry.foundVersion)
        ].join('|');

        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }

    return deduped;
};

const mergeCompatibilityIssues = (existingIssues, compatibilityEntries) => {
    const compatibilityIssues = compatibilityEntries.map((entry, index) => toCompatibilityIssue(entry, index));
    const alreadyCovered = new Set(
        existingIssues
            .filter((issue) => issue.fixAction === 'install_compatible_mod')
            .map((issue) => normalizeToken(issue?.compatibility?.targetMod || issue?.compatibility?.dependencyName || issue?.compatibility?.modName || ''))
    );

    const nextCompatibility = compatibilityIssues.filter((issue) => {
        const key = normalizeToken(issue?.compatibility?.targetMod || '');
        if (!key) return true;
        if (alreadyCovered.has(key)) return false;
        alreadyCovered.add(key);
        return true;
    });

    return [...existingIssues, ...nextCompatibility];
};

/**
 * Analyzes the provided log content for known crash patterns.
 * @param {string} logContent - The log content or crash report text.
 * @returns {Array} - A list of identified issues.
 */
export function analyzeLog(logContent, options: any = {}) {
    const safeLog = typeof logContent === 'string' ? logContent : '';
    const externalCompatibilityIssues = Array.isArray(options.compatibilityIssues)
        ? options.compatibilityIssues
        : [];

    if (!safeLog && externalCompatibilityIssues.length === 0) return [];

    const issues = [];

    for (const pattern of CRASH_PATTERNS) {
        const match = safeLog.match(pattern.regex);
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

    const inlineCompatibilityIssues = extractCompatibilityIssuesFromLog(safeLog);
    const mergedCompatibility = [...inlineCompatibilityIssues, ...externalCompatibilityIssues];

    const allIssues = mergeCompatibilityIssues(issues, mergedCompatibility);

    return allIssues.sort((a, b) => b.priority - a.priority);
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
