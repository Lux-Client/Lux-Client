const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const { downloadAndCacheIcon } = require('../utils/icon-cache');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const CURSEFORGE_API = 'https://api.curse.tools/v1/cf';
const CURSEFORGE_PROJECT_PREFIX = 'curseforge:';
const CURSEFORGE_VERSION_PREFIX = 'cf-file:';
const MODRINTH_PROJECT_PREFIX = 'modrinth:';
const USER_AGENT = 'LuxAGENT/MinecraftLauncher/1.0 (fernsehheft@pluginhub.de)';
const appData = app.getPath('userData');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('../utils/instances-path');
const modrinthToCurseForgeProjectMap = new Map();

const CURSEFORGE_CLASS_BY_PROJECT_TYPE = {
    mod: 6,
    plugin: 5,
    resourcepack: 12,
    modpack: 4471,
    shader: 6552
};

const CURSEFORGE_KNOWN_LOADERS = new Set([
    'forge',
    'neoforge',
    'fabric',
    'quilt',
    'paper',
    'spigot',
    'bukkit',
    'purpur',
    'folia',
    'velocity',
    'waterfall',
    'bungeecord'
]);

const CURSEFORGE_LOADER_ALIASES = {
    forge: ['forge'],
    neoforge: ['neoforge', 'neo forge'],
    fabric: ['fabric'],
    quilt: ['quilt'],
    paper: ['paper', 'spigot', 'bukkit', 'purpur', 'folia'],
    spigot: ['spigot', 'paper', 'bukkit', 'purpur', 'folia'],
    bukkit: ['bukkit', 'paper', 'spigot', 'purpur', 'folia'],
    purpur: ['purpur', 'paper', 'spigot', 'bukkit', 'folia'],
    folia: ['folia', 'paper', 'spigot', 'bukkit', 'purpur'],
    velocity: ['velocity'],
    waterfall: ['waterfall'],
    bungeecord: ['bungeecord'],
    vanilla: []
};

const normalizeProjectType = (projectType) => {
    const normalized = String(projectType || '').toLowerCase().trim();
    if (normalized === 'shaderpack' || normalized === 'shader_pack') return 'shader';
    if (normalized === 'resource_pack' || normalized === 'texturepack' || normalized === 'texture_pack') return 'resourcepack';
    return normalized || 'mod';
};

const normalizeModrinthProjectId = (projectId) => {
    if (typeof projectId !== 'string') return projectId;
    if (projectId.startsWith(MODRINTH_PROJECT_PREFIX)) {
        return projectId.slice(MODRINTH_PROJECT_PREFIX.length);
    }
    return projectId;
};

const mapCurseForgeClassToProjectType = (classId) => {
    if (classId === 5) return 'plugin';
    if (classId === 12) return 'resourcepack';
    if (classId === 6552) return 'shader';
    if (classId === 4471) return 'modpack';
    return 'mod';
};

const getCurseForgeClassId = (projectType) => {
    const normalized = normalizeProjectType(projectType);
    return CURSEFORGE_CLASS_BY_PROJECT_TYPE[normalized] || CURSEFORGE_CLASS_BY_PROJECT_TYPE.mod;
};

const toCurseForgeProjectId = (projectId) => `${CURSEFORGE_PROJECT_PREFIX}${projectId}`;

const isCurseForgeProjectId = (projectId) => {
    if (typeof projectId !== 'string') return false;
    return projectId.startsWith(CURSEFORGE_PROJECT_PREFIX);
};

const parseCurseForgeProjectId = (projectId) => {
    if (typeof projectId === 'number') return projectId;
    if (typeof projectId !== 'string') return NaN;
    const normalized = isCurseForgeProjectId(projectId)
        ? projectId.slice(CURSEFORGE_PROJECT_PREFIX.length)
        : projectId;
    return Number.parseInt(normalized, 10);
};

const normalizeCurseForgeProjectId = (projectId) => {
    if (typeof projectId === 'number' && Number.isFinite(projectId)) {
        return toCurseForgeProjectId(projectId);
    }

    if (typeof projectId !== 'string') return '';
    const normalized = projectId.trim();
    if (!normalized) return '';

    if (isCurseForgeProjectId(normalized)) {
        return normalized;
    }

    if (/^\d+$/.test(normalized)) {
        return toCurseForgeProjectId(normalized);
    }

    return '';
};

const toCurseForgeVersionId = (fileId) => `${CURSEFORGE_VERSION_PREFIX}${fileId}`;

const isCurseForgeVersionId = (versionId) => {
    if (typeof versionId !== 'string') return false;
    return versionId.startsWith(CURSEFORGE_VERSION_PREFIX);
};

const parseCurseForgeVersionId = (versionId) => {
    if (typeof versionId === 'number') return versionId;
    if (typeof versionId !== 'string') return NaN;

    if (isCurseForgeVersionId(versionId)) {
        return Number.parseInt(versionId.slice(CURSEFORGE_VERSION_PREFIX.length), 10);
    }

    if (/^\d+$/.test(versionId)) {
        return Number.parseInt(versionId, 10);
    }

    return NaN;
};

const sortByDateDesc = (left, right, key) => {
    const leftTime = new Date(left?.[key] || 0).getTime();
    const rightTime = new Date(right?.[key] || 0).getTime();
    return rightTime - leftTime;
};

const sortByDateAsc = (left, right, key) => {
    const leftTime = new Date(left?.[key] || 0).getTime();
    const rightTime = new Date(right?.[key] || 0).getTime();
    return leftTime - rightTime;
};

const getSearchDateValue = (entry, keys = []) => {
    for (const key of keys) {
        const value = entry?.[key];
        if (!value) continue;
        const parsed = new Date(value).getTime();
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return 0;
};

const getNormalizedSearchIndex = (index) => {
    const normalized = String(index || 'downloads').toLowerCase();
    if (normalized === 'relevance') return 'downloads';
    return normalized;
};

const normalizeSearchText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSearchEntryTitle = (entry) => entry?.title || entry?.name || '';

const getSearchEntrySummary = (entry) => entry?.description || entry?.summary || '';

const getSearchEntryAuthor = (entry) => entry?.author || '';

const getSearchEntryId = (entry) => String(entry?.project_id || entry?.id || '');

const getSearchEntryIcon = (entry) => {
    const icon = entry?.icon_url || entry?.icon || null;
    if (typeof icon !== 'string') return icon;
    const normalized = icon.trim();
    return normalized || null;
};

const resolveCurseForgeProjectIdFromSearchEntry = (entry) => {
    const sourceCandidates = normalizeSources(entry?.sources || entry?.__sourceSet || entry?.source);
    const candidates = [entry?.curseforge_project_id, entry?.project_id, entry?.id];

    for (const candidate of candidates) {
        const normalized = normalizeCurseForgeProjectId(candidate);
        if (normalized) {
            return normalized;
        }

        if (typeof candidate === 'string' && /^\d+$/.test(candidate) && sourceCandidates.includes('curseforge')) {
            return toCurseForgeProjectId(candidate);
        }
    }

    return '';
};

const resolveModrinthProjectIdFromSearchEntry = (entry) => {
    const candidates = [entry?.modrinth_project_id, entry?.project_id, entry?.id];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const normalized = normalizeModrinthProjectId(String(candidate).trim());
        if (!normalized) continue;
        if (isCurseForgeProjectId(normalized)) continue;
        if (/^\d+$/.test(normalized)) continue;
        return normalized;
    }

    return '';
};

