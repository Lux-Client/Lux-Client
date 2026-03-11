const { Client } = require('minecraft-launcher-core');
const path = require('path');
const { app } = require('electron');
const fs = require('fs-extra');
const Store = require('electron-store');
const store = new Store();
const backupManager = require('../backupManager');
const { getProcessStats } = require('../utils/process-utils');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('../utils/instances-path');
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
            const fallbackInstanceDir = path.join(resolvePrimaryInstancesDir(), instanceName);
            const instanceDir = resolveInstanceDirByName(instanceName) || fallbackInstanceDir;
            const configPath = path.join(instanceDir, 'instance.json');

            if (!await fs.pathExists(configPath)) return { success: false, error: 'Instance not found' };

            const config = await fs.readJson(configPath);

            const backupConfig = store.get('settings') || {};
            if (backupConfig.backupSettings?.enabled && backupConfig.backupSettings?.onLaunch) {
                console.log(`[Launcher] Triggering on-launch backup for ${instanceName}`);
                await backupManager.createBackup(instanceName).catch(err => {
                    console.error('[Launcher] On-launch backup failed:', err);
                });
            }

            if (backupConfig.backupSettings?.enabled && backupConfig.backupSettings?.interval > 0) {
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
                root: instanceDir,
                overrides: {
                    detached: false,
                    assetRoot: path.join(sharedDir, 'assets')
                },
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
                javaPath: opts.javaPath || 'default'
            });

            if (config.loader && config.loader.toLowerCase() === 'neoforge') {
                const neoForgeArgs = [
                    `-DlibraryDirectory=${path.join(instanceDir, 'libraries')}`,
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
                    return { success: false, error: `Instance configuration incomplete (missing versionId). Please reinstall ${instanceName}.` };
                }
                const specificVersionDir = path.join(instanceDir, 'versions', config.versionId);
                if (!await fs.pathExists(specificVersionDir)) {
                    return { success: false, error: `Mod loader files missing for ${config.versionId}. Please reinstall.` };
                }
            }

            const launcher = new Client();

            liveLogs.set(instanceName, []);
            if (config.preLaunchHook && config.preLaunchHook.trim()) {
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
                        const currentConfig = await fs.readJson(configPath);
                        currentConfig.playtime = (currentConfig.playtime || 0) + sessionTime;
                        currentConfig.lastPlayed = Date.now();
                        await fs.writeJson(configPath, currentConfig, { spaces: 4 });

                        const playtimePath = path.join(instanceDir, 'playtime.txt');
                        await fs.writeFile(playtimePath, String(currentConfig.playtime));

                        console.log(`[Launcher] Updated total playtime for ${instanceName}: ${currentConfig.playtime}ms`);

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
                if (settings.backupSettings?.enabled && settings.backupSettings?.onClose) {
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
