// Direct test of external profile discovery
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

function normalizeLoaderFromString(value, debugLabel = '') {
    let candidate = value;
    console.log(`[normalizeLoaderFromString] Input for ${debugLabel}:`, typeof value, JSON.stringify(value).substring(0, 100));

    if (candidate && typeof candidate === 'object') {
        console.log(`[normalizeLoaderFromString] Object detected, extracting name/id...`);
        candidate = candidate.name || candidate.id || candidate.loader || candidate.type || '';
        console.log(`[normalizeLoaderFromString] Extracted value:`, candidate);
    }

    const raw = String(candidate || '').trim().toLowerCase();
    console.log(`[normalizeLoaderFromString] Final raw value:`, raw);

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

function getExternalLauncherRoots() {
    if (process.platform !== 'win32') {
        console.log(`[getExternalLauncherRoots] Non-Windows platform detected: ${process.platform}, returning empty`);
        return [];
    }

    const homeDir = os.homedir();
    const roamingDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

    console.log(`[getExternalLauncherRoots] homeDir: ${homeDir}`);
    console.log(`[getExternalLauncherRoots] roamingDir: ${roamingDir}`);

    const roots = [
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

    console.log(`[getExternalLauncherRoots] Configured roots:`, roots.map(r => `${r.source}@${r.baseDir}`).join(', '));
    return roots;
}

async function readExternalProfileConfig(source, profileDir, fallbackName) {
    console.log(`\n[readExternalProfileConfig] Starting: source=${source}, profileDir=${profileDir}, fallbackName=${fallbackName}`);

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
        console.log(`[readExternalProfileConfig:modrinth] Reading Modrinth profile...`);
        const profilePath = path.join(profileDir, 'profile.json');
        let profile = null;

        const profileExists = await fs.pathExists(profilePath);
        console.log(`[readExternalProfileConfig:modrinth] profile.json exists: ${profileExists}`);

        if (profileExists) {
            try {
                profile = await fs.readJson(profilePath);
                console.log(`[readExternalProfileConfig:modrinth] Loaded profile.json:`, JSON.stringify(profile).substring(0, 200));
            } catch (e) {
                console.error(`[readExternalProfileConfig:modrinth] Error reading profile.json:`, e.message);
            }
        } else {
            console.log(`[readExternalProfileConfig:modrinth] No profile.json, will use fallback detection`);
        }

        const hasFabricMarker = await fs.pathExists(path.join(profileDir, '.fabric'));
        const hasQuiltMarker = await fs.pathExists(path.join(profileDir, '.quilt'));
        console.log(`[readExternalProfileConfig:modrinth] Markers - fabric: ${hasFabricMarker}, quilt: ${hasQuiltMarker}`);

        const inferredLoaderFromName = inferLoaderFromName(fallbackName);
        console.log(`[readExternalProfileConfig:modrinth] Inferred from name: ${inferredLoaderFromName}`);

        let detectedLoader = '';
        if (hasFabricMarker) {
            detectedLoader = 'fabric';
            console.log(`[readExternalProfileConfig:modrinth] Detected Fabric (from marker)`);
        } else if (hasQuiltMarker) {
            detectedLoader = 'quilt';
            console.log(`[readExternalProfileConfig:modrinth] Detected Quilt (from marker)`);
        } else if (inferredLoaderFromName) {
            detectedLoader = inferredLoaderFromName;
            console.log(`[readExternalProfileConfig:modrinth] Detected from name: ${inferredLoaderFromName}`);
        } else {
            // If absolutely nothing found, assume vanilla
            detectedLoader = 'vanilla';
            console.log(`[readExternalProfileConfig:modrinth] No loader detected, assuming vanilla`);
        }

        const version = String(profile?.game_version || profile?.gameVersion || inferVersionFromName(fallbackName) || '').trim();
        const name = String(profile?.name || fallbackName || '').trim() || fallbackName;

        console.log(`[readExternalProfileConfig:modrinth] Final result - name: ${name}, loader: ${detectedLoader}, version: ${version}`);

        // IMPORTANT: Return config even if profile.json doesn't exist
        return {
            ...fallbackConfig,
            name: name,
            version: version,
            loader: detectedLoader
        };
    }

    if (source === 'curseforge') {
        console.log(`[readExternalProfileConfig:curseforge] Reading CurseForge instance...`);
        const instancePath = path.join(profileDir, 'minecraftinstance.json');

        const exists = await fs.pathExists(instancePath);
        console.log(`[readExternalProfileConfig:curseforge] minecraftinstance.json exists: ${exists}`);

        if (!exists) {
            console.log(`[readExternalProfileConfig:curseforge] Returning null (no minecraftinstance.json)`);
            return null;
        }

        let profile;
        try {
            profile = await fs.readJson(instancePath);
            console.log(`[readExternalProfileConfig:curseforge] Loaded JSON, name: ${profile.name}`);
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
                console.log(`[readExternalProfileConfig:curseforge] Using baseModLoader.name: ${loaderValue}`);
            }
            // Try .forgeVersion for forge
            else if (profile.baseModLoader.forgeVersion) {
                loaderValue = `forge-${profile.baseModLoader.forgeVersion}`;
                console.log(`[readExternalProfileConfig:curseforge] Using baseModLoader.forgeVersion: ${loaderValue}`);
            }
            // Try .id as fallback
            else if (profile.baseModLoader.id) {
                loaderValue = profile.baseModLoader.id;
                console.log(`[readExternalProfileConfig:curseforge] Using baseModLoader.id: ${loaderValue}`);
            }
        }

        // Fallback to other fields
        if (!loaderValue) {
            loaderValue = profile?.modLoader?.name || profile?.modLoader || profile?.modloader || '';
            console.log(`[readExternalProfileConfig:curseforge] Using fallback modLoader: ${loaderValue}`);
        }

        const minecraftVersion = String(profile?.minecraftVersion || profile?.gameVersion || profile?.baseModLoader?.minecraftVersion || '').trim();

        console.log(`[readExternalProfileConfig:curseforge] Final loaderValue before normalize: '${loaderValue}' (type: ${typeof loaderValue})`);
        console.log(`[readExternalProfileConfig:curseforge] minecraft version: ${minecraftVersion}`);

        const normalizedLoader = normalizeLoaderFromString(loaderValue, 'curseforge');
        console.log(`[readExternalProfileConfig:curseforge] Normalized loader result: '${normalizedLoader}' (type: ${typeof normalizedLoader})`);

        return {
            ...fallbackConfig,
            name: String(profile?.name || fallbackName || '').trim() || fallbackName,
            version: minecraftVersion,
            loader: String(normalizedLoader || '').trim()  // Force to string
        };
    }

    return null;
}