const compareSearchEntriesStable = (leftEntry, rightEntry) => {
    const leftTitle = normalizeSearchText(getSearchEntryTitle(leftEntry));
    const rightTitle = normalizeSearchText(getSearchEntryTitle(rightEntry));
    if (leftTitle !== rightTitle) {
        return leftTitle < rightTitle ? -1 : 1;
    }

    const leftSummary = normalizeSearchText(getSearchEntrySummary(leftEntry));
    const rightSummary = normalizeSearchText(getSearchEntrySummary(rightEntry));
    if (leftSummary !== rightSummary) {
        return leftSummary < rightSummary ? -1 : 1;
    }

    const leftId = getSearchEntryId(leftEntry);
    const rightId = getSearchEntryId(rightEntry);
    if (leftId !== rightId) {
        return leftId < rightId ? -1 : 1;
    }

    return 0;
};

const normalizeSources = (sourceValue) => {
    if (sourceValue instanceof Set) {
        return normalizeSources([...sourceValue]);
    }

    if (Array.isArray(sourceValue)) {
        return sourceValue
            .map((entry) => String(entry || '').toLowerCase().trim())
            .filter(Boolean);
    }

    if (typeof sourceValue === 'string') {
        const normalized = sourceValue.toLowerCase();
        return ['modrinth', 'curseforge'].filter((source) => normalized.includes(source));
    }

    return [];
};

const createMergeCandidateKeys = (entry) => {
    const projectType = normalizeProjectType(entry?.project_type || 'mod');
    const title = normalizeSearchText(getSearchEntryTitle(entry));
    const summary = normalizeSearchText(getSearchEntrySummary(entry));
    const author = normalizeSearchText(getSearchEntryAuthor(entry));
    const slug = normalizeSearchText(entry?.slug || '');
    const keys = [];

    if (title && author) {
        keys.push(`${projectType}::title-author::${title}::${author}`);
    }

    if (slug) {
        keys.push(`${projectType}::slug::${slug}`);
    }

    if (title && summary) {
        keys.push(`${projectType}::title-summary::${title}::${summary}`);
    }

    if (title) {
        keys.push(`${projectType}::title::${title}`);
    }

    const fallbackId = String(entry?.project_id || entry?.id || '');
    if (fallbackId) {
        keys.push(`${projectType}::id::${fallbackId}`);
    }

    if (keys.length === 0) {
        keys.push(`${projectType}::rank::${Number(entry?.__providerRank ?? Number.MAX_SAFE_INTEGER)}`);
    }

    return [...new Set(keys)];
};

const createMergeKey = (entry) => {
    const candidateKeys = createMergeCandidateKeys(entry);
    if (candidateKeys.length > 0) {
        return candidateKeys[0];
    }

    const projectType = normalizeProjectType(entry?.project_type || 'mod');
    return `${projectType}::id::${String(entry?.project_id || entry?.id || '')}`;
};

const pickPreferredPrimaryEntry = (currentEntry, incomingEntry) => {
    const currentSources = normalizeSources(currentEntry?.sources || currentEntry?.__sourceSet || currentEntry?.source);
    const incomingSources = normalizeSources(incomingEntry?.sources || incomingEntry?.__sourceSet || incomingEntry?.source);

    const currentHasModrinth = currentSources.includes('modrinth');
    const incomingHasModrinth = incomingSources.includes('modrinth');

    if (incomingHasModrinth && !currentHasModrinth) {
        return incomingEntry;
    }

    if (currentHasModrinth && !incomingHasModrinth) {
        return currentEntry;
    }

    const currentDownloads = Number(currentEntry?.downloads || 0);
    const incomingDownloads = Number(incomingEntry?.downloads || 0);
    if (incomingDownloads > currentDownloads) {
        return incomingEntry;
    }

    return currentEntry;
};

const mergeDuplicateSearchEntries = (entries = []) => {
    const mergedByKey = new Map();

    for (const entry of entries) {
        const candidateKeys = createMergeCandidateKeys(entry);
        const mergeKey = candidateKeys.find((key) => mergedByKey.has(key)) || createMergeKey(entry);
        const existing = mergedByKey.get(mergeKey);

        if (!existing) {
            const modrinthProjectId = resolveModrinthProjectIdFromSearchEntry(entry);
            const curseforgeProjectId = resolveCurseForgeProjectIdFromSearchEntry(entry);
            const initialEntry = {
                ...entry,
                icon_url: getSearchEntryIcon(entry),
                modrinth_project_id: modrinthProjectId || undefined,
                curseforge_project_id: curseforgeProjectId || undefined,
                __sourceSet: new Set(normalizeSources(entry?.sources || entry?.__sourceSet || entry?.source)),
                __providerRank: Number(entry?.__providerRank ?? Number.MAX_SAFE_INTEGER)
            };

            for (const key of (candidateKeys.length > 0 ? candidateKeys : [mergeKey])) {
                mergedByKey.set(key, initialEntry);
            }
            continue;
        }

        const preferred = pickPreferredPrimaryEntry(existing, entry);
        const retained = preferred === existing ? entry : existing;

        const combinedSourceSet = new Set([
            ...normalizeSources(existing?.sources || existing?.__sourceSet || existing?.source),
            ...normalizeSources(entry?.sources || entry?.__sourceSet || entry?.source)
        ]);

        const mergedModrinthProjectId =
            resolveModrinthProjectIdFromSearchEntry(preferred) ||
            resolveModrinthProjectIdFromSearchEntry(retained) ||
            resolveModrinthProjectIdFromSearchEntry(existing) ||
            resolveModrinthProjectIdFromSearchEntry(entry);

        const mergedCurseForgeProjectId =
            resolveCurseForgeProjectIdFromSearchEntry(preferred) ||
            resolveCurseForgeProjectIdFromSearchEntry(retained) ||
            resolveCurseForgeProjectIdFromSearchEntry(existing) ||
            resolveCurseForgeProjectIdFromSearchEntry(entry);

        const mergedEntry = {
            ...preferred,
            downloads: Number(existing?.downloads || 0) + Number(entry?.downloads || 0),
            follows: Math.max(Number(existing?.follows || 0), Number(entry?.follows || 0)),
            icon_url: getSearchEntryIcon(preferred)
                || getSearchEntryIcon(retained)
                || getSearchEntryIcon(existing)
                || getSearchEntryIcon(entry)
                || null,
            date_created: (() => {
                const preferredValue = getSearchDateValue(preferred, ['date_created']);
                const retainedValue = getSearchDateValue(retained, ['date_created']);
                if (preferredValue > 0 && retainedValue > 0) {
                    return preferredValue <= retainedValue ? preferred.date_created : retained.date_created;
                }
                return preferred.date_created || retained.date_created;
            })(),
            date_modified: (() => {
                const preferredValue = getSearchDateValue(preferred, ['date_modified']);
                const retainedValue = getSearchDateValue(retained, ['date_modified']);
                if (preferredValue > 0 && retainedValue > 0) {
                    return preferredValue >= retainedValue ? preferred.date_modified : retained.date_modified;
                }
                return preferred.date_modified || retained.date_modified;
            })(),
            __providerRank: Math.min(
                Number(existing?.__providerRank ?? Number.MAX_SAFE_INTEGER),
                Number(entry?.__providerRank ?? Number.MAX_SAFE_INTEGER)
            ),
            modrinth_project_id: mergedModrinthProjectId || undefined,
            curseforge_project_id: mergedCurseForgeProjectId || undefined,
            __sourceSet: combinedSourceSet
        };

        const mergedKeys = [
            ...createMergeCandidateKeys(existing),
            ...candidateKeys,
            ...createMergeCandidateKeys(mergedEntry)
        ];

        for (const key of mergedKeys) {
            mergedByKey.set(key, mergedEntry);
        }
    }

    const uniqueMergedEntries = [...new Set(mergedByKey.values())];

    return uniqueMergedEntries.map((entry) => {
        const sourceList = [...(entry.__sourceSet || new Set())];
        const prioritizedSources = ['modrinth', 'curseforge'].filter((source) => sourceList.includes(source));
        const customSources = sourceList.filter((source) => !prioritizedSources.includes(source));
        const sources = [...prioritizedSources, ...customSources];
        const source = sources.length > 0 ? sources.join(' + ') : 'modrinth';
        const modrinthProjectId = resolveModrinthProjectIdFromSearchEntry(entry);
        const curseforgeProjectId = resolveCurseForgeProjectIdFromSearchEntry(entry);

        if (modrinthProjectId && curseforgeProjectId) {
            modrinthToCurseForgeProjectMap.set(modrinthProjectId, curseforgeProjectId);
        }

        return {
            ...entry,
            icon_url: getSearchEntryIcon(entry),
            source,
            sources,
            modrinth_project_id: modrinthProjectId || undefined,
            curseforge_project_id: curseforgeProjectId || undefined,
            __sourceSet: sources
        };
    });
};

