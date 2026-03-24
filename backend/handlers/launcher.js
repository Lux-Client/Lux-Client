const { Client } = require('minecraft-launcher-core');
const path = require('path');
const { app } = require('electron');
const fs = require('fs-extra');
const Store = require('electron-store');
const store = new Store();
const backupManager = require('../backupManager');
const { getProcessStats } = require('../utils/process-utils');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('../utils/instances-path');

function normalizeExternalRequestName(value) {
    return String(value || '').trim().toLowerCase();
}

function stripExternalSuffix(value) {
    return String(value || '')
        .replace(/\s+\((modrinth|curseforge)(?:\s+\d+)?\)$/i, '')
        .trim();
}

function getExternalLauncherRoots() {
    if (process.platform !== 'win32') return [];

    const homeDir = require('os').homedir();
    const roamingDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

    return [
        { source: 'modrinth', baseDir: path.join(homeDir, 'AppData', 'Roaming', 'ModrinthApp', 'profiles') },
        { source: 'modrinth', baseDir: path.join(roamingDir, 'com.modrinth.theseus', 'profiles') },
        { source: 'curseforge', baseDir: path.join(homeDir, 'curseforge', 'minecraft', 'Instances') }
    ];
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

function buildVersionIdCandidates({ version, loader, loaderVersion, explicitVersionId }) {
    const candidates = [];
    const addCandidate = (value) => {
        const candidate = String(value || '').trim();
        if (!candidate) return;
        if (!candidates.includes(candidate)) candidates.push(candidate);
    };

    addCandidate(explicitVersionId);

    if (!loader || loader === 'vanilla') {
        addCandidate(version);
        return candidates;
    }

    switch (loader) {
        case 'fabric':
            addCandidate(`fabric-loader-${loaderVersion}-${version}`);
            addCandidate(`fabric-${loaderVersion}-${version}`);
            addCandidate(`${version}-${loaderVersion}`);
            break;
        case 'quilt':
            addCandidate(`quilt-loader-${loaderVersion}-${version}`);
            addCandidate(`quilt-${loaderVersion}-${version}`);
            addCandidate(`${version}-${loaderVersion}`);
            break;
        case 'forge':
            addCandidate(`forge-${loaderVersion}`);
            addCandidate(`${version}-forge-${loaderVersion}`);
            addCandidate(`${version}-${loaderVersion}`);
            break;
        case 'neoforge':
            addCandidate(`neoforge-${loaderVersion}`);
            addCandidate(`${version}-neoforge-${loaderVersion}`);
            addCandidate(`${version}-${loaderVersion}`);
            break;
        default:
            addCandidate(`${loader}-${loaderVersion}-${version}`);
            addCandidate(`${version}-${loaderVersion}`);
            break;
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

    let bestMatch = '';
    let bestScore = -1;

    for (const versionName of versionNames) {
        const current = versionName.toLowerCase();
        let score = 0;

        if (version && current.includes(version)) score += 40;
        if (loaderVersion && current.includes(loaderVersion)) score += 35;
        if (loader && current.includes(loader)) score += 20;
        if (current.startsWith(version)) score += 10;
        if (current.startsWith(`${loader}-`) || current.includes(`-${loader}-`)) score += 10;

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

        const inheritedFrom = String(versionJson.inheritsFrom || '').trim();
        if (inheritedFrom && !visited.has(inheritedFrom)) {
            queue.push(inheritedFrom);
        }
    }

    return '';
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
        const availableVersions = await listDirectoryNames(versionsDir);
        const directVersionMatch = availableVersions.find((entry) => /^\d+\.\d+(?:\.\d+)?$/i.test(entry));
        if (directVersionMatch) version = directVersionMatch;
    }

    if (!loader) {
        loader = explicitVersionId ? normalizeLoaderFromString(explicitVersionId) : 'vanilla';
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

    if (config.assetIndex) {
        overrides.assetIndex = config.assetIndex;
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
    if (resolvedAssetIndex) {
        overrides.assetIndex = resolvedAssetIndex;
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

            const userProfile = store.get('user_profile');
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
                    user_properties: {}
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

            function getRequiredJavaVersion(mcVersion) {
                const v = mcVersion.split('.');
                const major = parseInt(v[0]);
                const minor = parseInt(v[1]);
                const patch = parseInt(v[2] || 0);

                if (minor >= 21) return 21;
                if (minor === 20 && patch >= 5) return 21;
                if (minor >= 17) return 17;
                return 8;
            }

            let javaValid = false;
            let javaVersion = 0;
            let javaOutput = '';

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const performJavaCheck = async (p) => {
                try {
                    const { stderr, stdout } = await execAsync(`"${p}" -version`, { encoding: 'utf8' });
                    javaOutput = stderr || stdout;

                    const versionMatch = javaOutput.match(/(?:version|jd[kj])\s*["']?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
                    if (versionMatch) {
                        let major = parseInt(versionMatch[1]);
                        if (major === 1) major = parseInt(versionMatch[2] || 8);
                        javaVersion = major;
                        console.log(`[Launcher] Detected Java version ${javaVersion} for ${p}`);
                    }

                    return true;
                } catch (e) {
                    console.error(`[Launcher] Java check failed for ${p}:`, e.message);
                    return false;
                }
            };

            let javaToCheck = opts.javaPath || 'java';
            javaValid = await performJavaCheck(javaToCheck);

            const reqVersion = getRequiredJavaVersion(config.version);

            if (javaValid && javaVersion < reqVersion) {
                console.warn(`[Launcher] Detected Java ${javaVersion} is too old for MC ${config.version} (requires ${reqVersion}).`);
                javaValid = false;
            }

            if (!javaValid) {
                const reqVersion = getRequiredJavaVersion(config.version);
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
                'IllegalAccessException',
                'NoClassDefFoundError',
                'java.lang.NoSuchMethodError',
                'Exception in thread "main"'
            ];

            const appendLog = (data) => {
                const line = data.toString();

                if (!logCrashDetected) {
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

            launcher.on('debug', (line) => appendLog(`[DEBUG] ${line}`));
            launcher.on('data', (line) => appendLog(line));
            launcher.on('stderr', (line) => appendLog(`[ERROR] ${line}`));
            launcher.on('progress', (e) => {
                mainWindow.webContents.send('launch:progress', { ...e, instanceName });
            });

            launcher.on('arguments', (e) => {
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

            launcher.on('close', async (code) => {
                console.log(`[Launcher] MC Process closed with code: ${code}, logCrashDetected: ${logCrashDetected}`);

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

                        const isShortSession = sessionTime < 15000;
                        const isCrash = (code !== 0 && code !== null) || logCrashDetected || isShortSession;

                        if (isCrash) {
                            console.log(`[Launcher] Crash/Early Exit detected for ${instanceName} (Exit code: ${code}, LogCrash: ${logCrashDetected}, Duration: ${sessionTime}ms).`);

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
                                logUrl: logUrl
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