async function discoverExternalProfiles() {
    const results = [];
    console.log(`\n[discoverExternalProfiles] Starting discovery...`);

    const launcherRoots = getExternalLauncherRoots();
    console.log(`[discoverExternalProfiles] Found ${launcherRoots.length} launcher roots:`, launcherRoots.map(l => `${l.source}@${l.baseDir}`).join(', '));

    for (const launcherRoot of launcherRoots) {
        const { source, baseDir } = launcherRoot;
        console.log(`\n[discoverExternalProfiles] Processing ${source} at ${baseDir}`);

        const dirExists = await fs.pathExists(baseDir);
        console.log(`[discoverExternalProfiles] Directory exists: ${dirExists}`);

        if (!dirExists) {
            console.log(`[discoverExternalProfiles] Skipping (path doesn't exist)`);
            continue;
        }

        let entries = [];
        try {
            entries = await fs.readdir(baseDir, { withFileTypes: true });
            console.log(`[discoverExternalProfiles] Found ${entries.length} entries in directory`);
        } catch (err) {
            console.error(`[discoverExternalProfiles] Error reading directory:`, err.message);
            continue;
        }

        let dirCount = 0;
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            dirCount++;

            const profileDir = path.join(baseDir, entry.name);
            console.log(`[discoverExternalProfiles] [${dirCount}] Reading profile: ${entry.name}`);

            try {
                const externalConfig = await readExternalProfileConfig(source, profileDir, entry.name);
                if (externalConfig) {
                    console.log(`[discoverExternalProfiles] ✓ Added profile: ${externalConfig.name} (${externalConfig.loader}@${externalConfig.version})`);
                    results.push(externalConfig);
                } else {
                    console.log(`[discoverExternalProfiles] ✗ Config returned null for ${entry.name}`);
                }
            } catch (error) {
                console.error(`[discoverExternalProfiles] Error reading ${source} profile ${entry.name}:`, error.message);
            }
        }

        console.log(`[discoverExternalProfiles] Processed ${dirCount} profile directories for ${source}`);
    }

    console.log(`\n[discoverExternalProfiles] DISCOVERY COMPLETE - Found ${results.length} external profiles total`);
    console.log(`\n=== FINAL RESULTS ===`);
    results.forEach((r, idx) => {
        console.log(`[${idx + 1}] ${r.name} (${r.externalSource}) - Loader: ${r.loader}, Version: ${r.version}`);
    });
    return results;
}

// RUN TEST
(async () => {
    console.log('====== EXTERNAL PROFILE DISCOVERY TEST ======\n');
    await discoverExternalProfiles();
})().catch(err => console.error('Test error:', err));