const sortMergedSearchResults = (results, index) => {
    const normalizedIndex = getNormalizedSearchIndex(index);
    const sorted = [...results];

    if (normalizedIndex === 'downloads') {
        sorted.sort((left, right) => {
            const downloadsDiff = Number(right?.downloads || 0) - Number(left?.downloads || 0);
            if (downloadsDiff !== 0) return downloadsDiff;

            const followsDiff = Number(right?.follows || 0) - Number(left?.follows || 0);
            if (followsDiff !== 0) return followsDiff;

            const updatedDiff = getSearchDateValue(right, ['date_modified', 'date_created']) - getSearchDateValue(left, ['date_modified', 'date_created']);
            if (updatedDiff !== 0) return updatedDiff;

            return compareSearchEntriesStable(left, right);
        });
        return sorted;
    }

    if (normalizedIndex === 'newest') {
        sorted.sort((left, right) => {
            const createdDiff = getSearchDateValue(right, ['date_created', 'date_modified']) - getSearchDateValue(left, ['date_created', 'date_modified']);
            if (createdDiff !== 0) return createdDiff;

            const downloadsDiff = Number(right?.downloads || 0) - Number(left?.downloads || 0);
            if (downloadsDiff !== 0) return downloadsDiff;

            return compareSearchEntriesStable(left, right);
        });
        return sorted;
    }

    if (normalizedIndex === 'oldest') {
        sorted.sort((left, right) => {
            const createdDiff = getSearchDateValue(left, ['date_created', 'date_modified']) - getSearchDateValue(right, ['date_created', 'date_modified']);
            if (createdDiff !== 0) return createdDiff;

            const downloadsDiff = Number(right?.downloads || 0) - Number(left?.downloads || 0);
            if (downloadsDiff !== 0) return downloadsDiff;

            return compareSearchEntriesStable(left, right);
        });
        return sorted;
    }

    if (normalizedIndex === 'updated') {
        sorted.sort((left, right) => {
            const updatedDiff = getSearchDateValue(right, ['date_modified', 'date_created']) - getSearchDateValue(left, ['date_modified', 'date_created']);
            if (updatedDiff !== 0) return updatedDiff;

            const downloadsDiff = Number(right?.downloads || 0) - Number(left?.downloads || 0);
            if (downloadsDiff !== 0) return downloadsDiff;

            return compareSearchEntriesStable(left, right);
        });
        return sorted;
    }

    sorted.sort((left, right) => {
        const downloadsDiff = Number(right?.downloads || 0) - Number(left?.downloads || 0);
        if (downloadsDiff !== 0) return downloadsDiff;

        const followsDiff = Number(right?.follows || 0) - Number(left?.follows || 0);
        if (followsDiff !== 0) return followsDiff;

        const updatedDiff = getSearchDateValue(right, ['date_modified', 'date_created']) - getSearchDateValue(left, ['date_modified', 'date_created']);
        if (updatedDiff !== 0) return updatedDiff;

        return compareSearchEntriesStable(left, right);
    });

    return sorted;
};

const stripSearchInternalFields = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const { __providerRank, __sourceSet, ...cleanEntry } = entry;
    return cleanEntry;
};

const mapCurseForgeReleaseType = (releaseType) => {
    if (releaseType === 1) return 'release';
    if (releaseType === 2) return 'beta';
    if (releaseType === 3) return 'alpha';
    return 'release';
};

const extractCurseForgeGameVersions = (file) => {
    const list = Array.isArray(file?.gameVersions) ? file.gameVersions : [];
    return list.filter((entry) => /^\d+\.\d+(\.\d+)?$/.test(String(entry || '').trim()));
};

const extractCurseForgeLoaders = (file) => {
    const list = Array.isArray(file?.gameVersions) ? file.gameVersions : [];
    return list
        .map(entry => String(entry || '').toLowerCase())
        .filter(entry => CURSEFORGE_KNOWN_LOADERS.has(entry));
};

const getCurseForgeLoaderAliases = (loader) => {
    const normalized = String(loader || '').toLowerCase();
    return CURSEFORGE_LOADER_ALIASES[normalized] || [normalized];
};

const isCurseForgeLoaderCompatible = (file, loaders = []) => {
    if (!Array.isArray(loaders) || loaders.length === 0) {
        return true;
    }

    const versionEntries = Array.isArray(file?.gameVersions)
        ? file.gameVersions.map(entry => String(entry || '').toLowerCase())
        : [];

    const normalizedLoaders = loaders
        .map(loader => String(loader || '').toLowerCase())
        .filter(loader => loader && loader !== 'vanilla');

    if (normalizedLoaders.length === 0) {
        return true;
    }

    return normalizedLoaders.some(loader => {
        const aliases = getCurseForgeLoaderAliases(loader);
        return aliases.some(alias => versionEntries.includes(alias));
    });
};

const isCurseForgeGameVersionCompatible = (file, gameVersions = []) => {
    if (!Array.isArray(gameVersions) || gameVersions.length === 0) {
        return true;
    }

    const versionEntries = Array.isArray(file?.gameVersions)
        ? file.gameVersions.map(entry => String(entry || '').toLowerCase())
        : [];

    const normalizedVersions = gameVersions
        .map(version => String(version || '').toLowerCase())
        .filter(Boolean);

    if (normalizedVersions.length === 0) {
        return true;
    }

    return normalizedVersions.some(version => versionEntries.includes(version));
};

