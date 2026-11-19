// Recognises Modrinth and CurseForge project links pasted into a content search box
// and turns them into a search hit, so a pasted link shows exactly that project.

export type ContentLinkSource = 'modrinth' | 'curseforge';

export interface ParsedContentLink {
    source: ContentLinkSource;
    /** Slug or id taken from the link. */
    slug: string;
    /** Numeric CurseForge project id, when the link carries one. */
    numericId?: string;
    /** Project type the link path implies, if any. */
    projectType?: string;
}

const MODRINTH_TYPES: Record<string, string | undefined> = {
    mod: 'mod',
    resourcepack: 'resourcepack',
    shader: 'shader',
    modpack: 'modpack',
    datapack: 'datapack',
    plugin: 'plugin',
    project: undefined
};

const CURSEFORGE_TYPES: Record<string, string> = {
    'mc-mods': 'mod',
    'texture-packs': 'resourcepack',
    shaders: 'shader',
    customization: 'shader',
    modpacks: 'modpack',
    'bukkit-plugins': 'plugin',
    'data-packs': 'datapack'
};

export function parseContentLink(input: string): ParsedContentLink | null {
    const raw = String(input || '').trim();
    if (!raw || /\s/.test(raw)) return null;
    if (!/(^|\.|\/\/)(modrinth\.com|curseforge\.com)\//i.test(raw)) return null;

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

    if (host === 'modrinth.com' || host.endsWith('.modrinth.com')) {
        // modrinth.com/<type>/<slug>[/...]
        const [type, slug] = parts;
        if (!type || !slug || !(type in MODRINTH_TYPES)) return null;
        return { source: 'modrinth', slug, projectType: MODRINTH_TYPES[type] };
    }

    if (host === 'curseforge.com' || host.endsWith('.curseforge.com')) {
        // curseforge.com/projects/<id>
        if (parts[0] === 'projects' && /^\d+$/.test(parts[1] || '')) {
            return { source: 'curseforge', slug: parts[1], numericId: parts[1] };
        }
        // curseforge.com/minecraft/<class>/<slug or id>[/...]
        if (parts[0] === 'minecraft' && parts[1] && parts[2]) {
            const projectType = CURSEFORGE_TYPES[parts[1]];
            if (!projectType) return null;
            const slug = parts[2];
            return /^\d+$/.test(slug)
                ? { source: 'curseforge', slug, numericId: slug, projectType }
                : { source: 'curseforge', slug, projectType };
        }
    }

    return null;
}

export interface ResolvedContentLink {
    /** Exact project, when it could be pinned down. */
    hit: any | null;
    /** Fallback search results when the exact project was not found. */
    fallback: any[];
    projectType?: string;
}

const projectToHit = (project: any, source: ContentLinkSource) => ({
    project_id: project.id,
    project_type: project.project_type,
    title: project.title,
    description: project.description || '',
    author: project.author || '',
    icon_url: project.icon_url || null,
    downloads: Number(project.downloads || 0),
    slug: project.slug,
    source,
    curseforge_project_id: project.curseforge_project_id || null
});

export async function resolveContentLink(link: ParsedContentLink): Promise<ResolvedContentLink> {
    const api = (window as any).electronAPI;

    if (link.source === 'modrinth' || link.numericId) {
        const id = link.source === 'curseforge' ? `curseforge:${link.numericId}` : link.slug;
        const res = await api.getModrinthProject(id);
        if (res?.success && res.project) {
            const hit = projectToHit(res.project, link.source);
            return { hit, fallback: [], projectType: hit.project_type || link.projectType };
        }
        return { hit: null, fallback: [], projectType: link.projectType };
    }

    // CurseForge page links only carry the slug, so search for it and pick the exact match.
    const projectType = link.projectType || 'mod';
    const res = await api.searchModrinth(link.slug.replace(/-/g, ' '), [], {
        limit: 20,
        offset: 0,
        index: 'relevance',
        projectType,
        provider: 'curseforge'
    });
    const results: any[] = res?.success && Array.isArray(res.results) ? res.results : [];
    const hit = results.find((r) => String(r.slug || '').toLowerCase() === link.slug.toLowerCase()) || null;
    return { hit, fallback: hit ? [] : results, projectType };
}
