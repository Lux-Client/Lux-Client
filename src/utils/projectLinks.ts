const CURSEFORGE_PROJECT_PREFIX = 'curseforge:';
const MODRINTH_PROJECT_PREFIX = 'modrinth:';
const PLUGIN_PORTAL_PROJECT_PREFIX = 'pluginportal:';

export type ProjectPlatform = 'modrinth' | 'curseforge';

export interface ProjectLink {
    url: string;
    platform: ProjectPlatform;
}

const MODRINTH_PATH_BY_TYPE: Record<string, string> = {
    mod: 'mod',
    modpack: 'modpack',
    resourcepack: 'resourcepack',
    texturepack: 'resourcepack',
    shader: 'shader',
    datapack: 'datapack',
    plugin: 'plugin'
};

const CURSEFORGE_PATH_BY_TYPE: Record<string, string> = {
    mod: 'mc-mods',
    modpack: 'modpacks',
    resourcepack: 'texture-packs',
    texturepack: 'texture-packs',
    shader: 'shaders',
    datapack: 'data-packs',
    plugin: 'bukkit-plugins',
    world: 'worlds'
};

const firstString = (...values: unknown[]): string => {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value !== 'string') continue;
        const normalized = value.trim();
        if (normalized) return normalized;
    }
    return '';
};

const collectSources = (project: any): Set<string> => {
    const found = new Set<string>();
    const candidates = [
        ...(Array.isArray(project?.sources) ? project.sources : []),
        ...(Array.isArray(project?.__sourceSet) ? project.__sourceSet : []),
        project?.source,
        project?.provider,
        project?.platform
    ];

    candidates.forEach((candidate) => {
        const normalized = String(candidate || '').toLowerCase();
        if (!normalized) return;
        if (normalized.includes('modrinth')) found.add('modrinth');
        if (normalized.includes('curseforge')) found.add('curseforge');
    });

    return found;
};

const normalizeProjectType = (project: any): string => String(
    project?.project_type || project?.projectType || project?.type || ''
).toLowerCase().replace(/[^a-z]/g, '');

const stripPrefix = (value: string, prefix: string): string => (
    value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length).trim() : value
);

const hasPrefix = (value: string, prefix: string): boolean => value.toLowerCase().startsWith(prefix);

const resolveModrinthId = (project: any, sources: Set<string>): string => {
    const explicit = firstString(project?.modrinth_project_id, project?.modrinthProjectId);
    if (explicit) return stripPrefix(explicit, MODRINTH_PROJECT_PREFIX);

    // A curseforge-only entry never carries a usable Modrinth id.
    if (sources.has('curseforge') && !sources.has('modrinth')) return '';

    const rawId = firstString(project?.project_id, project?.projectId, project?.id);
    if (!rawId) return '';
    if (hasPrefix(rawId, CURSEFORGE_PROJECT_PREFIX) || hasPrefix(rawId, PLUGIN_PORTAL_PROJECT_PREFIX)) return '';

    const normalized = stripPrefix(rawId, MODRINTH_PROJECT_PREFIX);
    // Purely numeric ids are CurseForge ids, Modrinth uses base62 slugs/ids.
    if (!normalized || /^\d+$/.test(normalized)) return '';
    return normalized;
};

const resolveCurseForgeId = (project: any, sources: Set<string>): string => {
    const explicit = firstString(project?.curseforge_project_id, project?.curseforgeProjectId);
    if (explicit) return stripPrefix(explicit, CURSEFORGE_PROJECT_PREFIX);

    const rawId = firstString(project?.project_id, project?.projectId, project?.id);
    if (!rawId) return '';
    if (hasPrefix(rawId, CURSEFORGE_PROJECT_PREFIX)) return stripPrefix(rawId, CURSEFORGE_PROJECT_PREFIX);
    if (/^\d+$/.test(rawId) && sources.has('curseforge')) return rawId;
    return '';
};

/**
 * Builds the public project page URL for a Modrinth or CurseForge project so it can be
 * opened in the browser or shared. Returns null for entries we cannot link (e.g. local
 * jars without metadata or plugin portal results).
 */
export const getProjectLink = (project: any): ProjectLink | null => {
    if (!project) return null;

    const explicitUrl = firstString(
        project.website_url,
        project.websiteUrl,
        project.project_url,
        project.links?.websiteUrl
    );
    if (/^https?:\/\//i.test(explicitUrl)) {
        return {
            url: explicitUrl,
            platform: explicitUrl.toLowerCase().includes('curseforge') ? 'curseforge' : 'modrinth'
        };
    }

    const sources = collectSources(project);
    const projectType = normalizeProjectType(project);
    const slug = firstString(project.slug);

    const modrinthId = resolveModrinthId(project, sources);
    if (modrinthId) {
        const segment = MODRINTH_PATH_BY_TYPE[projectType] || 'project';
        return { url: `https://modrinth.com/${segment}/${encodeURIComponent(modrinthId)}`, platform: 'modrinth' };
    }

    const curseForgeId = resolveCurseForgeId(project, sources);
    if (curseForgeId) {
        const isCurseForgeNative = sources.has('curseforge') && !sources.has('modrinth');
        const segment = CURSEFORGE_PATH_BY_TYPE[projectType];
        if (slug && segment && isCurseForgeNative) {
            return { url: `https://www.curseforge.com/minecraft/${segment}/${encodeURIComponent(slug)}`, platform: 'curseforge' };
        }
        // /projects/<id> redirects to the correct project page for every class.
        return { url: `https://www.curseforge.com/projects/${encodeURIComponent(curseForgeId)}`, platform: 'curseforge' };
    }

    return null;
};

export const getProjectPlatformLabel = (platform: ProjectPlatform): string => (
    platform === 'curseforge' ? 'CurseForge' : 'Modrinth'
);