const mapCurseForgeModToSearchHit = (mod, projectType) => ({
    project_id: toCurseForgeProjectId(mod.id),
    project_type: normalizeProjectType(projectType || mapCurseForgeClassToProjectType(mod.classId)),
    title: mod.name,
    description: mod.summary || '',
    author: Array.isArray(mod.authors) && mod.authors.length > 0 ? mod.authors[0].name : 'Unknown',
    icon_url: mod.logo?.thumbnailUrl || mod.logo?.url || null,
    downloads: Number(mod.downloadCount || 0),
    follows: Number(mod.thumbsUpCount || 0),
    slug: mod.slug,
    source: 'curseforge',
    date_modified: mod.dateModified,
    date_created: mod.dateCreated
});

const mapCurseForgeFileToVersion = (file, projectId) => {
    const primaryUrl = file?.downloadUrl || '';
    const normalizedProjectId = normalizeCurseForgeProjectId(projectId);
    return {
        id: toCurseForgeVersionId(file.id),
        project_id: normalizedProjectId || undefined,
        source: 'curseforge',
        version_number: file.displayName || file.fileName || String(file.id),
        version_type: mapCurseForgeReleaseType(file.releaseType),
        date_published: file.fileDate,
        game_versions: extractCurseForgeGameVersions(file),
        loaders: extractCurseForgeLoaders(file),
        files: [
            {
                filename: file.fileName || `${file.id}.jar`,
                url: primaryUrl,
                primary: true,
                size: Number(file.fileLength || 0)
            }
        ]
    };
};

const getCurseForgeCompatibleVersions = async (projectId, loaders = [], gameVersions = []) => {
    const normalizedProjectId = normalizeCurseForgeProjectId(projectId);
    if (!normalizedProjectId) {
        return [];
    }

    const files = await getCurseForgeFiles(normalizedProjectId, 100);
    return files
        .filter(file => isCurseForgeLoaderCompatible(file, loaders))
        .filter(file => isCurseForgeGameVersionCompatible(file, gameVersions))
        .sort((left, right) => sortByDateDesc(left, right, 'fileDate'))
        .map(file => mapCurseForgeFileToVersion(file, normalizedProjectId));
};

const getCurseForgeProject = async (projectId) => {
    const numericProjectId = parseCurseForgeProjectId(projectId);
    if (!Number.isFinite(numericProjectId)) {
        throw new Error('Invalid CurseForge project ID');
    }

    const response = await axios.get(`${CURSEFORGE_API}/mods/${numericProjectId}`, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000
    });

    return response?.data?.data;
};

const getCurseForgeFiles = async (projectId, pageSize = 50) => {
    const numericProjectId = parseCurseForgeProjectId(projectId);
    if (!Number.isFinite(numericProjectId)) {
        throw new Error('Invalid CurseForge project ID');
    }

    const response = await axios.get(`${CURSEFORGE_API}/mods/${numericProjectId}/files`, {
        params: { pageSize, index: 0 },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000
    });

    return Array.isArray(response?.data?.data) ? response.data.data : [];
};

const getCurseForgeFile = async (projectId, versionId) => {
    const numericProjectId = parseCurseForgeProjectId(projectId);
    const numericVersionId = parseCurseForgeVersionId(versionId);

    if (!Number.isFinite(numericProjectId) || !Number.isFinite(numericVersionId)) {
        throw new Error('Invalid CurseForge project or version ID');
    }

    const response = await axios.get(`${CURSEFORGE_API}/mods/${numericProjectId}/files/${numericVersionId}`, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000
    });

    return response?.data?.data;
};

const searchCurseForge = async ({ query, projectType, limit = 20, offset = 0, index = 'downloads' }) => {
    const classId = getCurseForgeClassId(projectType);
    const normalizedLimit = Math.max(1, Number(limit) || 20);
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const normalizedIndex = getNormalizedSearchIndex(index);
    const maxPageSize = 50;

    let sortField;
    let sortOrder;
    if (normalizedIndex === 'downloads') {
        sortField = 6;
        sortOrder = 'desc';
    } else if (normalizedIndex === 'newest' || normalizedIndex === 'updated') {
        sortField = 3;
        sortOrder = 'desc';
    } else if (normalizedIndex === 'oldest') {
        sortField = 3;
        sortOrder = 'asc';
    }

    const mapped = [];
    let totalHits = 0;
    let remaining = normalizedLimit;
    let currentOffset = normalizedOffset;
    let requestCount = 0;

    while (remaining > 0 && requestCount < 5) {
        requestCount += 1;

        const params = {
            gameId: 432,
            classId,
            searchFilter: query || '',
            pageSize: Math.min(maxPageSize, remaining),
            index: currentOffset
        };

        if (sortField !== undefined) params.sortField = sortField;
        if (sortOrder !== undefined) params.sortOrder = sortOrder;

        const response = await axios.get(`${CURSEFORGE_API}/mods/search`, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
        });

        const mods = Array.isArray(response?.data?.data) ? response.data.data : [];
        const resultCount = Number(response?.data?.pagination?.resultCount || mods.length);
        totalHits = Number(response?.data?.pagination?.totalCount || totalHits || mods.length);

        mapped.push(...mods.map(mod => mapCurseForgeModToSearchHit(mod, projectType)));

        if (resultCount <= 0) break;

        currentOffset += resultCount;
        remaining -= resultCount;

        if (totalHits > 0 && currentOffset >= totalHits) {
            break;
        }
    }

    if (normalizedIndex === 'downloads') {
        mapped.sort((left, right) => Number(right?.downloads || 0) - Number(left?.downloads || 0));
    } else if (normalizedIndex === 'newest') {
        mapped.sort((left, right) => sortByDateDesc(left, right, 'date_created'));
    } else if (normalizedIndex === 'oldest') {
        mapped.sort((left, right) => sortByDateAsc(left, right, 'date_created'));
    } else if (normalizedIndex === 'updated') {
        mapped.sort((left, right) => sortByDateDesc(left, right, 'date_modified'));
    }

    return {
        results: mapped,
        total_hits: Number(totalHits || mapped.length),
        offset: normalizedOffset,
        limit: normalizedLimit
    };
};

const resolveInstallContext = async (data) => {
    let loader = 'vanilla';
    let version = '';

    if (data.isServer) {
        const serversDir = path.join(appData, 'servers');
        const resolvedSafeName = await resolveServerSafeName(data.instanceName, data.serverSafeName);
        const serverJsonPath = path.join(serversDir, resolvedSafeName, 'server.json');
        if (await fs.pathExists(serverJsonPath)) {
            const serverConfig = await fs.readJson(serverJsonPath);
            loader = serverConfig.software ? serverConfig.software.toLowerCase() : 'vanilla';
            version = serverConfig.version;
        }
    } else {
        const instanceDir = resolveInstanceDirByName(data.instanceName) || path.join(resolvePrimaryInstancesDir(), data.instanceName);
        const instanceJsonPath = path.join(instanceDir, 'instance.json');
        if (await fs.pathExists(instanceJsonPath)) {
            const instance = await fs.readJson(instanceJsonPath);
            loader = instance.loader ? instance.loader.toLowerCase() : 'vanilla';
            version = instance.version;
        }
    }

    return { loader, version };
};

