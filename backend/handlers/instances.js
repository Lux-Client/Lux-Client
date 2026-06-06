const fs = require('fs-extra');
const { Client } = require('minecraft-launcher-core');
const Store = require('electron-store');
const store = new Store();
const path = require('path');
const os = require('os');
const { app, ipcMain, shell, dialog } = require('electron');
const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const { spawn } = require('child_process');
const nbt = require('prismarine-nbt');
const {
    resolvePrimaryInstancesDir,
    getAllInstanceDirsSync,
    migrateLegacyInstancesToPrimarySync
} = require('../utils/instances-path');
const { downloadAndCacheIcon } = require('../utils/icon-cache');
let appData;
let instancesDir;
let globalBackupsDir;

function normalizeFolderPathValue(value = '') {
    const segments = String(value)
        .split(/[\\/]+/)
        .map(segment => segment.trim())
        .filter(segment => segment && segment !== '.' && segment !== '..');
    return segments.join('/');
}

function sanitizeActionLogToken(value, fallback = 'action') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || fallback;
}

function formatActionLogTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

async function writeInstanceActionLog(action, payload = {}) {
    try {
        const base = appData || app.getPath('userData');
        const logDir = path.join(base, 'instance-action-logs');
        await fs.ensureDir(logDir);

        const now = new Date();
        const actionToken = sanitizeActionLogToken(action, 'instance-action');
        const instanceToken = sanitizeActionLogToken(payload.instanceName || payload.name || '', 'global');
        const timestamp = formatActionLogTimestamp(now);
        const fileName = `${actionToken}-${instanceToken}-${timestamp}.log`;
        const filePath = path.join(logDir, fileName);

        const content = {
            action,
            instanceName: payload.instanceName || payload.name || null,
            createdAt: now.toISOString(),
            details: payload
        };

        await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
    } catch (error) {
        console.warn('[Instances] Failed to write instance action log:', error.message);
    }
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xEDB88320 & mask);
        }
    }
    return (crc ^ -1) >>> 0;
}

function makePngChunk(type, data) {
    const chunkType = Buffer.from(type, 'ascii');
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    const crcBuffer = Buffer.concat([chunkType, payload]);
    const crcValue = crc32(crcBuffer);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcValue, 0);
    return Buffer.concat([length, chunkType, payload, crc]);
}

async function recompressPngLossless(filePath) {
    const original = await fs.readFile(filePath);
    if (original.length < 12 || !original.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return { success: false, reason: 'not-png' };
    }

    let offset = 8;
    const rebuiltChunks = [];
    const idatBuffers = [];
    let hasIdat = false;

    while (offset + 12 <= original.length) {
        const length = original.readUInt32BE(offset);
        offset += 4;

        if (offset + 8 > original.length) break;

        const type = original.subarray(offset, offset + 4).toString('ascii');
        offset += 4;

        if (offset + length + 4 > original.length) break;

        const data = original.subarray(offset, offset + length);
        offset += length;

        const crc = original.subarray(offset, offset + 4);
        offset += 4;

        if (type === 'IDAT') {
            hasIdat = true;
            idatBuffers.push(Buffer.from(data));
            continue;
        }

        if (type === 'IEND') {
            break;
        }

        rebuiltChunks.push(Buffer.concat([
            Buffer.from([0, 0, 0, 0]),
            Buffer.from(type, 'ascii'),
            Buffer.from(data),
            Buffer.from(crc)
        ]));
        rebuiltChunks[rebuiltChunks.length - 1].writeUInt32BE(data.length, 0);
    }

    if (!hasIdat) {
        return { success: false, reason: 'missing-idat' };
    }

    const idatData = Buffer.concat(idatBuffers);
    const inflated = zlib.inflateSync(idatData);
    const recompressed = zlib.deflateSync(inflated, { level: 9 });

    const finalChunks = [];
    for (const chunk of rebuiltChunks) {
        finalChunks.push(chunk);
    }
    finalChunks.push(makePngChunk('IDAT', recompressed));
    finalChunks.push(makePngChunk('IEND', Buffer.alloc(0)));

    const rebuilt = Buffer.concat([PNG_SIGNATURE, ...finalChunks]);

    if (rebuilt.length >= original.length) {
        return {
            success: true,
            changed: false,
            beforeBytes: original.length,
            afterBytes: original.length,
            savedBytes: 0
        };
    }

    await fs.writeFile(filePath, rebuilt);
    return {
        success: true,
        changed: true,
        beforeBytes: original.length,
        afterBytes: rebuilt.length,
        savedBytes: original.length - rebuilt.length
    };
}

function getPackJunkReason(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (!lower) return null;
    if (lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini') return 'os-metadata';
    if (lower.endsWith('.psd') || lower.endsWith('.xcf') || lower.endsWith('.kra') || lower.endsWith('.clip')) return 'source-file';
    if (lower.endsWith('.bak') || lower.endsWith('.tmp')) return 'temporary-file';
    return null;
}

function normalizeTargetLoaderForTools(targetLoader, projectType) {
    if (isVisualMigrationProjectType(projectType)) return 'vanilla';
    return String(targetLoader || 'vanilla').trim().toLowerCase() || 'vanilla';
}

function normalizeProjectIdForComparison(projectId) {
    const raw = String(projectId || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.startsWith('modrinth:') || raw.startsWith('curseforge:')) return raw;
    if (/^\d+$/.test(raw)) return `curseforge:${raw}`;
    return `modrinth:${raw}`;
}

function parseNbtLong(value) {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value) && value.length >= 2) {
        const hi = Number(value[0] || 0);
        const lo = Number(value[1] || 0) >>> 0;
        return hi * 4294967296 + lo;
    }
    if (value && typeof value === 'object') {
        if (typeof value.low === 'number' && typeof value.high === 'number') {
            return (Number(value.high) * 4294967296) + (Number(value.low) >>> 0);
        }
        if (typeof value.value === 'number') return value.value;
    }
    return null;
}

function extractSeedFromLevelDat(data) {
    const randomSeed = parseNbtLong(data?.RandomSeed?.value);
    if (Number.isFinite(randomSeed)) return randomSeed;

    const worldGenSettings = data?.WorldGenSettings?.value;
    const worldSeed = parseNbtLong(worldGenSettings?.seed?.value);
    if (Number.isFinite(worldSeed)) return worldSeed;

    return null;
}

async function listFilesRecursive(baseDir) {
    const files = [];
    const stack = [baseDir];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(absolute);
            } else if (entry.isFile()) {
                files.push(absolute);
            }
        }
    }

    return files;
}

function toRelativePackPath(baseDir, absolutePath) {
    const rel = path.relative(baseDir, absolutePath);
    return rel.split(path.sep).join('/');
}

function normalizeWorldFolderName(name, fallback = 'WorldClone') {
    const normalized = String(name || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\.+$/, '')
        .replace(/\s+/g, ' ');
    return normalized || fallback;
}

function getInstanceFolderMetaPath() {
    const base = appData || app.getPath('userData');
    return path.join(base, 'instance_folder_meta.json');
}

async function readInstanceFolderMeta() {
    try {
        const metaPath = getInstanceFolderMetaPath();
        if (!await fs.pathExists(metaPath)) return {};
        const data = await fs.readJson(metaPath);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        return data;
    } catch (e) {
        console.warn('[Instances] Failed to read folder metadata:', e.message);
        return {};
    }
}

async function writeInstanceFolderMeta(meta) {
    const metaPath = getInstanceFolderMetaPath();
    await fs.writeJson(metaPath, meta, { spaces: 2 });
}

function buildInstanceFolderMetaKey(instance) {
    const instanceType = String(instance?.instanceType || '').trim().toLowerCase();
    const name = String(instance?.name || '').trim().toLowerCase();
    const source = String(instance?.externalSource || 'external').trim().toLowerCase();
    const externalPath = String(instance?.externalPath || '').trim().toLowerCase();

    if (instanceType === 'external') {
        return `external:${source}:${externalPath || name}`;
    }

    return `local:${name}`;
}


async function resolveInstanceBaseDir(instanceName) {
    const normalizedName = String(instanceName || '').trim().toLowerCase();
    let externalInstance = null;

    try {
        const mergedInstances = await getMergedInstances();
        externalInstance = mergedInstances.find((entry) => {
            const entryName = String(entry?.name || '').trim().toLowerCase();
            return entryName === normalizedName && String(entry?.instanceType || '').toLowerCase() === 'external';
        }) || null;
    } catch (e) {
        // If merged instance lookup fails we still fall back to local path lookup.
    }

    const externalPath = String(externalInstance?.externalPath || '').trim();
    if (externalPath) {
        return {
            baseDir: externalPath,
            externalInstance,
            isExternal: true
        };
    }

    return {
        baseDir: path.join(instancesDir, instanceName),
        externalInstance: null,
        isExternal: false
    };
}

function isPathWithinBaseDir(targetPath, baseDir) {
    const normalizedTarget = path.resolve(targetPath);
    const normalizedBase = path.resolve(baseDir);

    if (process.platform === 'win32') {
        return normalizedTarget.toLowerCase().startsWith(normalizedBase.toLowerCase());
    }

    return normalizedTarget.startsWith(normalizedBase);
}

async function resolveInstanceTargetPath(instanceName, relativePath = '') {
    const { baseDir } = await resolveInstanceBaseDir(instanceName);
    const safeRelative = String(relativePath || '').replace(/^[/\\]+/, '');
    const targetPath = path.resolve(path.join(baseDir, safeRelative));

    if (!isPathWithinBaseDir(targetPath, baseDir)) {
        throw new Error('Access denied');
    }

    return {
        baseDir: path.resolve(baseDir),
        targetPath
    };
}

function normalizeLoaderFromString(value) {
    let candidate = value;

    if (candidate && typeof candidate === 'object') {
        candidate = candidate.name || candidate.id || candidate.loader || candidate.type || '';
    }

    const raw = String(candidate || '').trim().toLowerCase();

    if (!raw) return '';
    if (raw.includes('fabric')) return 'fabric';
    if (raw.includes('quilt')) return 'quilt';
    if (raw.includes('neoforge') || raw.startsWith('neo')) return 'neoforge';
    if (raw.includes('forge')) return 'forge';
    return raw;
}

function inferLoaderFromName(name) {
    const raw = String(name || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes('neoforge') || raw.includes('neo forge')) return 'neoforge';
    if (raw.includes('forge')) return 'forge';
    if (raw.includes('fabric')) return 'fabric';
    if (raw.includes('quilt')) return 'quilt';
    return '';
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
        } catch (e) {
            // Ignore scan errors and continue to next candidate root.
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
        } catch (e) {
            // Ignore log parsing failures and continue.
        }
    }

    return '';
}

async function inferPlaytimeFromWorldStats(profileDir) {
    const savesDir = path.join(profileDir, 'saves');
    if (!await fs.pathExists(savesDir)) return 0;

    let totalTicks = 0;
    let worldEntries = [];

    try {
        worldEntries = await fs.readdir(savesDir, { withFileTypes: true });
    } catch (e) {
        return 0;
    }

    for (const worldEntry of worldEntries) {
        if (!worldEntry.isDirectory()) continue;

        const statsDir = path.join(savesDir, worldEntry.name, 'stats');
        if (!await fs.pathExists(statsDir)) continue;

        let statFiles = [];
        try {
            statFiles = await fs.readdir(statsDir, { withFileTypes: true });
        } catch (e) {
            continue;
        }

        let worldMaxTicks = 0;
        for (const statFile of statFiles) {
            if (!statFile.isFile() || !String(statFile.name).toLowerCase().endsWith('.json')) continue;

            try {
                const statPath = path.join(statsDir, statFile.name);
                const statData = await fs.readJson(statPath);
                const customStats = statData?.stats?.['minecraft:custom'] || {};

                const ticks = parseFiniteNumber(
                    customStats['minecraft:play_time'] ||
                    customStats['minecraft:play_one_minute'] ||
                    0
                ) || 0;

                if (ticks > worldMaxTicks) {
                    worldMaxTicks = ticks;
                }
            } catch (e) {
                // Ignore invalid stat JSON entries.
            }
        }

        totalTicks += worldMaxTicks;
    }

    // Minecraft stat ticks are 20 ticks per second.
    return Math.max(0, Math.round(totalTicks * 50));
}

async function inferLastPlayedFromProfileActivity(profileDir) {
    const candidates = [
        path.join(profileDir, 'logs', 'latest.log'),
        path.join(profileDir, 'logs', 'launcher_log.txt'),
        path.join(profileDir, 'saves')
    ];

    let latest = 0;
    for (const candidatePath of candidates) {
        try {
            if (!await fs.pathExists(candidatePath)) continue;
            const stats = await fs.stat(candidatePath);
            if (stats.mtimeMs > latest) {
                latest = stats.mtimeMs;
            }
        } catch (e) {
            // Ignore and continue.
        }
    }

    return latest > 0 ? latest : null;
}

