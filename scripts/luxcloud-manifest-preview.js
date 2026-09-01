const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { buildManifest, summarize } = require('../backend/luxcloud/manifest');
const { readInstanceId } = require('../backend/luxcloud/instanceIdentity');

function userDataDir() {
    if (process.env.LUX_USER_DATA) return process.env.LUX_USER_DATA;
    if (process.platform === 'win32') return path.join(process.env.APPDATA, 'Lux');
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Lux');
    return path.join(os.homedir(), '.config', 'Lux');
}

function instancesDir(userData) {
    try {
        const settings = fs.readJsonSync(path.join(userData, 'settings.json'));
        if (settings && typeof settings.instancesPath === 'string' && settings.instancesPath.trim()) {
            return settings.instancesPath.trim();
        }
    } catch {
        /* Standardpfad */
    }
    return path.join(userData, 'instances');
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function percent(part, total) {
    if (!total) return '0 %';
    return `${((part / total) * 100).toFixed(1)} %`;
}

async function directorySize(dir) {
    let total = 0;
    async function walk(current) {
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                try {
                    total += (await fs.stat(full)).size;
                } catch {
                    /* unlesbare Datei */
                }
            }
        }
    }
    await walk(dir);
    return total;
}

function parseArgs(argv) {
    const flags = new Set(argv.filter((a) => a.startsWith('--')));
    const names = argv.filter((a) => !a.startsWith('--'));
    return {
        names,
        syncWorlds: flags.has('--worlds'),
        syncScreenshots: flags.has('--screenshots'),
        enableChunking: flags.has('--chunking'),
        resolveOnline: flags.has('--online'),
        json: flags.has('--json'),
        all: flags.has('--all'),
        skipDiskSize: flags.has('--fast')
    };
}

function sourceStats(manifest) {
    const contentDirs = ['mods/', 'resourcepacks/', 'shaderpacks/'];
    let total = 0;
    let referenced = 0;
    let referencedBytes = 0;
    let ownBytes = 0;

    for (const entry of manifest.entries) {
        if (!contentDirs.some((dir) => entry.path.startsWith(dir))) continue;
        total += 1;
        if (entry.source) {
            referenced += 1;
            referencedBytes += entry.size;
        } else {
            ownBytes += entry.size;
        }
    }

    return { total, referenced, referencedBytes, ownBytes };
}