const updateModCacheForInstall = async ({ destination, projectId, versionId, source, title, icon, version }) => {
    try {
        if (!destination || !await fs.pathExists(destination)) return;

        const stats = await fs.stat(destination);
        const cacheKey = `${path.basename(destination)}-${stats.size}`;
        const cachePath = path.join(appData, 'mod_cache.json');
        let cache = {};

        if (await fs.pathExists(cachePath)) {
            cache = await fs.readJson(cachePath).catch(() => ({}));
        }

        const cachedIcon = await downloadAndCacheIcon(icon);
        cache[cacheKey] = {
            title: title || path.basename(destination),
            icon: cachedIcon || icon || null,
            version: version || null,
            projectId,
            versionId,
            source,
            timestamp: Date.now()
        };

        await fs.writeJson(cachePath, cache);
    } catch (e) {
        console.warn('[Install:Cache] Failed to update mod cache:', e.message);
    }
};

const getFolderForProjectType = (projectType) => {
    switch (normalizeProjectType(projectType)) {
        case 'resourcepack': return 'resourcepacks';
        case 'shader': return 'shaderpacks';
        case 'plugin': return 'plugins';
        default: return 'mods';
    }
};

const SERVER_PLUGIN_SOFTWARE = new Set([
    'bukkit',
    'spigot',
    'paper',
    'purpur',
    'folia',
    'bungeecord',
    'waterfall',
    'velocity'
]);

const SERVER_MOD_SOFTWARE = new Set([
    'forge',
    'neoforge',
    'fabric',
    'quilt',
    'magma',
    'mohist',
    'arclight',
    'ketting',
    'spongeforge',
    'catserver'
]);

const getFolderForServerSoftware = (software, fallbackProjectType) => {
    const normalizedSoftware = String(software || '').toLowerCase();

    if (SERVER_PLUGIN_SOFTWARE.has(normalizedSoftware)) {
        return 'plugins';
    }

    if (SERVER_MOD_SOFTWARE.has(normalizedSoftware)) {
        return 'mods';
    }

    return getFolderForProjectType(fallbackProjectType);
};

function sanitizeFileName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

const resolveServerSafeName = async (instanceName, explicitSafeName) => {
    if (explicitSafeName && typeof explicitSafeName === 'string') {
        return sanitizeFileName(explicitSafeName);
    }

    const directSafeName = sanitizeFileName(instanceName || '');
    const directConfigPath = path.join(appData, 'servers', directSafeName, 'server.json');
    if (await fs.pathExists(directConfigPath)) {
        return directSafeName;
    }

    const serversDir = path.join(appData, 'servers');
    if (!await fs.pathExists(serversDir)) {
        return directSafeName;
    }

    const dirs = await fs.readdir(serversDir);
    for (const dir of dirs) {
        const configPath = path.join(serversDir, dir, 'server.json');
        if (!await fs.pathExists(configPath)) continue;

        try {
            const config = await fs.readJson(configPath);
            if (config?.name === instanceName || config?.safeName === directSafeName) {
                return dir;
            }
        } catch (_) {
        }
    }

    return directSafeName;
};

const emitServerInstallLog = (win, serverName, message) => {
    try {
        if (!win || !serverName) return;
        win.webContents.send('server:console', {
            serverName,
            log: `[Modrinth Install] ${message}`
        });
    } catch (_) {
    }
};

const installModInternal = async (win, { instanceName, serverSafeName, projectId, versionId, filename, url, projectType, isServer }) => {
    let dest;
    try {
        let folder = getFolderForProjectType(projectType);
        let resolvedServerSoftware = '';

        let resolvedName = instanceName;
        let contentDir;

        if (isServer) {
            const baseDir = path.join(appData, 'servers');
            resolvedName = await resolveServerSafeName(instanceName, serverSafeName);
            const serverJsonPath = path.join(baseDir, resolvedName, 'server.json');
            if (await fs.pathExists(serverJsonPath)) {
                try {
                    const serverConfig = await fs.readJson(serverJsonPath);
                    resolvedServerSoftware = String(serverConfig?.software || '').toLowerCase();
                    folder = getFolderForServerSoftware(resolvedServerSoftware, projectType);
                } catch (readError) {
                    console.warn('[Modrinth:Install] Could not read server config for folder resolution:', readError.message);
                }
            }

            contentDir = path.join(baseDir, resolvedName, folder);
        } else {
            const instanceDir = resolveInstanceDirByName(instanceName) || path.join(resolvePrimaryInstancesDir(), instanceName);
            contentDir = path.join(instanceDir, folder);
        }

        console.log(`[Modrinth:Install] Starting install for ${instanceName} (${projectType})`);
        console.log(`[Modrinth:Install] isServer=${!!isServer}, resolvedName=${resolvedName}, software=${resolvedServerSoftware || 'n/a'}, folder=${folder}`);
        console.log(`[Modrinth:Install] contentDir=${contentDir}`);
        if (isServer) {
            emitServerInstallLog(win, instanceName, `Resolving target folder: ${contentDir}`);
        }

        await fs.ensureDir(contentDir);

        const contentDirExists = await fs.pathExists(contentDir);
        console.log(`[Modrinth:Install] contentDir exists after ensureDir: ${contentDirExists}`);
        if (isServer) {
            emitServerInstallLog(win, instanceName, `Target folder exists: ${contentDirExists}`);
        }

        dest = path.join(contentDir, filename);
        console.log(`[Modrinth:Install] destination file: ${dest}`);
        if (isServer) {
            emitServerInstallLog(win, instanceName, `Downloading jar to: ${dest}`);
        }

        if (await fs.pathExists(dest)) {
            if (win) {
                win.webContents.send('install:progress', {
                    instanceName,
                    progress: 100,
                    status: `Skipping ${filename} (already installed)`
                });
            }
            console.log(`[Modrinth:Install] Skipped existing file: ${dest}`);
            if (isServer) {
                emitServerInstallLog(win, instanceName, `File already exists, skipping: ${filename}`);
            }
            return { success: true, skipped: true, destination: dest };
        }

        const maxAttempts = 2;
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 30000
                });

                const writer = fs.createWriteStream(dest);
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;

                response.data.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (win) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        win.webContents.send('install:progress', {
                            instanceName,
                            progress,
                            status: `Installing ${filename} (Attempt ${attempt}/${maxAttempts})`
                        });
                    }
                });

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                const fileExistsAfterDownload = await fs.pathExists(dest);
                if (!fileExistsAfterDownload) {
                    throw new Error(`Downloaded file not found at expected destination: ${dest}`);
                }

                console.log(`[Modrinth:Install] Download complete: ${filename}`);
                if (win) {
                    win.webContents.send('install:progress', {
                        instanceName,
                        progress: 100,
                        status: `Installed ${filename}`
                    });
                }

                lastError = null;
                break;
            } catch (e) {
                lastError = e;
                console.warn(`[Modrinth:Install] Attempt ${attempt} failed for ${filename}: ${e.message}`);
                if (dest && await fs.pathExists(dest)) {
                    try { await fs.unlink(dest); } catch (_) { }
                }
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        if (lastError) {
            console.error(`[Modrinth:Install] All ${maxAttempts} attempts failed for ${filename}. Skipping.`);
            if (win) {
                win.webContents.send('install:progress', {
                    instanceName,
                    progress: 100,
                    status: `Skipping ${filename} (Download failed)`
                });
            }
            return { success: true, skipped: true, error: lastError.message };
        }
        if (projectType === 'shader') {
            try {
                const instanceDir = resolveInstanceDirByName(instanceName) || path.join(resolvePrimaryInstancesDir(), instanceName);
                const instanceJsonPath = path.join(instanceDir, 'instance.json');
                if (await fs.pathExists(instanceJsonPath)) {
                    const instance = await fs.readJson(instanceJsonPath);
                    const loader = instance.loader ? instance.loader.toLowerCase() : 'vanilla';
                    const version = instance.version;

                    const softwares = [];

                    if (loader === 'fabric' || loader === 'quilt' || loader === 'neoforge') {
                        softwares.push({ id: 'iris', name: 'Iris Shaders' });
                        softwares.push({ id: 'sodium', name: 'Sodium' });
                    } else if (loader === 'forge') {
                        softwares.push({ id: 'oculus', name: 'Oculus' });
                    }

                    for (const sw of softwares) {
                        try {
                            const modsDir = path.join(instanceDir, 'mods');
                            await fs.ensureDir(modsDir);
                            const currentFiles = await fs.readdir(modsDir);

                            const res = await axios.get(`${MODRINTH_API}/project/${sw.id}/version`, {
                                params: {
                                    loaders: JSON.stringify([loader]),
                                    game_versions: JSON.stringify([version])
                                },
                                headers: { 'User-Agent': USER_AGENT }
                            });

                            if (res.data && res.data.length > 0) {
                                const latest = res.data[0];
                                const file = latest.files.find(f => f.primary) || latest.files[0];

                                if (!currentFiles.includes(file.filename)) {
                                    const softwareDest = path.join(modsDir, file.filename);
                                    const swWriter = fs.createWriteStream(softwareDest);
                                    const swRes = await axios({
                                        url: file.url,
                                        method: 'GET',
                                        responseType: 'stream',
                                        headers: { 'User-Agent': USER_AGENT }
                                    });
                                    swRes.data.pipe(swWriter);
                                    await new Promise((resolve) => swWriter.on('finish', resolve));

                                    if (win) {
                                        win.webContents.send('install:progress', {
                                            instanceName,
                                            progress: 100,
                                            status: `Auto-installed ${sw.name} for shader support`
                                        });
                                    }
                                }
                            }
                        } catch (swErr) {
                            console.error(`[Modrinth] Error auto-installing ${sw.name}:`, swErr.message);
                        }
                    }
                }
            } catch (err) {
                console.error("[Modrinth] Error auto-installing shader software:", err);
            }
        }

        return { success: true, destination: dest };

    } catch (e) {
        console.error("Modrinth Install Error:", e);
        console.error(`[Modrinth:Install] instance=${instanceName}, projectId=${projectId}, versionId=${versionId}, dest=${dest || 'n/a'}`);
        if (isServer) {
            emitServerInstallLog(win, instanceName, `Install failed: ${e.message}`);
            if (dest) {
                emitServerInstallLog(win, instanceName, `Last destination path: ${dest}`);
            }
        }

        if (dest && await fs.pathExists(dest)) {
            try { await fs.unlink(dest); } catch (delErr) { console.warn('[Modrinth] Failed to clean up partial download:', delErr.message); }
        }
        return { success: false, error: e.message };
    }
};

