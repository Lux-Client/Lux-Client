// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// This mirrors the Java resolution the launcher does for the client, so servers pick up the
// same installed runtimes and the globally configured Java path instead of blindly using
// whatever `java` happens to be first on PATH. Kept as its own module so both sides can share
// it without importing launcher.js (which builds a full game launch on require).

const JAVA_DETECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const javaDetectionCache = new Map();

function parseMinecraftVersionForJava(mcVersion) {
    const raw = String(mcVersion || '').trim();
    const match = raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return { major: 0, minor: 0, patch: 0 };

    const first = Number.parseInt(match[1] || '0', 10);
    const second = Number.parseInt(match[2] || '0', 10);
    const third = Number.parseInt(match[3] || '0', 10);

    // Normalize both "1.20.6" and "20.6" style versioning.
    if (first === 1 && match[2]) return { major: second, minor: third, patch: 0 };
    return { major: first, minor: second, patch: third };
}

function getRequiredJavaVersion(mcVersion) {
    const parsed = parseMinecraftVersionForJava(mcVersion);
    if (parsed.major > 26 || (parsed.major === 26 && parsed.minor >= 1)) return 25;
    if (parsed.major >= 21) return 21;
    if (parsed.major === 20 && parsed.minor >= 5) return 21;
    if (parsed.major >= 17) return 17;
    return 8;
}

async function detectJavaVersion(javaBinaryPath) {
    const normalizedPath = String(javaBinaryPath || '').trim();
    const cacheKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    const cached = javaDetectionCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) <= JAVA_DETECTION_CACHE_TTL_MS) {
        return { ...cached.result };
    }

    try {
        const { stderr, stdout } = await execAsync(`"${javaBinaryPath}" -version`, {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 12000,
            maxBuffer: 256 * 1024
        });
        const output = stderr || stdout || '';
        const versionMatch = output.match(/(?:version|jd[kj])\s*["']?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
        if (!versionMatch) {
            const result = { success: false, version: 0, output };
            javaDetectionCache.set(cacheKey, { cachedAt: now, result });
            return { ...result };
        }

        let major = Number.parseInt(versionMatch[1], 10);
        if (major === 1) major = Number.parseInt(versionMatch[2] || '8', 10);

        const result = { success: true, version: major, output };
        javaDetectionCache.set(cacheKey, { cachedAt: now, result });
        return { ...result };
    } catch (e) {
        const result = { success: false, version: 0, output: '', error: e.message };
        javaDetectionCache.set(cacheKey, { cachedAt: now, result });
        return { ...result };
    }
}

async function findCompatibleJavaRuntime(requiredVersion, preferredPaths = []) {
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
        console.warn('[JavaResolver] Failed to scan internal runtimes:', e.message);
    }

    for (const candidate of candidates) {
        if (candidate !== 'java' && !await fs.pathExists(candidate)) continue;

        const detected = await detectJavaVersion(candidate);
        if (detected.success && detected.version >= requiredVersion) {
            return { found: true, path: candidate, version: detected.version };
        }
    }

    return { found: false };
}

// A configured path may point at java.exe/javaw.exe or at the runtime folder; accept either.
async function usableJavaPath(candidate) {
    const value = String(candidate || '').trim();
    if (!value) return null;
    if (value === 'java') return 'java';

    if (await fs.pathExists(value)) {
        const stat = await fs.stat(value).catch(() => null);
        if (stat && stat.isDirectory()) {
            const binName = process.platform === 'win32' ? 'java.exe' : 'java';
            const nested = path.join(value, 'bin', binName);
            return (await fs.pathExists(nested)) ? nested : null;
        }
        return value;
    }
    return null;
}

/**
 * Resolve the Java binary a server should launch with.
 * @param {object} opts
 * @param {string} opts.mcVersion   Minecraft version, drives auto-detection.
 * @param {string[]} opts.candidatePaths  Explicit paths in priority order (per-server, global, default).
 * @param {boolean} opts.autoDetect  Fall back to scanning installed runtimes by required version.
 * @returns {{ path: string, source: 'explicit'|'auto'|'fallback', version?: number, requiredVersion: number }}
 */
async function resolveServerJava({ mcVersion, candidatePaths = [], autoDetect = true }) {
    const requiredVersion = getRequiredJavaVersion(mcVersion);

    for (const candidate of candidatePaths) {
        const usable = await usableJavaPath(candidate);
        if (usable) return { path: usable, source: 'explicit', requiredVersion };
    }

    if (autoDetect) {
        const found = await findCompatibleJavaRuntime(requiredVersion, candidatePaths);
        if (found.found) return { path: found.path, source: 'auto', version: found.version, requiredVersion };
    }

    return { path: 'java', source: 'fallback', requiredVersion };
}

module.exports = {
    getRequiredJavaVersion,
    detectJavaVersion,
    findCompatibleJavaRuntime,
    resolveServerJava
};
