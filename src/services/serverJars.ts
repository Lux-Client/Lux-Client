const PAPERMC_API_URL = 'https://api.papermc.io/v2/projects';
const PURPUR_API_URL = 'https://api.purpurmc.org/v2/purpur';
const PUFFERFISH_API_URL = 'https://ci.pufferfish.host';
const MOHIST_API_URL = 'https://api.mohistmc.com/project/mohist';
const FABRIC_API_URL = 'https://meta.fabricmc.net/v2/versions';
const VANILLA_VERSIONS_API_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const NEOFORGE_MAVEN_METADATA_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const QUILT_MAVEN_METADATA_URL = 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml';

const CACHE_TTL = 30 * 60 * 1000;
const versionCache = new Map();

const manualJars = {
    spigot: [
        { version: '1.21.8', release: 'July 17th 2025' },
        { version: '1.21.7', release: 'June 26th 2025' },
        { version: '1.21.6', release: 'June 17th 2025' },
        { version: '1.21.5', release: 'April 23rd 2025' },
        { version: '1.21.4', release: 'December 3rd 2024' },
        { version: '1.21.1', release: 'August 8th 2024' },
        { version: '1.20.6', release: 'April 29th 2024' },
        { version: '1.20.4', release: 'December 13th 2023' },
        { version: '1.20.2', release: 'September 21st 2023' },
        { version: '1.20.1', release: 'June 12th 2023' }
    ],
    craftbukkit: [
        { version: '1.21.1', release: 'August 8th 2024' },
        { version: '1.20.6', release: 'April 29th 2024' },
        { version: '1.20.4', release: 'December 13th 2023' },
        { version: '1.20.2', release: 'September 21st 2023' },
        { version: '1.20.1', release: 'June 12th 2023' }
    ],
    forge: [
        { version: '1.21.10', release: 'October 11th 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.10-60.0.4/forge-1.21.10-60.0.4-installer.jar' },
        { version: '1.21.9', release: 'October 6th 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.9-59.0.5/forge-1.21.9-59.0.5-installer.jar' },
        { version: '1.21.8', release: 'August 27th 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.8-58.1.0/forge-1.21.8-58.1.0-installer.jar' },
        { version: '1.21.7', release: 'July 16th 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.7-57.0.3/forge-1.21.7-57.0.3-installer.jar' },
        { version: '1.21.6', release: 'June 25th 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.6-56.0.9/forge-1.21.6-56.0.9-installer.jar' },
        { version: '1.21.5', release: 'April 23rd 2025', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.5-55.1.0/forge-1.21.5-55.1.0-installer.jar' },
        { version: '1.21.4', release: 'December 3rd 2024', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.4-54.1.0/forge-1.21.4-54.1.0-installer.jar' },
        { version: '1.21.1', release: 'August 8th 2024', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.1-52.1.0/forge-1.21.1-52.1.0-installer.jar' },
        { version: '1.20.6', release: 'April 29th 2024', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.6-50.1.32/forge-1.20.6-50.1.32-installer.jar' },
        { version: '1.20.4', release: 'December 13th 2023', downloadUrl: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.4-49.0.9/forge-1.20.4-49.0.9-installer.jar' }
    ]
};

const platformInfo = [
    { platform: 'purpur', display: 'Purpur' },
    { platform: 'mohist', display: 'Mohist' },
    { platform: 'pufferfish', display: 'Pufferfish' },
    { platform: 'paper', display: 'Paper' },
    { platform: 'spigot', display: 'Spigot' },
    { platform: 'craftbukkit', display: 'CraftBukkit' },
    { platform: 'vanilla', display: 'Vanilla' },
    { platform: 'folia', display: 'Folia' },
    { platform: 'velocity', display: 'Velocity (Proxy)' },
    { platform: 'waterfall', display: 'Waterfall (Proxy)' },
    { platform: 'fabric', display: 'Fabric' },
    { platform: 'neoforge', display: 'NeoForge' },
    { platform: 'quilt', display: 'Quilt' },
    { platform: 'forge', display: 'Forge' }
];

const aliasMap = {
    bukkit: 'craftbukkit',
    bungeecord: 'waterfall'
};

const compareMinecraftVersionsDesc = (left, right) => {
    const parts = (value) => String(value).split('.').map((piece) => Number(piece) || 0);
    const a = parts(left);
    const b = parts(right);

    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (b[i] || 0) - (a[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
};

const safeFetchJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

const normalizePlatform = (platform) => aliasMap[(platform || '').toLowerCase()] || (platform || '').toLowerCase();

export const findVersion = (versions, version) => versions.find((item) => item.version === version);
export const findLatestVersion = (versions) => versions[0];

export const fetchSupportedPlatforms = () => platformInfo.map((platform) => ({ key: platform.platform, name: platform.display }));

export const fetchVersionsFor = async (platform) => handle(true, platform, null);
export const fetchDetailsFor = async (platform, version) => handle(false, platform, version);

const handleVersion = async (version, versions) => (version || '').toLowerCase() === 'latest' ? findLatestVersion(versions) : version;

const handle = async (handleVersions, platform, version) => {
    const normalized = normalizePlatform(platform);
    let versions;

    switch (normalized) {
        case 'paper':
        case 'waterfall':
        case 'velocity':
        case 'folia':
            versions = await fetchPaperMcVersionsFor(normalized);
            return handleVersions ? versions : fetchPaperMcDetailsFor(normalized, await handleVersion(version, versions));

        case 'purpur':
            versions = await fetchPurpurVersions();
            return handleVersions ? versions : fetchPurpurDetailsFor(await handleVersion(version, versions));

        case 'mohist':
            versions = await fetchMohistVersions();
            return handleVersions ? versions : fetchMohistDetailsFor(await handleVersion(version, versions));

        case 'pufferfish':
            versions = await fetchPufferfishVersions();
            return handleVersions ? versions : fetchPufferfishDetailsFor(await handleVersion(version, versions));

        case 'fabric':
            versions = await fetchFabricVersions();
            return handleVersions ? versions : fetchFabricDetailsFor(await handleVersion(version, versions));

        case 'vanilla':
            versions = await fetchVanillaVersions();
            return handleVersions ? versions : fetchVanillaDetailsFor(await handleVersion(version, versions));

        case 'spigot':
        case 'craftbukkit':
        case 'forge':
            versions = await fetchManualVersionsFor(normalized);
            return handleVersions ? versions : fetchManualDetailsFor(normalized, await handleVersion(version, versions));

        case 'neoforge':
            versions = await fetchNeoforgeVersions();
            return handleVersions ? versions : fetchNeoforgeDetailsFor(await handleVersion(version, versions));

        case 'quilt':
            versions = await fetchQuiltVersions();
            return handleVersions ? versions : fetchQuiltDetailsFor(await handleVersion(version, versions));

        default:
            return null;
    }
};

export const fetchManualVersionsFor = async (platform) => {
    return (manualJars[platform] || []).map((item) => item.version);
};

export const fetchManualDetailsFor = async (platform, version) => {
    const versions = manualJars[platform] || [];
    const versionResponse = versions.find((item) => item.version === version);
    if (!versionResponse) throw new Error(`No details for ${platform} ${version}`);

    const display = platformInfo.find((item) => item.platform === platform)?.display || platform;
    return {
        platform,
        display,
        version: versionResponse.version,
        release: versionResponse.release,
        downloadUrl: versionResponse.downloadUrl || `https://cdn.mcutils.com/jars/${platform}-${versionResponse.version}.jar`
    };
};

export const fetchPaperMcVersionsFor = async (platform) => {
    const cached = versionCache.get(platform);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

    const data = await safeFetchJson(`${PAPERMC_API_URL}/${platform}`);
    const versions = [...(data.versions || [])].reverse();
    const batchSize = 10;
    const validVersions = [];

    for (let index = 0; index < versions.length; index += batchSize) {
        const batch = versions.slice(index, index + batchSize);
        const results = await Promise.allSettled(
            batch.map(async (version) => {
                const url = `${PAPERMC_API_URL}/${platform}/versions/${version}`;
                const buildsResponse = await safeFetchJson(url);
                const latestBuild = buildsResponse.builds?.[buildsResponse.builds.length - 1];
                if (!latestBuild) return null;
                const buildResponse = await safeFetchJson(`${url}/builds/${latestBuild}`);
                return buildResponse.downloads?.application ? version : null;
            })
        );

        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) validVersions.push(result.value);
        });
    }

    versionCache.set(platform, { data: validVersions, timestamp: Date.now() });
    return validVersions;
};

export const fetchPaperMcDetailsFor = async (platform, version) => {
    const url = `${PAPERMC_API_URL}/${platform}/versions/${version}`;
    const buildsResponse = await safeFetchJson(url);
    const latestBuild = buildsResponse.builds?.[buildsResponse.builds.length - 1];
    if (!latestBuild) throw new Error(`No builds for ${platform} ${version}`);

    const response = await safeFetchJson(`${url}/builds/${latestBuild}`);
    return {
        platform: response.project_id,
        display: response.project_name,
        version: response.version,
        release: formatDate(new Date(response.time)),
        downloadUrl: `${url}/builds/${response.build}/downloads/${response.downloads.application.name}`
    };
};

export const fetchPurpurVersions = async () => {
    const data = await safeFetchJson(PURPUR_API_URL);
    return [...(data.versions || [])].reverse();
};

export const fetchMohistVersions = async () => {
    const cached = versionCache.get('mohist');
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

    const data = await safeFetchJson(`${MOHIST_API_URL}/versions`);
    const names = (Array.isArray(data) ? data : [])
        .map((entry) => (typeof entry === 'string' ? entry : entry && entry.name))
        .filter(Boolean)
        .sort(compareMinecraftVersionsDesc);

    const buildCounts = await Promise.all(names.map(async (name) => {
        try {
            return (await fetchMohistBuilds(name)).length;
        } catch {
            return 0;
        }
    }));

    const usable = names.filter((_, index) => buildCounts[index] > 0);
    versionCache.set('mohist', { data: usable, timestamp: Date.now() });
    return usable;
};

export const fetchMohistBuilds = async (version) => {
    const data = await safeFetchJson(`${MOHIST_API_URL}/${version}/builds`);
    return Array.isArray(data) ? data : [];
};

export const fetchMohistDetailsFor = async (version) => {
    const builds = await fetchMohistBuilds(version);
    if (builds.length === 0) {
        throw new Error(`Mohist has no build for ${version} yet`);
    }

    const latest = builds.reduce((best, entry) => (
        Number(entry.id) > Number(best.id) ? entry : best
    ), builds[0]);

    return {
        platform: 'mohist',
        display: 'Mohist',
        version,
        build: latest.id,
        release: latest.build_date ? formatDate(new Date(latest.build_date)) : '',
        downloadUrl: `${MOHIST_API_URL}/${version}/builds/${latest.id}/download`
    };
};

export const fetchPurpurDetailsFor = async (version) => {
    const url = `${PURPUR_API_URL}/${version}/latest`;
    const response = await safeFetchJson(url);
    return {
        platform: 'purpur',
        display: 'Purpur',
        version: response.version,
        release: formatDate(new Date(response.timestamp)),
        downloadUrl: `${url}/download`
    };
};

export const fetchPufferfishVersions = async () => {
    const response = await safeFetchJson(`${PUFFERFISH_API_URL}/api/json`);
    return (response.jobs || [])
        .filter((job) => job.name.startsWith('Pufferfish-1.'))
        .map((job) => job.name.split('-')[1])
        .reverse();
};

export const fetchPufferfishDetailsFor = async (version) => {
    const url = `${PUFFERFISH_API_URL}/job/Pufferfish-${version}/lastSuccessfulBuild`;
    const response = await safeFetchJson(`${url}/api/json`);
    return {
        platform: 'pufferfish',
        display: 'Pufferfish',
        version,
        release: formatDate(new Date(response.timestamp)),
        downloadUrl: `${url}/artifact/${response.artifacts[0].relativePath}`
    };
};

export const fetchFabricVersions = async () => {
    const versions = await safeFetchJson(`${FABRIC_API_URL}/game`);
    return versions.filter((item) => item.stable).map((item) => item.version);
};

export const fetchFabricDetailsFor = async (version) => {
    const url = `${FABRIC_API_URL}/loader/${version}`;
    const loaders = await safeFetchJson(url);
    const loader = loaders[0]?.loader?.version;
    if (!loader) throw new Error(`No Fabric loader for ${version}`);

    const serverMeta = await safeFetchJson(`${url}/${loader}/server/json`);
    const installers = await safeFetchJson(`${FABRIC_API_URL}/installer`);
    const installer = installers[0]?.version;
    if (!installer) throw new Error('No Fabric installer available');

    return {
        platform: 'fabric',
        display: 'Fabric',
        version,
        release: formatDate(new Date(serverMeta.releaseTime)),
        downloadUrl: `${url}/${loader}/${installer}/server/jar`
    };
};

const parseMavenVersionsFromXml = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const nodes = doc.querySelectorAll('metadata > versioning > versions > version');
    return Array.from(nodes).map((node) => node.textContent).filter(Boolean).reverse();
};

export const fetchNeoforgeVersions = async () => {
    return parseMavenVersionsFromXml(NEOFORGE_MAVEN_METADATA_URL);
};

export const fetchNeoforgeDetailsFor = async (version) => {
    return {
        platform: 'neoforge',
        display: 'NeoForge',
        version,
        release: '',
        downloadUrl: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    };
};

export const fetchQuiltVersions = async () => {
    return parseMavenVersionsFromXml(QUILT_MAVEN_METADATA_URL);
};

export const fetchQuiltDetailsFor = async (version) => {
    return {
        platform: 'quilt',
        display: 'Quilt',
        version,
        release: '',
        downloadUrl: `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${version}/quilt-installer-${version}.jar`
    };
};

export const fetchVanillaVersions = async () => {
    const response = await safeFetchJson(VANILLA_VERSIONS_API_URL);
    return response.versions.filter((version) => version.type === 'release').map((version) => version.id);
};

export const fetchVanillaDetailsFor = async (version) => {
    const response = await safeFetchJson(VANILLA_VERSIONS_API_URL);
    const versionEntry = response.versions
        .filter((entry) => entry.type === 'release')
        .find((entry) => entry.id === version);

    if (!versionEntry) throw new Error(`No vanilla entry for ${version}`);
    const details = await safeFetchJson(versionEntry.url);

    return {
        platform: 'vanilla',
        display: 'Vanilla',
        version,
        release: formatDate(new Date(versionEntry.releaseTime)),
        downloadUrl: details.downloads.server?.url
    };
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const formatDate = (date) => {
    const day = date.getDate();

    let suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';

    return `${MONTH_NAMES[date.getMonth()]} ${day}${suffix} ${date.getFullYear()}`;
};