// Lux Client Mod: the mod itself is closed source; its jars are published as
// GitHub release assets on the public Lux-Client/Lux-Mod repository. This module
// only contains the pure logic (asset name parsing, release selection, file
// naming) so it can be tested without Electron.

const LUX_MOD_REPO = 'Lux-Client/Lux-Mod';

// Used when GitHub cannot be reached (offline, rate limit) so the launcher still
// knows which instances could get the mod.
const FALLBACK_SUPPORTED_VERSIONS = ['1.21.11', '1.21.8', '26.2', '1.20.1'];
const SUPPORTED_LOADERS = ['fabric'];

// Every jar the launcher writes is named like this, so it can find, update and
// protect the mod later without guessing.
const INSTALLED_FILE_PREFIX = 'LuxClient-';
const INSTALLED_FILE_PATTERN = /^luxclient-.*\.jar(\.disabled)?$/i;

const VERSION = '\\d+\\.\\d+(?:\\.\\d+)?';
const OTHER_LOADER_PATTERN = /(^|[-_+.])(neoforge|forge|quilt)([-_+.]|$)/i;
const IGNORED_ASSET_PATTERN = /(^|[-_+.])(sources|dev|javadoc)\.jar$/i;

// Accepted asset names (the MC version must be in the name):
//   lux-client-1.0.0-mc1.21.11.jar   (recommended)
//   lux-client-1.0.0+1.21.11.jar     (Fabric convention)
//   lux-client-1.0.0-1.21.11.jar     (last version token wins)
//   LuxClient-26.2.jar
const parseMcVersionFromAssetName = (assetName) => {
    const name = String(assetName || '').trim();
    if (!/\.jar$/i.test(name) || IGNORED_ASSET_PATTERN.test(name)) return null;

    const explicit = name.match(new RegExp(`(?:mc|minecraft)[-_]?(${VERSION})(?=[-_+]|\\.jar$)`, 'i'));
    if (explicit) return explicit[1];

    const plus = name.match(new RegExp(`\\+(${VERSION})(?=[-_+]|\\.jar$)`));
    if (plus) return plus[1];

    const tokens = name.replace(/\.jar$/i, '').match(new RegExp(`(?:^|[-_])(${VERSION})(?=[-_]|$)`, 'g'));
    if (tokens && tokens.length > 0) {
        return tokens[tokens.length - 1].replace(/^[-_]/, '');
    }

    return null;
};

const parseLoaderFromAssetName = (assetName) => {
    const match = String(assetName || '').match(OTHER_LOADER_PATTERN);
    return match ? match[2].toLowerCase() : 'fabric';
};

// Walks the releases newest first and keeps the newest jar per MC version + loader.
const collectBuildsFromReleases = (releases) => {
    const builds = new Map();
    const list = Array.isArray(releases) ? releases : [];

    for (const release of list) {
        if (!release || release.draft || release.prerelease) continue;
        const assets = Array.isArray(release.assets) ? release.assets : [];

        for (const asset of assets) {
            const mcVersion = parseMcVersionFromAssetName(asset?.name);
            if (!mcVersion || !asset?.browser_download_url) continue;

            const loader = parseLoaderFromAssetName(asset.name);
            const key = `${loader}:${mcVersion}`;
            if (builds.has(key)) continue;

            builds.set(key, {
                mcVersion,
                loader,
                tag: String(release.tag_name || release.name || 'latest'),
                assetName: asset.name,
                size: Number(asset.size) || 0,
                url: asset.browser_download_url
            });
        }
    }

    return [...builds.values()];
};

const findBuild = (builds, mcVersion, loader) => {
    const wantedLoader = String(loader || '').toLowerCase();
    const wantedVersion = String(mcVersion || '').trim();
    return (builds || []).find((build) => build.loader === wantedLoader && build.mcVersion === wantedVersion) || null;
};

const sanitizeFilePart = (value) => String(value || '')
    .replace(/[^a-z0-9._+-]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const buildInstalledFileName = (build) => {
    const tag = sanitizeFilePart(String(build?.tag || 'latest').replace(/^v(?=\d)/i, '')) || 'latest';
    const mcVersion = sanitizeFilePart(build?.mcVersion) || 'unknown';
    return `${INSTALLED_FILE_PREFIX}${tag}-mc${mcVersion}.jar`;
};

const isLuxModFileName = (fileName) => INSTALLED_FILE_PATTERN.test(String(fileName || ''));

module.exports = {
    LUX_MOD_REPO,
    FALLBACK_SUPPORTED_VERSIONS,
    SUPPORTED_LOADERS,
    INSTALLED_FILE_PREFIX,
    parseMcVersionFromAssetName,
    parseLoaderFromAssetName,
    collectBuildsFromReleases,
    findBuild,
    buildInstalledFileName,
    isLuxModFileName
};