const resolveDependenciesInternal = async (versionId, loaders = [], gameVersions = []) => {
    const resolved = new Map();
    const queue = [versionId];
    const visited = new Set();

    try {
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (visited.has(currentId)) continue;
            const vRes = await axios.get(`${MODRINTH_API}/version/${currentId}`, { headers: { 'User-Agent': USER_AGENT } });
            const version = vRes.data;
            if (!resolved.has(version.project_id)) {

                const pRes = await axios.get(`${MODRINTH_API}/project/${version.project_id}`, { headers: { 'User-Agent': USER_AGENT } });
                resolved.set(version.project_id, {
                    projectId: version.project_id,
                    versionId: version.id,
                    title: pRes.data.title,
                    iconUrl: pRes.data.icon_url,
                    filename: (version.files.find(f => f.primary) || version.files[0]).filename,
                    url: (version.files.find(f => f.primary) || version.files[0]).url,
                    projectType: pRes.data.project_type,
                    isPrimary: resolved.size === 0
                });
            }
            if (version.dependencies) {
                for (const dep of version.dependencies) {
                    if (dep.dependency_type !== 'required') continue;
                    if (dep.version_id) {
                        if (!visited.has(dep.version_id)) {
                            queue.push(dep.version_id);
                        }
                    }

                    else if (dep.project_id) {
                        if (!resolved.has(dep.project_id)) {
                            const params = {
                                loaders: JSON.stringify(loaders),
                                game_versions: JSON.stringify(gameVersions)
                            };
                            try {
                                const vListRes = await axios.get(`${MODRINTH_API}/project/${dep.project_id}/version`, {
                                    params,
                                    headers: { 'User-Agent': USER_AGENT }
                                });
                                if (vListRes.data && vListRes.data.length > 0) {
                                    queue.push(vListRes.data[0].id);
                                }
                            } catch (err) {
                                console.warn(`[Modrinth:Resolve] Could not find compatible version for dependency project ${dep.project_id}`);
                            }
                        }
                    }
                }
            }
            visited.add(currentId);
        }

        return { success: true, dependencies: Array.from(resolved.values()) };
    } catch (e) {
        console.error("[Modrinth:Resolve] Error:", e.response?.data || e.message);
        return { success: false, error: e.message };
    }
};

