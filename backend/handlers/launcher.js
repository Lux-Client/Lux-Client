const { Client } = require('minecraft-launcher-core');
const path = require('path');
const { app } = require('electron');
const fs = require('fs-extra');
const Store = require('electron-store');
const store = new Store();
const { getUserProfile } = require('../utils/secureProfileStore');
const backupManager = require('../backupManager');
const { getProcessStats } = require('../utils/process-utils');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('../utils/instances-path');

function normalizeExternalRequestName(value) {
    return String(value || '').trim().toLowerCase();
}

function extractXuidFromToken(accessToken) {
    try {
        const base64Url = String(accessToken || '').split('.')[1];
        if (!base64Url) return '';
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        return payload.xuid || '';
    } catch {
        return '';
    }
}

function stripExternalSuffix(value) {
    return String(value || '')
        .replace(/\s+\((modrinth|curseforge)(?:\s+\d+)?\)$/i, '')
        .trim();
}

function readJsonSyncSafe(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        return fs.readJsonSync(filePath);
    } catch (_) {
        return null;
    }
}

function collectAbsolutePathStrings(value, depth = 0, maxDepth = 6, bucket = []) {
    if (depth > maxDepth || value === null || value === undefined) {
        return bucket;
    }

    if (typeof value === 'string') {
        const candidate = value.trim();
        if (candidate && path.isAbsolute(candidate)) {
            bucket.push(candidate);
        }
        return bucket;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectAbsolutePathStrings(entry, depth + 1, maxDepth, bucket);
        }
        return bucket;
    }

    if (typeof value === 'object') {
        for (const entry of Object.values(value)) {
            collectAbsolutePathStrings(entry, depth + 1, maxDepth, bucket);
        }
    }

    return bucket;
}

function pushDirCandidate(target, dirPath) {
    const normalized = String(dirPath || '').trim();
    if (!normalized) return;
    const resolved = path.resolve(normalized);
    if (!fs.existsSync(resolved)) return;
    if (!target.includes(resolved)) {
        target.push(resolved);
    }
}

function expandModrinthCandidatePath(rawPath) {
    const candidates = [];
    const resolved = path.resolve(String(rawPath || '').trim());
    if (!resolved) return candidates;

    const baseName = path.basename(resolved).toLowerCase();
    pushDirCandidate(candidates, resolved);
    if (baseName !== 'profiles') {
        pushDirCandidate(candidates, path.join(resolved, 'profiles'));
    }
    pushDirCandidate(candidates, path.join(resolved, '.minecraft', 'profiles'));
    return candidates;
}

function expandCurseForgeCandidatePath(rawPath) {
    const candidates = [];
    const resolved = path.resolve(String(rawPath || '').trim());
    if (!resolved) return candidates;

    const baseName = path.basename(resolved).toLowerCase();
    pushDirCandidate(candidates, resolved);
    if (baseName !== 'instances') {
        pushDirCandidate(candidates, path.join(resolved, 'Instances'));
        pushDirCandidate(candidates, path.join(resolved, 'instances'));
    }
    pushDirCandidate(candidates, path.join(resolved, 'minecraft', 'Instances'));
    pushDirCandidate(candidates, path.join(resolved, 'Minecraft', 'Instances'));
    return candidates;
}

function getConfiguredExternalRootCandidates(source, homeDir, roamingDir) {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const appSettings = readJsonSyncSafe(settingsPath) || {};

    const modrinthConfigPaths = [
        path.join(roamingDir, 'com.modrinth.theseus', 'settings.json'),
        path.join(roamingDir, 'com.modrinth.theseus', 'state.json'),
        path.join(homeDir, 'AppData', 'Roaming', 'ModrinthApp', 'settings.json'),
        path.join(homeDir, 'AppData', 'Roaming', 'ModrinthApp', 'config.json')
    ];

    const curseForgeConfigPaths = [
        path.join(roamingDir, 'CurseForge', 'Settings.json'),
        path.join(roamingDir, 'CurseForge', 'settings.json'),
        path.join(roamingDir, 'CurseForge', 'Install', 'Settings.json'),
        path.join(roamingDir, 'CurseForge', 'Install', 'settings.json')
    ];

    const configuredValues = [];

    if (Array.isArray(appSettings.externalLauncherPaths)) {
        configuredValues.push(...appSettings.externalLauncherPaths);
    }
    if (Array.isArray(appSettings.externalModrinthPaths) && source === 'modrinth') {
        configuredValues.push(...appSettings.externalModrinthPaths);
    }
    if (Array.isArray(appSettings.externalCurseforgePaths) && source === 'curseforge') {
        configuredValues.push(...appSettings.externalCurseforgePaths);
    }

    const configPaths = source === 'modrinth' ? modrinthConfigPaths : curseForgeConfigPaths;
    for (const configPath of configPaths) {
        const parsed = readJsonSyncSafe(configPath);
        if (parsed) {
            configuredValues.push(parsed);
        }
    }

    const absolutePaths = collectAbsolutePathStrings(configuredValues);
    const expanded = [];

    for (const absolutePath of absolutePaths) {
        const variants = source === 'modrinth'
            ? expandModrinthCandidatePath(absolutePath)
            : expandCurseForgeCandidatePath(absolutePath);
        for (const variant of variants) {
            pushDirCandidate(expanded, variant);
        }
    }

    return expanded;
}

function getExternalLauncherRoots() {
    if (process.platform !== 'win32') return [];

    const homeDir = require('os').homedir();
    const roamingDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

    const defaults = [
        { source: 'modrinth', baseDir: path.join(homeDir, 'AppData', 'Roaming', 'ModrinthApp', 'profiles') },
        { source: 'modrinth', baseDir: path.join(roamingDir, 'com.modrinth.theseus', 'profiles') },
        { source: 'curseforge', baseDir: path.join(homeDir, 'curseforge', 'minecraft', 'Instances') }
    ];

    const dynamicRoots = [
        ...getConfiguredExternalRootCandidates('modrinth', homeDir, roamingDir).map((baseDir) => ({ source: 'modrinth', baseDir })),
        ...getConfiguredExternalRootCandidates('curseforge', homeDir, roamingDir).map((baseDir) => ({ source: 'curseforge', baseDir }))
    ];

    const deduped = [];
    const seen = new Set();
    for (const root of [...defaults, ...dynamicRoots]) {
        const source = String(root?.source || '').trim().toLowerCase();
        const baseDir = String(root?.baseDir || '').trim();
        if (!source || !baseDir) continue;
        const key = `${source}::${path.resolve(baseDir).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({ source, baseDir: path.resolve(baseDir) });
    }

    return deduped;
}

function normalizeLoaderFromString(value) {
    let candidate = value;

    if (candidate && typeof candidate === 'object') {
        candidate = candidate.name || candidate.id || candidate.loader || candidate.type || '';
    }

    const raw = String(candidate || '').trim().toLowerCase();

    if (!raw) return '';
    if (raw.includes('neoforge') || raw.startsWith('neo')) return 'neoforge';
    if (raw.includes('fabric')) return 'fabric';
    if (raw.includes('quilt')) return 'quilt';
    if (raw.includes('forge')) return 'forge';
    if (raw.includes('vanilla')) return 'vanilla';
    return raw;
}

function inferVersionFromName(name) {
    const raw = String(name || '');
    const match = raw.match(/\b\d+\.\d+(?:\.\d+)?\b/);
    return match ? match[0] : '';
}

async function inferVersionFromProfileDirectory(profileDir) {
    const versionRoots = [
        path.join(profileDir, '.minecraft', 'versions'),
        path.join(profileDir, 'versions')
    ];

    for (const versionRoot of versionRoots) {
        try {
            if (!await fs.pathExists(versionRoot)) continue;
            const entries = await fs.readdir(versionRoot, { withFileTypes: true });
            const versionNames = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => String(entry.name || '').trim())
                .filter(Boolean)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

            for (const candidate of versionNames) {
                const inferred = inferVersionFromName(candidate);
                if (inferred) {
                    return inferred;
                }
            }
        } catch (_) {
            // Ignore scan errors and continue.
        }
    }

    return '';
}

async function inferVersionFromProfileLogs(profileDir) {
    const logCandidates = [
        path.join(profileDir, 'logs', 'launcher_log.txt'),
        path.join(profileDir, 'logs', 'latest.log')
    ];

    const versionPatterns = [
        /--fml\.mcVersion,\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
        /--version,\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
        /minecraft server version\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
        /minecraft\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i
    ];

    for (const logPath of logCandidates) {
        try {
            if (!await fs.pathExists(logPath)) continue;
            const content = await fs.readFile(logPath, 'utf8');

            for (const pattern of versionPatterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    return String(match[1]).trim();
                }
            }
        } catch (_) {
            // Ignore log parsing failures.
        }
    }

    return '';
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDelimitedToken(haystack, token) {
    const normalizedHaystack = String(haystack || '').trim().toLowerCase();
    const normalizedToken = String(token || '').trim().toLowerCase();

    if (!normalizedHaystack || !normalizedToken) {
        return false;
    }

    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedToken)}($|[^a-z0-9])`, 'i');
    return pattern.test(normalizedHaystack);
}

