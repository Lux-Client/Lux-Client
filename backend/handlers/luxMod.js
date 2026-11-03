const axios = require('axios');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('../utils/instances-path');
const {
    LUX_MOD_REPO,
    FALLBACK_SUPPORTED_VERSIONS,
    SUPPORTED_LOADERS,
    collectBuildsFromReleases,
    findBuild,
    buildInstalledFileName,
    isLuxModFileName
} = require('../utils/luxModReleases');

const USER_AGENT = 'LuxAGENT/MinecraftLauncher/1.0';
const RELEASES_URL = `https://api.github.com/repos/${LUX_MOD_REPO}/releases?per_page=30`;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedBuilds = null;
let cachedAt = 0;
let pendingFetch = null;

const fetchBuilds = async (force = false) => {
    if (!force && cachedBuilds && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedBuilds;
    }
    if (pendingFetch) return pendingFetch;

    pendingFetch = (async () => {
        try {
            const response = await axios.get(RELEASES_URL, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
                timeout: 12000
            });
            cachedBuilds = collectBuildsFromReleases(response?.data);
            cachedAt = Date.now();
            return cachedBuilds;
        } finally {
            pendingFetch = null;
        }
    })();

    return pendingFetch;
};

// Supported versions come from the published jars. Without network (or before the
// first release) the launcher falls back to the versions the mod is built for.
const getSupportInfo = async (force = false) => {
    try {
        const builds = await fetchBuilds(force);
        if (builds.length > 0) {
            return {
                source: 'github',
                builds,
                versions: [...new Set(builds.filter((b) => SUPPORTED_LOADERS.includes(b.loader)).map((b) => b.mcVersion))]
            };
        }
        return { source: 'fallback', builds, versions: [...FALLBACK_SUPPORTED_VERSIONS] };
    } catch (error) {
        console.warn('[LuxMod] Could not load releases:', error.message);
        return { source: 'fallback', builds: cachedBuilds || [], versions: [...FALLBACK_SUPPORTED_VERSIONS], error: error.message };
    }
};

const readInstance = async (instanceName) => {
    const instanceDir = resolveInstanceDirByName(instanceName) || path.join(resolvePrimaryInstancesDir(), instanceName);
    const configPath = path.join(instanceDir, 'instance.json');
    if (!(await fs.pathExists(configPath))) {
        throw new Error('Instance not found');
    }
    const config = await fs.readJson(configPath);
    return {
        instanceDir,
        modsDir: path.join(instanceDir, 'mods'),
        mcVersion: String(config?.version || '').trim(),
        loader: String(config?.loader || 'vanilla').toLowerCase()
    };
};

const listInstalledLuxFiles = async (modsDir) => {
    if (!(await fs.pathExists(modsDir))) return [];
    const entries = await fs.readdir(modsDir);
    return entries.filter(isLuxModFileName);
};

const getStatus = async (instanceName, force = false) => {
    const instance = await readInstance(instanceName);
    const support = await getSupportInfo(force);
    const loaderSupported = SUPPORTED_LOADERS.includes(instance.loader);
    const supported = loaderSupported && support.versions.includes(instance.mcVersion);
    const installedFiles = await listInstalledLuxFiles(instance.modsDir);
    const build = loaderSupported ? findBuild(support.builds, instance.mcVersion, instance.loader) : null;
    const expectedFile = build ? buildInstalledFileName(build) : null;
    const activeFile = installedFiles.find((file) => !file.toLowerCase().endsWith('.disabled')) || null;

    return {
        success: true,
        supported,
        available: Boolean(build),
        installed: installedFiles.length > 0,
        disabled: installedFiles.length > 0 && !activeFile,
        installedFile: activeFile || installedFiles[0] || null,
        latestTag: build?.tag || null,
        updateAvailable: Boolean(build && activeFile && activeFile !== expectedFile),
        mcVersion: instance.mcVersion,
        loader: instance.loader
    };
};

const downloadJar = async (url, destination) => {
    const tempPath = path.join(os.tmpdir(), `lux-mod-${Date.now()}-${Math.random().toString(16).slice(2)}.jar`);
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 5
        });
        const data = Buffer.from(response.data);
        // A jar is a zip; anything else (HTML error page, empty body) must not land in mods/.
        if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
            throw new Error('Downloaded file is not a valid jar');
        }
        await fs.writeFile(tempPath, data);
        await fs.move(tempPath, destination, { overwrite: true });
    } finally {
        await fs.remove(tempPath).catch(() => {});
    }
};

const installLuxMod = async (instanceName) => {
    const instance = await readInstance(instanceName);
    if (!SUPPORTED_LOADERS.includes(instance.loader)) {
        return { success: false, error: 'Lux Client is only available for Fabric right now.' };
    }

    // Always ask GitHub fresh when installing so a new release is picked up right away.
    let builds;
    try {
        builds = await fetchBuilds(true);
    } catch (error) {
        return { success: false, error: `Could not reach the Lux Client releases: ${error.message}` };
    }

    const build = findBuild(builds, instance.mcVersion, instance.loader);
    if (!build) {
        return { success: false, error: `No Lux Client release for Minecraft ${instance.mcVersion} yet.` };
    }

    await fs.ensureDir(instance.modsDir);
    const fileName = buildInstalledFileName(build);
    const destination = path.join(instance.modsDir, fileName);
    const existing = await listInstalledLuxFiles(instance.modsDir);

    if (!existing.includes(fileName)) {
        await downloadJar(build.url, destination);
    }

    // Only one Lux Client jar per instance: drop older or disabled copies.
    for (const file of existing) {
        if (file !== fileName) {
            await fs.remove(path.join(instance.modsDir, file)).catch(() => {});
        }
    }

    console.log(`[LuxMod] Installed ${fileName} into ${instanceName}`);
    return { success: true, fileName, tag: build.tag, mcVersion: build.mcVersion };
};

module.exports = (ipcMain) => {
    ipcMain.handle('lux-mod:get-info', async (_, options = {}) => {
        const info = await getSupportInfo(Boolean(options?.force));
        return {
            success: true,
            source: info.source,
            versions: info.versions,
            loaders: [...SUPPORTED_LOADERS],
            repo: LUX_MOD_REPO
        };
    });

    ipcMain.handle('lux-mod:get-status', async (_, instanceName, options = {}) => {
        try {
            return await getStatus(instanceName, Boolean(options?.force));
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('lux-mod:install', async (_, instanceName) => {
        try {
            return await installLuxMod(instanceName);
        } catch (error) {
            console.error('[LuxMod] Install failed:', error);
            return { success: false, error: error.message };
        }
    });
};