module.exports = (ipcMain, win) => {
    ipcMain.handle('modrinth:search', async (_, query, facets = [], options = {}) => {
        try {
            const { limit = 20, offset = 0, index, projectType = 'mod', provider = 'modrinth' } = options;
            const includeCurseforge = provider === 'curseforge' || provider === 'both';
            const includeModrinth = provider === 'modrinth' || provider === 'both';

            const normalizedLimit = Math.max(1, Number(limit) || 20);
            const normalizedOffset = Math.max(0, Number(offset) || 0);
            const normalizedIndex = getNormalizedSearchIndex(index);

            const baseFetchLimit = (includeCurseforge && includeModrinth)
                ? Math.min(Math.max(normalizedLimit + normalizedOffset, normalizedLimit), 100)
                : normalizedLimit;
            const mergeFetchBuffer = 30;
            const mergeCandidateTarget = normalizedOffset + normalizedLimit + mergeFetchBuffer;

            const modrinthFetchLimit = (includeCurseforge && includeModrinth)
                ? Math.min(Math.max(baseFetchLimit, mergeCandidateTarget), 100)
                : baseFetchLimit;
            const curseforgeFetchLimit = (includeCurseforge && includeModrinth)
                ? Math.min(Math.max(baseFetchLimit, mergeCandidateTarget), 250)
                : baseFetchLimit;

            const facetStr = JSON.stringify([[`project_type:${projectType}`], ...facets]);

            let modrinthResults = [];
            let modrinthTotalHits = 0;
            let modrinthOffset = normalizedOffset;
            let modrinthLimit = normalizedLimit;

            if (includeModrinth) {
                const params = {
                    query,
                    facets: facetStr,
                    limit: modrinthFetchLimit,
                    offset: (includeCurseforge && includeModrinth) ? 0 : normalizedOffset
                };
                if (normalizedIndex) params.index = normalizedIndex;

                try {
                    const response = await axios.get(`${MODRINTH_API}/search`, {
                        params,
                        headers: { 'User-Agent': USER_AGENT }
                    });
                    const data = response.data;
                    modrinthResults = (data.hits || []).map((hit, rank) => ({
                        ...hit,
                        source: 'modrinth',
                        __providerRank: rank
                    }));
                    modrinthTotalHits = Number(data.total_hits || 0);
                    modrinthOffset = Number(data.offset ?? normalizedOffset);
                    modrinthLimit = Number(data.limit ?? normalizedLimit);
                } catch (modrinthError) {
                    if (provider === 'modrinth') {
                        throw modrinthError;
                    }
                    console.warn('[Modrinth:Search] Modrinth API unavailable:', modrinthError.message);
                }
            }

            let results = modrinthResults;
            let totalHits = modrinthTotalHits;

            if (includeCurseforge) {
                try {
                    const curseforgeResult = await searchCurseForge({
                        query,
                        projectType,
                        limit: curseforgeFetchLimit,
                        offset: (includeCurseforge && includeModrinth) ? 0 : normalizedOffset,
                        index: normalizedIndex
                    });

                    const curseforgeResults = (curseforgeResult.results || []).map((hit, rank) => ({
                        ...hit,
                        __providerRank: rank
                    }));

                    if (includeModrinth) {
                        // Merging mode
                        const deduplicated = mergeDuplicateSearchEntries([...modrinthResults, ...curseforgeResults]);
                        totalHits = deduplicated.length; // This is a limitation of merging, we can't easily know the true global total
                        const merged = sortMergedSearchResults(deduplicated, normalizedIndex);
                        results = merged.slice(normalizedOffset, normalizedOffset + normalizedLimit);
                    } else {
                        // CurseForge only mode
                        results = curseforgeResults;
                        totalHits = Number(curseforgeResult.total_hits || 0);
                    }
                } catch (curseforgeError) {
                    if (provider === 'curseforge') {
                        throw curseforgeError;
                    }
                    console.warn('[CurseForge:Search] Failed to fetch CurseForge results:', curseforgeError.message);
                    if (includeModrinth) {
                        results = modrinthResults.slice(normalizedOffset, normalizedOffset + normalizedLimit);
                    }
                }
            }

            return {
                success: true,
                results: results.map(stripSearchInternalFields),
                total_hits: totalHits,
                offset: (includeCurseforge && includeModrinth) ? normalizedOffset : modrinthOffset,
                limit: (includeCurseforge && includeModrinth) ? normalizedLimit : modrinthLimit
            };
        } catch (e) {
            console.error("Modrinth Search Error:", e.response ? e.response.data : e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('modrinth:install', async (_, data) => {
        const isCurseForgeInstall =
            isCurseForgeProjectId(String(data?.projectId || '')) ||
            String(data?.source || '').toLowerCase() === 'curseforge' ||
            isCurseForgeVersionId(String(data?.versionId || ''));

        const normalizedData = {
            ...data,
            projectId: normalizeModrinthProjectId(data?.projectId),
            projectType: normalizeProjectType(data?.projectType)
        };

        if (isCurseForgeInstall) {
            try {
                const mappedFallbackCurseForgeProjectId = modrinthToCurseForgeProjectMap.get(normalizeModrinthProjectId(String(data?.projectId || '')));
                const resolvedCurseForgeProjectId =
                    normalizeCurseForgeProjectId(data?.projectId)
                    || normalizeCurseForgeProjectId(data?.curseforgeProjectId)
                    || normalizeCurseForgeProjectId(data?.fallbackCurseForgeProjectId)
                    || normalizeCurseForgeProjectId(mappedFallbackCurseForgeProjectId);

                const numericProjectId = parseCurseForgeProjectId(resolvedCurseForgeProjectId);
                if (!Number.isFinite(numericProjectId)) {
                    return { success: false, error: 'Invalid CurseForge project ID' };
                }

                let resolvedVersionId = parseCurseForgeVersionId(data.versionId);
                let resolvedFilename = data.filename;
                let resolvedUrl = data.url;
                let resolvedVersionName = data.versionName || null;

                if ((!resolvedFilename || !resolvedUrl) && Number.isFinite(resolvedVersionId)) {
                    const fileData = await getCurseForgeFile(numericProjectId, resolvedVersionId);
                    resolvedFilename = resolvedFilename || fileData?.fileName;
                    resolvedUrl = resolvedUrl || fileData?.downloadUrl;
                    resolvedVersionName = resolvedVersionName || fileData?.displayName || fileData?.fileName || null;
                }

                if (!resolvedFilename || !resolvedUrl) {
                    const { loader, version } = await resolveInstallContext(data);
                    const allFiles = await getCurseForgeFiles(numericProjectId, 100);
                    const compatibleFiles = allFiles
                        .filter(file => isCurseForgeLoaderCompatible(file, loader && loader !== 'vanilla' ? [loader] : []))
                        .filter(file => isCurseForgeGameVersionCompatible(file, version ? [version] : []))
                        .sort((left, right) => sortByDateDesc(left, right, 'fileDate'));

                    const selectedFile = compatibleFiles[0] || allFiles.sort((left, right) => sortByDateDesc(left, right, 'fileDate'))[0];

                    if (!selectedFile) {
                        return { success: false, error: 'No compatible CurseForge file found' };
                    }

                    resolvedVersionId = selectedFile.id;
                    resolvedFilename = selectedFile.fileName;
                    resolvedUrl = selectedFile.downloadUrl;
                    resolvedVersionName = resolvedVersionName || selectedFile.displayName || selectedFile.fileName || null;
                }

                if (!resolvedFilename || !resolvedUrl) {
                    return { success: false, error: 'Could not resolve CurseForge download file' };
                }

                let projectTitle = data.title || null;
                let projectIcon = data.iconUrl || data.icon || null;
                try {
                    const projectData = await getCurseForgeProject(numericProjectId);
                    projectTitle = projectTitle || projectData?.name || null;
                    projectIcon = projectIcon || projectData?.logo?.url || projectData?.logo?.thumbnailUrl || null;
                } catch (projectError) {
                    console.warn('[CurseForge:Install] Could not fetch project metadata:', projectError.message);
                }

                const cacheVersionId = Number.isFinite(resolvedVersionId)
                    ? toCurseForgeVersionId(resolvedVersionId)
                    : data.versionId;
                const cacheProjectId = toCurseForgeProjectId(numericProjectId);

                const installResult = await installModInternal(win, {
                    ...data,
                    projectId: cacheProjectId,
                    versionId: cacheVersionId,
                    filename: resolvedFilename,
                    url: resolvedUrl
                });

                if (installResult.success && installResult.destination) {
                    await updateModCacheForInstall({
                        destination: installResult.destination,
                        projectId: cacheProjectId,
                        versionId: cacheVersionId,
                        source: 'curseforge',
                        title: projectTitle,
                        icon: projectIcon,
                        version: resolvedVersionName
                    });
                }

                return installResult;
            } catch (error) {
                console.error('[CurseForge:Install] Error:', error);
                return { success: false, error: error.message };
            }
        }

        if (normalizedData.projectType === 'mod' || normalizedData.projectType === 'plugin') {
            try {
                const { loader, version } = await resolveInstallContext(normalizedData);

                if (loader !== 'vanilla' && version) {

                    const resolveLoader = ['spigot', 'bukkit', 'purpur', 'folia'].includes(loader) ? 'paper' : loader;

                    const resolveRes = await resolveDependenciesInternal(normalizedData.versionId, [resolveLoader], [version]);

                    if (resolveRes.success && resolveRes.dependencies.length > 0) {
                        let successCount = 0;
                        let failCount = 0;
                        for (const dep of resolveRes.dependencies) {
                            const installRes = await installModInternal(win, {
                                instanceName: normalizedData.instanceName,
                                serverSafeName: normalizedData.serverSafeName,
                                projectId: dep.projectId,
                                versionId: dep.versionId,
                                filename: dep.filename,
                                url: dep.url,
                                projectType: dep.projectType || normalizedData.projectType,
                                isServer: normalizedData.isServer
                            });

                            if (installRes.success) successCount++;
                            else failCount++;
                        }

                        return { success: failCount === 0 };
                    }
                }
            } catch (err) {
                console.error("[Modrinth:Install] Dependency resolution failed, falling back to single install:", err);
            }
        }
        return await installModInternal(win, normalizedData);
    });

    ipcMain.handle('modrinth:get-versions', async (_, projectId, loaders = [], gameVersions = [], fallbackCurseForgeProjectId = null) => {
        try {
            if (isCurseForgeProjectId(projectId)) {
                const versions = await getCurseForgeCompatibleVersions(projectId, loaders, gameVersions);

                return { success: true, versions };
            }

            const params = {};
            const normalizedProjectId = normalizeModrinthProjectId(projectId);
            const explicitFallbackCurseForgeProjectId = normalizeCurseForgeProjectId(fallbackCurseForgeProjectId);
            if (loaders.length) params.loaders = JSON.stringify(loaders);
            if (gameVersions.length) params.game_versions = JSON.stringify(gameVersions);
            const response = await axios.get(`${MODRINTH_API}/project/${normalizedProjectId}/version`, {
                params,
                headers: { 'User-Agent': USER_AGENT }
            });
            const modrinthVersions = Array.isArray(response?.data) ? response.data : [];
            if (modrinthVersions.length > 0) {
                return { success: true, versions: modrinthVersions };
            }

            const mappedCurseForgeProjectId = modrinthToCurseForgeProjectMap.get(normalizedProjectId);
            const resolvedCurseForgeFallbackProjectId = explicitFallbackCurseForgeProjectId || mappedCurseForgeProjectId;
            if (resolvedCurseForgeFallbackProjectId) {
                const fallbackVersions = await getCurseForgeCompatibleVersions(resolvedCurseForgeFallbackProjectId, loaders, gameVersions);
                if (fallbackVersions.length > 0) {
                    return { success: true, versions: fallbackVersions };
                }
            }

            return { success: true, versions: modrinthVersions };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('modrinth:update-file', async (_, { instanceName, projectType, oldFileName, newFileName, url, isServer }) => {
        try {
            const folder = getFolderForProjectType(projectType);

            let contentDir;
            if (isServer) {
                const baseDir = path.join(appData, 'servers');
                const resolvedName = sanitizeFileName(instanceName);
                contentDir = path.join(baseDir, resolvedName, folder);
            } else {
                const instanceDir = resolveInstanceDirByName(instanceName) || path.join(resolvePrimaryInstancesDir(), instanceName);
                contentDir = path.join(instanceDir, folder);
            }

            const oldPath = path.join(contentDir, oldFileName);
            const newPath = path.join(contentDir, newFileName);

            const writer = fs.createWriteStream(newPath);
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: { 'User-Agent': USER_AGENT },
                timeout: 30000
            });

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;

            response.data.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (win) {
                    const progress = Math.round((downloadedSize / totalSize) * 100);
                    win.webContents.send('install:progress', { instanceName, progress, status: `Updating ${newFileName}` });
                }
            });

            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            if (await fs.pathExists(oldPath)) await fs.remove(oldPath);
            if (win) {
                win.webContents.send('install:progress', { instanceName, progress: 100, status: `Updated ${newFileName}` });
            }
            return { success: true };
        } catch (e) {
            console.error(`[Modrinth:Update] Error updating file:`, e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('modrinth:get-project', async (_, projectId) => {
        try {
            if (isCurseForgeProjectId(projectId)) {
                const projectData = await getCurseForgeProject(projectId);
                const gallery = Array.isArray(projectData?.screenshots)
                    ? projectData.screenshots.map((item) => ({
                        url: item?.url || item?.thumbnailUrl,
                        title: item?.title || ''
                    })).filter(item => !!item.url)
                    : [];

                const project = {
                    id: toCurseForgeProjectId(projectData.id),
                    title: projectData.name,
                    slug: projectData.slug,
                    description: projectData.summary || '',
                    icon_url: projectData.logo?.url || projectData.logo?.thumbnailUrl || null,
                    project_type: mapCurseForgeClassToProjectType(projectData.classId),
                    downloads: Number(projectData.downloadCount || 0),
                    source: 'curseforge',
                    author: Array.isArray(projectData.authors) && projectData.authors.length > 0 ? projectData.authors[0].name : 'Unknown',
                    gallery,
                    body: ''
                };

                return { success: true, project };
            }

            const normalizedProjectId = normalizeModrinthProjectId(projectId);
            const response = await axios.get(`${MODRINTH_API}/project/${normalizedProjectId}`, {
                headers: { 'User-Agent': USER_AGENT }
            });
            const project = response.data;

            const mappedCurseForgeProjectId = modrinthToCurseForgeProjectMap.get(normalizedProjectId);
            if (mappedCurseForgeProjectId) {
                project.curseforge_project_id = mappedCurseForgeProjectId;
                if (!project.icon_url) {
                    try {
                        const curseForgeProject = await getCurseForgeProject(mappedCurseForgeProjectId);
                        project.icon_url = curseForgeProject?.logo?.url || curseForgeProject?.logo?.thumbnailUrl || project.icon_url || null;
                    } catch (fallbackError) {
                        console.warn('[Modrinth:GetProject] Could not hydrate icon from CurseForge:', fallbackError.message);
                    }
                }
            }

            if (project.team) {
                try {
                    const teamRes = await axios.get(`${MODRINTH_API}/team/${project.team}/members`, {
                        headers: { 'User-Agent': USER_AGENT }
                    });
                    if (teamRes.data && teamRes.data.length > 0) {
                        const owner = teamRes.data.find(m => m.role === 'Owner') || teamRes.data[0];
                        project.author = owner.user.username;
                    }
                } catch (e) {
                    console.error("Modrinth Get Team Error:", e.message);
                }
            }

            return { success: true, project };
        } catch (e) {
            console.error("Modrinth Get Project Error:", e.response ? e.response.data : e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('modrinth:resolve-dependencies', async (_, versionId, loaders = [], gameVersions = []) => {
        if (isCurseForgeVersionId(versionId)) {
            return { success: true, dependencies: [] };
        }
        return await resolveDependenciesInternal(versionId, loaders, gameVersions);
    });
};

module.exports.installModInternal = installModInternal;