function parseFiniteNumber(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function readJsonIfExists(filePath) {
    try {
        if (!await fs.pathExists(filePath)) return null;
        return await fs.readJson(filePath);
    } catch (_) {
        return null;
    }
}

async function readTextIfExists(filePath) {
    try {
        if (!await fs.pathExists(filePath)) return '';
        return await fs.readFile(filePath, 'utf8');
    } catch (_) {
        return '';
    }
}

async function listDirectoryNames(dirPath) {
    try {
        if (!await fs.pathExists(dirPath)) return [];
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => String(entry.name || '').trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function getExternalRuntimeRoot(externalProfile) {
    const baseDir = String(externalProfile?.baseDir || '').trim();
    const source = String(externalProfile?.source || '').trim().toLowerCase();
    if (!baseDir || !source) return '';

    const launcherBaseDir = path.dirname(baseDir);
    if (source === 'curseforge') {
        return path.join(launcherBaseDir, 'Install');
    }

    if (source === 'modrinth') {
        return path.join(launcherBaseDir, 'meta');
    }

    return '';
}

function buildGameVersionAliases(version) {
    const value = String(version || '').trim();
    if (!value) return [];

    const aliases = [];
    const addAlias = (entry) => {
        const normalized = String(entry || '').trim();
        if (!normalized) return;
        if (!aliases.includes(normalized)) aliases.push(normalized);
    };

    addAlias(value);

    if (/^\d+\.\d+(?:\.\d+)?$/.test(value)) {
        if (value.startsWith('1.')) {
            addAlias(value.slice(2));
        } else {
            addAlias(`1.${value}`);
        }
    }

    return aliases;
}

function buildVersionIdCandidates({ version, loader, loaderVersion, explicitVersionId }) {
    const candidates = [];
    const addCandidate = (value) => {
        const candidate = String(value || '').trim();
        if (!candidate) return;
        if (!candidates.includes(candidate)) candidates.push(candidate);
    };

    addCandidate(explicitVersionId);
    const versionAliases = buildGameVersionAliases(version);

    if (!loader || loader === 'vanilla') {
        for (const alias of versionAliases) addCandidate(alias);
        return candidates;
    }

    const candidateVersions = versionAliases.length ? versionAliases : [String(version || '').trim()];

    for (const candidateVersion of candidateVersions) {
        switch (loader) {
            case 'fabric':
                addCandidate(`fabric-loader-${loaderVersion}-${candidateVersion}`);
                addCandidate(`fabric-${loaderVersion}-${candidateVersion}`);
                addCandidate(`${candidateVersion}-${loaderVersion}`);
                break;
            case 'quilt':
                addCandidate(`quilt-loader-${loaderVersion}-${candidateVersion}`);
                addCandidate(`quilt-${loaderVersion}-${candidateVersion}`);
                addCandidate(`${candidateVersion}-${loaderVersion}`);
                break;
            case 'forge':
                addCandidate(`forge-${loaderVersion}`);
                addCandidate(`${candidateVersion}-forge-${loaderVersion}`);
                addCandidate(`${candidateVersion}-${loaderVersion}`);
                break;
            case 'neoforge':
                addCandidate(`neoforge-${loaderVersion}`);
                addCandidate(`${candidateVersion}-neoforge-${loaderVersion}`);
                addCandidate(`${candidateVersion}-${loaderVersion}`);
                break;
            default:
                addCandidate(`${loader}-${loaderVersion}-${candidateVersion}`);
                addCandidate(`${candidateVersion}-${loaderVersion}`);
                break;
        }
    }

    return candidates;
}

async function resolveSharedVersionId(versionsDir, details) {
    const versionNames = await listDirectoryNames(versionsDir);
    if (!versionNames.length) return '';

    const byLower = new Map(versionNames.map((name) => [name.toLowerCase(), name]));
    const candidates = buildVersionIdCandidates(details);

    for (const candidate of candidates) {
        const exactMatch = byLower.get(candidate.toLowerCase());
        if (exactMatch) return exactMatch;
    }

    const version = String(details?.version || '').trim().toLowerCase();
    const loader = String(details?.loader || '').trim().toLowerCase();
    const loaderVersion = String(details?.loaderVersion || '').trim().toLowerCase();
    const versionAliases = buildGameVersionAliases(version).map((entry) => entry.toLowerCase());

    const resolvedVersionCache = new Map();
    const resolveBaseMinecraftVersionFromJson = async (versionName) => {
        const cacheKey = String(versionName || '').trim().toLowerCase();
        if (!cacheKey) return '';
        if (resolvedVersionCache.has(cacheKey)) return resolvedVersionCache.get(cacheKey);

        const visited = new Set();
        let current = String(versionName || '').trim();
        let resolved = '';

        while (current) {
            const currentKey = current.toLowerCase();
            if (visited.has(currentKey)) break;
            visited.add(currentKey);

            const inferredFromCurrent = inferVersionFromName(current);
            if (inferredFromCurrent) {
                resolved = inferredFromCurrent;
            }

            const jsonPath = path.join(versionsDir, current, `${current}.json`);
            const versionJson = await readJsonIfExists(jsonPath);
            if (!versionJson) break;

            const jsonId = String(versionJson?.id || '').trim();
            const inferredFromJsonId = inferVersionFromName(jsonId);
            if (inferredFromJsonId) {
                resolved = inferredFromJsonId;
            }

            const inherited = String(versionJson?.inheritsFrom || '').trim();
            if (!inherited) break;
            current = inherited;
        }

        const normalized = String(resolved || '').trim().toLowerCase();
        resolvedVersionCache.set(cacheKey, normalized);
        return normalized;
    };

    const versionMatchedEntries = [];
    for (const versionName of versionNames) {
        const current = versionName.toLowerCase();
        const byName = versionAliases.some((alias) => hasDelimitedToken(current, alias));
        let byBaseVersion = false;

        if (!byName && versionAliases.length > 0) {
            const baseVersion = await resolveBaseMinecraftVersionFromJson(versionName);
            byBaseVersion = baseVersion ? versionAliases.includes(baseVersion) : false;
        }

        if (byName || byBaseVersion) {
            versionMatchedEntries.push(versionName);
        }
    }

    const candidatesToScore = versionMatchedEntries.length > 0 ? versionMatchedEntries : versionNames;

    let bestMatch = '';
    let bestScore = -1;

    for (const versionName of candidatesToScore) {
        const current = versionName.toLowerCase();
        let score = 0;

        const baseVersion = await resolveBaseMinecraftVersionFromJson(versionName);

        if (versionAliases.some((alias) => hasDelimitedToken(current, alias))) score += 60;
        if (baseVersion && versionAliases.includes(baseVersion)) score += 80;
        if (loaderVersion && hasDelimitedToken(current, loaderVersion)) score += 35;
        if (loader && hasDelimitedToken(current, loader)) score += 20;
        if (version && current.endsWith(`-${version}`)) score += 12;
        if (loader && (current.startsWith(`${loader}-`) || current.includes(`-${loader}-`))) score += 10;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = versionName;
        }
    }

    return bestScore > 0 ? bestMatch : '';
}

async function resolveAssetIndex(runtimeRoot, version, versionId) {
    const visited = new Set();
    const queue = [];

    if (versionId) queue.push(versionId);
    if (version && version !== versionId) queue.push(version);

    while (queue.length > 0) {
        const current = String(queue.shift() || '').trim();
        if (!current || visited.has(current)) continue;
        visited.add(current);

        const versionJsonPath = path.join(runtimeRoot, 'versions', current, `${current}.json`);
        const versionJson = await readJsonIfExists(versionJsonPath);
        if (!versionJson) continue;

        const assetsValue = String(versionJson.assets || '').trim();
        if (assetsValue) {
            return assetsValue;
        }

        const assetIndexId = String(versionJson?.assetIndex?.id || versionJson?.assetIndex || '').trim();
        if (assetIndexId) {
            return assetIndexId;
        }

        const inheritedFrom = String(versionJson.inheritsFrom || '').trim();
        if (inheritedFrom && !visited.has(inheritedFrom)) {
            queue.push(inheritedFrom);
        }
    }

    return '';
}

async function resolveAssetIndexMetadata(runtimeRoot, version, versionId) {
    const visited = new Set();
    const queue = [];
    let fallbackAssetId = '';

    if (versionId) queue.push(versionId);
    if (version && version !== versionId) queue.push(version);

    while (queue.length > 0) {
        const current = String(queue.shift() || '').trim();
        if (!current || visited.has(current)) continue;
        visited.add(current);

        const versionJsonPath = path.join(runtimeRoot, 'versions', current, `${current}.json`);
        const versionJson = await readJsonIfExists(versionJsonPath);
        if (!versionJson) continue;

        const assetIndex = versionJson?.assetIndex;
        const assetId = String(assetIndex?.id || versionJson.assets || '').trim();
        const assetUrl = String(assetIndex?.url || '').trim();

        if (!fallbackAssetId && assetId) {
            fallbackAssetId = assetId;
        }

        if (assetId && assetUrl) {
            return {
                id: assetId,
                url: assetUrl
            };
        }

        const inheritedFrom = String(versionJson.inheritsFrom || '').trim();
        if (inheritedFrom && !visited.has(inheritedFrom)) {
            queue.push(inheritedFrom);
        }
    }

    if (fallbackAssetId) {
        return {
            id: fallbackAssetId,
            url: ''
        };
    }

    return null;
}

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function fetchAssetIndexMetadataFromVersionManifest(version) {
    const targetVersion = String(version || '').trim();
    if (!targetVersion) return null;

    try {
        const axios = require('axios');
        const manifestResponse = await axios.get(VERSION_MANIFEST_URL, { timeout: 30000 });
        const versions = Array.isArray(manifestResponse?.data?.versions) ? manifestResponse.data.versions : [];
        const matched = versions.find((entry) => String(entry?.id || '').trim() === targetVersion);
        const versionUrl = String(matched?.url || '').trim();
        if (!versionUrl) return null;

        const versionResponse = await axios.get(versionUrl, { timeout: 30000 });
        const assetIndex = versionResponse?.data?.assetIndex || {};
        const assetId = String(assetIndex?.id || '').trim();
        const assetUrl = String(assetIndex?.url || '').trim();

        if (!assetId) return null;
        return { id: assetId, url: assetUrl };
    } catch (error) {
        console.warn(`[Launcher] Failed to resolve asset index from version manifest for ${targetVersion}: ${error.message}`);
        return null;
    }
}

async function ensureAssetIndexFile(runtimeRoot, assetRoot, version, versionId, fallbackAssetIndex = '') {
    let metadata = await resolveAssetIndexMetadata(runtimeRoot, version, versionId);

    if (metadata?.id && !metadata?.url) {
        const manifestMetadata = await fetchAssetIndexMetadataFromVersionManifest(version);
        if (manifestMetadata && (!metadata.id || manifestMetadata.id === metadata.id)) {
            metadata = {
                id: metadata.id || manifestMetadata.id,
                url: manifestMetadata.url
            };
        }
    }

    const assetIndexId = String(metadata?.id || fallbackAssetIndex || '').trim();
    if (!assetIndexId || !assetRoot) return assetIndexId;

    const indexPath = path.join(assetRoot, 'indexes', `${assetIndexId}.json`);
    if (await fs.pathExists(indexPath)) {
        return assetIndexId;
    }

    const indexUrl = String(metadata?.url || '').trim();
    if (!indexUrl) {
        console.warn(`[Launcher] Missing asset index file ${assetIndexId}.json and no URL available for download.`);
        return assetIndexId;
    }

    try {
        await fs.ensureDir(path.dirname(indexPath));
        const axios = require('axios');
        const response = await axios.get(indexUrl, { responseType: 'arraybuffer', timeout: 30000 });
        await fs.writeFile(indexPath, response.data);
        console.log(`[Launcher] Downloaded missing asset index ${assetIndexId}.json`);
    } catch (error) {
        console.warn(`[Launcher] Failed to download missing asset index ${assetIndexId}.json: ${error.message}`);
    }

    return assetIndexId;
}

async function readExternalLaunchDetails(externalProfile) {
    const source = String(externalProfile?.source || '').trim().toLowerCase();
    const profileDir = String(externalProfile?.path || '').trim();
    const runtimeRoot = getExternalRuntimeRoot(externalProfile);
    const versionsDir = runtimeRoot ? path.join(runtimeRoot, 'versions') : '';

    const launcherLog = await readTextIfExists(path.join(profileDir, 'logs', 'launcher_log.txt'));
    const latestLog = await readTextIfExists(path.join(profileDir, 'logs', 'latest.log'));
    const combinedLogs = `${launcherLog}\n${latestLog}`;

    const readLogValue = (pattern) => {
        const match = combinedLogs.match(pattern);
        return match && match[1] ? String(match[1]).trim() : '';
    };

    let version = '';
    let loader = '';
    let loaderVersion = '';
    let explicitVersionId = '';
    let assetIndex = '';
    const fallbackProfileName = path.basename(profileDir);

    if (source === 'modrinth') {
        const profile = await readJsonIfExists(path.join(profileDir, 'profile.json'));
        const metadata = profile && typeof profile.metadata === 'object' ? profile.metadata : {};

        version = String(
            profile?.game_version ||
            profile?.gameVersion ||
            profile?.minecraft_version ||
            profile?.minecraftVersion ||
            metadata?.game_version ||
            metadata?.gameVersion ||
            metadata?.minecraft_version ||
            metadata?.minecraftVersion ||
            readLogValue(/--fml\.mcVersion,\s*([^,\]\s]+)/i) ||
            readLogValue(/--version,\s*([^,\]\s]+)/i) ||
            ''
        ).trim();

        loader = normalizeLoaderFromString(
            profile?.loader ||
            profile?.loader_id ||
            profile?.loaderId ||
            metadata?.loader ||
            metadata?.loader_id ||
            metadata?.loaderId ||
            metadata?.loader_version?.id ||
            metadata?.loaderVersion?.id ||
            metadata?.loader_version ||
            metadata?.loaderVersion ||
            ''
        );

        const neoForgeVersion = readLogValue(/--fml\.neoForgeVersion,\s*([^,\]\s]+)/i);
        const forgeVersion = readLogValue(/--fml\.forgeVersion,\s*([^,\]\s]+)/i);
        const fabricVersion = readLogValue(/fabric-loader-([0-9][0-9a-z.+\-]*)-/i);
        const quiltVersion = readLogValue(/quilt-loader-([0-9][0-9a-z.+\-]*)-/i);

        if (!loader) {
            if (neoForgeVersion) loader = 'neoforge';
            else if (forgeVersion) loader = 'forge';
            else if (fabricVersion) loader = 'fabric';
            else if (quiltVersion) loader = 'quilt';
            else loader = 'vanilla';
        }

        loaderVersion = String(
            metadata?.loader_version?.version ||
            metadata?.loaderVersion?.version ||
            metadata?.loader_version ||
            metadata?.loaderVersion ||
            profile?.loader_version ||
            profile?.loaderVersion ||
            ''
        ).trim();

        if (!loaderVersion) {
            if (loader === 'neoforge') loaderVersion = neoForgeVersion;
            else if (loader === 'forge') loaderVersion = forgeVersion;
            else if (loader === 'fabric') loaderVersion = fabricVersion;
            else if (loader === 'quilt') loaderVersion = quiltVersion;
        }

        explicitVersionId = String(
            profile?.versionId ||
            profile?.version_id ||
            metadata?.versionId ||
            metadata?.version_id ||
            ''
        ).trim();
        assetIndex = readLogValue(/--assetIndex,\s*([^,\]\s]+)/i);
    }

    if (source === 'curseforge') {
        const profile = await readJsonIfExists(path.join(profileDir, 'minecraftinstance.json'));
        const manifest = await readJsonIfExists(path.join(profileDir, 'manifest.json'));

        const primaryLoader = Array.isArray(manifest?.minecraft?.modLoaders)
            ? manifest.minecraft.modLoaders.find((entry) => entry?.primary) || manifest.minecraft.modLoaders[0]
            : null;

        const loaderSource =
            primaryLoader?.id ||
            profile?.baseModLoader?.name ||
            profile?.baseModLoader?.id ||
            profile?.baseModLoader?.forgeVersion ||
            profile?.modLoader?.name ||
            profile?.modLoader ||
            profile?.modloader ||
            '';

        version = String(
            manifest?.minecraft?.version ||
            profile?.minecraftVersion ||
            profile?.gameVersion ||
            profile?.baseModLoader?.minecraftVersion ||
            readLogValue(/--version,\s*([^,\]\s]+)/i) ||
            ''
        ).trim();

        explicitVersionId = String(loaderSource || '').trim();
        loader = normalizeLoaderFromString(loaderSource);
        loaderVersion = String(
            profile?.baseModLoader?.forgeVersion ||
            readLogValue(/--fml\.forgeVersion,\s*([^,\]\s]+)/i) ||
            ''
        ).trim();

        if (!loaderVersion && explicitVersionId) {
            const dashIndex = explicitVersionId.indexOf('-');
            if (dashIndex >= 0) {
                loaderVersion = explicitVersionId.slice(dashIndex + 1).trim();
            }
        }
    }

    if (!version) {
        version = inferVersionFromName(fallbackProfileName);
    }

    if (!version) {
        version = await inferVersionFromProfileDirectory(profileDir);
    }

    if (!version) {
        version = await inferVersionFromProfileLogs(profileDir);
    }

    if (!version) {
        const availableVersions = (await listDirectoryNames(versionsDir))
            .map((entry) => inferVersionFromName(entry))
            .filter(Boolean)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        if (availableVersions.length > 0) {
            version = availableVersions[0];
        }
    }

    if (!loader) {
        loader = explicitVersionId ? normalizeLoaderFromString(explicitVersionId) : 'vanilla';
    }

    if (!loader) {
        const hasFabricMarker = await fs.pathExists(path.join(profileDir, '.fabric'));
        const hasQuiltMarker = await fs.pathExists(path.join(profileDir, '.quilt'));
        if (hasFabricMarker) {
            loader = 'fabric';
        } else if (hasQuiltMarker) {
            loader = 'quilt';
        } else {
            const inferredFromName = normalizeLoaderFromString(fallbackProfileName);
            loader = inferredFromName || (explicitVersionId ? normalizeLoaderFromString(explicitVersionId) : 'vanilla');
        }
    }

    const resolvedVersionId = await resolveSharedVersionId(versionsDir, {
        version,
        loader,
        loaderVersion,
        explicitVersionId
    });

    const resolvedAssetIndex = assetIndex || await resolveAssetIndex(runtimeRoot, version, resolvedVersionId);

    return {
        runtimeRoot,
        profileDir,
        version,
        loader: loader || 'vanilla',
        loaderVersion,
        versionId: resolvedVersionId,
        assetIndex: resolvedAssetIndex
    };
}