async function previewInstance(instanceDir, name, options) {
    const storedId = await readInstanceId(instanceDir);
    const instanceId = storedId
        || `preview-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}`;

    const started = Date.now();
    const result = await buildManifest({
        instanceDir,
        instanceId,
        name,
        hashCacheDir: path.join(options.userData, 'luxcloud', 'hashes'),
        modCachePath: path.join(options.userData, 'mod_cache.json'),
        syncWorlds: options.syncWorlds,
        syncScreenshots: options.syncScreenshots,
        enableChunking: options.enableChunking,
        resolveOnline: options.resolveOnline
    });

    const overview = summarize(result);
    const sources = sourceStats(result.manifest);
    const onDisk = options.skipDiskSize ? null : await directorySize(instanceDir);

    if (options.json) {
        console.log(JSON.stringify({ name, instanceId, onDisk, overview, sources }, null, 2));
        return { overview, sources, onDisk };
    }

    console.log(`\n${'='.repeat(72)}`);
    console.log(`${name}   (${instanceId})`);
    console.log('='.repeat(72));

    if (!storedId) {
        console.log('Hinweis: diese Instanz hat noch keine UUID. Fuer die Vorschau reicht ein');
        console.log('         abgeleiteter Schluessel; die echte UUID vergibt der Client beim');
        console.log('         naechsten Start (Phase 0). Es wird nichts geschrieben.');
    }

    if (onDisk !== null) {
        console.log(`Auf der Platte      ${formatBytes(onDisk)}`);
    }
    console.log(`Im Manifest         ${overview.entries} Dateien, ${formatBytes(overview.totalBytes)}`);
    console.log(`Davon referenziert  ${overview.referencedFiles} Dateien, ${formatBytes(overview.referencedBytes)} (kommen vom Modrinth-CDN)`);
    console.log(`Tatsaechlich hoch   ${formatBytes(overview.uploadBytes)}`);
    if (onDisk !== null && onDisk > 0) {
        console.log(`Anteil des Ordners  ${percent(overview.uploadBytes, onDisk)}`);
    }
    console.log(`Manifest selbst     ${formatBytes(overview.manifestBytes)}`);
    console.log(`Hashes aus Cache    ${overview.cachedHashes} von ${overview.entries}`);
    console.log(`Dauer               ${((Date.now() - started) / 1000).toFixed(1)} s`);

    if (sources.total > 0) {
        console.log(`\nModrinth-Trefferquote  ${sources.referenced} von ${sources.total} `
            + `(${percent(sources.referenced, sources.total)}) — `
            + `${formatBytes(sources.referencedBytes)} gespart, ${formatBytes(sources.ownBytes)} muessen hoch`);
    }

    const folders = Object.entries(overview.uploadBytesByFolder)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    if (folders.length > 0) {
        console.log('\nUpload nach Ordner:');
        for (const [folder, bytes] of folders) {
            console.log(`  ${String(folder).padEnd(24)} ${formatBytes(bytes).padStart(10)}`);
        }
    }

    const excluded = Object.entries(overview.excluded).sort((a, b) => b[1] - a[1]);
    if (excluded.length > 0) {
        console.log('\nAusgeschlossen (Grund: Anzahl):');
        for (const [reason, count] of excluded) {
            console.log(`  ${String(reason).padEnd(28)} ${String(count).padStart(6)}`);
        }
    }

    if (overview.oversized.length > 0) {
        console.log('\nZu grosse Dateien (uebersprungen):');
        for (const file of overview.oversized) {
            console.log(`  ${formatBytes(file.size).padStart(10)}  ${file.path}`);
        }
    }

    return { overview, sources, onDisk };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    options.userData = userDataDir();

    const baseDir = instancesDir(options.userData);
    if (!await fs.pathExists(baseDir)) {
        console.error(`Instanzordner nicht gefunden: ${baseDir}`);
        console.error('Setze LUX_USER_DATA, wenn Lux woanders liegt.');
        process.exit(1);
    }

    const available = (await fs.readdir(baseDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    let selected = options.names;
    if (options.all) selected = available;

    if (selected.length === 0) {
        console.log(`Instanzen in ${baseDir}:\n`);
        for (const name of available) console.log(`  ${name}`);
        console.log('\nAufruf:');
        console.log('  npm run luxcloud:preview -- "PVP MISCHE"');
        console.log('  npm run luxcloud:preview -- --all');
        console.log('  npm run luxcloud:preview -- --all --worlds --chunking');
        console.log('\nFlags: --worlds  --screenshots  --chunking  --online  --all  --json  --fast');
        console.log('       --online fragt Modrinth nach Mods, die noch nicht im mod_cache stehen');
        return;
    }

    const totals = { upload: 0, referenced: 0, disk: 0, entries: 0 };

    for (const name of selected) {
        const dir = path.join(baseDir, name);
        if (!await fs.pathExists(dir)) {
            console.error(`\nUnbekannte Instanz: ${name}`);
            continue;
        }
        const result = await previewInstance(dir, name, options);
        if (!result) continue;

        totals.upload += result.overview.uploadBytes;
        totals.referenced += result.overview.referencedBytes;
        totals.entries += result.overview.entries;
        if (result.onDisk !== null) totals.disk += result.onDisk;
    }

    if (selected.length > 1 && !options.json) {
        console.log(`\n${'='.repeat(72)}`);
        console.log('Summe ueber alle geprueften Instanzen');
        console.log('='.repeat(72));
        if (totals.disk > 0) console.log(`Auf der Platte      ${formatBytes(totals.disk)}`);
        console.log(`Dateien im Manifest ${totals.entries}`);
        console.log(`Referenziert        ${formatBytes(totals.referenced)}`);
        console.log(`Upload gesamt       ${formatBytes(totals.upload)}`);
        if (totals.disk > 0) {
            console.log(`Anteil              ${percent(totals.upload, totals.disk)}`);
        }
        console.log(`\nKontingent 5 GB:    ${percent(totals.upload, 5 * 1024 * 1024 * 1024)} belegt`);
    }
}

main().catch((err) => {
    console.error('\nFehlgeschlagen:', err.message);
    process.exit(1);
});