function parseFiniteNumber(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestampMs(value) {
    const parsed = parseFiniteNumber(value);
    if (parsed !== null && parsed > 0) {
        // If this looks like seconds, convert to milliseconds.
        if (parsed < 1e12) return parsed * 1000;
        return parsed;
    }

    const dateParsed = Date.parse(String(value || ''));
    if (Number.isFinite(dateParsed) && dateParsed > 0) {
        return dateParsed;
    }

    return null;
}

function getMimeTypeFromImagePath(filePath) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.svg') return 'image/svg+xml';
    return '';
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

async function readImageAsDataUrl(imagePath) {
    if (!imagePath) return '';
    const exists = await fs.pathExists(imagePath);
    if (!exists) return '';

    const stat = await fs.stat(imagePath);
    if (!stat.isFile()) return '';

    const mimeType = getMimeTypeFromImagePath(imagePath);
    if (!mimeType) return '';

    const fileBuffer = await fs.readFile(imagePath);
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
}

function normalizeExternalIconCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (raw.startsWith('data:')) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;

    const cleaned = raw
        .replace(/^file:\/\//i, '')
        .replace(/^\\?\/+/, '')
        .replace(/^\.\//, '');

    return cleaned;
}

async function resolveExternalProfileIcon(source, profileDir, profile) {
    const normalizedSource = String(source || '').toLowerCase();
    const candidates = [];
    const addCandidate = (value) => {
        const candidate = normalizeExternalIconCandidate(value);
        if (candidate) candidates.push(candidate);
    };

    if (normalizedSource === 'modrinth') {
        addCandidate(profile?.icon_path);
        addCandidate(profile?.iconPath);
        addCandidate(profile?.icon_url);
        addCandidate(profile?.iconUrl);
        addCandidate(profile?.icon);
    }

    if (normalizedSource === 'curseforge') {
        addCandidate(profile?.profileImagePath);
        addCandidate(profile?.installedModpack?.thumbnailUrl);
        addCandidate(profile?.manifest?.thumbnailUrl);
        addCandidate(profile?.thumbnailUrl);
    }

    const localIconNames = [
        'icon.png',
        'icon.jpg',
        'icon.jpeg',
        'icon.webp',
        'pack.png',
        'pack.jpg',
        'pack.jpeg',
        'pack.webp',
        'logo.png',
        'logo.jpg',
        'logo.jpeg',
        'logo.webp'
    ];

    for (const fileName of localIconNames) {
        candidates.push(path.join(profileDir, fileName));
    }

    for (const candidate of candidates) {
        if (candidate.startsWith('data:') || /^https?:\/\//i.test(candidate)) {
            return candidate;
        }

        const candidatePath = path.isAbsolute(candidate)
            ? candidate
            : path.join(profileDir, candidate);

        try {
            const dataUrl = await readImageAsDataUrl(candidatePath);
            if (dataUrl) {
                return dataUrl;
            }
        } catch (e) {
            // Ignore icon read errors and continue with next candidate.
        }
    }

    return '';
}

function getExternalLauncherRoots() {
    if (process.platform !== 'win32') {
        return [];
    }

    const homeDir = os.homedir();
    const roamingDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

    const defaults = [
        {
            source: 'modrinth',
            baseDir: path.join(homeDir, 'AppData', 'Roaming', 'ModrinthApp', 'profiles')
        },
        {
            source: 'modrinth',
            baseDir: path.join(roamingDir, 'com.modrinth.theseus', 'profiles')
        },
        {
            source: 'curseforge',
            baseDir: path.join(homeDir, 'curseforge', 'minecraft', 'Instances')
        }
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

async function readExternalProfileConfig(source, profileDir, fallbackName) {
    const fallbackConfig = {
        name: fallbackName,
        version: '',
        loader: '',
        instanceType: 'external',
        externalSource: source,
        externalManaged: true,
        externalPath: profileDir
    };

    if (source === 'modrinth') {
        const profilePath = path.join(profileDir, 'profile.json');
        let profile = null;

        const profileExists = await fs.pathExists(profilePath);

        if (profileExists) {
            try {
                profile = await fs.readJson(profilePath);
            } catch (e) {
                console.error(`[readExternalProfileConfig:modrinth] Error reading profile.json:`, e.message);
            }
        }

        const hasFabricMarker = await fs.pathExists(path.join(profileDir, '.fabric'));
        const hasQuiltMarker = await fs.pathExists(path.join(profileDir, '.quilt'));
        const metadata = profile && typeof profile.metadata === 'object' ? profile.metadata : {};

        const inferredLoaderFromName = inferLoaderFromName(fallbackName);
        const loaderFromProfile = normalizeLoaderFromString(
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

        let detectedLoader = '';
        if (hasFabricMarker) {
            detectedLoader = 'fabric';
        } else if (hasQuiltMarker) {
            detectedLoader = 'quilt';
        } else if (loaderFromProfile) {
            detectedLoader = loaderFromProfile;
        } else if (inferredLoaderFromName) {
            detectedLoader = inferredLoaderFromName;
        } else {
            // If absolutely nothing found, assume vanilla
            detectedLoader = 'vanilla';
        }

        let version = String(
            profile?.game_version ||
            profile?.gameVersion ||
            profile?.minecraft_version ||
            profile?.minecraftVersion ||
            metadata?.game_version ||
            metadata?.gameVersion ||
            metadata?.minecraft_version ||
            metadata?.minecraftVersion ||
            inferVersionFromName(fallbackName) ||
            ''
        ).trim();

        if (!version) {
            version = await inferVersionFromProfileDirectory(profileDir);
        }

        if (!version) {
            version = await inferVersionFromProfileLogs(profileDir);
        }

        const playtime = parseFiniteNumber(
            profile?.playtime ||
            profile?.time_played ||
            profile?.timePlayed ||
            profile?.submitted_time_played ||
            profile?.submittedTimePlayed ||
            metadata?.playtime ||
            metadata?.time_played ||
            metadata?.timePlayed ||
            profile?.recent_time_played ||
            profile?.recentTimePlayed ||
            0
        ) || 0;

        const lastPlayed = normalizeTimestampMs(
            profile?.last_played ||
            profile?.lastPlayed ||
            profile?.last_played_at ||
            profile?.lastPlayedAt ||
            profile?.date_modified ||
            profile?.dateModified ||
            metadata?.last_played ||
            metadata?.lastPlayed ||
            metadata?.last_played_at ||
            metadata?.lastPlayedAt ||
            metadata?.date_modified ||
            metadata?.dateModified ||
            null
        );

        let resolvedPlaytime = playtime;
        if (resolvedPlaytime <= 0) {
            resolvedPlaytime = await inferPlaytimeFromWorldStats(profileDir);
        }

        let resolvedLastPlayed = lastPlayed;
        if (!resolvedLastPlayed) {
            resolvedLastPlayed = await inferLastPlayedFromProfileActivity(profileDir);
        }

        const name = String(profile?.name || fallbackName || '').trim() || fallbackName;
        const icon = await resolveExternalProfileIcon(source, profileDir, profile);

        // IMPORTANT: Return config even if profile.json doesn't exist
        return {
            ...fallbackConfig,
            name: name,
            version: version,
            loader: detectedLoader,
            playtime: resolvedPlaytime,
            lastPlayed: resolvedLastPlayed,
            icon: icon || null
        };
    }

    if (source === 'curseforge') {
        const instancePath = path.join(profileDir, 'minecraftinstance.json');

        const exists = await fs.pathExists(instancePath);

        if (!exists) {
            return null;
        }

        let profile;
        try {
            profile = await fs.readJson(instancePath);
        } catch (e) {
            console.error(`[readExternalProfileConfig:curseforge] Error reading JSON:`, e.message);
            return null;
        }

        // Extract loader - safely handle baseModLoader as object
        let loaderValue = '';
        if (profile?.baseModLoader) {
            // Try .name first - most reliable
            if (profile.baseModLoader.name) {
                loaderValue = profile.baseModLoader.name;
            }
            // Try .forgeVersion for forge
            else if (profile.baseModLoader.forgeVersion) {
                loaderValue = `forge-${profile.baseModLoader.forgeVersion}`;
            }
            // Try .id as fallback
            else if (profile.baseModLoader.id) {
                loaderValue = profile.baseModLoader.id;
            }
        }

        // Fallback to other fields
        if (!loaderValue) {
            loaderValue = profile?.modLoader?.name || profile?.modLoader || profile?.modloader || '';
        }

        const minecraftVersion = String(profile?.minecraftVersion || profile?.gameVersion || profile?.baseModLoader?.minecraftVersion || '').trim();

        const normalizedLoader = normalizeLoaderFromString(loaderValue);
        const icon = await resolveExternalProfileIcon(source, profileDir, profile);

        return {
            ...fallbackConfig,
            name: String(profile?.name || fallbackName || '').trim() || fallbackName,
            version: minecraftVersion,
            loader: String(normalizedLoader || '').trim(),  // Force to string
            icon: icon || null
        };
    }

    return null;
}

async function discoverExternalProfiles() {
    const results = [];

    const launcherRoots = getExternalLauncherRoots();

    for (const launcherRoot of launcherRoots) {
        const { source, baseDir } = launcherRoot;

        const dirExists = await fs.pathExists(baseDir);

        if (!dirExists) {
            continue;
        }

        let entries = [];
        try {
            entries = await fs.readdir(baseDir, { withFileTypes: true });
        } catch (err) {
            console.error(`[discoverExternalProfiles] Error reading directory:`, err.message);
            continue;
        }

        let dirCount = 0;
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            dirCount++;

            const profileDir = path.join(baseDir, entry.name);

            try {
                const externalConfig = await readExternalProfileConfig(source, profileDir, entry.name);
                if (externalConfig) {
                    results.push(externalConfig);
                }
            } catch (error) {
                console.error(`[discoverExternalProfiles] Error reading ${source} profile ${entry.name}:`, error.message);
            }
        }
    }
    return results;
}

async function getMergedInstances() {
    instancesDir = resolvePrimaryInstancesDir();
    const baseDirs = getAllInstanceDirsSync();
    const instancesByName = new Map();
    const folderMeta = await readInstanceFolderMeta();

    for (const baseDir of baseDirs) {
        if (!await fs.pathExists(baseDir)) continue;

        const dirs = await fs.readdir(baseDir);
        for (const dir of dirs) {
            const configPath = path.join(baseDir, dir, 'instance.json');
            if (!await fs.pathExists(configPath)) continue;

            try {
                const config = await fs.readJson(configPath);
                const instanceType = typeof config?.instanceType === 'string' ? config.instanceType.trim().toLowerCase() : '';
                const loader = String(config?.loader || '').trim().toLowerCase();
                const instanceName = String(config?.name || dir).trim().toLowerCase();
                if (!instanceType && loader === 'fabric' && instanceName.startsWith('client ')) {
                    config.instanceType = 'open-client';
                }

                const key = config?.name || dir;
                const folderMetaKey = buildInstanceFolderMetaKey(config);
                const metaFolderPath = normalizeFolderPathValue(folderMeta[folderMetaKey]);
                const configFolderPath = normalizeFolderPathValue(config?.folderPath);
                if (configFolderPath) {
                    config.folderPath = configFolderPath;
                } else if (metaFolderPath) {
                    config.folderPath = metaFolderPath;
                }
                if (!instancesByName.has(key)) {
                    instancesByName.set(key, config);
                }
            } catch (e) {
                console.error(`Failed to read instance config for ${dir}:`, e);
            }
        }
    }

    const externalProfiles = await discoverExternalProfiles();
    for (const profile of externalProfiles) {
        const baseName = String(profile?.name || '').trim();
        if (!baseName) continue;

        const source = String(profile?.externalSource || 'external').toLowerCase();
        const sourceLabel = source === 'modrinth'
            ? 'Modrinth'
            : source === 'curseforge'
                ? 'CurseForge'
                : 'External';

        let displayName = baseName;
        let suffixIndex = 1;
        while (instancesByName.has(displayName)) {
            const suffix = suffixIndex === 1 ? ` (${sourceLabel})` : ` (${sourceLabel} ${suffixIndex})`;
            displayName = `${baseName}${suffix}`;
            suffixIndex += 1;
        }

        instancesByName.set(displayName, {
            ...profile,
            name: displayName,
            folderPath: normalizeFolderPathValue(folderMeta[buildInstanceFolderMetaKey({
                ...profile,
                name: displayName
            })])
        });
    }

    return Array.from(instancesByName.values());
}

let mergedInstancesCache = [];
let mergedInstancesCacheAt = 0;
let mergedInstancesRefreshPromise = null;
const MERGED_INSTANCES_CACHE_TTL_MS = 4000;

function getCachedMergedInstances() {
    return Array.isArray(mergedInstancesCache) ? [...mergedInstancesCache] : [];
}

function setCachedMergedInstances(instances) {
    mergedInstancesCache = Array.isArray(instances) ? [...instances] : [];
    mergedInstancesCacheAt = Date.now();
}

function invalidateMergedInstancesCache() {
    mergedInstancesCacheAt = 0;
    mergedInstancesCache = [];
}

async function refreshMergedInstancesCache(force = false) {
    const isFresh = (Date.now() - mergedInstancesCacheAt) < MERGED_INSTANCES_CACHE_TTL_MS;
    if (!force && isFresh && mergedInstancesCache.length > 0) {
        return getCachedMergedInstances();
    }

    if (mergedInstancesRefreshPromise) {
        return mergedInstancesRefreshPromise;
    }

    mergedInstancesRefreshPromise = (async () => {
        const merged = await getMergedInstances();
        setCachedMergedInstances(merged);
        return getCachedMergedInstances();
    })();

    try {
        return await mergedInstancesRefreshPromise;
    } finally {
        mergedInstancesRefreshPromise = null;
    }
}

async function calculateSha1(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha1');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_META = 'https://meta.modrinth.com/forge/v0';
const NEOFORGE_META = 'https://meta.modrinth.com/neo/v0';
const CURSEFORGE_API = 'https://api.curse.tools/v1/cf';
const API_USER_AGENT = 'Client/Lux/1.0 (fernsehheft@pluginhub.de)';
const CURSEFORGE_PROJECT_PREFIX = 'curseforge:';
const MODRINTH_PROJECT_PREFIX = 'modrinth:';
const activeTasks = new Map();

const CURSEFORGE_CLASS_BY_PROJECT_TYPE = {
    mod: 6,
    resourcepack: 12,
    shader: 6552
};

const CURSEFORGE_AUTOINSTALL_LOADER_ALIASES = {
    forge: ['forge'],
    neoforge: ['neoforge', 'neo forge'],
    fabric: ['fabric'],
    quilt: ['quilt'],
    paper: ['paper', 'spigot', 'bukkit', 'purpur', 'folia'],
    spigot: ['spigot', 'paper', 'bukkit', 'purpur', 'folia'],
    bukkit: ['bukkit', 'paper', 'spigot', 'purpur', 'folia'],
    purpur: ['purpur', 'paper', 'spigot', 'bukkit', 'folia'],
    folia: ['folia', 'paper', 'spigot', 'bukkit', 'purpur'],
    vanilla: []
};

const parseAutoInstallModEntry = (entry) => {
    const raw = String(entry || '').trim();
    if (!raw) {
        return { source: 'modrinth', projectId: '' };
    }

    if (raw.startsWith(CURSEFORGE_PROJECT_PREFIX)) {
        return {
            source: 'curseforge',
            projectId: raw.slice(CURSEFORGE_PROJECT_PREFIX.length)
        };
    }

    if (raw.startsWith(MODRINTH_PROJECT_PREFIX)) {
        return {
            source: 'modrinth',
            projectId: raw.slice(MODRINTH_PROJECT_PREFIX.length)
        };
    }

    return { source: 'modrinth', projectId: raw };
};

const isCurseForgeAutoInstallLoaderCompatible = (file, loader) => {
    const normalizedLoader = String(loader || '').toLowerCase();
    if (!normalizedLoader || normalizedLoader === 'vanilla') return true;

    const aliases = CURSEFORGE_AUTOINSTALL_LOADER_ALIASES[normalizedLoader] || [normalizedLoader];
    const gameVersions = Array.isArray(file?.gameVersions)
        ? file.gameVersions.map((entry) => String(entry || '').toLowerCase())
        : [];

    return aliases.some(alias => gameVersions.includes(alias));
};

const buildGameVersionAliases = (mcVersion) => {
    const value = String(mcVersion || '').trim();
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
};

const isCurseForgeAutoInstallVersionCompatible = (file, mcVersionOrVersions) => {
    const expectedVersions = Array.isArray(mcVersionOrVersions)
        ? mcVersionOrVersions.map((entry) => String(entry || '').toLowerCase()).filter(Boolean)
        : buildGameVersionAliases(mcVersionOrVersions).map((entry) => entry.toLowerCase()).filter(Boolean);

    if (expectedVersions.length === 0) return true;

    const gameVersions = Array.isArray(file?.gameVersions)
        ? file.gameVersions.map((entry) => String(entry || '').toLowerCase())
        : [];

    return expectedVersions.some((entry) => gameVersions.includes(entry));
};

const normalizeMigrationProjectType = (projectType) => {
    const normalized = String(projectType || '').toLowerCase().trim();
    if (normalized === 'shaderpack' || normalized === 'shader_pack') return 'shader';
    if (normalized === 'resource_pack' || normalized === 'texturepack' || normalized === 'texture_pack') return 'resourcepack';
    return normalized || 'mod';
};

const getMigrationFolderForProjectType = (projectType) => {
    const normalizedType = normalizeMigrationProjectType(projectType);
    if (normalizedType === 'resourcepack') return 'resourcepacks';
    if (normalizedType === 'shader') return 'shaderpacks';
    return 'mods';
};

const isVisualMigrationProjectType = (projectType) => {
    const normalizedType = normalizeMigrationProjectType(projectType);
    return normalizedType === 'resourcepack' || normalizedType === 'shader';
};

const getCurseForgeClassIdForMigration = (projectType) => {
    const normalizedType = normalizeMigrationProjectType(projectType);
    return CURSEFORGE_CLASS_BY_PROJECT_TYPE[normalizedType] || CURSEFORGE_CLASS_BY_PROJECT_TYPE.mod;
};

const normalizeCurseForgeProjectIdForMigration = (projectId) => {
    const raw = String(projectId || '').trim();
    if (!raw) return NaN;
    if (raw.startsWith(CURSEFORGE_PROJECT_PREFIX)) {
        return Number.parseInt(raw.slice(CURSEFORGE_PROJECT_PREFIX.length), 10);
    }
    return Number.parseInt(raw, 10);
};

const normalizeMigrationSearchQuery = (entry) => {
    const source = String(entry?.title || entry?.name || '').trim();
    if (!source) return '';

    return source
        .replace(/\.(jar|jar\.disabled|zip|rar)$/i, '')
        .replace(/[._-]+/g, ' ')
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(v?\d+(?:\.\d+){1,3}[a-z0-9-]*)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const createMigrationEntryId = (entry) => `${normalizeMigrationProjectType(entry?.projectType)}:${String(entry?.name || '').toLowerCase()}`;

const readMigrationContentEntries = async (instanceDir, projectType, modCache) => {
    const normalizedType = normalizeMigrationProjectType(projectType);
    const folder = getMigrationFolderForProjectType(normalizedType);
    const contentDir = path.join(instanceDir, folder);

    if (!await fs.pathExists(contentDir)) return [];

    const dirents = await fs.readdir(contentDir, { withFileTypes: true });
    const entries = [];

    for (const dirent of dirents) {
        const name = dirent.name;
        const absolutePath = path.join(contentDir, name);

        const includeEntry = (() => {
            if (normalizedType === 'mod') {
                return dirent.isFile() && (name.endsWith('.jar') || name.endsWith('.jar.disabled') || name.endsWith('.litemod'));
            }
            if (normalizedType === 'resourcepack') {
                return dirent.isDirectory() || /\.(zip|rar)$/i.test(name);
            }
            if (normalizedType === 'shader') {
                return dirent.isDirectory() || /\.zip$/i.test(name);
            }
            return false;
        })();

        if (!includeEntry) continue;

        let stats;
        try {
            stats = await fs.stat(absolutePath);
        } catch {
            continue;
        }

        const cacheKey = `${name}-${stats.size}`;
        const cacheEntry = (modCache && typeof modCache === 'object') ? (modCache[cacheKey] || null) : null;

        entries.push({
            projectType: normalizedType,
            folder,
            name,
            title: cacheEntry?.title || name,
            path: absolutePath,
            size: stats.size,
            isDirectory: dirent.isDirectory(),
            cacheKey,
            projectId: cacheEntry?.projectId || null,
            versionId: cacheEntry?.versionId || null,
            source: String(cacheEntry?.source || '').toLowerCase() || 'modrinth'
        });
    }

    return entries;
};

const resolveCurseForgeCandidateByProjectId = async (projectId, projectType, targetLoader, versionAliases) => {
    const numericProjectId = normalizeCurseForgeProjectIdForMigration(projectId);
    if (!Number.isFinite(numericProjectId)) {
        return { success: false, reason: 'invalid-project-id' };
    }

    let files = [];
    try {
        const filesRes = await axios.get(`${CURSEFORGE_API}/mods/${numericProjectId}/files`, {
            params: {
                pageSize: 100,
                index: 0
            },
            headers: {
                'User-Agent': API_USER_AGENT
            },
            timeout: 10000
        });
        files = Array.isArray(filesRes?.data?.data) ? filesRes.data.data : [];
    } catch {
        return { success: false, reason: 'api-error' };
    }

    if (files.length === 0) {
        return { success: false, reason: 'no-files' };
    }

    const compatibleFiles = files
        .filter(file => isCurseForgeAutoInstallLoaderCompatible(file, targetLoader))
        .filter(file => isCurseForgeAutoInstallVersionCompatible(file, versionAliases))
        .sort((left, right) => new Date(right?.fileDate || 0).getTime() - new Date(left?.fileDate || 0).getTime());

    const selectedFile = compatibleFiles[0];
    if (!selectedFile || !selectedFile.downloadUrl) {
        return { success: false, reason: 'unsupported-version' };
    }

    return {
        success: true,
        source: 'curseforge',
        projectId: `curseforge:${numericProjectId}`,
        versionId: `cf-file:${selectedFile.id}`,
        versionLabel: selectedFile.displayName || selectedFile.fileName || `File ${selectedFile.id}`,
        fileName: selectedFile.fileName || `${numericProjectId}-${selectedFile.id}.jar`,
        downloadUrl: selectedFile.downloadUrl
    };
};

const searchCurseForgeProjectForMigration = async (entry, projectType) => {
    const query = normalizeMigrationSearchQuery(entry);
    if (!query || query.length < 2) return { success: false, reason: 'missing-query' };

    const classId = getCurseForgeClassIdForMigration(projectType);
    try {
        const response = await axios.get(`${CURSEFORGE_API}/mods/search`, {
            params: {
                gameId: 432,
                classId,
                searchFilter: query,
                pageSize: 10,
                index: 0,
                sortField: 6,
                sortOrder: 'desc'
            },
            headers: {
                'User-Agent': API_USER_AGENT
            },
            timeout: 10000
        });

        const results = Array.isArray(response?.data?.data) ? response.data.data : [];
        if (results.length === 0) {
            return { success: false, reason: 'not-found' };
        }

        const best = results[0];
        if (!Number.isFinite(Number(best?.id))) {
            return { success: false, reason: 'invalid-response' };
        }

        return {
            success: true,
            projectId: Number(best.id)
        };
    } catch {
        return { success: false, reason: 'api-error' };
    }
};

const resolveModrinthCandidateForMigration = async ({ projectId, projectType, targetLoader, versionAliases }) => {
    const normalizedProjectId = String(projectId || '').startsWith(MODRINTH_PROJECT_PREFIX)
        ? String(projectId || '').slice(MODRINTH_PROJECT_PREFIX.length)
        : String(projectId || '').trim();

    if (!normalizedProjectId) {
        return { success: false, reason: 'missing-project-id' };
    }

    const isVisualType = isVisualMigrationProjectType(projectType);
    const queryVariants = isVisualType
        ? [
            { game_versions: JSON.stringify(versionAliases) },
            {}
        ]
        : [
            {
                loaders: JSON.stringify([targetLoader]),
                game_versions: JSON.stringify(versionAliases)
            }
        ];

    for (const params of queryVariants) {
        try {
            const versionsRes = await axios.get(`https://api.modrinth.com/v2/project/${normalizedProjectId}/version`, {
                params,
                headers: {
                    'User-Agent': API_USER_AGENT
                },
                timeout: 10000
            });

            const versions = Array.isArray(versionsRes?.data) ? versionsRes.data : [];
            if (versions.length === 0) {
                continue;
            }

            const latest = versions[0];
            const primaryFile = latest.files?.find(file => file.primary) || latest.files?.[0];
            if (!primaryFile?.url || !primaryFile?.filename) {
                continue;
            }

            return {
                success: true,
                source: 'modrinth',
                projectId: `modrinth:${normalizedProjectId}`,
                versionId: latest.id,
                versionLabel: latest.version_number || latest.name || latest.id,
                fileName: primaryFile.filename,
                downloadUrl: primaryFile.url,
                resolvedProjectId: normalizedProjectId
            };
        } catch {
            continue;
        }
    }

    return { success: false, reason: 'unsupported-version' };
};

const resolveMigrationCandidateForEntry = async (entry, targetVersion, targetLoader) => {
    const normalizedType = normalizeMigrationProjectType(entry?.projectType);
    const resolvedLoader = isVisualMigrationProjectType(normalizedType)
        ? 'vanilla'
        : String(targetLoader || 'vanilla').toLowerCase();
    const versionAliases = buildGameVersionAliases(targetVersion);
    const source = String(entry?.source || '').toLowerCase();
    const rawProjectId = String(entry?.projectId || '').trim();

    if ((source === 'curseforge' || rawProjectId.startsWith(CURSEFORGE_PROJECT_PREFIX)) && rawProjectId) {
        const curseResult = await resolveCurseForgeCandidateByProjectId(rawProjectId, normalizedType, resolvedLoader, versionAliases);
        if (curseResult.success) {
            return { success: true, update: curseResult };
        }
    }

    let modrinthProjectId = '';
    if (rawProjectId && !rawProjectId.startsWith(CURSEFORGE_PROJECT_PREFIX)) {
        modrinthProjectId = rawProjectId;
    }

    if (!modrinthProjectId && !entry?.isDirectory && entry?.path && await fs.pathExists(entry.path)) {
        try {
            const hash = await calculateSha1(entry.path);
            const versionRes = await axios.get(`https://api.modrinth.com/v2/version_file/${hash}`, {
                headers: {
                    'User-Agent': API_USER_AGENT
                },
                timeout: 10000
            });
            modrinthProjectId = String(versionRes?.data?.project_id || '').trim();
        } catch {
            // Intentionally ignored. We fallback to CurseForge search below.
        }
    }

    if (modrinthProjectId) {
        const modrinthResult = await resolveModrinthCandidateForMigration({
            projectId: modrinthProjectId,
            projectType: normalizedType,
            targetLoader: resolvedLoader,
            versionAliases
        });

        if (modrinthResult.success) {
            return { success: true, update: modrinthResult };
        }
    }

    const searchedProject = await searchCurseForgeProjectForMigration(entry, normalizedType);
    if (searchedProject.success) {
        const curseResult = await resolveCurseForgeCandidateByProjectId(searchedProject.projectId, normalizedType, resolvedLoader, versionAliases);
        if (curseResult.success) {
            return { success: true, update: curseResult };
        }
        return {
            success: false,
            reason: curseResult.reason || 'unsupported-version'
        };
    }

    return {
        success: false,
        reason: searchedProject.reason || 'not-found'
    };
};

const buildMigrationPlan = async ({ instanceDir, targetVersion, targetLoader }) => {
    const modCachePath = path.join(appData, 'mod_cache.json');
    let modCache = {};
    try {
        if (await fs.pathExists(modCachePath)) {
            modCache = await fs.readJson(modCachePath);
        }
    } catch {
        modCache = {};
    }

    const entryGroups = await Promise.all([
        readMigrationContentEntries(instanceDir, 'mod', modCache),
        readMigrationContentEntries(instanceDir, 'resourcepack', modCache),
        readMigrationContentEntries(instanceDir, 'shader', modCache)
    ]);
    const allEntries = entryGroups.flat();

    const updates = [];
    const unresolved = [];

    for (const entry of allEntries) {
        const resolved = await resolveMigrationCandidateForEntry(entry, targetVersion, targetLoader);

        if (resolved.success && resolved.update) {
            updates.push({
                id: createMigrationEntryId(entry),
                projectType: normalizeMigrationProjectType(entry.projectType),
                name: entry.name,
                title: entry.title || entry.name,
                sourcePath: entry.path,
                targetFolder: entry.folder,
                projectId: entry.projectId || null,
                versionId: entry.versionId || null,
                source: entry.source || null,
                update: resolved.update
            });
            continue;
        }

        unresolved.push({
            id: createMigrationEntryId(entry),
            projectType: normalizeMigrationProjectType(entry.projectType),
            name: entry.name,
            title: entry.title || entry.name,
            sourcePath: entry.path,
            reason: resolved.reason || 'not-found'
        });
    }

    return {
        updates,
        unresolved,
        summary: {
            total: allEntries.length,
            updatable: updates.length,
            unresolved: unresolved.length
        }
    };
};

async function downloadFile(url, destPath, signal = null, retries = 1) {
    let lastError;
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await axios({ url, responseType: 'arraybuffer', signal, timeout: 30000 });
            await fs.writeFile(destPath, response.data);
            return;
        } catch (e) {
            lastError = e;
            console.warn(`[Download] Attempt ${i + 1} failed for ${url}: ${e.message}`);
            if (i < retries) await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw lastError;
}

async function resolveAssetIndexMetadata(instanceDir, versionId, fallbackVersion = '') {
    const queue = [];
    const visited = new Set();

    if (versionId) queue.push(String(versionId).trim());
    if (fallbackVersion && fallbackVersion !== versionId) queue.push(String(fallbackVersion).trim());

    while (queue.length > 0) {
        const current = String(queue.shift() || '').trim();
        if (!current || visited.has(current)) continue;
        visited.add(current);

        const currentJsonPath = path.join(instanceDir, 'versions', current, `${current}.json`);
        if (!await fs.pathExists(currentJsonPath)) continue;

        let versionJson;
        try {
            versionJson = await fs.readJson(currentJsonPath);
        } catch {
            continue;
        }

        if (versionJson?.assetIndex) {
            const assetIndex = versionJson.assetIndex;
            const id = String(assetIndex.id || versionJson.assets || '').trim();
            const url = String(assetIndex.url || '').trim();
            const sha1 = String(assetIndex.sha1 || '').trim();
            const size = Number(assetIndex.size || 0);

            if (id) {
                return { id, url, sha1, size };
            }
        }

        const assetsId = String(versionJson?.assets || '').trim();
        if (assetsId) {
            return { id: assetsId, url: '', sha1: '', size: 0 };
        }

        const inherited = String(versionJson?.inheritsFrom || '').trim();
        if (inherited && !visited.has(inherited)) {
            queue.push(inherited);
        }
    }

    return null;
}

async function syncMinecraftAssets(instanceDir, assetRoot, versionId, fallbackVersion, onProgress, logCallback, isAborted) {
    const log = (message) => {
        if (typeof logCallback === 'function') {
            logCallback(message);
        }
    };

    const progress = (value, status) => {
        if (typeof onProgress === 'function') {
            onProgress(value, status);
        }
    };

    const assetMeta = await resolveAssetIndexMetadata(instanceDir, versionId, fallbackVersion);
    if (!assetMeta?.id) {
        log('Asset sync skipped: no asset index metadata found.');
        return;
    }

    const indexesDir = path.join(assetRoot, 'indexes');
    const objectsDir = path.join(assetRoot, 'objects');
    await fs.ensureDir(indexesDir);
    await fs.ensureDir(objectsDir);

    const indexPath = path.join(indexesDir, `${assetMeta.id}.json`);
    const indexUrl = assetMeta.url || `https://resources.download.minecraft.net/indexes/${assetMeta.id}.json`;
    let hasValidIndex = await fs.pathExists(indexPath);

    if (hasValidIndex && assetMeta.sha1) {
        const currentSha1 = await calculateSha1(indexPath).catch(() => '');
        if (!currentSha1 || currentSha1.toLowerCase() !== assetMeta.sha1.toLowerCase()) {
            hasValidIndex = false;
        }
    }

    if (!hasValidIndex) {
        log(`Downloading asset index ${assetMeta.id}...`);
        await downloadFile(indexUrl, indexPath);
    }

    let indexJson;
    try {
        indexJson = await fs.readJson(indexPath);
    } catch {
        throw new Error(`Failed to read asset index ${assetMeta.id}`);
    }

    const objects = Object.values(indexJson?.objects || {});
    if (objects.length === 0) {
        log(`Asset index ${assetMeta.id} contains no downloadable objects.`);
        return;
    }

    let completed = 0;
    let downloaded = 0;
    const total = objects.length;

    for (const entry of objects) {
        if (typeof isAborted === 'function' && isAborted()) break;

        const hash = String(entry?.hash || '').trim();
        const size = Number(entry?.size || 0);
        if (!hash || hash.length < 2) {
            completed += 1;
            continue;
        }

        const prefix = hash.slice(0, 2);
        const objectPath = path.join(objectsDir, prefix, hash);
        let exists = await fs.pathExists(objectPath);

        if (exists && size > 0) {
            try {
                const stat = await fs.stat(objectPath);
                if (!stat.isFile() || stat.size !== size) {
                    exists = false;
                }
            } catch {
                exists = false;
            }
        }

        if (!exists) {
            await fs.ensureDir(path.dirname(objectPath));
            await downloadFile(`https://resources.download.minecraft.net/${prefix}/${hash}`, objectPath);
            downloaded += 1;
        }

        completed += 1;
        if (completed % 100 === 0 || completed === total) {
            const percentage = 70 + Math.round((completed / total) * 10);
            progress(percentage, `Syncing game assets (${completed}/${total})...`);
        }
    }

    log(`Asset sync finished: ${downloaded} downloaded, ${total - downloaded} already present.`);
}

async function getFolderSize(directory) {
    let size = 0;
    const files = await fs.readdir(directory);
    for (const file of files) {
        const filePath = path.join(directory, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            size += await getFolderSize(filePath);
        } else {
            size += stats.size;
        }
    }
    return size;
}

const GAME_MODES = {
    0: 'Survival',
    1: 'Creative',
    2: 'Adventure',
    3: 'Spectator'
};

const DIFFICULTIES = {
    0: 'Peaceful',
    1: 'Easy',
    2: 'Normal',
    3: 'Hard'
};
async function installFabricLoader(instanceDir, mcVersion, loaderVersion, onProgress, logCallback) {
    const log = (msg) => {
        console.log(msg);
        if (logCallback) logCallback(msg);
    };
    try {
        if (onProgress) onProgress(5, 'Fetching Fabric metadata');
        log('Fetching Fabric metadata...');
        let versionToUse = loaderVersion;
        let versionId;

        if (!versionToUse) {
            const loadersRes = await axios.get(`${FABRIC_META}/versions/loader/${mcVersion}`);
            if (!loadersRes.data || loadersRes.data.length === 0) {
                return { success: false, error: 'No Fabric loader available for this version' };
            }
            versionToUse = loadersRes.data[0].loader.version;
        }

        versionId = `fabric-loader-${versionToUse}-${mcVersion}`;
        log(`Using Fabric loader: ${versionToUse}`);
        if (onProgress) onProgress(15, 'Downloading Fabric profile');
        log('Downloading Fabric profile...');
        const profileRes = await axios.get(`${FABRIC_META}/versions/loader/${mcVersion}/${versionToUse}/profile/json`);
        const profile = profileRes.data;

        const versionsDir = path.join(instanceDir, 'versions', versionId);
        await fs.ensureDir(versionsDir);
        await fs.writeJson(path.join(versionsDir, `${versionId}.json`), profile, { spaces: 2 });

        log(`Installed Fabric ${versionToUse} for MC ${mcVersion} -> ${versionId}`);
        if (onProgress) onProgress(25, 'Fabric profile saved');
        return { success: true, loaderVersion: versionToUse, versionId };
    } catch (e) {
        console.error('Fabric install error:', e.message);
        if (logCallback) logCallback(`Fabric install error: ${e.message}`);
        return { success: false, error: e.message };
    }
}
async function installQuiltLoader(instanceDir, mcVersion, loaderVersion, onProgress, logCallback) {
    const log = (msg) => {
        console.log(msg);
        if (logCallback) logCallback(msg);
    };
    try {
        if (onProgress) onProgress(5, 'Fetching Quilt metadata');
        log('Fetching Quilt metadata...');
        let versionToUse = loaderVersion;
        let versionId;

        if (!versionToUse) {
            const loadersRes = await axios.get(`${QUILT_META}/versions/loader/${mcVersion}`);
            if (!loadersRes.data || loadersRes.data.length === 0) {
                return { success: false, error: 'No Quilt loader available for this version' };
            }
            versionToUse = loadersRes.data[0].loader.version;
        }

        versionId = `quilt-loader-${versionToUse}-${mcVersion}`;
        log(`Using Quilt loader: ${versionToUse}`);
        if (onProgress) onProgress(15, 'Downloading Quilt profile');
        log('Downloading Quilt profile...');
        const profileRes = await axios.get(`${QUILT_META}/versions/loader/${mcVersion}/${versionToUse}/profile/json`);
        const profile = profileRes.data;

        const versionsDir = path.join(instanceDir, 'versions', versionId);
        await fs.ensureDir(versionsDir);
        await fs.writeJson(path.join(versionsDir, `${versionId}.json`), profile, { spaces: 2 });

        log(`Installed Quilt ${versionToUse} for MC ${mcVersion}`);
        if (onProgress) onProgress(25, 'Quilt profile saved');
        return { success: true, loaderVersion: versionToUse, versionId };
    } catch (e) {
        console.error('Quilt install error:', e.message);
        if (logCallback) logCallback(`Quilt install error: ${e.message}`);
        return { success: false, error: e.message };
    }
}
async function extractVersionUid(installerPath, filesToLookFor = ['version.json', 'install_profile.json']) {
    const zip = new AdmZip(installerPath);
    const zipEntries = zip.getEntries();
    let entry = zipEntries.find(e => e.entryName === 'version.json');
    if (entry) {
        return JSON.parse(entry.getData().toString('utf8'));
    }
    entry = zipEntries.find(e => e.entryName === 'install_profile.json');
    if (entry) {
        const profile = JSON.parse(entry.getData().toString('utf8'));
        if (profile.versionInfo) return profile.versionInfo;
    }

    return null;
}
async function fetchMavenVersions(metadataUrl) {
    try {
        const res = await axios.get(metadataUrl);
        const xml = res.data;

        const versions = [];
        const regex = /<version>(.*?)<\/version>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
            versions.push(match[1]);
        }
        return versions.reverse();
    } catch (e) {
        console.error(`Failed to fetch metadata from ${metadataUrl}`, e.message);
        return [];
    }
}
async function runInstaller(installerPath, instanceDir, onProgress, logCallback) {
    const profilePath = path.join(instanceDir, 'launcher_profiles.json');
    if (!await fs.pathExists(profilePath)) {
        console.log('Creating dummy launcher_profiles.json for installer...');
        const dummyProfile = {
            profiles: {},
            settings: {
                crashAssistance: true,
                enableAdvanced: true,
                enableAnalytics: true,
                enableHistorical: true,
                enableReleases: true,
                enableSnapshots: true,
                keepLauncherOpen: false,
                locale: 'en-us',
                profileSorting: 'last_played',
                showGameLog: false,
                showMenu: false,
                soundOn: false
            },
            version: 3
        };
        await fs.ensureDir(instanceDir);
        await fs.writeJson(profilePath, dummyProfile, { spaces: 2 });
    }

    const log = (msg) => {
        console.log(msg);
        if (logCallback) logCallback(msg);
    };

    return new Promise((resolve, reject) => {
        console.log(`Running installer: java -jar "${installerPath}" --installClient "${instanceDir}"`);
        const child = spawn('java', ['-jar', installerPath, '--installClient', instanceDir]);
        const instanceName = path.basename(instanceDir);
        if (activeTasks.has(instanceName)) {
            activeTasks.get(instanceName).child = child;
        }

        child.stdout.on('data', (data) => {
            const str = data.toString();
            log(`[Installer]: ${str.trim()}`);
            if (onProgress) {

                if (str.includes('Downloading')) onProgress(null, 'Downloading libraries...');
                if (str.includes('Extracting')) onProgress(null, 'Extracting files...');
                if (str.includes('Processing')) onProgress(null, 'Processing JARs...');
            }
        });
        child.stderr.on('data', (data) => log(`[Installer ERROR]: ${data.toString().trim()}`));

        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Installer exited with code ${code}`));
        });
    });
}
async function installForgeLoader(instanceDir, mcVersion, loaderVersion, onProgress, logCallback) {
    const log = (msg) => {
        console.log(msg);
        if (logCallback) logCallback(msg);
    };
    try {
        // If no loaderVersion given, fetch the recommended version from Forge Maven metadata.
        if (!loaderVersion) {
            if (onProgress) onProgress(3, 'Fetching recommended Forge version...');
            try {
                const metaUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`;
                const res = await axios.get(metaUrl, { timeout: 10000 });
                const xml = String(res.data);
                // Find versions matching the mcVersion prefix
                const regex = new RegExp(`<version>(${mcVersion.replace('.', '\.').replace('.', '\.')}[^<]*)<\/version>`, 'g');
                const matches = [];
                let m;
                while ((m = regex.exec(xml)) !== null) matches.push(m[1]);
                if (matches.length > 0) {
                    const best = matches[matches.length - 1]; // last = highest
                    loaderVersion = best.replace(`${mcVersion}-`, '');
                    log(`Auto-resolved Forge version: ${loaderVersion}`);
                } else {
                    return { success: false, error: `Could not find a Forge version for Minecraft ${mcVersion}` };
                }
            } catch (e) {
                return { success: false, error: `Failed to fetch Forge version list: ${e.message}` };
            }
        }

        if (onProgress) onProgress(5, `Preparing Forge ${loaderVersion}`);
        console.log(`Installing Forge ${loaderVersion} for MC ${mcVersion}...`);

        let fullVersion = loaderVersion;
        if (!String(fullVersion).startsWith(mcVersion)) {
            fullVersion = `${mcVersion}-${loaderVersion}`;
        }

        const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
        const installerPath = path.join(os.tmpdir(), `forge-${fullVersion}-installer.jar`);

        console.log(`Downloading Maven Installer: ${installerUrl}`);
        if (onProgress) onProgress(10, 'Downloading Forge Installer');
        try {
            await downloadFile(installerUrl, installerPath, null, 1);
        } catch (e) {
            return { success: false, error: `Failed to download Forge installer from ${installerUrl} after retries: ${e.message}` };
        }

        log('Running Forge Installer headlessly...');
        if (onProgress) onProgress(30, 'Running Forge Installer (this may take a minute)');
        try {
            await runInstaller(installerPath, instanceDir, (p, s) => {
                if (onProgress) onProgress(p || 50, s);
            }, logCallback);
        } catch (e) {
            return { success: false, error: `Forge installation failed: ${e.message}` };
        }

        console.log('Extracting version.json for Lux compatibility...');
        if (onProgress) onProgress(80, 'Extracting version profile...');
        const versionProfile = await extractVersionUid(installerPath);

        if (!versionProfile) {
            return { success: false, error: 'Could not find version.json in Forge installer' };
        }

        const versionId = versionProfile.id;
        const versionsDir = path.join(instanceDir, 'versions', versionId);
        await fs.ensureDir(versionsDir);
        await fs.writeJson(path.join(versionsDir, `${versionId}.json`), versionProfile, { spaces: 2 });
        await fs.remove(installerPath);

        console.log(`Successfully installed Forge ${versionId}`);
        if (onProgress) onProgress(95, 'Finalizing Forge installation...');
        return { success: true, loaderVersion: loaderVersion, versionId };
    } catch (e) {
        console.error('Forge install error:', e.message);
        return { success: false, error: e.message };
    }
}
async function installNeoForgeLoader(instanceDir, mcVersion, loaderVersion, onProgress, logCallback) {
    const log = (msg) => {
        console.log(msg);
        if (logCallback) logCallback(msg);
    };
    try {
        // If no loaderVersion given (e.g. during migration), resolve the newest NeoForge build for this MC version.
        if (!loaderVersion) {
            if (onProgress) onProgress(3, 'Fetching newest NeoForge version...');
            try {
                const all = await fetchMavenVersions('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
                const shortMc = mcVersion.replace(/^1\./, '');
                const matches = all.filter(v => v.startsWith(`${mcVersion}-`) || v.startsWith(`${shortMc}.`));
                if (matches.length > 0) {
                    loaderVersion = matches[0]; // fetchMavenVersions returns newest-first
                    log(`Auto-resolved NeoForge version: ${loaderVersion}`);
                } else {
                    return { success: false, error: `Could not find a NeoForge version for Minecraft ${mcVersion}` };
                }
            } catch (e) {
                return { success: false, error: `Failed to fetch NeoForge version list: ${e.message}` };
            }
        }

        if (onProgress) onProgress(5, `Preparing NeoForge ${loaderVersion}`);
        console.log(`Installing NeoForge ${loaderVersion} for MC ${mcVersion}...`);

        const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
        const installerPath = path.join(os.tmpdir(), `neoforge-${loaderVersion}-installer.jar`);

        console.log(`Downloading NeoForge Installer: ${installerUrl}`);
        if (onProgress) onProgress(10, 'Downloading NeoForge Installer');
        try {
            await downloadFile(installerUrl, installerPath, null, 1);
        } catch (e) {
            return { success: false, error: `Failed to download NeoForge installer after retries: ${e.message}` };
        }

        log('Running NeoForge Installer headlessly...');
        if (onProgress) onProgress(30, 'Running NeoForge Installer');
        try {
            await runInstaller(installerPath, instanceDir, (p, s) => {
                if (onProgress) onProgress(p || 50, s);
            }, logCallback);
        } catch (e) {
            return { success: false, error: `NeoForge installation failed: ${e.message}` };
        }

        console.log('Extracting version.json for Lux compatibility...');
        const versionProfile = await extractVersionUid(installerPath);

        if (!versionProfile) {
            return { success: false, error: 'Could not find version.json in NeoForge installer' };
        }

        const versionId = versionProfile.id;
        const versionsDir = path.join(instanceDir, 'versions', versionId);
        await fs.ensureDir(versionsDir);
        await fs.writeJson(path.join(versionsDir, `${versionId}.json`), versionProfile, { spaces: 2 });
        await fs.remove(installerPath);

        console.log(`Successfully installed NeoForge ${versionId}`);
        if (onProgress) onProgress(95, 'Finalizing NeoForge installation...');
        return { success: true, loaderVersion: loaderVersion, versionId };
    } catch (e) {
        console.error('NeoForge install error:', e.message);
        return { success: false, error: e.message };
    }
}

function sanitizeInstanceConfig(config) {
    if (!config || typeof config !== 'object') return {};
    const allowedKeys = [
        'name', 'version', 'loader', 'loaderVersion', 'versionId', 'icon',
        'created', 'playtime', 'lastPlayed', 'status', 'imported',
        'javaPath', 'minMemory', 'maxMemory', 'resolutionWidth', 'resolutionHeight',
        'folderPath'
    ];
    const cleanConfig = {};
    for (const key of allowedKeys) {
        if (config[key] !== undefined) {
            cleanConfig[key] = config[key];
        }
    }
    return cleanConfig;
}

const BUSY_FS_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function isBusyFsError(error) {
    if (!error) return false;
    if (BUSY_FS_ERROR_CODES.has(String(error.code || '').toUpperCase())) return true;
    const message = String(error.message || '').toLowerCase();
    return message.includes('resource busy') || message.includes('locked');
}

async function waitMs(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBusyFsRetry(action, maxAttempts = 6, baseDelayMs = 120) {
    let attempt = 0;
    while (attempt < maxAttempts) {
        try {
            return await action();
        } catch (error) {
            attempt += 1;
            if (!isBusyFsError(error) || attempt >= maxAttempts) {
                throw error;
            }
            const delay = baseDelayMs * attempt;
            await waitMs(delay);
        }
    }
}

module.exports = (ipcMain, win) => {
    try {

        if (!appData) {
            appData = app.getPath('userData');
            instancesDir = resolvePrimaryInstancesDir();
            globalBackupsDir = path.join(appData, 'backups');

            const migration = migrateLegacyInstancesToPrimarySync();
            instancesDir = migration.primaryDir;

            if (migration.migrated.length > 0) {
                console.log('[Instances] Migrated legacy instances:', migration.migrated);
            }
            if (migration.skipped.length > 0) {
                console.log('[Instances] Skipped legacy instance migrations:', migration.skipped);
            }

            console.log('[Instances] Initialized paths:', { appData, instancesDir, globalBackupsDir });
        }

        console.log('--- INSTANCES HANDLER INIT START ---');
        const startBackgroundInstall = async (finalName, config, cleanInstall = false, isMigration = false, migrationOptions = {}) => {
            const dir = path.join(instancesDir, finalName);
            const { version, loader } = config;
            // During a migration we always want the newest loader build for the *target*
            // Minecraft version, so ignore the stored (old) loaderVersion/versionId and let
            // the installer auto-resolve it. A normal (re)install keeps the pinned version.
            // If loaderVersion is missing but versionId contains it (e.g. "1.20.1-forge-47.2.17"), extract it.
            let existingLoaderVer = isMigration ? undefined : config.loaderVersion;
            if (!isMigration && !existingLoaderVer && config.versionId) {
                const loaderType = (loader || '').toLowerCase();
                const vId = String(config.versionId);
                if (loaderType === 'forge' && vId.includes('-forge-')) {
                    existingLoaderVer = vId.split('-forge-')[1] || undefined;
                } else if (loaderType === 'neoforge' && vId.includes('-neoforge-')) {
                    existingLoaderVer = vId.split('-neoforge-')[1] || undefined;
                } else if (loaderType === 'fabric' && vId.includes('-fabric-')) {
                    existingLoaderVer = vId.split('-fabric-')[1] || undefined;
                } else if (loaderType === 'quilt' && vId.includes('-quilt-')) {
                    existingLoaderVer = vId.split('-quilt-')[1] || undefined;
                }
                if (existingLoaderVer) {
                    console.log(`[Background Install] Extracted loaderVersion from versionId: ${existingLoaderVer}`);
                }
            }

            console.log(`[Background Install] Starting for ${finalName}, clean=${cleanInstall}, migration=${isMigration}`);
            if (activeTasks.has(finalName)) {
                const t = activeTasks.get(finalName);
                if (!t.aborted) {
                    console.log('[Background Install] Task already active for this instance, aborting old one.');
                    t.abort();
                }
            }
            activeTasks.set(finalName, {
                aborted: false,
                child: null,
                abort: () => {
                    const task = activeTasks.get(finalName);
                    if (task) {
                        task.aborted = true;
                        if (task.child) {
                            try {
                                task.child.kill();
                            } catch (e) { console.error('Failed to kill installer child:', e); }
                        }
                    }
                }
            });
            return (async () => {
                const task = activeTasks.get(finalName);
                if (!task) return;
                let sendCompletion = async () => { };

                try {

                    const logsPath = path.join(dir, 'install.log');
                    await fs.ensureDir(path.dirname(logsPath));
                    await fs.appendFile(logsPath, `\n--- ${isMigration ? 'Migration' : 'Installation'} Started: ${new Date().toLocaleString()} ---\n`);

                    const appendLog = async (line) => {
                        if (task.aborted) return;
                        const normalizedLine = String(line)
                            .replace(/\[Debug\]\[MCLC\]/g, '[Debug][LUX]')
                            .replace(/\[DEBUG\]\[MCLC\]/g, '[DEBUG][LUX]');
                        const formatted = `[${new Date().toLocaleTimeString()}] ${normalizedLine}\n`;
                        await fs.appendFile(logsPath, formatted);
                        if (win && win.webContents) {
                            win.webContents.send('launch:log', normalizedLine);
                        }
                    };

                    const sendProgress = (progress, status) => {
                        if (task.aborted) return;
                        if (status) appendLog(`Status: ${status}`);
                        if (win && win.webContents) {
                            win.webContents.send('install:progress', { instanceName: finalName, progress, status });
                        }
                    };

                    sendCompletion = async (success, error = null) => {
                        if (task.aborted) return;
                        try {
                            const configPath = path.join(dir, 'instance.json');
                            const updatedConfig = await fs.readJson(configPath);
                            updatedConfig.status = success ? 'ready' : 'error';
                            await fs.writeJson(configPath, updatedConfig, { spaces: 4 });
                            invalidateMergedInstancesCache();
                        } catch (e) { console.error('Failed to update instance config:', e); }

                        if (win && win.webContents) {
                            sendProgress(100, success ? 'Completed' : 'Failed');
                            await new Promise(resolve => setTimeout(resolve, 500));
                            if (success) {
                                win.webContents.send('instance:status', { instanceName: finalName, status: 'stopped' });
                            } else {
                                win.webContents.send('instance:status', { instanceName: finalName, status: 'error', error });
                            }
                        }
                    };
                    let migratedContentToInstall = [];
                    if (isMigration) {
                        sendProgress(2, 'Analyzing current content for migration...');
                        const migrationPlan = await buildMigrationPlan({
                            instanceDir: dir,
                            targetVersion: version,
                            targetLoader: loader
                        });

                        const removeUnresolvedIds = new Set(
                            Array.isArray(migrationOptions?.removeUnresolvedIds)
                                ? migrationOptions.removeUnresolvedIds.map((entry) => String(entry || '').toLowerCase())
                                : []
                        );

                        for (const unresolvedItem of migrationPlan.unresolved) {
                            if (task.aborted) break;
                            const itemId = String(unresolvedItem.id || '').toLowerCase();
                            const shouldRemove = removeUnresolvedIds.has(itemId);
                            if (shouldRemove) {
                                try {
                                    await fs.remove(unresolvedItem.sourcePath);
                                    appendLog(`Removed unresolved ${unresolvedItem.projectType}: ${unresolvedItem.name}`);
                                } catch (removeErr) {
                                    appendLog(`Failed to remove unresolved ${unresolvedItem.projectType} ${unresolvedItem.name}: ${removeErr.message}`);
                                }
                            } else {
                                appendLog(`Keeping unresolved ${unresolvedItem.projectType}: ${unresolvedItem.name}`);
                            }
                        }

                        migratedContentToInstall = migrationPlan.updates;

                        for (const migratedItem of migratedContentToInstall) {
                            if (task.aborted) break;
                            try {
                                await fs.remove(migratedItem.sourcePath);
                            } catch (removeErr) {
                                appendLog(`Failed to remove old ${migratedItem.projectType} ${migratedItem.name}: ${removeErr.message}`);
                            }
                        }

                        appendLog(`Migration scan complete: ${migrationPlan.summary.updatable} updatable, ${migrationPlan.summary.unresolved} unresolved.`);
                    }

                    let result = { success: true };
                    const loaderType = (loader || 'vanilla').toLowerCase();
                    let resolvedMcVersion = String(version || '').trim();
                    sendProgress(10, `Downloading Minecraft ${version} base files (Phase 1/3)...`);
                    let resolvedVersionAliases = [];
                    try {
                        const versionManifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
                        const manifestPath = path.join(dir, 'version_manifest.json');
                        await downloadFile(versionManifestUrl, manifestPath);
                        const manifest = await fs.readJson(manifestPath);
                        const requestedAliases = buildGameVersionAliases(resolvedMcVersion);
                        const manifestVersions = Array.isArray(manifest?.versions) ? manifest.versions : [];
                        let versionData = manifestVersions.find((entry) => requestedAliases.includes(String(entry?.id || '').trim()));

                        if (!versionData) throw new Error(`Version ${version} not found in manifest`);

                        resolvedMcVersion = String(versionData.id || resolvedMcVersion || version).trim();
                        if (resolvedMcVersion !== String(version || '').trim()) {
                            appendLog(`Resolved Minecraft version alias ${version} -> ${resolvedMcVersion}`);
                        }

                        resolvedVersionAliases = buildGameVersionAliases(resolvedMcVersion);

                        const versionJsonUrl = versionData.url;
                        const versionDir = path.join(dir, 'versions', resolvedMcVersion);
                        await fs.ensureDir(versionDir);
                        const versionJsonPath = path.join(versionDir, `${resolvedMcVersion}.json`);

                        await downloadFile(versionJsonUrl, versionJsonPath);
                        const clientJarPath = path.join(versionDir, `${resolvedMcVersion}.jar`);
                        const versionJson = await fs.readJson(versionJsonPath);
                        await downloadFile(versionJson.downloads.client.url, clientJarPath);
                        await fs.remove(manifestPath);

                        const configPath = path.join(dir, 'instance.json');
                        const updatedConfig = await fs.readJson(configPath);
                        updatedConfig.version = resolvedMcVersion;
                        // On migration, reset versionId to the bare MC version so a stale
                        // loader profile id (e.g. "fabric-loader-0.15.0-1.20.1") can't leak
                        // through; the loader phase below rewrites it for the new version.
                        if (isMigration || !updatedConfig.versionId || updatedConfig.versionId === version) {
                            updatedConfig.versionId = resolvedMcVersion;
                        }
                        await fs.writeJson(configPath, updatedConfig, { spaces: 4 });
                    } catch (e) {
                        const criticalError = "The instance cannot be started because critical software components could not be downloaded.";
                        appendLog(`CRITICAL ERROR: ${criticalError} Details: ${e.message}`);
                        throw new Error(criticalError);
                    }
                    if (loaderType !== 'vanilla') {
                        sendProgress(20, `Installing ${loader} loader (Phase 2/3)...`);
                        let targetLoaderVer = existingLoaderVer;
                        if (loaderType === 'fabric') result = await installFabricLoader(dir, resolvedMcVersion, targetLoaderVer, (p, s) => sendProgress(Math.round(p * 0.1) + 20, s), appendLog);
                        else if (loaderType === 'quilt') result = await installQuiltLoader(dir, resolvedMcVersion, targetLoaderVer, (p, s) => sendProgress(Math.round(p * 0.1) + 20, s), appendLog);
                        else if (loaderType === 'forge') result = await installForgeLoader(dir, resolvedMcVersion, targetLoaderVer, (p, s) => sendProgress(Math.round(p * 0.1) + 20, s), appendLog);
                        else if (loaderType === 'neoforge') result = await installNeoForgeLoader(dir, resolvedMcVersion, targetLoaderVer, (p, s) => sendProgress(Math.round(p * 0.1) + 20, s), appendLog);

                        if (!result || !result.success) throw new Error(result?.error || `${loader} installation failed`);
                        if (loaderType === 'fabric') {
                            try {
                                sendProgress(35, 'Auto-installing Fabric API...');
                                const fabricApiId = 'P7dR8mSH';
                                const fapiRes = await axios.get(`https://api.modrinth.com/v2/project/${fabricApiId}/version`, {
                                    params: {
                                        loaders: JSON.stringify(['fabric']),
                                        game_versions: JSON.stringify(resolvedVersionAliases)
                                    }
                                });

                                if (fapiRes.data && fapiRes.data.length > 0) {
                                    const latest = fapiRes.data[0];
                                    const file = latest.files.find(f => f.primary) || latest.files[0];
                                    const modsDir = path.join(dir, 'mods');
                                    await fs.ensureDir(modsDir);
                                    const dest = path.join(modsDir, file.filename);

                                    if (!await fs.pathExists(dest)) {
                                        appendLog(`Downloading Fabric API compatible with ${resolvedMcVersion}...`);
                                        await downloadFile(file.url, dest);
                                        appendLog(`Fabric API installed: ${file.filename}`);
                                    }
                                }
                            } catch (fapiErr) {
                                appendLog(`Warning: Failed to auto-install Fabric API: ${fapiErr.message}`);
                            }
                        }

                        const configPath = path.join(dir, 'instance.json');
                        const updatedConfig = await fs.readJson(configPath);
                        updatedConfig.loaderVersion = result.loaderVersion;
                        updatedConfig.versionId = result.versionId;
                        await fs.writeJson(configPath, updatedConfig, { spaces: 4 });
                    }
                    sendProgress(40, 'Finalizing game files...');
                    const baseProgressStart = 40;
                    try {
                        const sharedDir = path.join(app.getPath('userData'), 'common');
                        const assetRoot = path.join(sharedDir, 'assets');
                        const librariesRoot = path.join(dir, 'libraries');
                        await fs.ensureDir(assetRoot); await fs.ensureDir(librariesRoot);

                        const currentConfig = await fs.readJson(path.join(dir, 'instance.json'));
                        const vId = currentConfig.versionId || resolvedMcVersion;
                        const vJsonPath = path.join(dir, 'versions', vId, `${vId}.json`);
                        const vJson = await fs.readJson(vJsonPath);

                        const libraries = vJson.libraries || [];
                        let downloaded = 0;
                        for (const lib of libraries) {
                            if (task.aborted) break;

                            if (lib.downloads && lib.downloads.artifact) {
                                const art = lib.downloads.artifact;
                                const dest = path.join(librariesRoot, art.path);
                                if (!await fs.pathExists(dest)) {
                                    await fs.ensureDir(path.dirname(dest));
                                    await downloadFile(art.url, dest);
                                }
                            }
                            downloaded++;
                            sendProgress(Math.round(baseProgressStart + (downloaded / libraries.length) * 30), `Syncing libraries...`);
                        }

                        if (!task.aborted) {
                            await syncMinecraftAssets(
                                dir,
                                assetRoot,
                                vId,
                                resolvedMcVersion,
                                (p, s) => sendProgress(p, s),
                                appendLog,
                                () => task.aborted
                            );
                        }
                    } catch (e) { appendLog(`Library sync warning: ${e.message}`); }
                    if (migratedContentToInstall.length > 0) {
                        sendProgress(80, `Installing ${migratedContentToInstall.length} migrated item(s)...`);
                        for (const migratedItem of migratedContentToInstall) {
                            if (task.aborted) break;
                            const targetFolder = getMigrationFolderForProjectType(migratedItem.projectType);
                            const destDir = path.join(dir, targetFolder);
                            await fs.ensureDir(destDir);

                            const fileName = migratedItem.update?.fileName || migratedItem.name;
                            const fileUrl = migratedItem.update?.downloadUrl;
                            const dest = path.join(destDir, fileName);

                            appendLog(`Downloading migrated ${migratedItem.projectType}: ${fileName}`);
                            try {
                                await downloadFile(fileUrl, dest);
                            } catch (e) {
                                appendLog(`Skipping ${migratedItem.projectType} ${fileName} after failed retries: ${e.message}`);
                            }
                        }
                    }
                    try {
                        const settingsPath = path.join(appData, 'settings.json');
                        let settings = {};
                        if (await fs.pathExists(settingsPath)) {
                            settings = await fs.readJson(settingsPath);
                        }

                        if (settings.optimization !== false) {
                            sendProgress(85, 'Installing optimization mods...');
                            appendLog('Installing optimization mods...');

                            const MODRINTH_API = 'https://api.modrinth.com/v2';
                            const modsDir = path.join(dir, 'mods');
                            await fs.ensureDir(modsDir);

                            const loaderName = (loader || 'vanilla').toLowerCase();
                            const primaryMods = [
                                '5ZwdcRci',
                                'YL57xq9U',
                                'iAiqcykM',
                                'Bh37bMuy',
                                'PtjYWJkn',
                                'AANobbMI',
                                'gvQqBUqZ',
                                'mOgUt4GM',
                                'yBW8D80W',
                                'EIa1eiMm',
                                'P7dR8mSH',
                                '4I1XuqiY',
                                'BVzZfTc1',
                                'NNAgCjsB',
                                'g96Z4WVZ',
                                'uXXizFIs',
                                'fQEb0iXm',
                                'nmDcB62a',
                                '51shyZVL',
                                'NRjRiSSD',
                                'J81TRJWm',
                                '9s6osm5g',
                                'LQ3K71Q1',
                                'OVuFYfre'
                            ];
                            const fallbackMods = ['GchcoXML', '4ZqxOvjD'];

                            let modsToInstallList = [...primaryMods];
                            let installedPhosphor = false;

                            for (const projectId of modsToInstallList) {
                                if (task.aborted) break;

                                try {
                                    const versionsRes = await axios.get(
                                        `${MODRINTH_API}/project/${projectId}/version`,
                                        {
                                            params: {
                                                loaders: JSON.stringify([loaderName]),
                                                game_versions: JSON.stringify(resolvedVersionAliases)
                                            }
                                        }
                                    );

                                    if (versionsRes.data && versionsRes.data.length > 0) {
                                        const latestVersion = versionsRes.data[0];
                                        const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];

                                        const dest = path.join(modsDir, primaryFile.filename);
                                        if (!await fs.pathExists(dest)) {
                                            appendLog(`Downloading: ${primaryFile.filename}`);
                                            try {
                                                await downloadFile(primaryFile.url, dest);
                                                appendLog(`Installed: ${primaryFile.filename}`);
                                            } catch (e) {
                                                appendLog(`Skipping optimization mod ${primaryFile.filename} after failed retries: ${e.message}`);
                                            }

                                            if (projectId === 'YL57xq9U' && await fs.pathExists(dest)) {
                                                installedPhosphor = true;
                                            }
                                        }
                                    } else if (projectId === 'YL57xq9U' && !installedPhosphor) {

                                        appendLog('Phosphor not available, trying fallback mods...');
                                        for (const fallbackId of fallbackMods) {
                                            try {
                                                const fallbackRes = await axios.get(
                                                    `${MODRINTH_API}/project/${fallbackId}/version`,
                                                    {
                                                        params: {
                                                            loaders: JSON.stringify([loaderName]),
                                                            game_versions: JSON.stringify(resolvedVersionAliases)
                                                        }
                                                    }
                                                );

                                                if (fallbackRes.data && fallbackRes.data.length > 0) {
                                                    const fallbackVersion = fallbackRes.data[0];
                                                    const fallbackFile = fallbackVersion.files.find(f => f.primary) || fallbackVersion.files[0];
                                                    const dest = path.join(modsDir, fallbackFile.filename);

                                                    if (!await fs.pathExists(dest)) {
                                                        appendLog(`Downloading fallback: ${fallbackFile.filename}`);
                                                        try {
                                                            await downloadFile(fallbackFile.url, dest);
                                                            appendLog(`Installed fallback: ${fallbackFile.filename}`);
                                                        } catch (e) {
                                                            appendLog(`Skipping fallback mod ${fallbackFile.filename} after failed retries: ${e.message}`);
                                                        }
                                                    }
                                                }
                                            } catch (e) {
                                                appendLog(`Fallback mod ${fallbackId} not available: ${e.message}`);
                                            }
                                        }
                                    }
                                } catch (e) {
                                    if (projectId === 'YL57xq9U') {
                                        appendLog(`Phosphor not available (${e.message}), trying fallbacks...`);
                                        for (const fallbackId of fallbackMods) {
                                            try {
                                                const fallbackRes = await axios.get(
                                                    `${MODRINTH_API}/project/${fallbackId}/version`,
                                                    {
                                                        params: {
                                                            loaders: JSON.stringify([loaderName]),
                                                            game_versions: JSON.stringify(resolvedVersionAliases)
                                                        }
                                                    }
                                                );

                                                if (fallbackRes.data && fallbackRes.data.length > 0) {
                                                    const fallbackVersion = fallbackRes.data[0];
                                                    const fallbackFile = fallbackVersion.files.find(f => f.primary) || fallbackVersion.files[0];
                                                    const dest = path.join(modsDir, fallbackFile.filename);

                                                    if (!await fs.pathExists(dest)) {
                                                        appendLog(`Downloading fallback: ${fallbackFile.filename}`);
                                                        try {
                                                            await downloadFile(fallbackFile.url, dest);
                                                            appendLog(`Installed fallback: ${fallbackFile.filename}`);
                                                        } catch (e) {
                                                            appendLog(`Skipping fallback mod ${fallbackFile.filename} after failed retries: ${e.message}`);
                                                        }
                                                    }
                                                }
                                            } catch (fallbackErr) {
                                                appendLog(`Fallback mod ${fallbackId} failed: ${fallbackErr.message}`);
                                            }
                                        }
                                    } else {
                                        appendLog(`Optimization mod ${projectId} not available for this configuration: ${e.message}`);
                                    }
                                }
                            }

                            appendLog('Optimization mods installation complete');
                        }
                    } catch (e) {
                        appendLog(`Optimization mods installation failed: ${e.message}`);
                    }
                    try {
                        const settingsPath = path.join(appData, 'settings.json');
                        let settings = {};
                        if (await fs.pathExists(settingsPath)) {
                            settings = await fs.readJson(settingsPath);
                        }

                        if (settings.enableAutoInstallMods && Array.isArray(settings.autoInstallMods) && settings.autoInstallMods.length > 0) {
                            sendProgress(90, 'Installing auto install mods...');
                            appendLog(`Installing ${settings.autoInstallMods.length} auto install mod(s)...`);

                            const MODRINTH_API = 'https://api.modrinth.com/v2';
                            const modsDir = path.join(dir, 'mods');
                            await fs.ensureDir(modsDir);

                            const loaderName = (loader || 'vanilla').toLowerCase();
                            let installedCount = 0;
                            let skippedCount = 0;
                            const modCachePath = path.join(appData, 'mod_cache.json');

                            const updateAutoInstallCache = async ({ filePath, fileName, title, projectId, versionId, source }) => {
                                try {
                                    if (!await fs.pathExists(filePath)) return;
                                    const stats = await fs.stat(filePath);
                                    const cacheKey = `${fileName}-${stats.size}`;
                                    let modCache = {};

                                    if (await fs.pathExists(modCachePath)) {
                                        modCache = await fs.readJson(modCachePath).catch(() => ({}));
                                    }

                                    modCache[cacheKey] = {
                                        title: title || fileName,
                                        icon: null,
                                        version: title || null,
                                        projectId,
                                        versionId,
                                        source,
                                        timestamp: Date.now()
                                    };

                                    await fs.writeJson(modCachePath, modCache);
                                } catch (cacheError) {
                                    appendLog(`Failed to cache auto install metadata for ${fileName}: ${cacheError.message}`);
                                }
                            };

                            for (const configuredEntry of settings.autoInstallMods) {
                                if (task.aborted) break;

                                const parsedEntry = parseAutoInstallModEntry(configuredEntry);
                                const projectId = parsedEntry.projectId;

                                if (!projectId) {
                                    skippedCount++;
                                    continue;
                                }

                                try {
                                    if (parsedEntry.source === 'curseforge') {
                                        const numericProjectId = Number.parseInt(projectId, 10);
                                        if (!Number.isFinite(numericProjectId)) {
                                            appendLog(`Invalid CurseForge project id: ${configuredEntry}`);
                                            skippedCount++;
                                            continue;
                                        }

                                        const filesRes = await axios.get(
                                            `${CURSEFORGE_API}/mods/${numericProjectId}/files`,
                                            {
                                                params: {
                                                    pageSize: 100,
                                                    index: 0
                                                },
                                                headers: {
                                                    'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)'
                                                }
                                            }
                                        );

                                        const allFiles = Array.isArray(filesRes?.data?.data) ? filesRes.data.data : [];
                                        const compatibleFiles = allFiles
                                            .filter(file => isCurseForgeAutoInstallLoaderCompatible(file, loaderName))
                                            .filter(file => isCurseForgeAutoInstallVersionCompatible(file, resolvedVersionAliases))
                                            .sort((left, right) => new Date(right?.fileDate || 0).getTime() - new Date(left?.fileDate || 0).getTime());

                                        const selectedFile = compatibleFiles[0] || allFiles
                                            .sort((left, right) => new Date(right?.fileDate || 0).getTime() - new Date(left?.fileDate || 0).getTime())[0];

                                        if (!selectedFile || !selectedFile.downloadUrl) {
                                            appendLog(`CurseForge auto install mod ${projectId} not available for ${loaderName} ${resolvedMcVersion} - skipping`);
                                            skippedCount++;
                                            continue;
                                        }

                                        const fileName = selectedFile.fileName || `${numericProjectId}-${selectedFile.id}.jar`;
                                        const dest = path.join(modsDir, fileName);

                                        if (!await fs.pathExists(dest)) {
                                            appendLog(`Downloading auto install mod: ${fileName}`);
                                            try {
                                                await downloadFile(selectedFile.downloadUrl, dest);
                                                appendLog(`Installed auto install mod: ${fileName}`);
                                                installedCount++;
                                            } catch (downloadError) {
                                                appendLog(`Skipping auto install mod ${fileName} after failed retries: ${downloadError.message}`);
                                                skippedCount++;
                                                continue;
                                            }
                                        } else {
                                            appendLog(`Auto install mod already exists: ${fileName}`);
                                            installedCount++;
                                        }

                                        await updateAutoInstallCache({
                                            filePath: dest,
                                            fileName,
                                            title: selectedFile.displayName || fileName,
                                            projectId: `curseforge:${numericProjectId}`,
                                            versionId: `cf-file:${selectedFile.id}`,
                                            source: 'curseforge'
                                        });

                                        continue;
                                    }

                                    const versionsRes = await axios.get(
                                        `${MODRINTH_API}/project/${projectId}/version`,
                                        {
                                            params: {
                                                loaders: JSON.stringify([loaderName]),
                                                game_versions: JSON.stringify(resolvedVersionAliases)
                                            }
                                        }
                                    );

                                    if (versionsRes.data && versionsRes.data.length > 0) {
                                        const latestVersion = versionsRes.data[0];
                                        const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];

                                        const dest = path.join(modsDir, primaryFile.filename);
                                        if (!await fs.pathExists(dest)) {
                                            appendLog(`Downloading auto install mod: ${primaryFile.filename}`);
                                            try {
                                                await downloadFile(primaryFile.url, dest);
                                                appendLog(`Installed auto install mod: ${primaryFile.filename}`);
                                                installedCount++;
                                            } catch (e) {
                                                appendLog(`Skipping auto install mod ${primaryFile.filename} after failed retries: ${e.message}`);
                                                skippedCount++;
                                            }
                                        } else {
                                            appendLog(`Auto install mod already exists: ${primaryFile.filename}`);
                                            installedCount++;
                                        }
                                    } else {
                                        appendLog(`Auto install mod ${projectId} not available for ${loaderName} ${resolvedMcVersion} - skipping`);
                                        skippedCount++;
                                    }
                                } catch (e) {
                                    appendLog(`Auto install mod ${configuredEntry} installation failed: ${e.message} - skipping`);
                                    skippedCount++;
                                }
                            }

                            appendLog(`Auto install mods installation complete (${installedCount} installed, ${skippedCount} skipped)`);
                        }
                    } catch (e) {
                        appendLog(`Auto install mods installation failed: ${e.message}`);
                    }

                    sendCompletion(true);
                } catch (err) {
                    console.error(`Background ${isMigration ? 'migration' : 'install'} error:`, err);
                    sendCompletion(false, err.message);
                } finally {
                    activeTasks.delete(finalName);
                }
            })();
        };

        const installMrPack = async (packPath, nameOverride = null, iconUrl = null) => {
            try {
                const zip = new AdmZip(packPath);

                const indexEntry = zip.getEntry('modrinth.index.json');
                if (!indexEntry) throw new Error('Invalid mrpack: missing modrinth.index.json');

                const index = JSON.parse(indexEntry.getData().toString('utf8'));
                let instanceName = nameOverride || index.name;
                let targetDir = path.join(instancesDir, instanceName);
                let counter = 1;
                while (await fs.pathExists(targetDir)) {
                    instanceName = `${nameOverride || index.name} (${counter++})`;
                    targetDir = path.join(instancesDir, instanceName);
                }

                await fs.ensureDir(targetDir);
                const mcVersion = index.dependencies.minecraft;
                let loaderType = 'Vanilla';
                let loaderVersion = '';

                if (index.dependencies['fabric-loader']) {
                    loaderType = 'Fabric';
                    loaderVersion = index.dependencies['fabric-loader'];
                } else if (index.dependencies['quilt-loader']) {
                    loaderType = 'Quilt';
                    loaderVersion = index.dependencies['quilt-loader'];
                } else if (index.dependencies['forge']) {
                    loaderType = 'Forge';
                    loaderVersion = index.dependencies['forge'];
                } else if (index.dependencies['neoforge']) {
                    loaderType = 'NeoForge';
                    loaderVersion = index.dependencies['neoforge'];
                }

                const instanceConfig = {
                    name: instanceName,
                    version: mcVersion,
                    loader: loaderType,
                    loaderVersion: loaderVersion,
                    icon: DEFAULT_ICON,
                    status: 'installing',
                    created: Date.now()
                };

                await writeInstanceActionLog('import-mrpack-instance', {
                    instanceName,
                    sourcePath: packPath,
                    version: mcVersion,
                    loader: loaderType,
                    loaderVersion
                });

                if (iconUrl) {
                    const cachedIcon = await downloadAndCacheIcon(iconUrl);
                    if (cachedIcon) {
                        instanceConfig.icon = cachedIcon;
                        console.log(`[Import:MrPack] Icon cached and set: ${cachedIcon}`);
                    }
                }

                const controller = new AbortController();
                const signal = controller.signal;

                activeTasks.set(instanceName, {
                    abort: () => {
                        console.log(`[Import:MrPack] Aborting installation for ${instanceName}`);
                        controller.abort();
                    }
                });

                await fs.writeJson(path.join(targetDir, 'instance.json'), instanceConfig, { spaces: 4 });
                await (async () => {
                    try {
                        const sendProgress = (progress, status) => {
                            if (win && win.webContents) {
                                win.webContents.send('install:progress', { instanceName, progress, status });
                            }
                        };

                        sendProgress(5, 'Extracting overrides...');

                        const entries = zip.getEntries();
                        for (const entry of entries) {
                            if (signal.aborted) throw new Error('Installation aborted');
                            if (entry.entryName.startsWith('overrides/')) {
                                const relPath = entry.entryName.replace('overrides/', '');
                                if (relPath) {
                                    const dest = path.join(targetDir, relPath);

                                    const normalizedTargetDir = path.normalize(targetDir + path.sep);
                                    const normalizedDest = path.normalize(dest);
                                    if (!normalizedDest.startsWith(normalizedTargetDir)) {
                                        console.warn(`[Security] Blocked Zip Slip entry: ${entry.entryName}`);
                                        continue;
                                    }

                                    if (entry.isDirectory) {
                                        await fs.ensureDir(dest);
                                    } else {
                                        await fs.ensureDir(path.dirname(dest));
                                        await fs.writeFile(dest, entry.getData());
                                    }
                                }
                            }
                        }

                        sendProgress(20, `Downloading ${index.files.length} files...`);

                        const totalFiles = index.files.length;
                        let downloaded = 0;

                        const chunks = [];
                        for (let i = 0; i < index.files.length; i += 5) {
                            chunks.push(index.files.slice(i, i + 5));
                        }

                        for (const chunk of chunks) {
                            if (signal.aborted) throw new Error('Installation aborted');
                            await Promise.all(chunk.map(async (file) => {
                                if (signal.aborted) return;
                                const dest = path.join(targetDir, file.path);

                                const normalizedTargetDir = path.normalize(targetDir + path.sep);
                                const normalizedDest = path.normalize(dest);
                                if (!normalizedDest.startsWith(normalizedTargetDir)) {
                                    console.warn(`[Security] Blocked malicious file path in mrpack index: ${file.path}`);
                                    return;
                                }

                                await fs.ensureDir(path.dirname(dest));
                                await downloadFile(file.downloads[0], dest, signal);
                                downloaded++;
                                const progress = 20 + Math.round((downloaded / totalFiles) * 60);
                                sendProgress(progress, `Downloading: ${path.basename(file.path)} (${downloaded}/${totalFiles})`);
                            }));
                        }

                        sendProgress(90, 'Finalizing installation...');
                        await startBackgroundInstall(instanceName, instanceConfig, false, false);

                    } catch (err) {
                        if (err.name === 'AbortError' || err.message === 'Installation aborted') {
                            console.log(`[Import:MrPack] ${instanceName} installation aborted cleanly.`);
                        } else {
                            console.error('[Import:MrPack] Error:', err);
                            if (win && win.webContents) {
                                win.webContents.send('instance:status', { instanceName, status: 'error', error: err.message });
                            }
                            throw err;
                        }
                    } finally {
                        if (activeTasks.get(instanceName)?.abort === controller.abort) {
                            activeTasks.delete(instanceName);
                        }
                    }
                })();

                return { success: true, instanceName };
            } catch (e) {
                throw e;
            }
        };

        const installCurseForgePack = async (packPath) => {
            try {
                const zip = new AdmZip(packPath);

                const manifestEntry = zip.getEntry('manifest.json');
                if (!manifestEntry) throw new Error('Invalid CurseForge pack: missing manifest.json');

                const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
                let instanceName = manifest.name || path.basename(packPath, '.zip');
                let targetDir = path.join(instancesDir, instanceName);
                let counter = 1;
                while (await fs.pathExists(targetDir)) {
                    instanceName = `${manifest.name || 'Imported CF'} (${counter++})`;
                    targetDir = path.join(instancesDir, instanceName);
                }

                await fs.ensureDir(targetDir);

                const mcVersion = manifest.minecraft.version;
                let loaderType = 'Vanilla';
                let loaderVersion = '';

                if (manifest.minecraft.modLoaders && manifest.minecraft.modLoaders.length > 0) {
                    const loaderInfo = manifest.minecraft.modLoaders[0];
                    const id = loaderInfo.id;
                    if (id.startsWith('forge-')) {
                        loaderType = 'Forge';
                        loaderVersion = id.replace('forge-', '');
                    } else if (id.startsWith('fabric-')) {
                        loaderType = 'Fabric';
                        loaderVersion = id.replace('fabric-', '');
                    } else if (id.startsWith('neoforge-')) {
                        loaderType = 'NeoForge';
                        loaderVersion = id.replace('neoforge-', '');
                    } else if (id.startsWith('quilt-')) {
                        loaderType = 'Quilt';
                        loaderVersion = id.replace('quilt-', '');
                    }
                }

                const instanceConfig = {
                    name: instanceName,
                    version: mcVersion,
                    loader: loaderType,
                    loaderVersion: loaderVersion,
                    icon: DEFAULT_ICON,
                    status: 'installing',
                    created: Date.now()
                };

                await writeInstanceActionLog('import-curseforge-instance', {
                    instanceName,
                    sourcePath: packPath,
                    version: mcVersion,
                    loader: loaderType,
                    loaderVersion
                });

                const controller = new AbortController();
                const signal = controller.signal;

                activeTasks.set(instanceName, {
                    abort: () => {
                        console.log(`[Import:CF] Aborting installation for ${instanceName}`);
                        controller.abort();
                    }
                });

                await fs.writeJson(path.join(targetDir, 'instance.json'), instanceConfig, { spaces: 4 });

                await (async () => {
                    try {
                        const sendProgress = (progress, status) => {
                            if (win && win.webContents) {
                                win.webContents.send('install:progress', { instanceName, progress, status });
                            }
                        };

                        sendProgress(5, 'Extracting overrides...');

                        const entries = zip.getEntries();
                        for (const entry of entries) {
                            if (signal.aborted) throw new Error('Installation aborted');
                            if (entry.entryName.startsWith('overrides/')) {
                                const relPath = entry.entryName.replace('overrides/', '');
                                if (relPath) {
                                    const dest = path.join(targetDir, relPath);

                                    const normalizedTargetDir = path.normalize(targetDir + path.sep);
                                    const normalizedDest = path.normalize(dest);
                                    if (!normalizedDest.startsWith(normalizedTargetDir)) {
                                        console.warn(`[Security] Blocked Zip Slip entry: ${entry.entryName}`);
                                        continue;
                                    }

                                    if (entry.isDirectory) {
                                        await fs.ensureDir(dest);
                                    } else {
                                        await fs.ensureDir(path.dirname(dest));
                                        await fs.writeFile(dest, entry.getData());
                                    }
                                }
                            }
                        }

                        const mods = manifest.files || [];
                        const totalMods = mods.length;
                        let downloaded = 0;

                        if (totalMods > 0) {
                            sendProgress(20, `Downloading ${totalMods} mods...`);
                            const modsDir = path.join(targetDir, 'mods');
                            await fs.ensureDir(modsDir);

                            for (const mod of mods) {
                                if (signal.aborted) throw new Error('Installation aborted');
                                try {
                                    const fileRes = await axios.get(`https://api.curse.tools/v1/cf/mods/${mod.projectID}/files/${mod.fileID}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0' },
                                        signal: signal
                                    });
                                    const fileData = fileRes.data.data;
                                    const downloadUrl = fileData.downloadUrl;
                                    const fileName = fileData.fileName;

                                    const dest = path.join(modsDir, fileName);

                                    const normalizedModsDir = path.normalize(modsDir + path.sep);
                                    const normalizedDest = path.normalize(dest);
                                    if (!normalizedDest.startsWith(normalizedModsDir)) {
                                        console.warn(`[Security] Blocked malicious filename in CurseForge pack: ${fileName}`);
                                        continue;
                                    }

                                    await downloadFile(downloadUrl, dest, signal);
                                    downloaded++;
                                    const progress = 20 + Math.round((downloaded / totalMods) * 60);
                                    sendProgress(progress, `Downloading: ${fileName} (${downloaded}/${totalMods})`);
                                } catch (e) {
                                    if (e.name === 'AbortError' || axios.isCancel(e)) throw e;
                                    console.error(`[Import:CF] Failed to download mod ID ${mod.projectID}:`, e.message);
                                }
                            }
                        }

                        sendProgress(90, 'Finalizing installation...');
                        await startBackgroundInstall(instanceName, instanceConfig, false, false);

                    } catch (err) {
                        if (err.name === 'AbortError' || err.message === 'Installation aborted' || axios.isCancel(err)) {
                            console.log(`[Import:CF] ${instanceName} installation aborted cleanly.`);
                        } else {
                            console.error('[Import:CF] Error:', err);
                            if (win && win.webContents) {
                                win.webContents.send('instance:status', { instanceName, status: 'error', error: err.message });
                            }
                            throw err;
                        }
                    } finally {
                        if (activeTasks.get(instanceName)?.abort === controller.abort) {
                            activeTasks.delete(instanceName);
                        }
                    }
                })();

                return { success: true, instanceName };
            } catch (e) {
                console.error('[Import:CF] Error:', e);
                return { success: false, error: e.message };
            }
        };
        console.log('[Instances] Stage 2: Registering instance:unified-import-v3...');
        ipcMain.handle('instance:unified-import-v3', async (_) => {
            console.log('[Backend] IPC Received: instance:unified-import-v3');
            try {
                const { filePaths } = await dialog.showOpenDialog({
                    title: 'Import Modpack',
                    filters: [
                        { name: 'Modpacks', extensions: ['mrpack', 'mcpack', 'zip'] },
                        { name: 'Modrinth Modpack', extensions: ['mrpack'] },
                        { name: 'Lux Modpack', extensions: ['mcpack'] },
                        { name: 'Curseforge Modpack', extensions: ['zip'] }
                    ],
                    properties: ['openFile']
                });

                if (!filePaths || filePaths.length === 0) return { success: false, error: 'Cancelled' };

                const packPath = filePaths[0];
                const ext = path.extname(packPath).toLowerCase();
                await writeInstanceActionLog('import-file-selected', {
                    sourcePath: packPath,
                    extension: ext
                });

                const zip = new AdmZip(packPath);

                if (ext === '.mrpack' || zip.getEntry('modrinth.index.json')) {
                    await writeInstanceActionLog('import-mrpack', {
                        sourcePath: packPath
                    });
                    return await installMrPack(packPath);
                } else if (ext === '.mcpack' || zip.getEntry('instance.json')) {
                    const instanceJsonEntry = zip.getEntry('instance.json');
                    const rawInstanceConfig = JSON.parse(instanceJsonEntry.getData().toString('utf8'));
                    const instanceConfig = sanitizeInstanceConfig(rawInstanceConfig);
                    let instanceName = instanceConfig.name || path.basename(packPath, path.extname(packPath));
                    let targetDir = path.join(instancesDir, instanceName);
                    let counter = 1;
                    while (await fs.pathExists(targetDir)) {
                        instanceName = `${instanceConfig.name || 'Imported'} (${counter++})`;
                        targetDir = path.join(instancesDir, instanceName);
                    }
                    await fs.ensureDir(targetDir);
                    zip.extractAllTo(targetDir, true);
                    instanceConfig.name = instanceName;
                    instanceConfig.imported = Date.now();
                    instanceConfig.status = 'installing';
                    await fs.writeJson(path.join(targetDir, 'instance.json'), instanceConfig, { spaces: 4 });
                    if (win && win.webContents) {
                        win.webContents.send('instance:status', { instanceName, status: 'installing' });
                    }
                    startBackgroundInstall(instanceName, instanceConfig, false, false).catch(err => {
                        console.error('[Import:MCPack] Background install failed:', err);
                    });
                    await writeInstanceActionLog('import-mcpack', {
                        instanceName,
                        sourcePath: packPath,
                        version: instanceConfig.version,
                        loader: instanceConfig.loader
                    });
                    return { success: true, instanceName };
                } else if (zip.getEntry('manifest.json')) {
                    await writeInstanceActionLog('import-curseforge-pack', {
                        sourcePath: packPath
                    });
                    return await installCurseForgePack(packPath);
                } else {
                    return { success: false, error: 'Unrecognized modpack format' };
                }
            } catch (e) {
                console.error('[Import:File] Error:', e);
                return { success: false, error: e.message };
            }
        });
        console.log('[Instances]  Checkpoint 1: Import handler registered');

        const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'%3E%3C/path%3E%3Cpolyline points='3.27 6.96 12 12.01 20.73 6.96'%3E%3C/polyline%3E%3Cline x1='12' y1='22.08' x2='12' y2='12'%3E%3C/line%3E%3C/svg%3E";
        console.log('[Instances]  Checkpoint 2: About to register get-resourcepacks');

        ipcMain.handle('instance:get-resourcepacks', async (_, instanceName) => {
            console.log(`[Instances:RP] Getting resource packs for: ${instanceName}`);
            try {
                const { baseDir } = await resolveInstanceBaseDir(instanceName);
                if (!baseDir || !await fs.pathExists(baseDir)) {
                    return { success: true, packs: [] };
                }

                const rpDir = path.join(baseDir, 'resourcepacks');
                if (!await fs.pathExists(rpDir)) {
                    return { success: true, packs: [] };
                }

                const modCachePath = path.join(appData, 'mod_cache.json');
                let modCache = {};
                try {
                    if (await fs.pathExists(modCachePath)) {
                        modCache = await fs.readJson(modCachePath);
                    }
                } catch (e) { console.error('Failed to load cache for RPs', e); }

                const files = await fs.readdir(rpDir, { withFileTypes: true });

                const rpObjects = (await Promise.all(files.map(async (dirent) => {
                    try {
                        const fileName = dirent.name;
                        const filePath = path.join(rpDir, fileName);

                        const isPack = dirent.isDirectory() ||
                            fileName.toLowerCase().endsWith('.zip') ||
                            fileName.toLowerCase().endsWith('.rar');

                        if (!isPack) return null;

                        const stats = await fs.stat(filePath);
                        let title = null, icon = null, version = null;

                        const cacheKey = `${fileName}-${stats.size}`;
                        if (modCache[cacheKey] && modCache[cacheKey].projectId) {
                            title = modCache[cacheKey].title;
                            icon = modCache[cacheKey].icon;
                            version = modCache[cacheKey].version;
                        } else if (dirent.isFile()) {
                            try {
                                const hash = await calculateSha1(filePath);
                                if (modCache[hash]) {
                                    console.log(`[Instances:RP] Found legacy SHA1 cache for ${fileName}`);
                                    title = modCache[hash].title;
                                    icon = modCache[hash].icon;
                                    version = modCache[hash].version;
                                    const projectId = modCache[hash].projectId;
                                    const versionId = modCache[hash].versionId;

                                    modCache[cacheKey] = { title, icon, version, projectId, versionId, hash };
                                } else {
                                    const res = await axios.get(`https://api.modrinth.com/v2/version_file/${hash}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                        timeout: 3000
                                    });
                                    const versionData = res.data;
                                    const versionId = versionData.id;
                                    const projectId = versionData.project_id;

                                    const projectRes = await axios.get(`https://api.modrinth.com/v2/project/${projectId}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                        timeout: 3000
                                    });
                                    const projectData = projectRes.data;

                                    title = projectData.title;
                                    icon = projectData.icon_url;
                                    version = versionData.version_number;

                                    modCache[cacheKey] = { title, icon, version, projectId, versionId, hash };
                                }
                            } catch (e) { }
                        }

                        return {
                            name: fileName,
                            title: title || fileName,
                            icon,
                            version,
                            projectId: modCache[cacheKey]?.projectId,
                            versionId: modCache[cacheKey]?.versionId,
                            size: stats.size,
                            enabled: true
                        };
                    } catch (e) {
                        console.error(`Error processing resource pack:`, e);
                        return null;
                    }
                }))).filter(p => p !== null);

                await fs.writeJson(modCachePath, modCache).catch(() => { });

                return { success: true, packs: rpObjects };
            } catch (e) {
                console.error('Failed to get resource packs', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:get-shaders', async (_, instanceName) => {
            console.log(`[Instances:Shaders] Getting shaders for: ${instanceName}`);
            try {
                const { baseDir } = await resolveInstanceBaseDir(instanceName);
                if (!baseDir || !await fs.pathExists(baseDir)) {
                    return { success: true, shaders: [] };
                }

                const shaderDir = path.join(baseDir, 'shaderpacks');
                if (!await fs.pathExists(shaderDir)) {
                    return { success: true, shaders: [] };
                }

                const modCachePath = path.join(appData, 'mod_cache.json');
                let modCache = {};
                try {
                    if (await fs.pathExists(modCachePath)) {
                        modCache = await fs.readJson(modCachePath);
                    }
                } catch (e) { console.error('Failed to load cache for shaders', e); }

                const files = await fs.readdir(shaderDir, { withFileTypes: true });

                const shaderObjects = (await Promise.all(files.map(async (dirent) => {
                    try {
                        const fileName = dirent.name;
                        const filePath = path.join(shaderDir, fileName);

                        const isShader = dirent.isDirectory() ||
                            fileName.toLowerCase().endsWith('.zip');

                        if (!isShader) return null;

                        const stats = await fs.stat(filePath);
                        let title = null, icon = null, version = null;

                        const cacheKey = `${fileName}-${stats.size}`;
                        if (modCache[cacheKey] && modCache[cacheKey].projectId) {
                            title = modCache[cacheKey].title;
                            icon = modCache[cacheKey].icon;
                            version = modCache[cacheKey].version;
                        } else if (dirent.isFile()) {
                            try {
                                const hash = await calculateSha1(filePath);
                                if (modCache[hash]) {
                                    console.log(`[Instances:Shaders] Found legacy SHA1 cache for ${fileName}`);
                                    title = modCache[hash].title;
                                    icon = modCache[hash].icon;
                                    version = modCache[hash].version;
                                    const projectId = modCache[hash].projectId;
                                    const versionId = modCache[hash].versionId;

                                    modCache[cacheKey] = { title, icon, version, projectId, versionId, hash };
                                } else {
                                    const res = await axios.get(`https://api.modrinth.com/v2/version_file/${hash}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                        timeout: 3000
                                    });
                                    const versionData = res.data;
                                    const versionId = versionData.id;
                                    const projectId = versionData.project_id;

                                    const projectRes = await axios.get(`https://api.modrinth.com/v2/project/${projectId}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                        timeout: 3000
                                    });
                                    const projectData = projectRes.data;

                                    title = projectData.title;
                                    icon = projectData.icon_url;
                                    version = versionData.version_number;

                                    modCache[cacheKey] = { title, icon, version, projectId, versionId, hash };
                                }
                            } catch (e) { }
                        }

                        return {
                            name: fileName,
                            title: title || fileName,
                            icon,
                            version,
                            projectId: modCache[cacheKey]?.projectId,
                            versionId: modCache[cacheKey]?.versionId,
                            size: stats.size,
                            enabled: true
                        };
                    } catch (e) {
                        console.error(`Error processing shader:`, e);
                        return null;
                    }
                }))).filter(p => p !== null);

                await fs.writeJson(modCachePath, modCache).catch(() => { });

                return { success: true, shaders: shaderObjects };
            } catch (e) {
                console.error('Failed to get shaders', e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:get-all', async () => {
            try {
                if (mergedInstancesCache.length > 0) {
                    // Return immediately to keep UI responsive while refreshing in background.
                    refreshMergedInstancesCache(false).catch((error) => {
                        console.error('Failed to refresh cached instances:', error);
                    });
                    return getCachedMergedInstances();
                }

                return await refreshMergedInstancesCache(true);
            } catch (e) {
                console.error('Failed to list instances:', e);
                return getCachedMergedInstances();
            }
        });

        ipcMain.handle('instance:get-log-files', async (_, instanceName) => {
            try {
                console.log(`Getting log files for: ${instanceName}`);
                const instanceDir = path.join(instancesDir, instanceName);
                const logsDir = path.join(instanceDir, 'logs');
                const logFiles = [];
                const installLogPath = path.join(instanceDir, 'install.log');
                if (await fs.pathExists(installLogPath)) {
                    const stats = await fs.stat(installLogPath);
                    logFiles.push({
                        name: 'install.log',
                        date: stats.mtime,
                        size: stats.size
                    });
                }

                if (await fs.pathExists(logsDir)) {
                    const files = await fs.readdir(logsDir);
                    for (const file of files) {
                        if (file.endsWith('.log') || file.endsWith('.log.gz')) {
                            const stats = await fs.stat(path.join(logsDir, file));
                            logFiles.push({
                                name: file,
                                date: stats.mtime,
                                size: stats.size
                            });
                        }
                    }
                }

                return logFiles.sort((a, b) => b.date - a.date);
            } catch (e) {
                console.error('Error getting log files:', e);
                return [];
            }
        });

        ipcMain.handle('instance:get-worlds', async (_, instanceName) => {
            try {
                console.log(`Getting worlds for: ${instanceName}`);
                const instanceDir = path.join(instancesDir, instanceName);
                const savesDir = path.join(instanceDir, 'saves');
                if (!await fs.pathExists(savesDir)) return { success: true, worlds: [] };

                const worlds = [];
                const dirs = await fs.readdir(savesDir);

                for (const dir of dirs) {
                    const worldPath = path.join(savesDir, dir);
                    const stats = await fs.stat(worldPath);
                    if (stats.isDirectory()) {
                        const levelDatPath = path.join(worldPath, 'level.dat');
                        const iconPath = path.join(worldPath, 'icon.png');

                        let worldData = {
                            folderName: dir,
                            name: dir,
                            lastPlayed: stats.mtimeMs,
                            folder: true,
                            size: 0,
                            hasIcon: false,
                            iconData: null
                        };

                        try {
                            worldData.size = await getFolderSize(worldPath);
                        } catch (e) {
                            console.warn(`Could not get size for world ${dir}:`, e.message);
                        }

                        if (await fs.pathExists(levelDatPath)) {
                            try {
                                const buffer = await fs.readFile(levelDatPath);
                                const { parsed } = await nbt.parse(buffer);
                                const data = parsed.value.Data.value;

                                worldData.name = data.LevelName?.value || dir;
                                worldData.lastPlayed = data.LastPlayed?.value ? Number(data.LastPlayed.value) : stats.mtimeMs;
                                worldData.gameMode = GAME_MODES[data.GameType?.value] || 'Unknown';
                                worldData.difficulty = DIFFICULTIES[data.Difficulty?.value] || 'Unknown';
                                worldData.version = data.Version?.value.Name.value || 'Unknown';
                                worldData.hardcore = data.hardcore?.value === 1;
                            } catch (e) {
                                console.error(`Error parsing level.dat for ${dir}:`, e);
                            }
                        }

                        if (await fs.pathExists(iconPath)) {
                            try {
                                const iconBuffer = await fs.readFile(iconPath);
                                worldData.hasIcon = true;
                                worldData.iconData = `data:image/png;base64,${iconBuffer.toString('base64')}`;
                            } catch (e) {
                                console.error(`Error reading icon for ${dir}:`, e);
                            }
                        }

                        worlds.push(worldData);
                    }
                }

                return { success: true, worlds: worlds.sort((a, b) => b.lastPlayed - a.lastPlayed) };
            } catch (e) {
                console.error('Error getting worlds:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:open-world-folder', async (_, instanceName, folderName) => {
            try {
                const worldPath = path.join(instancesDir, instanceName, 'saves', folderName);
                if (await fs.pathExists(worldPath)) {
                    shell.openPath(worldPath);
                    return { success: true };
                }
                return { success: false, error: 'World folder not found' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:backup-world', async (event, instanceName, folderName, providerOverride = false) => {
            try {
                const forceCloud = !!providerOverride;
                console.log(`[BackupWorld] ${instanceName}/${folderName} (forceCloud: ${forceCloud}, override: ${providerOverride})`);
                const worldPath = path.join(instancesDir, instanceName, 'saves', folderName);
                const backupsDir = path.join(globalBackupsDir, instanceName);
                await fs.ensureDir(backupsDir);

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupFile = path.join(backupsDir, `${folderName}-backup-${timestamp}.zip`);

                const output = fs.createWriteStream(backupFile);
                const archive = archiver('zip');

                return new Promise((resolve, reject) => {
                    output.on('close', async () => {
                        console.log(`[Instances] World backup created: ${backupFile}`);
                        try {
                            const settingsPath = path.join(app.getPath('userData'), 'settings.json');
                            if (await fs.pathExists(settingsPath)) {
                                const settings = await fs.readJson(settingsPath);
                                if (forceCloud || (settings.cloudBackupSettings?.enabled && settings.cloudBackupSettings?.provider)) {
                                    let providerId = (typeof providerOverride === 'string') ? providerOverride : settings.cloudBackupSettings?.provider;

                                    if (forceCloud && (!providerId || typeof providerOverride !== 'string')) {
                                        const cloudStatus = store.get('cloud_backups') || {};
                                        if (cloudStatus.DROPBOX?.tokens) providerId = 'DROPBOX';
                                        else if (cloudStatus.GOOGLE_DRIVE?.tokens) providerId = 'GOOGLE_DRIVE';
                                    }

                                    if (!providerId) providerId = 'GOOGLE_DRIVE';

                                    console.log(`[Instances] Emitting backup:created for ${instanceName} to ${providerId} (forceCloud: ${forceCloud})`);
                                    app.emit('backup:created', {
                                        providerId: providerId,
                                        filePath: backupFile,
                                        instanceName: instanceName
                                    });
                                } else {
                                    console.log(`[Instances] Cloud backup skipped: enabled=${settings.cloudBackupSettings?.enabled}, provider=${settings.cloudBackupSettings?.provider}, forceCloud=${forceCloud}`);
                                }
                            }
                        } catch (e) {
                            console.error('[Instances] Cloud upload trigger failed:', e);
                        }

                        resolve({ success: true, backupFile });
                    });
                    archive.on('error', (err) => resolve({ success: false, error: err.message }));
                    archive.pipe(output);
                    archive.directory(worldPath, folderName);
                    archive.finalize();
                });
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:delete-world', async (_, instanceName, folderName) => {
            try {
                const worldPath = path.join(instancesDir, instanceName, 'saves', folderName);
                if (await fs.pathExists(worldPath)) {
                    await fs.remove(worldPath);
                    return { success: true };
                }
                return { success: false, error: 'World folder not found' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:list-local-backups', async (_, instanceName) => {
            try {
                const backupsDir = path.join(globalBackupsDir, instanceName);
                if (!await fs.pathExists(backupsDir)) return { success: true, backups: [] };

                const files = await fs.readdir(backupsDir);
                const backups = await Promise.all(files.filter(f => f.endsWith('.zip')).map(async (file) => {
                    const filePath = path.join(backupsDir, file);
                    const stats = await fs.stat(filePath);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        date: stats.mtimeMs
                    };
                }));

                return { success: true, backups: backups.sort((a, b) => b.date - a.date) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:get-backups-dir', async (_, instanceName) => {
            const backupsDir = path.join(globalBackupsDir, instanceName);
            await fs.ensureDir(backupsDir);
            return backupsDir;
        });

        ipcMain.handle('instance:restore-local-backup', async (_, instanceName, backupPath) => {
            const instanceDir = path.join(instancesDir, instanceName);
            const targetSavesDir = path.join(instanceDir, 'saves');

            try {
                if (!await fs.pathExists(backupPath)) return { success: false, error: 'Backup file not found' };

                const zip = new AdmZip(backupPath);
                const zipEntries = zip.getEntries();

                for (const entry of zipEntries) {
                    if (entry.isDirectory) continue;

                    const entryName = entry.entryName;
                    const normalizedEntry = path.normalize(entryName);

                    if (normalizedEntry.startsWith('..') || path.isAbsolute(normalizedEntry)) {
                        console.warn(`[Instances] Skipping suspicious entry in backup ZIP: ${entryName}`);
                        continue;
                    }

                    const destPath = path.join(targetSavesDir, normalizedEntry);
                    if (!destPath.startsWith(targetSavesDir)) {
                        console.warn(`[Instances] Blocked attempt to write outside saves directory: ${destPath}`);
                        continue;
                    }

                    await fs.ensureDir(path.dirname(destPath));
                    await fs.writeFile(destPath, entry.getData());
                }

                return { success: true };
            } catch (e) {
                console.error('[Instances] Restore error:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:remove-file', async (_, filePath) => {
            try {
                const resolvedPath = path.resolve(filePath);
                if (!resolvedPath.startsWith(instancesDir)) {
                    console.error(`[Instances] Blocked attempt to delete file outside instances directory: ${resolvedPath}`);
                    return { success: false, error: 'Access denied: Path is outside of instances directory' };
                }

                if (await fs.pathExists(resolvedPath)) {
                    await fs.remove(resolvedPath);
                    return { success: true };
                }
                return { success: false, error: 'File not found' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:export-world', async (_, instanceName, folderName) => {
            try {
                const { filePath } = await dialog.showSaveDialog({
                    title: 'Export World',
                    defaultPath: `${folderName}.zip`,
                    filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
                });

                if (!filePath) return { success: false, error: 'Export cancelled' };

                const worldPath = path.join(instancesDir, instanceName, 'saves', folderName);
                const output = fs.createWriteStream(filePath);
                const archive = archiver('zip');

                return new Promise((resolve, reject) => {
                    output.on('close', () => resolve({ success: true }));
                    archive.on('error', (err) => resolve({ success: false, error: err.message }));
                    archive.pipe(output);
                    archive.directory(worldPath, false);
                    archive.finalize();
                });
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:get-log', async (_, instanceName, filename) => {
            try {
                const instanceDir = path.join(instancesDir, instanceName);

                const logPath = filename === 'install.log'
                    ? path.join(instanceDir, filename)
                    : path.join(instanceDir, 'logs', filename);

                if (!await fs.pathExists(logPath)) return { success: false, error: 'Log file not found' };

                let content;
                if (filename.endsWith('.gz')) {
                    const buffer = await fs.readFile(logPath);
                    const decompressed = await gunzip(buffer);
                    content = decompressed.toString('utf8');
                } else {
                    content = await fs.readFile(logPath, 'utf8');
                }

                return { success: true, content };
            } catch (e) {
                console.error('Error reading log:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:upload-log', async (_, instanceName, filename = 'latest.log') => {
            try {
                const instanceDir = path.join(instancesDir, instanceName);
                const logPath = filename === 'install.log'
                    ? path.join(instanceDir, filename)
                    : path.join(instanceDir, 'logs', filename);

                if (!await fs.pathExists(logPath)) {
                    return { success: false, error: 'Log file not found' };
                }

                let content = '';
                if (filename.endsWith('.gz')) {
                    const buffer = await fs.readFile(logPath);
                    const decompressed = await gunzip(buffer);
                    content = decompressed.toString('utf8');
                } else {
                    content = await fs.readFile(logPath, 'utf8');
                }

                if (!content || !content.trim()) {
                    return { success: false, error: 'Log file is empty' };
                }

                const form = new URLSearchParams();
                form.append('content', content);

                const response = await axios.post('https://api.mclo.gs/1/log', form.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 15000
                });

                if (response?.data?.success && response?.data?.url) {
                    return { success: true, url: response.data.url };
                }

                return {
                    success: false,
                    error: response?.data?.error || 'Upload to mclo.gs failed'
                };
            } catch (e) {
                console.error('Error uploading log to mclo.gs:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:create', async (_, { name, version, loader, loaderVersion, icon, options }) => {
            try {
                instancesDir = resolvePrimaryInstancesDir();
                await fs.ensureDir(instancesDir);

                let finalName = name;
                let dir = path.join(instancesDir, finalName);
                let counter = 1;
                while (await fs.pathExists(dir)) {
                    finalName = `${name} (${counter})`;
                    dir = path.join(instancesDir, finalName);
                    counter++;
                }

                await fs.ensureDir(dir);
                try {
                    const settingsPath = path.join(appData, 'settings.json');
                    if (await fs.pathExists(settingsPath)) {
                        const settings = await fs.readJson(settingsPath);
                        if (settings.copySettingsEnabled && settings.copySettingsSourceInstance) {
                            const sourceDir = path.join(instancesDir, settings.copySettingsSourceInstance);
                            if (await fs.pathExists(sourceDir)) {
                                console.log(`Copying settings from ${settings.copySettingsSourceInstance} to ${finalName}`);
                                const filesToCopy = ['options.txt', 'optionsof.txt'];
                                for (const file of filesToCopy) {
                                    const srcFile = path.join(sourceDir, file);
                                    if (await fs.pathExists(srcFile)) {
                                        await fs.copy(srcFile, path.join(dir, file));
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to copy settings:', e);
                }
                const instanceType = typeof options?.instanceType === 'string' ? options.instanceType.trim() : '';
                const folderPath = typeof options?.folderPath === 'string' ? options.folderPath.trim() : '';
                const config = {
                    name: finalName,
                    version,
                    loader: loader || 'vanilla',
                    loaderVersion: null,
                    versionId: version,
                    icon: icon || null,
                    created: Date.now(),
                    playtime: 0,
                    lastPlayed: null,
                    status: 'installing'
                };

                if (instanceType) {
                    config.instanceType = instanceType;
                }
                if (folderPath) {
                    config.folderPath = folderPath;
                }

                await fs.writeJson(path.join(dir, 'instance.json'), config, { spaces: 4 });
                await fs.writeFile(path.join(dir, 'playtime.txt'), '0');
                await writeInstanceActionLog('create-instance', {
                    instanceName: finalName,
                    requestedName: name,
                    version,
                    loader,
                    loaderVersion,
                    folderPath: folderPath || null
                });
                console.log(`[Instance Create] Sending installing status for ${finalName}`);
                if (win && win.webContents) {
                    win.webContents.send('instance:status', { instanceName: finalName, status: 'installing' });
                    win.webContents.send('install:progress', { instanceName: finalName, progress: 1, status: 'Initializing...' });
                    console.log(`[Instance Create] Sent IPC events for ${finalName}`);
                } else {
                    console.error(`[Instance Create] win not available for ${finalName}!`);
                }
                await startBackgroundInstall(finalName, {
                    version,
                    loader,
                    loaderVersion
                });

                return { success: true, instanceName: finalName };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        console.log('Registering instance:reinstall handler...');
        ipcMain.handle('instance:reinstall', async (_, instanceName, type = 'soft') => {
            try {
                console.log(`[Instance Reinstall] ${instanceName}, type: ${type}`);
                await writeInstanceActionLog('reinstall-instance', {
                    instanceName,
                    reinstallType: type
                });
                const dir = path.join(instancesDir, instanceName);
                if (!await fs.pathExists(dir)) return { success: false, error: 'Instance not found' };

                const configPath = path.join(dir, 'instance.json');
                if (!await fs.pathExists(configPath)) return { success: false, error: 'Config missing' };

                const config = await fs.readJson(configPath);

                config.status = 'installing';
                await fs.writeJson(configPath, config, { spaces: 4 });
                invalidateMergedInstancesCache();
                win.webContents.send('instance:status', { instanceName, status: 'installing' });
                if (type === 'hard') {
                    console.log(`[Instance Reinstall] Performing HARD reinstall (wiping directory)`);
                    const files = await fs.readdir(dir);
                    for (const file of files) {
                        if (file === 'instance.json') continue;
                        await fs.remove(path.join(dir, file));
                    }
                }
                await startBackgroundInstall(instanceName, config, type === 'hard');

                return { success: true };

            } catch (e) {
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:get-loader-versions', async (_, loader, mcVersion) => {
            try {
                if (!loader || !mcVersion) return { success: false, error: 'Missing arguments' };
                const loaderName = loader.toLowerCase();

                if (loaderName === 'fabric') {
                    const res = await axios.get(`${FABRIC_META}/versions/loader/${mcVersion}`);
                    return { success: true, versions: res.data.map(v => v.loader) };
                } else if (loaderName === 'quilt') {
                    const res = await axios.get(`${QUILT_META}/versions/loader/${mcVersion}`);
                    return { success: true, versions: res.data.map(v => v.loader) };
                } else if (loaderName === 'forge') {
                    const versions = await fetchMavenVersions('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
                    const filtered = versions.filter(v => v.startsWith(mcVersion + '-'))
                        .map(v => {
                            return v.replace(mcVersion + '-', '');
                        });
                    if (filtered.length === 0) {
                        try {
                            const promoRes = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
                            const promos = promoRes.data.promos;

                            const relevant = Object.entries(promos).filter(([k]) => k.startsWith(mcVersion + '-'));
                            return {
                                success: true,
                                versions: relevant.map(([_, v]) => ({ version: v, stable: false }))
                            };
                        } catch (e) { }
                    }

                    return {
                        success: true,
                        versions: filtered.map(v => ({ version: v, stable: false }))
                    };

                } else if (loaderName === 'neoforge') {

                    const versions = await fetchMavenVersions('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
                    const filtered = versions.filter(v => {
                        if (v.startsWith(mcVersion + '-')) return true;
                        const shortMc = mcVersion.replace(/^1\./, '');
                        if (v.startsWith(shortMc + '.')) return true;
                        return false;
                    });

                    return {
                        success: true,
                        versions: filtered.map(v => ({ version: v, stable: false }))
                    };
                }

                return { success: true, versions: [] };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:get-supported-game-versions', async (_, loader) => {
            try {
                if (!loader) return { success: false, error: 'Missing loader argument' };
                const loaderName = loader.toLowerCase();
                const supportedVersions = new Set();

                if (loaderName === 'fabric') {
                    const res = await axios.get(`${FABRIC_META}/versions/game`);
                    res.data.forEach(v => supportedVersions.add(v.version));
                } else if (loaderName === 'quilt') {
                    const res = await axios.get(`${QUILT_META}/versions/game`);
                    res.data.forEach(v => supportedVersions.add(v.version));
                } else if (loaderName === 'forge') {
                    const versions = await fetchMavenVersions('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
                    versions.forEach(v => {

                        const dashIndex = v.indexOf('-');
                        if (dashIndex !== -1) {
                            const mcVer = v.substring(0, dashIndex);

                            if (/^\d+\.\d+(\.\d+)?$/.test(mcVer)) {
                                supportedVersions.add(mcVer);
                            }
                        }
                    });
                } else if (loaderName === 'neoforge') {
                    const versions = await fetchMavenVersions('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
                    if (versions && versions.length > 0) {
                        console.log(`[NeoForge Logic] Raw versions found: ${versions.length}. First 5: ${versions.slice(0, 5).join(', ')}`);
                    }

                    versions.forEach(v => {
                        if (v.includes('-')) {
                            const dashIndex = v.indexOf('-');
                            const mcVer = v.substring(0, dashIndex);
                            if (/^1\.\d+(\.\d+)?$/.test(mcVer)) {
                                supportedVersions.add(mcVer);
                            } else {
                                console.log(`[NeoForge Logic] Ignored (bad prefix): ${mcVer} from ${v}`);
                            }
                        } else {
                            const parts = v.split('.');
                            if (parts.length >= 2) {
                                const major = parseInt(parts[0]);
                                const minor = parseInt(parts[1]);
                                if (!isNaN(major) && !isNaN(minor)) {
                                    if (major >= 20) {
                                        let derivedVersion;
                                        if (minor === 0 && major === 21) derivedVersion = `1.${major}`;
                                        else if (minor === 1 && major === 21) derivedVersion = `1.${major}.1`;
                                        else derivedVersion = `1.${major}.${minor}`;

                                        supportedVersions.add(derivedVersion);
                                        if (major === 21) supportedVersions.add('1.21');
                                        if (major === 20 && minor === 6) supportedVersions.add('1.20.6');
                                    }
                                }
                            }
                        }
                    });
                }
                const sorted = Array.from(supportedVersions).sort((a, b) => {
                    return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
                });

                return { success: true, versions: sorted };

            } catch (e) {
                console.error('Error fetching supported game versions:', e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:update', async (_, instanceName, newConfig) => {
            try {
                const configPath = path.join(instancesDir, instanceName, 'instance.json');
                if (await fs.pathExists(configPath)) {
                    const current = await fs.readJson(configPath);
                    const safeNewConfig = sanitizeInstanceConfig(newConfig);
                    const updated = { ...current, ...safeNewConfig };
                    await withBusyFsRetry(() => fs.writeJson(configPath, updated, { spaces: 4 }));
                    invalidateMergedInstancesCache();
                    return { success: true };
                }
                return { success: false, error: 'Instance not found' };
            } catch (e) {
                if (isBusyFsError(e)) {
                    return { success: false, error: 'Instance files are currently busy/locked. Please wait until startup is finished and try again.' };
                }
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:set-folder-path', async (_, instanceRef, folderPath) => {
            try {
                const normalizedFolderPath = normalizeFolderPathValue(folderPath);
                const safeRef = instanceRef && typeof instanceRef === 'object'
                    ? instanceRef
                    : { name: String(instanceRef || '') };
                const localConfigPath = path.join(instancesDir, String(safeRef?.name || ''), 'instance.json');

                if (await fs.pathExists(localConfigPath)) {
                    const current = await fs.readJson(localConfigPath);
                    if (normalizedFolderPath) {
                        current.folderPath = normalizedFolderPath;
                    } else {
                        delete current.folderPath;
                    }
                    await withBusyFsRetry(() => fs.writeJson(localConfigPath, current, { spaces: 4 }));
                    invalidateMergedInstancesCache();
                    return { success: true, mode: 'local-config' };
                }

                const meta = await readInstanceFolderMeta();
                const metaKey = buildInstanceFolderMetaKey(safeRef);
                if (!metaKey || metaKey.endsWith(':')) {
                    return { success: false, error: 'Invalid instance reference' };
                }

                if (normalizedFolderPath) {
                    meta[metaKey] = normalizedFolderPath;
                } else {
                    delete meta[metaKey];
                }

                await writeInstanceFolderMeta(meta);
                invalidateMergedInstancesCache();
                return { success: true, mode: 'dashboard-meta' };
            } catch (e) {
                if (isBusyFsError(e)) {
                    return { success: false, error: 'Instance files are currently busy/locked. Please wait until startup is finished and try again.' };
                }
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:rename', async (_, oldName, newName) => {
            try {
                console.log(`Renaming instance: "${oldName}" -> "${newName}"`);
                console.log(`Instances dir: ${instancesDir}`);

                const trimmedNewName = String(newName || '').trim();
                if (!trimmedNewName) {
                    return { success: false, error: 'New name cannot be empty' };
                }

                if (/[\\/]/.test(trimmedNewName) || trimmedNewName === '.' || trimmedNewName === '..') {
                    return { success: false, error: 'Invalid instance name' };
                }

                if (String(oldName || '') === trimmedNewName) {
                    return { success: true };
                }

                const oldPath = path.join(instancesDir, oldName);
                const newPath = path.join(instancesDir, trimmedNewName);

                console.log(`Old path: ${oldPath}`);
                console.log(`Exists: ${await fs.pathExists(oldPath)}`);

                if (!await fs.pathExists(oldPath)) {
                    return { success: false, error: `Instance not found at: ${oldPath}` };
                }
                if (await fs.pathExists(newPath)) {
                    return { success: false, error: 'An instance with that name already exists' };
                }

                await withBusyFsRetry(() => fs.rename(oldPath, newPath));

                let configPath = path.join(newPath, 'instance.json');
                if (!await fs.pathExists(configPath)) {
                    // Some packs may contain a differently-cased filename (works on Windows, fails on Linux).
                    const dirEntries = await fs.readdir(newPath, { withFileTypes: true });
                    const matched = dirEntries.find((entry) => {
                        return entry.isFile() && String(entry.name || '').toLowerCase() === 'instance.json';
                    });
                    if (matched) {
                        configPath = path.join(newPath, matched.name);
                    }
                }

                if (await fs.pathExists(configPath)) {
                    const rawConfig = await fs.readJson(configPath);
                    const config = sanitizeInstanceConfig(rawConfig);
                    config.name = trimmedNewName;
                    await withBusyFsRetry(() => fs.writeJson(configPath, config, { spaces: 4 }));
                }

                invalidateMergedInstancesCache();

                return { success: true };
            } catch (e) {
                if (isBusyFsError(e)) {
                    return { success: false, error: 'Could not rename instance because files are busy/locked. Stop the instance and try again.' };
                }
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:duplicate', async (_, instanceName) => {
            let newName = `${instanceName} (Copy)`;
            try {
                const sourcePath = path.join(instancesDir, instanceName);
                if (!await fs.pathExists(sourcePath)) {
                    return { success: false, error: 'Instance not found' };
                }
                let counter = 2;
                while (await fs.pathExists(path.join(instancesDir, newName))) {
                    newName = `${instanceName} (Copy ${counter})`;
                    counter++;
                }

                // Count total items for progress tracking
                let totalItems = 0;
                let copiedItems = 0;
                const countEntries = async (dir) => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        totalItems++;
                        if (entry.isDirectory()) {
                            await countEntries(path.join(dir, entry.name));
                        }
                    }
                };
                await countEntries(sourcePath);
                if (totalItems === 0) totalItems = 1;

                if (win && win.webContents) {
                    win.webContents.send('install:progress', { instanceName: newName, progress: 1, status: 'Duplicating...', type: 'duplicate' });
                }

                const destPath = path.join(instancesDir, newName);
                let lastReportedProgress = 1;
                await fs.copy(sourcePath, destPath, {
                    filter: (src) => {
                        copiedItems++;
                        const progress = Math.min(99, Math.floor((copiedItems / totalItems) * 99));
                        if (progress !== lastReportedProgress && win && win.webContents) {
                            lastReportedProgress = progress;
                            win.webContents.send('install:progress', { instanceName: newName, progress, status: 'Duplicating...', type: 'duplicate' });
                        }
                        return true;
                    }
                });

                const configPath = path.join(destPath, 'instance.json');
                if (await fs.pathExists(configPath)) {
                    const rawConfig = await fs.readJson(configPath);
                    const config = sanitizeInstanceConfig(rawConfig);
                    config.name = newName;
                    config.created = Date.now();
                    config.playtime = 0;
                    config.lastPlayed = null;
                    await fs.writeJson(configPath, config, { spaces: 4 });
                }

                invalidateMergedInstancesCache();

                if (win && win.webContents) {
                    win.webContents.send('install:progress', { instanceName: newName, progress: 100, status: 'Done', type: 'duplicate' });
                }

                return { success: true, newName };
            } catch (e) {
                if (win && win.webContents) {
                    win.webContents.send('install:progress', { instanceName: newName, progress: 100, status: 'Error', type: 'duplicate' });
                }
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('dialog:open-file', async (_, options = {}) => {
            const defaultFilters = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }];
            const { canceled, filePaths } = await dialog.showOpenDialog({
                properties: options.properties || ['openFile'],
                filters: options.filters || defaultFilters
            });
            return { canceled, filePaths };
        });

        ipcMain.handle('instance:open-folder', async (_, instanceName) => {
            try {
                const mergedInstances = await getMergedInstances();
                const normalizedName = String(instanceName || '').trim().toLowerCase();
                const externalInstance = mergedInstances.find((entry) => {
                    const entryName = String(entry?.name || '').trim().toLowerCase();
                    return entryName === normalizedName && String(entry?.instanceType || '').toLowerCase() === 'external';
                });

                const externalPath = String(externalInstance?.externalPath || '').trim();
                if (externalPath && await fs.pathExists(externalPath)) {
                    await shell.openPath(externalPath);
                    return { success: true };
                }

                const localInstancePath = path.join(instancesDir, instanceName);
                if (await fs.pathExists(localInstancePath)) {
                    await shell.openPath(localInstancePath);
                    return { success: true };
                }

                return { success: false, error: 'Instance folder not found' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:reset-config', async (_, instanceName) => {
            try {
                const { baseDir } = await resolveInstanceBaseDir(instanceName);
                if (!await fs.pathExists(baseDir)) {
                    return { success: false, error: 'Instance folder does not exist' };
                }

                const configDir = path.join(baseDir, 'config');
                const optionsFile = path.join(baseDir, 'options.txt');

                if (await fs.pathExists(configDir)) {
                    await fs.remove(configDir);
                }
                if (await fs.pathExists(optionsFile)) {
                    await fs.remove(optionsFile);
                }

                console.log(`[Instance:ResetConfig] Reset config for ${instanceName}`);
                return { success: true };
            } catch (e) {
                console.error(`[Instance:ResetConfig] Error:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:delete', async (_, name) => {
            try {
                console.log(`[Instance:Delete] Request to delete ${name}`);
                const task = activeTasks.get(name);
                if (task) {
                    console.log(`[Instance:Delete] Aborting installation for ${name}`);
                    task.abort();
                    activeTasks.delete(name);
                }
                await new Promise(resolve => setTimeout(resolve, 500));

                const normalizedName = String(name || '').trim().toLowerCase();
                const mergedInstances = await getMergedInstances();
                const matchedExternalInstance = mergedInstances.find((entry) => {
                    const entryName = String(entry?.name || '').trim().toLowerCase();
                    return entryName === normalizedName && String(entry?.instanceType || '').toLowerCase() === 'external';
                });

                const externalPath = String(matchedExternalInstance?.externalPath || '').trim();
                const dir = externalPath || path.join(instancesDir, name);

                if (!await fs.pathExists(dir)) {
                    return { success: true };
                }
                const maxRetries = 5;
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        await fs.remove(dir);
                        console.log(`[Instance:Delete] Successfully deleted ${name}`);
                        break;
                    } catch (err) {
                        if (i === maxRetries - 1) throw err;
                        console.warn(`[Instance:Delete] Attempt ${i + 1} failed, retrying in 1s... (${err.message})`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
                win.webContents.send('instance:status', { instanceName: name, status: 'deleted' });
                invalidateMergedInstancesCache();

                return { success: true };
            } catch (e) {
                console.error(`[Instance:Delete] Failed to delete ${name}:`, e);
                return { success: false, error: `Failed to delete instance: ${e.message}` };
            }
        });
        ipcMain.handle('instance:get-mods', async (_, instanceName) => {
            try {
                const mergedInstances = await getMergedInstances();
                const normalizedName = String(instanceName || '').trim().toLowerCase();
                const externalInstance = mergedInstances.find((entry) => {
                    const entryName = String(entry?.name || '').trim().toLowerCase();
                    return entryName === normalizedName && String(entry?.instanceType || '').toLowerCase() === 'external';
                });

                const resolvedBaseDir = (() => {
                    const externalPath = String(externalInstance?.externalPath || '').trim();
                    if (externalPath) return externalPath;
                    return path.join(instancesDir, instanceName);
                })();

                const modsDir = path.join(resolvedBaseDir, 'mods');
                await fs.ensureDir(modsDir);
                const modCachePath = path.join(appData, 'mod_cache.json');
                let modCache = {};
                try {
                    if (await fs.pathExists(modCachePath)) {
                        modCache = await fs.readJson(modCachePath);
                    }
                } catch (e) {
                    console.error('Failed to load mod cache', e);
                }

                const saveModCache = async () => {
                    try {
                        await fs.writeJson(modCachePath, modCache);
                    } catch (e) { console.error('Failed to save mod cache', e); }
                };

                const cacheUpdates = {};

                const files = await fs.readdir(modsDir);
                const jars = files.filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled') || f.endsWith('.litemod'));

                const modObjects = (await Promise.all(jars.map(async (fileName) => {
                    try {
                        const filePath = path.join(modsDir, fileName);
                        const stats = await fs.stat(filePath);
                        const isEnabled = !fileName.endsWith('.disabled');
                        let title = null;
                        let icon = null;
                        let version = null;

                        const cacheKey = `${fileName}-${stats.size}`;
                        if (modCache[cacheKey] && modCache[cacheKey].projectId) {
                            title = modCache[cacheKey].title;
                            icon = modCache[cacheKey].icon;
                            version = modCache[cacheKey].version;
                        } else {

                            try {
                                const hash = await calculateSha1(filePath);
                                if (modCache[hash]) {
                                    console.log(`[Instances] Found legacy SHA1 cache for ${fileName}`);
                                    title = modCache[hash].title;
                                    icon = modCache[hash].icon;
                                    version = modCache[hash].version;
                                    const projectId = modCache[hash].projectId;
                                    const versionId = modCache[hash].versionId;
                                    const source = modCache[hash].source || 'modrinth';
                                    const entry = { title, icon, version, projectId, versionId, hash, source };
                                    modCache[cacheKey] = entry;
                                    cacheUpdates[cacheKey] = entry;
                                } else {
                                    const res = await axios.get(`https://api.modrinth.com/v2/version_file/${hash}`, {
                                        headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                        timeout: 3000
                                    });
                                    const versionData = res.data;

                                    if (versionData && versionData.project_id) {

                                        const projectRes = await axios.get(`https://api.modrinth.com/v2/project/${versionData.project_id}`, {
                                            headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                            timeout: 3000
                                        });
                                        const projectData = projectRes.data;

                                        title = projectData.title;
                                        icon = await downloadAndCacheIcon(projectData.icon_url);
                                        version = versionData.version_number;
                                        const projectId = projectData.id;
                                        const versionId = versionData.id;
                                        const entry = { title, icon: icon || projectData.icon_url, version, hash, projectId, versionId, source: 'modrinth' };
                                        modCache[cacheKey] = entry;
                                        cacheUpdates[cacheKey] = entry;
                                    }
                                }
                            } catch (apiErr) {

                            }
                        }

                        return {
                            name: fileName,
                            path: filePath,
                            size: stats.size,
                            enabled: isEnabled,
                            title: title || fileName,
                            icon: icon,
                            version: version,
                            projectId: modCache[cacheKey]?.projectId,
                            versionId: modCache[cacheKey]?.versionId,
                            source: modCache[cacheKey]?.source || 'modrinth'
                        };
                    } catch (e) {
                        console.error(`Error processing mod ${fileName}:`, e);
                        return null;
                    }
                }))).filter(m => m !== null);
                if (Object.keys(cacheUpdates).length > 0) {
                    try {
                        const currentDisk = await fs.readJson(modCachePath).catch(() => ({}));
                        const merged = { ...currentDisk, ...cacheUpdates };
                        await fs.writeJson(modCachePath, merged);
                    } catch (e) { console.error('Failed to save mod cache updates', e); }
                }

                return { success: true, mods: modObjects };
            } catch (e) {
                console.error('Failed to get mods:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:toggle-mod', async (_, instanceName, modFileName) => {
            try {
                const modsDir = path.join(instancesDir, instanceName, 'mods');
                const oldPath = path.join(modsDir, modFileName);

                let newName;
                if (modFileName.endsWith('.disabled')) {
                    newName = modFileName.replace('.disabled', '');
                } else {
                    newName = modFileName + '.disabled';
                }

                await fs.rename(oldPath, path.join(modsDir, newName));
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:delete-mod', async (_, instanceName, modFileName, projectType = 'mod') => {
            try {
                let folder = 'mods';
                if (projectType === 'resourcepack') folder = 'resourcepacks';
                if (projectType === 'shader') folder = 'shaderpacks';

                const contentDir = path.join(instancesDir, instanceName, folder);
                const modPath = path.join(contentDir, modFileName);

                console.log(`[Instance:Delete] Request: ${instanceName} / ${folder} / ${modFileName}`);
                console.log(`[Instance:Delete] Target Path: ${modPath}`);

                if (!await fs.pathExists(modPath)) {
                    console.warn(`[Instance:Delete] Path does not exist: ${modPath}`);
                    return { success: true };
                }

                await fs.remove(modPath);
                if (await fs.pathExists(modPath)) {
                    console.error(`[Instance:Delete] FAILED: File still exists at ${modPath}`);
                    return { success: false, error: 'File could not be removed (is it locked?)' };
                }

                console.log(`[Instance:Delete] SUCCESS: Deleted ${modPath}`);
                return { success: true };
            } catch (e) {
                console.error(`[Instance:Delete] Error deleting ${modFileName}:`, e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:check-updates', async (_, instanceName, contentList) => {

            try {
                const configPath = path.join(instancesDir, instanceName, 'instance.json');
                const config = await fs.readJson(configPath);
                const mcVersion = config.version;
                const mcVersionAliases = buildGameVersionAliases(mcVersion);
                const loader = config.loader ? config.loader.toLowerCase() : 'vanilla';

                const results = await Promise.all(contentList.map(async (item) => {
                    if (!item.projectId) return { ...item, hasUpdate: false };

                    try {
                        const source = String(item.source || '').toLowerCase();
                        const isCurseForgeItem = source === 'curseforge' || String(item.projectId).startsWith(CURSEFORGE_PROJECT_PREFIX);

                        if (isCurseForgeItem) {
                            const numericProjectId = Number.parseInt(String(item.projectId).replace(CURSEFORGE_PROJECT_PREFIX, ''), 10);
                            if (!Number.isFinite(numericProjectId)) {
                                return { ...item, hasUpdate: false };
                            }

                            const filesResponse = await axios.get(`${CURSEFORGE_API}/mods/${numericProjectId}/files`, {
                                params: {
                                    pageSize: 100,
                                    index: 0
                                },
                                headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                timeout: 5000
                            });

                            const allFiles = Array.isArray(filesResponse?.data?.data) ? filesResponse.data.data : [];
                            const targetLoader = (item.type === 'resourcepack' || item.type === 'shader') ? 'vanilla' : loader;
                            const compatibleFiles = allFiles
                                .filter(file => isCurseForgeAutoInstallLoaderCompatible(file, targetLoader))
                                .filter(file => isCurseForgeAutoInstallVersionCompatible(file, mcVersionAliases))
                                .sort((left, right) => new Date(right?.fileDate || 0).getTime() - new Date(left?.fileDate || 0).getTime());

                            const latest = compatibleFiles[0] || allFiles
                                .sort((left, right) => new Date(right?.fileDate || 0).getTime() - new Date(left?.fileDate || 0).getTime())[0];

                            if (!latest) {
                                return { ...item, hasUpdate: false };
                            }

                            const currentVersionId = String(item.versionId || '').replace('cf-file:', '');
                            if (String(latest.id) !== currentVersionId) {
                                return {
                                    ...item,
                                    hasUpdate: true,
                                    newVersionId: `cf-file:${latest.id}`,
                                    newVersionNumber: latest.displayName || latest.fileName,
                                    downloadUrl: latest.downloadUrl,
                                    filename: latest.fileName
                                };
                            }

                            return { ...item, hasUpdate: false };
                        }

                        const isVisualContent = item.type === 'resourcepack' || item.type === 'shader';
                        const loaders = isVisualContent ? [] : [loader];
                        const normalizedProjectId = String(item.projectId || '').startsWith(MODRINTH_PROJECT_PREFIX)
                            ? String(item.projectId || '').slice(MODRINTH_PROJECT_PREFIX.length)
                            : item.projectId;
                        const versionQueryCandidates = [];

                        if (isVisualContent) {
                            versionQueryCandidates.push({
                                game_versions: JSON.stringify(mcVersionAliases)
                            });
                            versionQueryCandidates.push({});
                        } else {
                            versionQueryCandidates.push({
                                loaders: JSON.stringify(loaders),
                                game_versions: JSON.stringify(mcVersionAliases)
                            });
                        }

                        let versions = [];
                        for (const params of versionQueryCandidates) {
                            const response = await axios.get(`https://api.modrinth.com/v2/project/${normalizedProjectId}/version`, {
                                params,
                                headers: { 'User-Agent': 'Client/Lux/1.0 (fernsehheft@pluginhub.de)' },
                                timeout: 5000
                            });
                            versions = Array.isArray(response.data) ? response.data : [];
                            if (versions.length > 0) {
                                break;
                            }
                        }

                        if (versions.length > 0) {
                            const latest = versions[0];
                            if (latest.id !== item.versionId) {
                                return {
                                    ...item,
                                    hasUpdate: true,
                                    newVersionId: latest.id,
                                    newVersionNumber: latest.version_number,
                                    downloadUrl: latest.files.find(f => f.primary)?.url || latest.files[0]?.url,
                                    filename: latest.files.find(f => f.primary)?.filename || latest.files[0]?.filename
                                };
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to check update for ${item.projectId}:`, e.message);
                    }
                    return { ...item, hasUpdate: false };
                }));

                return { success: true, updates: results.filter(r => r.hasUpdate) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:export', async (_, instanceName) => {
            try {
                const { baseDir: instancePath, externalInstance } = await resolveInstanceBaseDir(instanceName);
                if (!instancePath || !await fs.pathExists(instancePath)) {
                    return { success: false, error: 'Instance not found' };
                }
                const { filePath } = await dialog.showSaveDialog({
                    title: 'Export Instance',
                    defaultPath: `${instanceName}.mcpack`,
                    filters: [{ name: 'Modpack', extensions: ['mcpack'] }]
                });

                if (!filePath) return { success: false, error: 'Cancelled' };
                const output = fs.createWriteStream(filePath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                archive.pipe(output);
                const instanceConfigPath = path.join(instancePath, 'instance.json');
                if (await fs.pathExists(instanceConfigPath)) {
                    archive.file(instanceConfigPath, { name: 'instance.json' });
                } else {
                    const fallbackConfig = sanitizeInstanceConfig({
                        name: externalInstance?.name || instanceName,
                        version: externalInstance?.version,
                        loader: externalInstance?.loader,
                        icon: externalInstance?.icon,
                        loaderVersion: externalInstance?.loaderVersion,
                        created: externalInstance?.created || Date.now(),
                        playtime: externalInstance?.playtime || 0,
                        lastPlayed: externalInstance?.lastPlayed || null,
                        folderPath: externalInstance?.folderPath || '',
                        instanceType: externalInstance?.instanceType,
                        externalSource: externalInstance?.externalSource,
                        externalPath: externalInstance?.externalPath
                    });
                    archive.append(JSON.stringify(fallbackConfig, null, 4), { name: 'instance.json' });
                }
                const modsPath = path.join(instancePath, 'mods');
                if (await fs.pathExists(modsPath)) {
                    archive.directory(modsPath, 'mods');
                }
                const configPath = path.join(instancePath, 'config');
                if (await fs.pathExists(configPath)) {
                    archive.directory(configPath, 'config');
                }

                await archive.finalize();

                return new Promise((resolve) => {
                    output.on('close', () => resolve({ success: true, path: filePath }));
                    output.on('error', (err) => resolve({ success: false, error: err.message }));
                });
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:install-modpack', async (_, url, name, iconUrl) => {
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            console.log(`[Modpack:Install] TRIGGERED for ${name}`);
            console.log(`[Modpack:Install] URL: ${url}`);
            console.log(`[Modpack:Install] ICON_URL: ${iconUrl}`);
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            try {
                await writeInstanceActionLog('install-modpack-url', {
                    instanceName: name,
                    url,
                    iconUrl: iconUrl || null
                });
                const tempPath = path.join(os.tmpdir(), `lux-modpack-${Date.now()}.mrpack`);
                if (win && win.webContents) {
                    win.webContents.send('install:progress', { instanceName: name, progress: 1, status: 'Downloading Modpack...' });
                }

                await downloadFile(url, tempPath);
                console.log(`[Modpack:Install] Downloaded to ${tempPath}`);

                const result = await installMrPack(tempPath, name, iconUrl);
                await fs.remove(tempPath);

                return result;
            } catch (e) {
                console.error('[Modpack:Install] Error:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:migration-preview', async (_, instanceName, nextConfig) => {
            try {
                const configPath = path.join(instancesDir, instanceName, 'instance.json');
                if (!await fs.pathExists(configPath)) throw new Error('Instance not found');

                const currentConfig = await fs.readJson(configPath);
                const safeNextConfig = sanitizeInstanceConfig(nextConfig);
                const targetVersion = safeNextConfig.version || currentConfig.version;
                const targetLoader = safeNextConfig.loader || currentConfig.loader;
                const instanceDir = path.join(instancesDir, instanceName);

                const plan = await buildMigrationPlan({
                    instanceDir,
                    targetVersion,
                    targetLoader
                });

                return {
                    success: true,
                    summary: plan.summary,
                    unresolved: plan.unresolved.map((item) => ({
                        id: item.id,
                        name: item.name,
                        title: item.title,
                        projectType: item.projectType,
                        reason: item.reason
                    }))
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('instance:migrate', async (_, instanceName, newConfig) => {
            try {
                console.log(`[Instance:Migrate] Starting migration for ${instanceName}`);
                const configPath = path.join(instancesDir, instanceName, 'instance.json');
                if (!await fs.pathExists(configPath)) throw new Error('Instance not found');

                const currentConfig = await fs.readJson(configPath);
                const removeUnresolvedIds = Array.isArray(newConfig?.removeUnresolvedIds)
                    ? newConfig.removeUnresolvedIds.map((entry) => String(entry || '').trim()).filter(Boolean)
                    : [];
                const safeNewConfig = sanitizeInstanceConfig(newConfig);
                const finalConfig = { ...currentConfig, ...safeNewConfig, status: 'installing' };
                await fs.writeJson(configPath, finalConfig, { spaces: 4 });
                await writeInstanceActionLog('migrate-instance', {
                    instanceName,
                    fromVersion: currentConfig.version,
                    fromLoader: currentConfig.loader,
                    toVersion: finalConfig.version,
                    toLoader: finalConfig.loader,
                    removeUnresolvedIds
                });

                if (win && win.webContents) {
                    win.webContents.send('instance:status', { instanceName, status: 'installing' });
                    win.webContents.send('install:progress', { instanceName, progress: 1, status: 'Starting migration...' });
                }

                startBackgroundInstall(instanceName, finalConfig, false, true, {
                    removeUnresolvedIds
                }).catch(e => {
                    console.error(`[Instance:Migrate] Background migration error for ${instanceName}:`, e);
                });

                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:install-local-mod', async (_, instanceName, filePath, projectType = 'mod') => {
            try {
                let folder = 'mods';
                if (projectType === 'resourcepack') folder = 'resourcepacks';
                if (projectType === 'shader') folder = 'shaderpacks';
                const destDir = path.join(instancesDir, instanceName, folder);
                await fs.ensureDir(destDir);

                const fileName = path.basename(filePath);
                const destPath = path.join(destDir, fileName);
                await fs.copy(filePath, destPath);

                console.log(`[Content:InstallLocal] Copied ${projectType}: ${fileName} to ${instanceName}`);
                return { success: true };
            } catch (e) {
                console.error(`[Content:InstallLocal] Error adding content to ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:list-files', async (_, instanceName, relativePath = '') => {
            try {
                const { targetPath } = await resolveInstanceTargetPath(instanceName, relativePath);

                if (!await fs.pathExists(targetPath)) {
                    return { success: false, error: 'Directory not found' };
                }

                const stats = await fs.stat(targetPath);
                if (!stats.isDirectory()) {
                    return { success: false, error: 'Target is not a directory' };
                }

                const entries = await fs.readdir(targetPath);
                const files = await Promise.all(entries.map(async (entry) => {
                    const entryPath = path.join(targetPath, entry);
                    const entryStats = await fs.stat(entryPath);
                    return {
                        name: entry,
                        isDirectory: entryStats.isDirectory(),
                        size: entryStats.size,
                        mtime: entryStats.mtime
                    };
                }));

                return { success: true, files };
            } catch (e) {
                console.error(`[Instance:Files] Error listing files for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:read-file', async (_, instanceName, relativePath) => {
            try {
                const { targetPath } = await resolveInstanceTargetPath(instanceName, relativePath);

                if (!await fs.pathExists(targetPath)) {
                    return { success: false, error: 'File not found' };
                }

                const stats = await fs.stat(targetPath);
                if (!stats.isFile()) {
                    return { success: false, error: 'Target is not a file' };
                }

                const content = await fs.readFile(targetPath, 'utf-8');
                return { success: true, content };
            } catch (e) {
                console.error(`[Instance:Files] Error reading file for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:write-file', async (_, instanceName, relativePath, content) => {
            try {
                const { targetPath, baseDir } = await resolveInstanceTargetPath(instanceName, relativePath);

                if (targetPath === baseDir) {
                    return { success: false, error: 'Access denied' };
                }

                await fs.ensureDir(path.dirname(targetPath));
                await fs.writeFile(targetPath, content, 'utf-8');
                return { success: true };
            } catch (e) {
                console.error(`[Instance:Files] Error writing file for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:delete-file', async (_, instanceName, relativePath) => {
            try {
                const { targetPath, baseDir } = await resolveInstanceTargetPath(instanceName, relativePath);

                if (targetPath === baseDir) {
                    return { success: false, error: 'Access denied' };
                }

                await fs.remove(targetPath);
                return { success: true };
            } catch (e) {
                console.error(`[Instance:Files] Error deleting path for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:create-directory', async (_, instanceName, relativePath) => {
            try {
                const { targetPath, baseDir } = await resolveInstanceTargetPath(instanceName, relativePath);

                if (targetPath === baseDir) {
                    return { success: false, error: 'Access denied' };
                }

                await fs.ensureDir(targetPath);
                return { success: true };
            } catch (e) {
                console.error(`[Instance:Files] Error creating directory for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:upload-file', async (_, instanceName, relativePath, localFilePath) => {
            try {
                const sourcePath = String(localFilePath || '').trim();
                if (!sourcePath) {
                    return { success: false, error: 'Missing local file path' };
                }

                const { targetPath, baseDir } = await resolveInstanceTargetPath(instanceName, relativePath);
                if (targetPath === baseDir) {
                    return { success: false, error: 'Access denied' };
                }

                await fs.ensureDir(path.dirname(targetPath));
                await fs.copy(sourcePath, targetPath);
                return { success: true };
            } catch (e) {
                console.error(`[Instance:Files] Error uploading file for ${instanceName}:`, e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('instance:update-file', async (_, data) => {
            console.log(`Updating file for ${data.instanceName}: ${data.oldFileName} -> ${data.newFileName}`);
            try {
                const instancePath = path.join(instancesDir, data.instanceName);
                let subDir = 'mods';
                if (data.projectType === 'resourcepack') subDir = 'resourcepacks';
                if (data.projectType === 'shader') subDir = 'shaderpacks';

                const targetDir = path.join(instancePath, subDir);

                const oldPath = path.join(targetDir, data.oldFileName);
                if (await fs.pathExists(oldPath)) {
                    await fs.remove(oldPath);
                }

                const newPath = path.join(targetDir, data.newFileName);
                await downloadFile(data.url, newPath);

                const modCachePath = path.join(appData, 'mod_cache.json');
                return { success: true };
            } catch (e) {
                console.error('Update failed:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('tools:compatibility-scan', async (_, instanceName, targetVersion, targetLoader) => {
            const sendLog = (msg) => {
                if (win && win.webContents) win.webContents.send('tools:compatibility-log', { msg });
            };
            try {
                sendLog(`[Scan] Instance: "${instanceName}"`);
                sendLog(`[Scan] Target: ${targetLoader} ${targetVersion}`);

                const { baseDir } = await resolveInstanceBaseDir(instanceName);
                if (!baseDir || !await fs.pathExists(baseDir)) {
                    sendLog('[Scan] ERROR: Instance directory not found');
                    return { success: false, error: 'Instance not found' };
                }
                sendLog(`[Scan] Instance directory resolved: ${baseDir}`);
                sendLog('[Scan] Building migration plan — fetching mod metadata…');

                const plan = await buildMigrationPlan({
                    instanceDir: baseDir,
                    targetVersion,
                    targetLoader
                });

                sendLog(`[Scan] Plan ready — ${plan.updates.length} entries resolvable, ${plan.unresolved.length} unresolved`);
                sendLog('[Scan] Analysing entries…');

                const detailed = [];
                for (const updateEntry of plan.updates) {
                    const currentProjectId = normalizeProjectIdForComparison(updateEntry?.projectId);
                    const nextProjectId = normalizeProjectIdForComparison(updateEntry?.update?.projectId);
                    const sameProject = currentProjectId && nextProjectId && currentProjectId === nextProjectId;
                    const sameVersion = String(updateEntry?.versionId || '').trim() !== ''
                        && String(updateEntry?.update?.versionId || '').trim() !== ''
                        && String(updateEntry.versionId).trim() === String(updateEntry.update.versionId).trim();

                    let status = 'update_available';
                    if (sameProject && sameVersion) status = 'compatible';
                    else if (!sameProject && nextProjectId) status = 'replaced_by_other_project';

                    const label = updateEntry.title || updateEntry.name || updateEntry.id || '(unknown)';
                    if (status === 'compatible') {
                        sendLog(`  ✓  ${label} — already compatible with ${targetLoader} ${targetVersion}`);
                    } else if (status === 'update_available') {
                        const nextLabel = updateEntry.update?.versionLabel || updateEntry.update?.fileName || updateEntry.update?.versionId || '?';
                        sendLog(`  ↑  ${label} — update available → ${nextLabel}`);
                    } else if (status === 'replaced_by_other_project') {
                        const replaceName = updateEntry.update?.title || updateEntry.update?.name || updateEntry.update?.projectId || '?';
                        sendLog(`  ⇄  ${label} — replaced by different project: ${replaceName}`);
                    }

                    detailed.push({
                        id: updateEntry.id,
                        name: updateEntry.name,
                        title: updateEntry.title,
                        projectType: updateEntry.projectType,
                        status,
                        currentProjectId: updateEntry.projectId || null,
                        currentVersionId: updateEntry.versionId || null,
                        nextProjectId: updateEntry.update?.projectId || null,
                        nextVersionId: updateEntry.update?.versionId || null,
                        nextVersionLabel: updateEntry.update?.versionLabel || null,
                        nextFileName: updateEntry.update?.fileName || null
                    });
                }

                for (const unresolved of plan.unresolved) {
                    const label = unresolved.title || unresolved.name || unresolved.id || '(unknown)';
                    sendLog(`  ✗  ${label} — no compatible version found (${unresolved.reason || 'not-found'})`);
                    detailed.push({
                        id: unresolved.id,
                        name: unresolved.name,
                        title: unresolved.title,
                        projectType: unresolved.projectType,
                        status: 'no_match',
                        reason: unresolved.reason || 'not-found'
                    });
                }

                const summary = {
                    total: detailed.length,
                    compatible: detailed.filter((item) => item.status === 'compatible').length,
                    updateAvailable: detailed.filter((item) => item.status === 'update_available').length,
                    replaced: detailed.filter((item) => item.status === 'replaced_by_other_project').length,
                    noMatch: detailed.filter((item) => item.status === 'no_match').length
                };

                sendLog(`[Scan] Done — Total: ${summary.total}  Compatible: ${summary.compatible}  Updates: ${summary.updateAvailable}  Replaced: ${summary.replaced}  No match: ${summary.noMatch}`);
                return { success: true, summary, items: detailed };
            } catch (error) {
                sendLog(`[Scan] ERROR: ${error.message}`);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:compatibility-apply', async (_, instanceName, targetVersion, targetLoader, options = {}) => {
            try {
                const configPath = path.join(instancesDir, instanceName, 'instance.json');
                if (!await fs.pathExists(configPath)) {
                    return { success: false, error: 'Instance not found' };
                }

                const currentConfig = await fs.readJson(configPath);
                const plan = await buildMigrationPlan({
                    instanceDir: path.join(instancesDir, instanceName),
                    targetVersion,
                    targetLoader
                });

                const removeNoMatch = Boolean(options?.removeNoMatch);
                const removeUnresolvedIds = removeNoMatch ? plan.unresolved.map((entry) => entry.id) : [];

                const nextConfig = {
                    ...currentConfig,
                    version: targetVersion || currentConfig.version,
                    loader: targetLoader || currentConfig.loader,
                    status: 'installing'
                };

                await fs.writeJson(configPath, nextConfig, { spaces: 4 });
                await writeInstanceActionLog('tools-compatibility-apply', {
                    instanceName,
                    fromVersion: currentConfig.version,
                    fromLoader: currentConfig.loader,
                    toVersion: nextConfig.version,
                    toLoader: nextConfig.loader,
                    removeNoMatch,
                    unresolvedCount: plan.unresolved.length
                });

                if (win && win.webContents) {
                    win.webContents.send('instance:status', { instanceName, status: 'installing' });
                    win.webContents.send('install:progress', {
                        instanceName,
                        progress: 1,
                        status: 'Applying compatibility fixes...'
                    });
                }

                startBackgroundInstall(instanceName, nextConfig, false, true, {
                    removeUnresolvedIds
                }).catch((error) => {
                    console.error('[Tools] Compatibility apply failed:', error);
                });

                return {
                    success: true,
                    summary: {
                        updatable: plan.updates.length,
                        unresolved: plan.unresolved.length,
                        removedUnresolved: removeUnresolvedIds.length
                    }
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:world-manager-list', async (_, instanceName) => {
            try {
                const { baseDir } = await resolveInstanceBaseDir(instanceName);
                if (!baseDir || !await fs.pathExists(baseDir)) {
                    return { success: false, error: 'Instance not found' };
                }

                const savesDir = path.join(baseDir, 'saves');
                if (!await fs.pathExists(savesDir)) {
                    return { success: true, worlds: [] };
                }

                const worlds = [];
                const entries = await fs.readdir(savesDir, { withFileTypes: true });

                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;

                    const worldDir = path.join(savesDir, entry.name);
                    const levelDatPath = path.join(worldDir, 'level.dat');
                    const regionDir = path.join(worldDir, 'region');

                    let lastPlayed = 0;
                    let worldName = entry.name;
                    let seed = null;
                    let size = 0;

                    try {
                        const stats = await fs.stat(worldDir);
                        lastPlayed = stats.mtimeMs;
                    } catch {
                        lastPlayed = Date.now();
                    }

                    try {
                        size = await getFolderSize(worldDir);
                    } catch {
                        size = 0;
                    }

                    const issues = [];
                    if (!await fs.pathExists(levelDatPath)) {
                        issues.push({ type: 'missing-leveldat', message: 'level.dat missing' });
                    } else {
                        try {
                            const buffer = await fs.readFile(levelDatPath);
                            const { parsed } = await nbt.parse(buffer);
                            const data = parsed?.value?.Data?.value || {};
                            worldName = data?.LevelName?.value || worldName;
                            const parsedSeed = extractSeedFromLevelDat(data);
                            if (Number.isFinite(parsedSeed)) seed = parsedSeed;
                            const parsedLastPlayed = parseNbtLong(data?.LastPlayed?.value);
                            if (Number.isFinite(parsedLastPlayed) && parsedLastPlayed > 0) {
                                lastPlayed = parsedLastPlayed;
                            }
                        } catch (error) {
                            issues.push({ type: 'invalid-leveldat', message: `Failed to parse level.dat: ${error.message}` });
                        }
                    }

                    if (await fs.pathExists(regionDir)) {
                        let regionFiles = [];
                        try {
                            regionFiles = (await fs.readdir(regionDir)).filter((name) => name.endsWith('.mca'));
                        } catch {
                            regionFiles = [];
                        }

                        for (const regionFile of regionFiles) {
                            const regionPath = path.join(regionDir, regionFile);
                            try {
                                const stats = await fs.stat(regionPath);
                                if (stats.size < 8192) {
                                    issues.push({ type: 'corrupt-region', file: regionFile, message: 'Region header too small (<8192 bytes)' });
                                }
                            } catch (error) {
                                issues.push({ type: 'missing-region', file: regionFile, message: `Failed to read region file: ${error.message}` });
                            }
                        }
                    } else {
                        issues.push({ type: 'missing-region-dir', message: 'region folder missing' });
                    }

                    worlds.push({
                        folderName: entry.name,
                        name: worldName,
                        size,
                        lastPlayed,
                        seed,
                        health: issues.length === 0 ? 'ok' : 'warning',
                        issues
                    });
                }

                worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
                return { success: true, worlds };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:world-safe-clone', async (_, sourceInstance, worldFolderName, targetInstance, nextWorldName = '') => {
            try {
                const sourcePath = path.join(instancesDir, sourceInstance, 'saves', worldFolderName);
                if (!await fs.pathExists(sourcePath)) {
                    return { success: false, error: 'Source world not found' };
                }

                const targetSavesDir = path.join(instancesDir, targetInstance, 'saves');
                await fs.ensureDir(targetSavesDir);

                const baseName = normalizeWorldFolderName(nextWorldName || worldFolderName, 'WorldClone');
                let finalName = baseName;
                let targetPath = path.join(targetSavesDir, finalName);
                let counter = 1;
                while (await fs.pathExists(targetPath)) {
                    finalName = `${baseName} (${counter++})`;
                    targetPath = path.join(targetSavesDir, finalName);
                }

                await fs.copy(sourcePath, targetPath);

                await writeInstanceActionLog('world-safe-clone', {
                    instanceName: sourceInstance,
                    sourceInstance,
                    worldFolderName,
                    targetInstance,
                    clonedWorldName: finalName
                });

                return { success: true, clonedWorldName: finalName };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:resourcepack-report', async (_, instanceName) => {
            try {
                const packsDir = path.join(instancesDir, instanceName, 'resourcepacks');
                if (!await fs.pathExists(packsDir)) {
                    return { success: true, packs: [] };
                }

                const entries = await fs.readdir(packsDir, { withFileTypes: true });
                const reports = [];

                for (const entry of entries) {
                    const absolute = path.join(packsDir, entry.name);
                    if (!(entry.isDirectory() || /\.(zip|rar)$/i.test(entry.name))) continue;

                    const report = {
                        packName: entry.name,
                        isDirectory: entry.isDirectory(),
                        totalFiles: 0,
                        pngFiles: 0,
                        junkFiles: [],
                        bytes: 0
                    };

                    if (entry.isDirectory()) {
                        const files = await listFilesRecursive(absolute);
                        report.totalFiles = files.length;
                        for (const filePath of files) {
                            const rel = toRelativePackPath(absolute, filePath);
                            const lower = rel.toLowerCase();
                            const stats = await fs.stat(filePath).catch(() => null);
                            if (stats) report.bytes += stats.size;
                            if (lower.endsWith('.png')) report.pngFiles += 1;
                            const junkReason = getPackJunkReason(path.basename(rel));
                            if (junkReason) {
                                report.junkFiles.push({ path: rel, reason: junkReason });
                            }
                        }
                    } else {
                        const zip = new AdmZip(absolute);
                        const zipEntries = zip.getEntries().filter((zipEntry) => !zipEntry.isDirectory);
                        report.totalFiles = zipEntries.length;
                        for (const zipEntry of zipEntries) {
                            const rel = zipEntry.entryName;
                            const lower = rel.toLowerCase();
                            report.bytes += zipEntry.header.size || 0;
                            if (lower.endsWith('.png')) report.pngFiles += 1;
                            const junkReason = getPackJunkReason(path.basename(rel));
                            if (junkReason) {
                                report.junkFiles.push({ path: rel, reason: junkReason });
                            }
                        }
                    }

                    reports.push(report);
                }

                return { success: true, packs: reports };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:resourcepack-cleanup', async (_, instanceName, packName) => {
            try {
                const packsDir = path.join(instancesDir, instanceName, 'resourcepacks');
                const packPath = path.join(packsDir, packName);
                if (!await fs.pathExists(packPath)) {
                    return { success: false, error: 'Resource pack not found' };
                }

                const stats = await fs.stat(packPath);
                const isZip = !stats.isDirectory();
                let workDir = packPath;
                const tempDir = isZip ? path.join(packsDir, `__tmp_cleanup_${Date.now()}`) : null;

                if (isZip) {
                    const zip = new AdmZip(packPath);
                    zip.extractAllTo(tempDir, true);
                    workDir = tempDir;
                }

                const files = await listFilesRecursive(workDir);
                let removed = 0;
                for (const filePath of files) {
                    const junkReason = getPackJunkReason(path.basename(filePath));
                    if (!junkReason) continue;
                    await fs.remove(filePath);
                    removed += 1;
                }

                if (isZip && tempDir) {
                    const newZip = new AdmZip();
                    const cleaned = await listFilesRecursive(workDir);
                    for (const f of cleaned) {
                        const rel = path.relative(workDir, f);
                        newZip.addFile(rel.replace(/\\/g, '/'), await fs.readFile(f));
                    }
                    newZip.writeZip(packPath);
                    await fs.remove(tempDir);
                }

                await writeInstanceActionLog('resourcepack-cleanup', {
                    instanceName,
                    packName,
                    removedFiles: removed
                });

                return { success: true, removedFiles: removed };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('tools:resourcepack-compress-png', async (_, instanceName, packName) => {
            try {
                const packsDir = path.join(instancesDir, instanceName, 'resourcepacks');
                const packPath = path.join(packsDir, packName);
                if (!await fs.pathExists(packPath)) {
                    return { success: false, error: 'Resource pack not found' };
                }

                const stats = await fs.stat(packPath);
                const isZip = !stats.isDirectory();
                let workDir = packPath;
                const tempDir = isZip ? path.join(packsDir, `__tmp_compress_${Date.now()}`) : null;

                if (isZip) {
                    const zip = new AdmZip(packPath);
                    zip.extractAllTo(tempDir, true);
                    workDir = tempDir;
                }

                const files = await listFilesRecursive(workDir);
                const pngFiles = files.filter((filePath) => filePath.toLowerCase().endsWith('.png'));
                let scanned = 0;
                let changed = 0;
                let savedBytes = 0;

                for (const pngPath of pngFiles) {
                    const result = await recompressPngLossless(pngPath).catch(() => ({ success: false, changed: false, savedBytes: 0 }));
                    scanned += 1;
                    if (result?.success && result?.changed) {
                        changed += 1;
                        savedBytes += Number(result.savedBytes || 0);
                    }
                }

                if (isZip && tempDir) {
                    const newZip = new AdmZip();
                    const allFiles = await listFilesRecursive(workDir);
                    for (const f of allFiles) {
                        const rel = path.relative(workDir, f);
                        newZip.addFile(rel.replace(/\\/g, '/'), await fs.readFile(f));
                    }
                    newZip.writeZip(packPath);
                    await fs.remove(tempDir);
                }

                await writeInstanceActionLog('resourcepack-compress-png', {
                    instanceName,
                    packName,
                    scanned,
                    changed,
                    savedBytes
                });

                return { success: true, scanned, changed, savedBytes };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        console.log('[Instances] Instance handlers registered.');

        console.log('[Instances] Registering theme handlers...');

        ipcMain.handle('theme:get-custom-presets', async () => {
            console.log('[Theme] theme:get-custom-presets invoked');
            try {
                const userData = app.getPath('userData');
                const presetsDir = path.join(userData, 'custom_themes');

                if (!await fs.pathExists(presetsDir)) return { success: true, presets: [] };

                const stats = await fs.stat(presetsDir);
                if (!stats.isDirectory()) {
                    console.warn('[Theme] custom_themes is a file, not a directory. Deleting...');
                    await fs.remove(presetsDir);
                    return { success: true, presets: [] };
                }

                const files = await fs.readdir(presetsDir);
                const presets = [];
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const content = await fs.readJson(path.join(presetsDir, file));
                        presets.push({
                            handle: path.basename(file, '.json'),
                            ...content
                        });
                    }
                }
                return { success: true, presets };
            } catch (e) {
                console.error('Failed to get custom presets:', e);
                return { success: false, error: e.message };
            }
        });

        console.log('[Instances] theme:get-custom-presets registered.');

        ipcMain.handle('theme:save-custom-preset', async (_, preset) => {
            try {
                const userData = app.getPath('userData');
                const presetsDir = path.join(userData, 'custom_themes');

                if (await fs.pathExists(presetsDir)) {
                    const stats = await fs.stat(presetsDir);
                    if (!stats.isDirectory()) {
                        console.warn('[Theme] custom_themes is blocked by a file. Removing...');
                        await fs.remove(presetsDir);
                    }
                }

                await fs.ensureDir(presetsDir);
                const filePath = path.join(presetsDir, `${preset.handle}.json`);
                const { handle, ...data } = preset;
                await fs.writeJson(filePath, data, { spaces: 4 });
                return { success: true };
            } catch (e) {
                console.error('Failed to save custom preset:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('theme:delete-custom-preset', async (_, handle) => {
            try {
                const userData = app.getPath('userData');
                const presetsDir = path.join(userData, 'custom_themes');
                const filePath = path.join(presetsDir, `${handle}.json`);

                if (await fs.pathExists(filePath)) {
                    await fs.remove(filePath);
                }
                return { success: true };
            } catch (e) {
                console.error('Failed to delete custom preset:', e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('theme:export-custom-preset', async (_, preset) => {
            try {
                const { filePath } = await dialog.showSaveDialog(win, {
                    title: 'Export Theme Preset',
                    defaultPath: path.join(app.getPath('downloads'), `${preset.handle}.json`),
                    filters: [{ name: 'JSON Files', extensions: ['json'] }]
                });

                if (filePath) {
                    await fs.writeJson(filePath, preset, { spaces: 4 });
                    return { success: true, path: filePath };
                }
                return { success: false, error: 'Cancelled' };
            } catch (e) {
                console.error('Failed to export theme:', e);
                return { success: false, error: e.message };
            }
        });
        ipcMain.handle('theme:import-custom-preset', async () => {
            console.log('[Theme] Import triggered');
            try {
                const { filePaths } = await dialog.showOpenDialog(win, {
                    title: 'Import Theme Preset',
                    properties: ['openFile'],
                    filters: [{ name: 'JSON Files', extensions: ['json'] }]
                });

                if (filePaths && filePaths.length > 0) {
                    const content = await fs.readJson(filePaths[0]);
                    const requiredFields = ['name', 'handle', 'primary', 'bg', 'surface'];
                    const missing = requiredFields.filter(field => !content[field]);

                    if (missing.length > 0) {
                        return { success: false, error: `Invalid theme file. Missing fields: ${missing.join(', ')}` };
                    }

                    const userData = app.getPath('userData');
                    const presetsDir = path.join(userData, 'custom_themes');
                    await fs.ensureDir(presetsDir);
                    const targetPath = path.join(presetsDir, `${content.handle}.json`);
                    await fs.writeJson(targetPath, content, { spaces: 4 });

                    return { success: true };
                }
                return { success: false, error: 'Cancelled' };
            } catch (e) {
                console.error('Failed to import theme:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('theme:install-from-marketplace', async (event, url) => {
            console.log(`[Theme] Installing from marketplace: ${url}`);
            try {
                const axios = require('axios');
                const response = await axios.get(url);
                const content = response.data;

                if (typeof content !== 'object') {
                    return { success: false, error: 'Downloaded theme file is not valid JSON' };
                }

                const requiredFields = ['name', 'handle', 'primary', 'bg', 'surface'];
                const missing = requiredFields.filter(field => !content[field]);

                if (missing.length > 0) {
                    return { success: false, error: `Invalid theme file. Missing fields: ${missing.join(', ')}` };
                }

                const userData = app.getPath('userData');
                const presetsDir = path.join(userData, 'custom_themes');
                await fs.ensureDir(presetsDir);

                const handle = content.handle.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                const targetPath = path.join(presetsDir, `${handle}.json`);
                await fs.writeJson(targetPath, content, { spaces: 4 });

                return { success: true, handle: handle };
            } catch (e) {
                console.error('Failed to install theme from marketplace:', e);
                return { success: false, error: e.message };
            }
        });

        console.log('[Instances] All theme handlers registered successfully.');
        ipcMain.handle('app:soft-reset', async () => {
            console.log('[Maintenance] Soft reset triggered');
            try {
                const userData = app.getPath('userData');
                const items = await fs.readdir(userData);

                for (const item of items) {
                    if (item === 'instances') continue;

                    const itemPath = path.join(userData, item);
                    try {
                        await fs.remove(itemPath);
                    } catch (err) {

                        if (err.code === 'EBUSY') {
                            console.warn(`[Maintenance] Skipping locked file: ${item}`);
                        } else {
                            console.error(`[Maintenance] Failed to remove ${item}:`, err);
                        }
                    }
                }

                console.log('[Maintenance] Soft reset complete. Relaunching...');
                app.relaunch();
                app.exit(0);
                return { success: true };
            } catch (e) {
                console.error('[Maintenance] Soft reset failed:', e);
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('app:factory-reset', async () => {
            console.log('[Maintenance] Factory reset triggered');
            try {
                const userData = app.getPath('userData');
                const items = await fs.readdir(userData);

                for (const item of items) {
                    const itemPath = path.join(userData, item);
                    try {
                        await fs.remove(itemPath);
                    } catch (err) {

                        if (err.code === 'EBUSY') {
                            console.warn(`[Maintenance] Skipping locked file: ${item}`);
                        } else {
                            console.error(`[Maintenance] Failed to remove ${item}:`, err);
                        }
                    }
                }

                console.log('[Maintenance] Factory reset complete. Relaunching...');
                app.relaunch();
                app.exit(0);
                return { success: true };
            } catch (e) {
                console.error('[Maintenance] Factory reset failed:', e);
                return { success: false, error: e.message };
            }
        });

        return ipcMain;
    } catch (err) {
        console.error('CRITICAL ERROR DURING INSTANCE HANDLERS REGISTRATION:', err);
        throw err;
    }
};