async function buildExternalLaunchContext(externalProfile) {
    const details = await readExternalLaunchDetails(externalProfile);

    if (!details.runtimeRoot || !await fs.pathExists(details.runtimeRoot)) {
        return { success: false, error: 'Shared launcher runtime for this external profile was not found.' };
    }

    if (!details.version) {
        return { success: false, error: 'Minecraft version for this external profile could not be determined.' };
    }

    const versionDirName = details.versionId || details.version;
    const versionDir = path.join(details.runtimeRoot, 'versions', versionDirName);
    const customJarPath = path.join(versionDir, `${versionDirName}.jar`);
    const vanillaJarPath = path.join(details.runtimeRoot, 'versions', details.version, `${details.version}.jar`);
    const libraryRoot = path.join(details.runtimeRoot, 'libraries');

    const config = {
        version: details.version,
        loader: details.loader || 'vanilla',
        versionId: details.versionId || '',
        assetIndex: details.assetIndex || ''
    };

    const overrides = {
        detached: false,
        gameDirectory: details.profileDir,
        cwd: details.profileDir,
        assetRoot: path.join(details.runtimeRoot, 'assets'),
        libraryRoot
    };

    if (details.versionId) {
        overrides.directory = versionDir;
    }

    const ensuredAssetIndex = await ensureAssetIndexFile(
        details.runtimeRoot,
        overrides.assetRoot,
        config.version,
        config.versionId,
        config.assetIndex
    );
    if (ensuredAssetIndex) {
        overrides.assetIndex = ensuredAssetIndex;
    }

    if (!await fs.pathExists(customJarPath) && await fs.pathExists(vanillaJarPath)) {
        overrides.minecraftJar = vanillaJarPath;
    }

    const nativesCandidates = [
        path.join(details.runtimeRoot, 'natives', versionDirName),
        path.join(details.runtimeRoot, 'natives', details.version)
    ];

    for (const nativesPath of nativesCandidates) {
        if (await fs.pathExists(nativesPath)) {
            overrides.natives = nativesPath;
            break;
        }
    }

    return {
        success: true,
        isExternal: true,
        config,
        configPath: null,
        instanceDir: details.profileDir,
        rootDir: details.runtimeRoot,
        overrides,
        librariesDir: libraryRoot,
        versionDir,
        supportsBackups: false,
        supportsPersistence: false
    };
}

async function buildLocalLaunchContext(instanceName) {
    const fallbackInstanceDir = path.join(resolvePrimaryInstancesDir(), instanceName);
    const instanceDir = resolveInstanceDirByName(instanceName) || fallbackInstanceDir;
    const configPath = path.join(instanceDir, 'instance.json');

    if (!await fs.pathExists(configPath)) {
        return { success: false, error: 'Instance not found' };
    }

    const config = await fs.readJson(configPath);
    const overrides = {
        detached: false,
        assetRoot: path.join(app.getPath('userData'), 'common', 'assets')
    };

    const resolvedAssetIndex = await resolveAssetIndex(instanceDir, config.version, config.versionId);
    const ensuredAssetIndex = await ensureAssetIndexFile(
        instanceDir,
        overrides.assetRoot,
        config.version,
        config.versionId,
        resolvedAssetIndex
    );
    if (ensuredAssetIndex) {
        overrides.assetIndex = ensuredAssetIndex;
    }

    return {
        success: true,
        isExternal: false,
        config,
        configPath,
        instanceDir,
        rootDir: instanceDir,
        overrides,
        librariesDir: path.join(instanceDir, 'libraries'),
        versionDir: path.join(instanceDir, 'versions', config.versionId || config.version),
        supportsBackups: true,
        supportsPersistence: true
    };
}

async function findExternalProfileByDisplayName(instanceName) {
    const requested = normalizeExternalRequestName(instanceName);
    if (!requested) return null;

    const stripped = normalizeExternalRequestName(stripExternalSuffix(instanceName));

    const roots = getExternalLauncherRoots();
    for (const root of roots) {
        const { source, baseDir } = root;
        if (!await fs.pathExists(baseDir)) continue;

        let entries = [];
        try {
            entries = await fs.readdir(baseDir, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const dirName = String(entry.name || '').trim();
            const dirLower = dirName.toLowerCase();
            const sourceLabel = source === 'curseforge' ? 'curseforge' : 'modrinth';

            if (
                dirLower === requested ||
                dirLower === stripped ||
                `${dirLower} (${sourceLabel})` === requested
            ) {
                return { source, baseDir, path: path.join(baseDir, dirName) };
            }

            if (source === 'modrinth') {
                const profilePath = path.join(baseDir, dirName, 'profile.json');
                if (!await fs.pathExists(profilePath)) continue;

                try {
                    const profile = await fs.readJson(profilePath);
                    const profileName = String(profile?.name || '').trim().toLowerCase();
                    if (!profileName) continue;

                    if (
                        profileName === requested ||
                        profileName === stripped ||
                        `${profileName} (${sourceLabel})` === requested
                    ) {
                        return { source, baseDir, path: path.join(baseDir, dirName) };
                    }
                } catch (_) {
                }
            }

            if (source === 'curseforge') {
                const profilePath = path.join(baseDir, dirName, 'minecraftinstance.json');
                if (!await fs.pathExists(profilePath)) continue;

                try {
                    const profile = await fs.readJson(profilePath);
                    const profileName = String(profile?.name || '').trim().toLowerCase();
                    if (!profileName) continue;

                    if (
                        profileName === requested ||
                        profileName === stripped ||
                        `${profileName} (${sourceLabel})` === requested
                    ) {
                        return { source, baseDir, path: path.join(baseDir, dirName) };
                    }
                } catch (_) {
                }
            }
        }
    }

    return null;
}

const CRASH_LOG_MAX_CHARS = 400000;

function stripColors(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '');
}

function normalizeCompatibilityToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^["'\s]+|["'\s]+$/g, '');
}

function extractCompatibilityIssuesFromCrashLog(logContent) {
    if (!logContent || typeof logContent !== 'string') return [];

    const patterns = [
        {
            issueType: 'missing_dependency',
            // Example: - Install cloth-config, version 16.0.0 or later.
            regex: /Install\s+['"]?([A-Za-z0-9_.\-]+)['"]?,\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later/ig,
            map: (match) => ({
                modName: null,
                dependencyName: match[1].trim(),
                requiredVersion: match[2].trim(),
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'missing_dependency',
            // Example: - Install cloth-config, any version.
            regex: /Install\s+['"]?([A-Za-z0-9_.\-]+)['"]?,\s+any\s+version/ig,
            map: (match) => ({
                modName: null,
                dependencyName: match[1].trim(),
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'missing_dependency',
            // Example: Mod 'More Culling' (moreculling) 1.6.2 requires version 16.0.0 or later of cloth-config, which is missing!
            regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+['"]?([A-Za-z0-9_.\-]+)['"]?/ig,
            map: (match) => ({
                modName: match[1] || match[2],
                dependencyName: match[4].trim(),
                requiredVersion: match[3].trim(),
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'missing_dependency',
            // Example: Mod 'FastQuit' (fastquit) 3.1.3+mc1.21.11 requires any version of cloth-config, which is missing!
            regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+any\s+version\s+of\s+['"]?([A-Za-z0-9_.\-]+)['"]?/ig,
            map: (match) => ({
                modName: match[1] || match[2],
                dependencyName: match[3].trim(),
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'outdated_dependency',
            // Example: Mod 'Mod A' (moda) 1.0.0 requires version 1.1.0 or later of mod 'Mod B' (modb), but only the wrong version is present: 1.0.0!
            regex: /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([^\s]+)\s+(?:or\s+later\s+)?of\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\),\s+but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!\r\n]+)/ig,
            map: (match) => ({
                modName: match[1] || match[2],
                dependencyName: match[5] || match[6],
                requiredVersion: match[4] || null,
                foundVersion: match[7] || null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'outdated_dependency',
            // Example: - Replace mod 'Sodium' (sodium) 0.8.7+mc1.21.11 with version 0.8.4+mc1.21.11.
            regex: /Replace\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+with\s+version\s+([0-9A-Za-z.+\-]+)/ig,
            map: (match) => ({
                modName: 'System',
                dependencyName: match[2].trim(),
                requiredVersion: match[4].trim(),
                foundVersion: match[3].trim(),
                sourceLine: match[0]
            })
        },
        {
            issueType: 'missing_dependency',
            regex: /Could\s+not\s+find\s+required\s+mod:\s*([A-Za-z0-9_.\-]+)/ig,
            map: (match) => ({
                modName: null,
                dependencyName: match[1],
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'duplicate_mod',
            regex: /Duplicate\s+mod\s+id\s+'([^']+)'\s+found/ig,
            map: (match) => ({
                modName: match[1],
                dependencyName: null,
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'incompatible_mod',
            regex: /Mod\s+'([^']+)'\s+is\s+incompatible\s+with\s+mod\s+'([^']+)'/ig,
            map: (match) => ({
                modName: match[1],
                dependencyName: match[2],
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'mixin_failure',
            regex: /Mixin\s+apply\s+failed\s+for\s+mod\s+([A-Za-z0-9_.\-]+)/ig,
            map: (match) => ({
                modName: match[1],
                dependencyName: null,
                requiredVersion: null,
                foundVersion: null,
                sourceLine: match[0]
            })
        },
        {
            issueType: 'loader_outdated',
            regex: /(fabric-loader|forge|neoforge|quilt\-loader)\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+is\s+required\s+but\s+([0-9A-Za-z.+\-]+)\s+is\s+present/ig,
            map: (match) => ({
                modName: 'System',
                dependencyName: match[1],
                requiredVersion: match[2],
                foundVersion: match[3],
                sourceLine: match[0]
            })
        },
        {
            issueType: 'loader_outdated',
            regex: /Mod\s+'([^']+)'\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+(fabric-loader|forge|neoforge|quilt\-loader)/ig,
            map: (match) => ({
                modName: match[1] || match[2],
                dependencyName: match[5],
                requiredVersion: match[4],
                foundVersion: null,
                sourceLine: match[0]
            })
        }
    ];

    const cleanLog = stripColors(logContent);
    const issues = [];
    const seen = new Set();

    for (const rule of patterns) {
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(cleanLog)) !== null) {
            const candidate = rule.map(match);
            const key = [
                rule.issueType,
                normalizeCompatibilityToken(candidate.modName),
                normalizeCompatibilityToken(candidate.dependencyName),
                normalizeCompatibilityToken(candidate.requiredVersion),
                normalizeCompatibilityToken(candidate.foundVersion)
            ].join('|');

            if (seen.has(key)) continue;
            seen.add(key);
            issues.push({
                issueType: rule.issueType,
                modName: candidate.modName || null,
                dependencyName: candidate.dependencyName || null,
                requiredVersion: candidate.requiredVersion || null,
                foundVersion: candidate.foundVersion || null,
                sourceLine: candidate.sourceLine || ''
            });
        }
    }

    return issues;
}

async function buildCrashLogContent(instanceDir, inMemoryLogs = []) {
    const latestLogPath = path.join(instanceDir, 'logs', 'latest.log');
    const debugLogPath = path.join(instanceDir, 'logs', 'debug.log');
    const crashReportsDir = path.join(instanceDir, 'crash-reports');

    const sections = [];

    // Prioritize actual crash reports if they exist
    try {
        if (await fs.pathExists(crashReportsDir)) {
            const files = await fs.readdir(crashReportsDir);
            const reportFiles = files
                .filter(f => f.startsWith('crash-') && f.endsWith('.txt'))
                .map(f => ({ name: f, path: path.join(crashReportsDir, f) }));

            if (reportFiles.length > 0) {
                // Sort by name (which includes timestamp) descending to get latest
                reportFiles.sort((a, b) => b.name.localeCompare(a.name));
                const latestReport = await fs.readFile(reportFiles[0].path, 'utf8');
                sections.push(`--- LATEST CRASH REPORT (${reportFiles[0].name}) ---\n${latestReport}`);
            }
        }
    } catch (e) {
        console.error('[Launcher] Failed to read crash reports directory:', e);
    }

    if (Array.isArray(inMemoryLogs) && inMemoryLogs.length > 0) {
        sections.push(`--- LIVE LOGS ---\n${inMemoryLogs.join('\n')}`);
    }

    if (await fs.pathExists(latestLogPath)) {
        const content = await fs.readFile(latestLogPath, 'utf8').catch(() => '');
        sections.push(`--- LATEST LOG ---\n${content}`);
    }

    if (await fs.pathExists(debugLogPath)) {
        const content = await fs.readFile(debugLogPath, 'utf8').catch(() => '');
        sections.push(`--- DEBUG LOG ---\n${content}`);
    }

    const combined = sections
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .join('\n\n');

    if (!combined) return '';
    if (combined.length <= CRASH_LOG_MAX_CHARS) return combined;
    // For crash logs, usually the beginning (stack trace) and end (logs) are important.
    // If it's too long, we take a bit from the start and a bit from the end.
    const halfMax = Math.floor(CRASH_LOG_MAX_CHARS / 2);
    return combined.slice(0, halfMax) + '\n\n... [LOG TRUNCATED] ...\n\n' + combined.slice(-halfMax);
}

module.exports = (ipcMain, mainWindow) => {

    const runningInstances = new Map();
    const liveLogs = new Map();
    const childProcesses = new Map();
    const activeLaunches = new Map();
    function setWindowTitle(pid, title) {
        if (process.platform !== 'win32') return;

        const { exec } = require('child_process');
        const script = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Threading;

public class TitleFixer {
    [DllImport("user32.dll")]
    public static extern bool SetWindowText(IntPtr hWnd, string lpString);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    public static void Run(int pid, string targetTitle) {
        Process p = null;
        try { p = Process.GetProcessById(pid); } catch { return; }

        IntPtr handle = IntPtr.Zero;
        StringBuilder sb = new StringBuilder(512);

        while (!p.HasExited) {
            try {
                if (handle == IntPtr.Zero || !IsWindow(handle)) {
                    p.Refresh();
                    handle = p.MainWindowHandle;
                }

                if (handle != IntPtr.Zero) {
                    sb.Clear();
                    GetWindowText(handle, sb, sb.Capacity);

                    string current = sb.ToString();
                    if (current != targetTitle && !string.IsNullOrEmpty(current)) {
                        SetWindowText(handle, targetTitle);

                        Thread.Sleep(200);
                    }
                }
            } catch {
            }

            Thread.Sleep(200);
        }
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
[TitleFixer]::Run(${pid}, "${title.replace(/"/g, '`"')}")
        `;

        const b64 = Buffer.from(script, 'utf16le').toString('base64');

        exec(`powershell -ExecutionPolicy Bypass -NoProfile -EncodedCommand ${b64}`, { windowsHide: true }, (err) => {
            if (err) console.error('[Launcher] Title watcher ended:', err);
        });
    }

    const getJavaProfileArgs = (profile, javaVersion) => {
        if (!profile || profile === 'default') return [];

        const aikarsFlags = [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+DisableExplicitGC",
            "-XX:+AlwaysPreTouch",
            "-XX:G1NewSizePercent=30",
            "-XX:G1MaxNewSizePercent=40",
            "-XX:G1HeapRegionSize=8M",
            "-XX:G1ReservePercent=20",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=4",
            "-XX:InitiatingHeapOccupancyPercent=15",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:G1RSetUpdatingPauseTimePercent=5",
            "-XX:SurvivorRatio=32",
            "-XX:+PerfDisableSharedMem",
            "-XX:MaxTenuringThreshold=1",
            "-Dusing.aikars.flags=https://mcflags.emc.gs",
            "-Daikars.new.flags=true"
        ];

        const lowEndFlags = [
            "-XX:+UseG1GC",
            "-XX:MaxGCPauseMillis=50",
            "-XX:G1HeapRegionSize=4M",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+DisableExplicitGC",
            "-XX:G1NewSizePercent=20",
            "-XX:G1MaxNewSizePercent=30",
            "-XX:G1ReservePercent=15",
            "-Dlux.profile=low-end"
        ];

        const zgcFlags = [
            "-XX:+UseZGC",
            "-XX:+ZGenerational",
            "-XX:+UnlockExperimentalVMOptions",
            "-Dlux.profile=zgc"
        ];

        if (profile === 'performance') return aikarsFlags;
        if (profile === 'low-end') return lowEndFlags;
        if (profile === 'zgc' && javaVersion >= 17) return zgcFlags;

        return [];
    };

    ipcMain.handle('launcher:abort-launch', async (_, instanceName) => {
        if (activeLaunches.has(instanceName)) {
            activeLaunches.get(instanceName).cancelled = true;
            console.log(`[Launcher] Mark launch cancelled for ${instanceName}`);
            return { success: true };
        }
        return { success: false, error: 'No active launch found to abort' };
    });

    ipcMain.handle('launcher:get-live-logs', (_, instanceName) => {
        return liveLogs.get(instanceName) || [];
    });

    ipcMain.handle('launcher:get-active-processes', () => {
        const processes = [];
        for (const [name, startTime] of runningInstances.entries()) {
            const proc = childProcesses.get(name);
            processes.push({
                name,
                startTime,
                pid: proc ? proc.pid : null
            });
        }
        return processes;
    });

    ipcMain.handle('launcher:get-process-stats', async (_, pid) => {
        return await getProcessStats(pid);
    });
    ipcMain.handle('launcher:kill', async (_, instanceName) => {
        const proc = childProcesses.get(instanceName);
        if (proc && !proc.killed) {
            try {
                if (process.platform === 'win32') {
                    const { exec } = require('child_process');
                    exec(`taskkill /pid ${proc.pid} /T /F`, (err) => {
                        if (err) console.error('Failed to kill process tree:', err);
                    });
                } else {
                    proc.kill('SIGTERM');
                }
                childProcesses.delete(instanceName);
                runningInstances.delete(instanceName);
                liveLogs.delete(instanceName);
                mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        return { success: false, error: 'No running process found for this instance.' };
    });

    const launchInstance = async (instanceName, quickPlay) => {
        if (runningInstances.has(instanceName) || activeLaunches.has(instanceName)) {
            const proc = childProcesses.get(instanceName);
            let isAlive = false;

            if (proc && proc.pid) {
                try {
                    process.kill(proc.pid, 0);
                    isAlive = true;
                } catch (e) {
                    isAlive = false;
                }
            }

            if (isAlive || activeLaunches.has(instanceName)) {
                console.warn(`[Launcher] Blocked launch attempt for ${instanceName} - Already ${activeLaunches.has(instanceName) ? 'launching' : 'running'}`);
                return { success: false, error: `Instance is already ${activeLaunches.has(instanceName) ? 'launching' : 'running'}.` };
            } else {
                console.log(`[Launcher] Process for ${instanceName} is no longer alive. Cleaning up stale state.`);
                runningInstances.delete(instanceName);
                childProcesses.delete(instanceName);
            }
        }

        activeLaunches.set(instanceName, { cancelled: false });

        try {
            const externalProfile = await findExternalProfileByDisplayName(instanceName);
            const launchContext = externalProfile
                ? await buildExternalLaunchContext(externalProfile)
                : await buildLocalLaunchContext(instanceName);

            if (!launchContext.success) {
                activeLaunches.delete(instanceName);
                return { success: false, error: launchContext.error };
            }

            const {
                config,
                configPath,
                instanceDir,
                rootDir,
                overrides: launchOverrides,
                librariesDir,
                versionDir,
                supportsBackups,
                supportsPersistence,
                isExternal
            } = launchContext;

            const backupConfig = store.get('settings') || {};
            if (supportsBackups && backupConfig.backupSettings?.enabled && backupConfig.backupSettings?.onLaunch) {
                console.log(`[Launcher] Triggering on-launch backup for ${instanceName}`);
                await backupManager.createBackup(instanceName).catch(err => {
                    console.error('[Launcher] On-launch backup failed:', err);
                });
            }

            if (supportsBackups && backupConfig.backupSettings?.enabled && backupConfig.backupSettings?.interval > 0) {
                backupManager.startScheduler(instanceName, backupConfig.backupSettings.interval);
            }

            const userProfile = getUserProfile(store);
            if (!userProfile || !userProfile.access_token) {
                return { success: false, error: 'Not logged in. Please login first.' };
            }

            const settingsPath = path.join(app.getPath('userData'), 'settings.json');
            let settings = {
                javaPath: '',
                minMemory: 1024,
                maxMemory: 4096,
                resolutionWidth: 854,
                resolutionHeight: 480,
                minimalMode: true
            };
            if (await fs.pathExists(settingsPath)) {
                try {
                    const saved = await fs.readJson(settingsPath);
                    settings = { ...settings, ...saved };
                } catch (e) {
                    console.error("Failed to load settings for launch", e);
                }
            }
            if (config.javaPath) settings.javaPath = config.javaPath;
            if (config.minMemory) settings.minMemory = config.minMemory;
            if (config.maxMemory) settings.maxMemory = config.maxMemory;
            if (config.resolutionWidth) settings.resolutionWidth = config.resolutionWidth;
            if (config.resolutionHeight) settings.resolutionHeight = config.resolutionHeight;
            if (config.javaProfile) settings.javaProfile = config.javaProfile;

            const sharedDir = path.join(app.getPath('userData'), 'common');
            await fs.ensureDir(sharedDir);

            let opts = {
                clientPackage: null,
                authorization: {
                    access_token: userProfile.access_token,
                    client_token: userProfile.uuid,
                    uuid: userProfile.uuid,
                    name: userProfile.name,
                    user_properties: '{}',
                    meta: {
                        type: 'msa',
                        xuid: userProfile.xuid || extractXuidFromToken(userProfile.access_token)
                    }
                },
                root: rootDir,
                overrides: { ...launchOverrides },
                version: {
                    number: config.version,
                    type: "release"
                },
                memory: {
                    max: `${settings.maxMemory}M`,
                    min: `${settings.minMemory}M`
                },
                window: {
                    width: settings.resolutionWidth,
                    height: settings.resolutionHeight
                }
            };

            console.log(`[Launcher] Launching with: version=${opts.version.number}, loader=${config.loader}`);

            if (config.versionId && config.loader && config.loader.toLowerCase() !== 'vanilla') {
                opts.version.custom = config.versionId;
                console.log(`Launching with ${config.loader} custom profile: ${config.versionId}`);
            }

            if (settings.javaPath && settings.javaPath.trim() !== '') {
                let jPath = settings.javaPath;
                if (process.platform === 'win32') {
                    jPath = path.normalize(jPath);
                    if (jPath.toLowerCase().endsWith('java.exe')) {
                        const javawPath = jPath.slice(0, -8) + 'javaw.exe';
                        if (await fs.pathExists(javawPath)) {
                            console.log(`[Launcher] Found javaw.exe, switching from java.exe to suppress console window: ${javawPath}`);
                            jPath = javawPath;
                        } else {
                            console.warn(`[Launcher] Could not find javaw.exe at ${javawPath}, continuing with java.exe`);
                        }
                    }
                }
                opts.javaPath = jPath;
            }

            const { installJava } = require('../utils/java-utils');

            function parseMinecraftVersionForJava(mcVersion) {
                const raw = String(mcVersion || '').trim();
                const match = raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
                if (!match) {
                    return { major: 0, minor: 0, patch: 0 };
                }

                const first = Number.parseInt(match[1] || '0', 10);
                const second = Number.parseInt(match[2] || '0', 10);
                const third = Number.parseInt(match[3] || '0', 10);

                // Normalize both "1.20.6" and "20.6" style versioning.
                if (first === 1 && match[2]) {
                    return { major: second, minor: third, patch: 0 };
                }

                return { major: first, minor: second, patch: third };
            }

            function getRequiredJavaVersion(mcVersion) {
                const parsed = parseMinecraftVersionForJava(mcVersion);

                // Newer MC builds from 26.1+ require Java 25.
                if (parsed.major > 26 || (parsed.major === 26 && parsed.minor >= 1)) return 25;
                if (parsed.major >= 21) return 21;
                if (parsed.major === 20 && parsed.minor >= 5) return 21;
                if (parsed.major >= 17) return 17;
                return 8;
            }

            let javaValid = false;
            let javaVersion = 0;
            let javaOutput = '';

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const detectJavaVersion = async (javaBinaryPath) => {
                try {
                    const { stderr, stdout } = await execAsync(`"${javaBinaryPath}" -version`, { encoding: 'utf8' });
                    const output = stderr || stdout || '';
                    const versionMatch = output.match(/(?:version|jd[kj])\s*["']?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
                    if (!versionMatch) {
                        return { success: false, version: 0, output };
                    }

                    let major = Number.parseInt(versionMatch[1], 10);
                    if (major === 1) major = Number.parseInt(versionMatch[2] || '8', 10);

                    return { success: true, version: major, output };
                } catch (e) {
                    return { success: false, version: 0, output: '', error: e.message };
                }
            };

            const findCompatibleJavaRuntime = async (requiredVersion, preferredPaths = []) => {
                const javaBinName = process.platform === 'win32' ? 'java.exe' : 'java';
                const runtimesDir = path.join(app.getPath('userData'), 'runtimes');
                const candidates = [];
                const seen = new Set();

                const addCandidate = (candidate) => {
                    const normalized = String(candidate || '').trim();
                    if (!normalized) return;
                    const dedupeKey = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
                    if (seen.has(dedupeKey)) return;
                    seen.add(dedupeKey);
                    candidates.push(normalized);
                };

                for (const p of preferredPaths) addCandidate(p);
                addCandidate('java');

                try {
                    if (await fs.pathExists(runtimesDir)) {
                        const runtimeDirs = await fs.readdir(runtimesDir);
                        for (const dirName of runtimeDirs) {
                            addCandidate(path.join(runtimesDir, dirName, 'bin', javaBinName));
                        }
                    }
                } catch (e) {
                    console.warn('[Launcher] Failed to scan internal runtimes:', e.message);
                }

                for (const candidate of candidates) {
                    if (candidate !== 'java' && !await fs.pathExists(candidate)) continue;

                    const detected = await detectJavaVersion(candidate);
                    if (detected.success && detected.version >= requiredVersion) {
                        return {
                            found: true,
                            path: candidate,
                            version: detected.version,
                            output: detected.output
                        };
                    }
                }

                return { found: false };
            };

            const performJavaCheck = async (p) => {
                const detected = await detectJavaVersion(p);
                if (detected.success) {
                    javaOutput = detected.output;
                    javaVersion = detected.version;
                    console.log(`[Launcher] Detected Java version ${javaVersion} for ${p}`);
                    return true;
                }

                console.error(`[Launcher] Java check failed for ${p}:`, detected.error || 'unknown error');
                return false;
            };

            let javaToCheck = opts.javaPath || 'java';
            javaValid = await performJavaCheck(javaToCheck);

            const reqVersion = getRequiredJavaVersion(config.version);

            if (javaValid && javaVersion < reqVersion) {
                console.warn(`[Launcher] Detected Java ${javaVersion} is too old for MC ${config.version} (requires ${reqVersion}).`);
                javaValid = false;
            }

            if (!javaValid) {
                const compatibleJava = await findCompatibleJavaRuntime(reqVersion, [opts.javaPath, settings.javaPath]);
                if (compatibleJava.found) {
                    javaToCheck = compatibleJava.path;
                    opts.javaPath = javaToCheck;
                    javaValid = true;
                    javaVersion = compatibleJava.version;
                    javaOutput = compatibleJava.output || javaOutput;
                    console.log(`[Launcher] Switched to compatible Java ${javaVersion}: ${javaToCheck}`);
                }
            }

            if (!javaValid) {
                if (reqVersion >= 25) {
                    if (mainWindow?.webContents) {
                        mainWindow.webContents.send('java:required', {
                            instanceName,
                            minecraftVersion: config.version,
                            requiredVersion: reqVersion
                        });
                    }

                    runningInstances.delete(instanceName);
                    activeLaunches.delete(instanceName);
                    return {
                        success: false,
                        error: `This Minecraft version requires Java ${reqVersion}, but no compatible Java runtime is installed.`
                    };
                }

                console.log(`[Launcher] Java not found or invalid. Attempting auto-install of Java ${reqVersion}...`);

                mainWindow.webContents.send('install:progress', {
                    instanceName,
                    progress: 0,
                    status: `Installing Java ${reqVersion} (required for MC ${config.version})...`
                });

                const runtimesDir = path.join(app.getPath('userData'), 'runtimes');
                const installRes = await installJava(reqVersion, runtimesDir, (step, progress) => {
                    mainWindow.webContents.send('install:progress', {
                        instanceName,
                        progress,
                        status: step
                    });
                });

                if (installRes.success) {
                    javaToCheck = installRes.path;
                    opts.javaPath = javaToCheck;
                    javaValid = await performJavaCheck(javaToCheck);

                    if (!config.javaPath) {
                        try {
                            const newSettings = { ...settings, javaPath: javaToCheck };
                            await fs.writeJson(settingsPath, newSettings, { spaces: 4 });
                            app.emit('settings-updated', newSettings);
                        } catch (e) { console.error("Failed to save auto-installed java path", e); }
                    }
                }
            }

            if (!javaValid) {
                runningInstances.delete(instanceName);
                activeLaunches.delete(instanceName);
                return {
                    success: false,
                    error: `Java not found or invalid even after attempted installation. Please check your settings.`
                };
            }

            const is64Bit = javaOutput.includes('64-Bit');
            const maxMem = parseInt(opts.memory.max) || 4096;

            if (!is64Bit && maxMem > 1536) {
                return {
                    success: false,
                    error: `You are using 32-bit Java with ${maxMem}MB memory. 32-bit Java has a limit of ~1.5GB. Please install 64-bit Java or reduce memory.`
                };
            }

            console.log(`[Launcher] Final launch options for ${instanceName}:`, {
                version: opts.version,
                memory: opts.memory,
                javaPath: opts.javaPath || 'default',
                external: isExternal,
                root: opts.root
            });

            if (config.loader && config.loader.toLowerCase() === 'neoforge') {
                const neoForgeArgs = [
                    `-DlibraryDirectory=${librariesDir}`,
                    "--add-modules=ALL-SYSTEM",
                    "--add-opens=java.base/java.util.jar=ALL-UNNAMED",
                    "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
                    "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
                    "--add-opens=java.base/java.io=ALL-UNNAMED",
                    "--add-opens=java.base/java.nio=ALL-UNNAMED",
                    "--add-opens=java.base/java.util=ALL-UNNAMED",
                    "--add-opens=java.base/java.time=ALL-UNNAMED",
                    "--add-opens=java.base/sun.security.util=ALL-UNNAMED",
                    "--add-opens=java.base/sun.io=ALL-UNNAMED",
                    "--add-opens=java.logging/java.util.logging=ALL-UNNAMED"
                ];

                if (opts.customArgs) {
                    if (Array.isArray(opts.customArgs)) {
                        opts.customArgs.push(...neoForgeArgs);
                    } else {
                        opts.customArgs = [...neoForgeArgs];
                    }
                } else {
                    opts.customArgs = neoForgeArgs;
                }
                console.log("Added NeoForge JVM arguments");
            }

            if (settings.javaProfile && settings.javaProfile !== 'default') {
                const profileArgs = getJavaProfileArgs(settings.javaProfile, javaVersion);
                if (profileArgs.length > 0) {
                    if (!opts.customArgs) opts.customArgs = [];
                    opts.customArgs.push(...profileArgs);
                    console.log(`[Launcher] Applied Java Profile: ${settings.javaProfile}`);
                }
            }

            if (!opts.customArgs) opts.customArgs = [];
            opts.customArgs.push(`-Dorg.lwjgl.opengl.Window.name=Lux Client ${config.version || ''}`);
            opts.customArgs.push(`-Dorg.lwjgl.Display.title=Lux Client ${config.version || ''}`);
            opts.version.type = "Lux Client";

            if (config.loader && config.loader.toLowerCase() !== 'vanilla') {
                if (!config.versionId) {
                    activeLaunches.delete(instanceName);
                    return { success: false, error: `Instance configuration incomplete (missing versionId). Please reinstall ${instanceName}.` };
                }
                const specificVersionDir = versionDir;
                if (!await fs.pathExists(specificVersionDir)) {
                    activeLaunches.delete(instanceName);
                    return { success: false, error: `Mod loader files missing for ${config.versionId}. Please reinstall.` };
                }
            }

            const launcher = new Client();

            liveLogs.set(instanceName, []);
            if (!isExternal && config.preLaunchHook && config.preLaunchHook.trim()) {
                try {
                    const hook = config.preLaunchHook.trim();
                    const forbiddenChars = /[;&|`$<>]/;
                    if (forbiddenChars.test(hook)) {
                        console.error('[Launcher] Blocked potentially malicious pre-launch hook:', hook);
                    } else {
                        const { execSync } = require('child_process');
                        console.log(`[Launcher] Executing pre-launch hook: ${hook}`);
                        execSync(hook, { cwd: instanceDir, stdio: 'inherit' });
                    }
                } catch (e) {
                    console.error('Pre-launch hook failed:', e.message);
                }
            }

            mainWindow.webContents.send('instance:status', {
                instanceName,
                status: 'launching',
                loader: config.loader || 'Vanilla',
                version: config.version
            });
            runningInstances.set(instanceName, Date.now());

            try {
                const discord = require('./discord');
                discord.setActivity(`Playing ${instanceName}`, 'Starting Game...', 'lux_icon', 'Lux', runningInstances.get(instanceName));
            } catch (e) {
                console.error('[Launcher] Failed to update Discord activity on start:', e.message);
            }

            let logCrashDetected = false;
            const crashPatterns = [
                'Failed to start Minecraft!',
                'FormattedException',
                'NoClassDefFoundError',
                'java.lang.NoSuchMethodError'
            ];
            let gameStarted = false;

            const appendLog = (data) => {
                const line = data.toString();

                if (!logCrashDetected && !gameStarted) {
                    for (const pattern of crashPatterns) {
                        if (line.includes(pattern)) {
                            console.log(`[Launcher] Detected potential crash pattern in logs: ${pattern}`);
                            logCrashDetected = true;
                            break;
                        }
                    }
                }

                const lines = line.split(/\r?\n/);
                for (const l of lines) {
                    if (!l.trim()) continue;
                }

                const logs = liveLogs.get(instanceName) || [];
                logs.push(line);
                if (logs.length > 1000) logs.shift();
                liveLogs.set(instanceName, logs);
                mainWindow.webContents.send('launch:log', line);
            };

            launcher.on('debug', (line) => {
                const sanitizedLine = String(line ?? '')
                    .replace(/\[MCLC\]\s*:?\s*/gi, '')
                    .trim();

                if (!sanitizedLine) return;
                appendLog(`[Debug] [LUX] ${sanitizedLine}`);
            });
            launcher.on('data', (line) => appendLog(line));
            launcher.on('stderr', (line) => appendLog(`[ERROR] ${line}`));
            launcher.on('progress', (e) => {
                mainWindow.webContents.send('launch:progress', { ...e, instanceName });
            });

            launcher.on('arguments', (e) => {
                                gameStarted = true;
                mainWindow.webContents.send('instance:status', {
                    instanceName,
                    status: 'running',
                    loader: config.loader || 'Vanilla',
                    version: config.version
                });
                try {
                    const discord = require('./discord');
                    discord.setActivity(`Playing ${instanceName}`, 'In Game', 'minecraft', 'Minecraft', runningInstances.get(instanceName));
                } catch (e) {
                    console.error('[Launcher] Failed to update Discord activity on game start:', e.message);
                }
            });

            launcher.on('close', async (code, signal) => {
                console.log(`[Launcher] MC Process closed with code: ${code}, signal: ${signal || 'none'}, logCrashDetected: ${logCrashDetected}`);

                const startTime = runningInstances.get(instanceName);
                if (startTime) {
                    const sessionTime = Date.now() - startTime;
                    console.log(`[Launcher] Session finished for ${instanceName}. Duration: ${sessionTime}ms`);

                    try {
                        if (supportsPersistence && configPath && await fs.pathExists(configPath)) {
                            const currentConfig = await fs.readJson(configPath);
                            currentConfig.playtime = (currentConfig.playtime || 0) + sessionTime;
                            currentConfig.lastPlayed = Date.now();
                            await fs.writeJson(configPath, currentConfig, { spaces: 4 });

                            const playtimePath = path.join(instanceDir, 'playtime.txt');
                            await fs.writeFile(playtimePath, String(currentConfig.playtime));

                            console.log(`[Launcher] Updated total playtime for ${instanceName}: ${currentConfig.playtime}ms`);
                        }

                        const normalizedExitCode = Number.isInteger(code) ? code : null;
                        const hasErrorExitCode = normalizedExitCode !== null && normalizedExitCode > 0;
                        const isShortSession = sessionTime < 15000;
                        const shouldFlagShortSessionCrash = process.platform !== 'linux' && isShortSession;
                        const isCrash = hasErrorExitCode || logCrashDetected || shouldFlagShortSessionCrash;

                        if (isCrash) {
                            console.log(`[Launcher] Crash/Early Exit detected for ${instanceName} (Exit code: ${normalizedExitCode ?? 'unknown'}, Signal: ${signal || 'none'}, LogCrash: ${logCrashDetected}, Duration: ${sessionTime}ms, ShortSessionCrash: ${shouldFlagShortSessionCrash}).`);

                            const crashLogContent = await buildCrashLogContent(instanceDir, liveLogs.get(instanceName) || []);
                            const compatibilityIssues = extractCompatibilityIssuesFromCrashLog(crashLogContent);

                            let logUrl = null;
                            const settings = store.get('settings') || {};
                            if (settings.autoUploadLogs) {
                                console.log('[Launcher] autoUploadLogs is enabled, uploading to mclo.gs...');
                                const logPath = path.join(instanceDir, 'logs', 'latest.log');
                                if (await fs.pathExists(logPath)) {
                                    try {
                                        const logContent = await fs.readFile(logPath, 'utf8');
                                        const axios = require('axios');
                                        const qs = require('querystring');
                                        const response = await axios.post('https://api.mclo.gs/1/log', qs.stringify({
                                            content: logContent
                                        }), {
                                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                                        });

                                        if (response.data && response.data.success) {
                                            logUrl = response.data.url;
                                            console.log(`[Launcher] Logs uploaded to mclo.gs: ${logUrl}`);
                                        }
                                    } catch (err) {
                                        console.error('[Launcher] Failed to upload logs to mclo.gs:', err.message);
                                    }
                                }
                            }

                            mainWindow.webContents.send('launcher:crash-report', {
                                instanceName,
                                exitCode: code,
                                logUrl: logUrl,
                                logContent: crashLogContent,
                                compatibilityIssues
                            });
                        }
                    } catch (err) {
                        console.error("[Launcher] Failed to update instance data after close:", err);
                    }

                    runningInstances.delete(instanceName);
                }

                childProcesses.delete(instanceName);
                liveLogs.delete(instanceName);
                mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });

                try {
                    const discord = require('./discord');
                    discord.setActivity('In Launcher', 'Idle', 'lux_icon', 'Lux');
                } catch (e) {
                    console.error('[Launcher] Failed to restore Discord activity after close:', e.message);
                }

                backupManager.stopScheduler(instanceName);

                const settings = store.get('settings') || {};
                if (supportsBackups && settings.backupSettings?.enabled && settings.backupSettings?.onClose) {
                    console.log(`[Launcher] Triggering on-close backup for ${instanceName}`);
                    await backupManager.createBackup(instanceName).catch(err => {
                        console.error('[Launcher] On-close backup failed:', err);
                    });
                }
            });

            try {
                if (activeLaunches.get(instanceName)?.cancelled) {
                    console.log(`[Launcher] Launch aborted before spawn for ${instanceName}`);
                    activeLaunches.delete(instanceName);
                    runningInstances.delete(instanceName);
                    liveLogs.delete(instanceName);
                    mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });
                    return { success: false, error: 'Launch aborted' };
                }

                activeLaunches.delete(instanceName);

                if (quickPlay) {
                    if (quickPlay.world) {
                        opts.quickPlay = { type: 'singleplayer', identifier: quickPlay.world };
                        console.log(`[Launcher] QuickPlay: World "${quickPlay.world}"`);
                    } else if (quickPlay.server) {
                        opts.quickPlay = { type: 'multiplayer', identifier: quickPlay.server };
                        console.log(`[Launcher] QuickPlay: Server "${quickPlay.server}"`);
                    }
                }

                const proc = await launcher.launch(opts);
                if (proc && proc.pid) {
                    childProcesses.set(instanceName, proc);
                    setWindowTitle(proc.pid, `Lux Client ${opts.version.number}`);

                    if (settings.minimalMode && process.platform === 'win32' && mainWindow) {
                        console.log('[Launcher] Minimal Mode enabled, minimizing window.');
                        mainWindow.minimize();
                    }
                } else {
                    console.error('[Launcher] Launch failed: No valid process returned from Lux.', proc);
                    runningInstances.delete(instanceName);
                    activeLaunches.delete(instanceName);
                    liveLogs.delete(instanceName);
                    mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });
                    return { success: false, error: 'Failed to start Minecraft process (no PID returned)' };
                }
            } catch (e) {
                console.error('Launch error:', e);
                runningInstances.delete(instanceName);
                liveLogs.delete(instanceName);
                childProcesses.delete(instanceName);
                activeLaunches.delete(instanceName);
                mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });
                try {
                    const discord = require('./discord');
                    discord.setActivity('In Launcher', 'Idle', 'minecraft', 'Minecraft');
                } catch (err) {
                    console.error('[Launcher] Failed to restore Discord activity after launch error:', err.message);
                }
                return { success: false, error: e.message };
            }

            return { success: true };
        } catch (e) {
            console.error('Initial launch error:', e);
            activeLaunches.delete(instanceName);
            runningInstances.delete(instanceName);
            childProcesses.delete(instanceName);
            mainWindow.webContents.send('instance:status', { instanceName, status: 'stopped' });
            return { success: false, error: e.message };
        }
    };

    ipcMain.handle('launcher:launch', async (_, instanceName, quickPlay) => {
        return await launchInstance(instanceName, quickPlay);
    });

    return { launchInstance };
};
