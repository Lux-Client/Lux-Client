const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { validRelPath } = require('../backend/luxcloud/pathRules');
const { chunkBuffer } = require('../backend/luxcloud/chunker');
const { chooseCompression, compressIfWorthwhile } = require('../backend/luxcloud/compression');
const { buildManifest, normalizeInstanceConfig, summarize } = require('../backend/luxcloud/manifest');
const { buildManifestInWorker } = require('../backend/luxcloud/manifestRunner');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

const NUL = String.fromCharCode(0);
const BACKSLASH = String.fromCharCode(92);
const COMBINING_ACUTE = String.fromCharCode(0x301);

const PATH_VECTORS = [
    ['mods/sodium.jar', true],
    ['config/a/b/c.json', true],
    ['instance.json', true],
    ['saves/Welt/region/r.0.0.mca', true],
    ['mods/normal name.jar', true],
    ['', false],
    ['..', false],
    ['../../.ssh/id_rsa', false],
    ['mods/../../etc/passwd', false],
    ['/etc/passwd', false],
    ['C:/Windows/system32', false],
    [`mods${BACKSLASH}evil.jar`, false],
    [`mods/evil${NUL}.jar`, false],
    ['CON', false],
    ['con.txt', false],
    ['aux/foo.json', false],
    ['mods/com1.jar', false],
    ['mods/trailing.', false],
    ['mods/trailing ', false],
    ['mods/./sodium.jar', false],
    ['mods//sodium.jar', false],
    [`${'a/'.repeat(30)}b`, false],
    ['x'.repeat(401), false],
    ['mods/a:b.jar', false],
    [`mods/e${COMBINING_ACUTE}vil.jar`, false]
];

async function makeInstance(root) {
    const dir = path.join(root, 'PVP Test');
    await fs.ensureDir(dir);

    await fs.writeJson(path.join(dir, 'instance.json'), {
        name: 'PVP Test',
        instanceId: 'inst-pvp-test-01',
        version: '1.21.1',
        loader: 'fabric',
        loaderVersion: '0.16.5',
        icon: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
        playtime: 151200000,
        lastPlayed: 1756582980000,
        status: 'ready',
        folderPath: 'C:/irgendwo/lokal',
        memory: 4096
    }, { spaces: 2 });

    const modBytes = Buffer.from('gefaelschte mod jar '.repeat(500));
    await fs.ensureDir(path.join(dir, 'mods'));
    await fs.writeFile(path.join(dir, 'mods', 'sodium-fabric-0.6.13.jar'), modBytes);
    await fs.writeFile(path.join(dir, 'mods', 'privatemod.jar'), Buffer.from('nicht auf modrinth'));

    await fs.ensureDir(path.join(dir, 'config', 'sodium'));
    await fs.writeJson(path.join(dir, 'config', 'sodium', 'options.json'), { quality: 'fast' });
    await fs.writeFile(path.join(dir, 'options.txt'), 'fov:90\ngamma:1000\n');
    await fs.writeFile(path.join(dir, 'servers.dat'), Buffer.from('serverliste'));

    await fs.ensureDir(path.join(dir, 'libraries', 'net', 'fabricmc'));
    await fs.writeFile(path.join(dir, 'libraries', 'net', 'fabricmc', 'huge.jar'), Buffer.alloc(4096));
    await fs.ensureDir(path.join(dir, 'logs'));
    await fs.writeFile(path.join(dir, 'logs', 'latest.log'), 'nichts davon gehoert in die cloud');
    await fs.ensureDir(path.join(dir, 'versions', '1.21.1'));
    await fs.writeFile(path.join(dir, 'versions', '1.21.1', '1.21.1.jar'), Buffer.alloc(2048));
    await fs.writeFile(path.join(dir, 'usercache.json'), '[]');

    await fs.ensureDir(path.join(dir, 'saves', 'Welt', 'region'));
    await fs.writeFile(path.join(dir, 'saves', 'Welt', 'level.dat'), Buffer.from('leveldat'));
    await fs.writeFile(path.join(dir, 'saves', 'Welt', 'region', 'r.0.0.mca'), crypto.randomBytes(5 * 1024 * 1024));
    await fs.ensureDir(path.join(dir, 'saves', 'Zweitwelt', 'region'));
    await fs.writeFile(path.join(dir, 'saves', 'Zweitwelt', 'level.dat'), Buffer.from('zweiteleveldat'));

    await fs.ensureDir(path.join(dir, 'screenshots'));
    await fs.writeFile(path.join(dir, 'screenshots', 'bild.png'), Buffer.alloc(1024));

    return { dir, modBytes };
}

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-phase4-'));
    const cacheDir = path.join(root, 'hashes');
    await fs.ensureDir(cacheDir);

    section('1) Pfadregeln');
    for (const [value, want] of PATH_VECTORS) {
        check(`${want ? 'akzeptiert' : 'weist ab'}: ${JSON.stringify(value)}`,
            validRelPath(value) === want);
    }

    const websiteRules = path.resolve(__dirname, '..', '..', 'Lux-Website', 'routes', 'manifestSchema.js');
    if (await fs.pathExists(websiteRules)) {
        const server = require(websiteRules);
        const disagreements = PATH_VECTORS
            .map(([value]) => ({ value, client: validRelPath(value), server: server.validRelPath(value) }))
            .filter((row) => row.client !== row.server);
        check('Client und Server beurteilen jeden Pfad gleich', disagreements.length === 0, disagreements);
    } else {
        console.log('  SKIP  Website-Repo nicht daneben gefunden, Quervergleich uebersprungen');
    }

    section('2) Kompressionsheuristik');
    check('.json wird komprimiert', chooseCompression('config/a.json', 10000) === 'zstd');
    check('.txt wird komprimiert', chooseCompression('options.txt', 10000) === 'zstd');
    check('.jar wird nicht komprimiert', chooseCompression('mods/a.jar', 10000) === 'none');
    check('.png wird nicht komprimiert', chooseCompression('screenshots/a.png', 10000) === 'none');
    check('.mca wird nicht komprimiert', chooseCompression('saves/w/region/r.0.0.mca', 8000000) === 'none');
    check('winzige Dateien lohnen nicht', chooseCompression('config/a.json', 100) === 'none');

    const textish = Buffer.from('a'.repeat(50000));
    check('unbekannte Endung mit Textinhalt -> zstd',
        chooseCompression('data/unbekannt.xyz', textish.length, textish) === 'zstd');
    const noisy = crypto.randomBytes(50000);
    check('unbekannte Endung mit Zufallsdaten -> none',
        chooseCompression('data/unbekannt.xyz', noisy.length, noisy) === 'none');

    const packed = compressIfWorthwhile('config/a.json', Buffer.from(JSON.stringify({ x: 1 }).repeat(1000)));
    check('compressIfWorthwhile liefert kleinere Daten',
        packed.compression === 'zstd' && packed.data.length < 9000, packed.data.length);

    const incompressible = compressIfWorthwhile('mods/a.jar', crypto.randomBytes(5000));
    check('compressIfWorthwhile laesst Unkomprimierbares in Ruhe',
        incompressible.compression === 'none');

    section('3) Chunking');
    const worldLike = Buffer.concat(
        Array.from({ length: 6 }, () => crypto.randomBytes(1024 * 1024))
    );
    const before = chunkBuffer(worldLike);
    check('eine 6-MB-Datei zerfaellt in mehrere Chunks', before.length >= 3, before.length);
    check('Chunks decken die Datei luecklos ab',
        before.reduce((sum, chunk) => sum + chunk.size, 0) === worldLike.length);
    check('kein Chunk ist groesser als das Maximum',
        before.every((chunk) => chunk.size <= 4 * 1024 * 1024), before.map((c) => c.size));

    const mutated = Buffer.from(worldLike);
    const middle = Math.floor(mutated.length / 2);
    mutated[middle] = mutated[middle] ^ 0xff;
    const after = chunkBuffer(mutated);

    const beforeHashes = new Set(before.map((chunk) => chunk.sha256));
    const changed = after.filter((chunk) => !beforeHashes.has(chunk.sha256));
    check('ein geaendertes Byte aendert hoechstens zwei Chunks', changed.length <= 2, {
        changed: changed.length, before: before.length, after: after.length
    });

    const identical = chunkBuffer(Buffer.from(worldLike));
    check('Chunking ist deterministisch',
        JSON.stringify(identical.map((c) => c.sha256)) === JSON.stringify(before.map((c) => c.sha256)));

    section('4) instance.json normalisieren');
    const normalized = normalizeInstanceConfig({
        name: 'X', version: '1.21.1', icon: 'data:image/png;base64,AAAA',
        playtime: 5, lastPlayed: 1, status: 'ready', folderPath: 'C:/x', memory: 4096
    });
    check('Icon ist raus', normalized.icon === undefined, normalized);
    check('Playtime ist raus', normalized.playtime === undefined && normalized.lastPlayed === undefined);
    check('geraetelokale Felder sind raus',
        normalized.folderPath === undefined && normalized.status === undefined);
    check('inhaltliche Felder bleiben',
        normalized.name === 'X' && normalized.version === '1.21.1' && normalized.memory === 4096);

    section('5) Manifest bauen');
    const { dir, modBytes } = await makeInstance(root);
    const modSha1 = crypto.createHash('sha1').update(modBytes).digest('hex');

    const modCachePath = path.join(root, 'mod_cache.json');
    await fs.writeJson(modCachePath, {
        [`sodium-fabric-0.6.13.jar-${modBytes.length}`]: {
            title: 'Sodium',
            projectId: 'AANobbMI',
            versionId: 'abcd1234',
            hash: modSha1,
            source: 'modrinth'
        }
    });

    const common = {
        instanceDir: dir,
        instanceId: 'inst-pvp-test-01',
        name: 'PVP Test',
        hashCacheDir: cacheDir,
        modCachePath,
        device: { uuid: 'dev-aaaa-0001', platform: 'win32', appVersion: '1.11.0' },
        runtime: { mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5' }
    };

    let result = await buildManifest({ ...common });
    let paths = result.manifest.entries.map((entry) => entry.path);

    check('Manifest hat die erwartete Version', result.manifest.manifestVersion === 1);
    check('libraries/ ist nicht drin', !paths.some((p) => p.startsWith('libraries/')), paths);
    check('logs/ ist nicht drin', !paths.some((p) => p.startsWith('logs/')));
    check('versions/ ist nicht drin', !paths.some((p) => p.startsWith('versions/')));
    check('usercache.json ist nicht drin', !paths.includes('usercache.json'));
    check('saves/ ist standardmaessig nicht drin', !paths.some((p) => p.startsWith('saves/')), paths);
    check('screenshots/ ist standardmaessig nicht drin', !paths.some((p) => p.startsWith('screenshots/')));
    check('mods sind drin', paths.includes('mods/sodium-fabric-0.6.13.jar'));
    check('configs sind drin', paths.includes('config/sodium/options.json'));
    check('options.txt ist drin', paths.includes('options.txt'));
    check('servers.dat ist drin', paths.includes('servers.dat'));
    check('instance.json ist drin', paths.includes('instance.json'));

    const sodium = result.manifest.entries.find((e) => e.path === 'mods/sodium-fabric-0.6.13.jar');
    check('bekannte Mod wird referenziert statt hochgeladen',
        sodium.source && sodium.source.type === 'modrinth' && !sodium.blob, sodium);
    check('die Referenz traegt die sha1 fuer Modrinth', sodium.source.sha1 === modSha1, sodium.source);

    const privateMod = result.manifest.entries.find((e) => e.path === 'mods/privatemod.jar');
    check('unbekannte Mod bekommt einen eigenen Blob', Boolean(privateMod.blob) && !privateMod.source, privateMod);

    const instanceEntry = result.manifest.entries.find((e) => e.path === 'instance.json');
    const rawInstanceJson = await fs.readFile(path.join(dir, 'instance.json'));
    const rawHash = crypto.createHash('sha256').update(rawInstanceJson).digest('hex');
    check('instance.json wird normalisiert hochgeladen, nicht wie auf der Platte',
        instanceEntry.sha256 !== rawHash, { manifest: instanceEntry.sha256, disk: rawHash });

    const uploadedInstanceJson = result.uploads.find((u) => u.path === 'instance.json');
    const parsed = JSON.parse(uploadedInstanceJson.buffer.toString('utf8'));
    check('die hochgeladene instance.json enthaelt kein Icon und keine Playtime',
        parsed.icon === undefined && parsed.playtime === undefined, Object.keys(parsed));

    check('jeder Eintrag hat genau eine Quelle',
        result.manifest.entries.every((e) => ['blob', 'source', 'chunks'].filter((k) => e[k] !== undefined).length === 1));
    check('Ausschlussgruende werden gezaehlt',
        Object.keys(result.manifest.excluded).length > 0, result.manifest.excluded);
    check('Referenzen zaehlen nicht als Upload',
        result.stats.referencedBytes === modBytes.length, result.stats);

    if (await fs.pathExists(websiteRules)) {
        const { validateManifest } = require(websiteRules);
        const validation = validateManifest(result.manifest);
        check('der Server-Validator akzeptiert das erzeugte Manifest', validation.valid === true, validation.issues);
    }

    section('6) Hash-Cache');
    const second = await buildManifest({ ...common });
    check('der zweite Lauf kommt aus dem Cache',
        second.stats.cachedHashes > 0 && second.stats.cachedHashes === second.stats.fileCount - 1,
        second.stats);
    check('beide Laeufe erzeugen dasselbe Manifest',
        second.manifestBlob.sha256.length === 64
        && JSON.stringify(second.manifest.entries) === JSON.stringify(result.manifest.entries));

    section('7) Welten und Chunking');
    result = await buildManifest({ ...common, syncWorlds: true });
    paths = result.manifest.entries.map((entry) => entry.path);
    check('mit syncWorlds sind Welten drin', paths.includes('saves/Welt/level.dat'), paths);
    check('ohne Auswahl sind alle Welten drin', paths.includes('saves/Zweitwelt/level.dat'), paths);

    const onlyOne = await buildManifest({ ...common, syncWorlds: true, worldNames: ['Welt'] });
    const onlyOnePaths = onlyOne.manifest.entries.map((entry) => entry.path);
    check('eine Auswahl nimmt die gewaehlte Welt mit',
        onlyOnePaths.includes('saves/Welt/level.dat'), onlyOnePaths);
    check('eine Auswahl laesst die uebrigen Welten weg',
        !onlyOnePaths.some((entry) => entry.startsWith('saves/Zweitwelt/')), onlyOnePaths);

    const noneSelected = await buildManifest({ ...common, syncWorlds: true, worldNames: [] });
    check('eine leere Auswahl synct keine Welt',
        !noneSelected.manifest.entries.some((entry) => entry.path.startsWith('saves/')),
        noneSelected.manifest.entries.map((entry) => entry.path));

    const region = result.manifest.entries.find((e) => e.path === 'saves/Welt/region/r.0.0.mca');
    check('ohne Chunking-Flag bekommt die grosse Weltdatei einen Blob',
        Boolean(region.blob) && !region.chunks, region);

    result = await buildManifest({ ...common, syncWorlds: true, enableChunking: true });
    const chunkedRegion = result.manifest.entries.find((e) => e.path === 'saves/Welt/region/r.0.0.mca');
    check('mit Chunking-Flag wird die grosse Weltdatei gechunkt',
        Boolean(chunkedRegion.chunks) && chunkedRegion.chunks.algo === 'fastcdc-1M', chunkedRegion);
    check('die Chunk-Liste ist selbst ein Upload',
        result.uploads.some((u) => u.kind === 'chunk-list' && u.sha256 === chunkedRegion.chunks.list));
    check('die einzelnen Chunks sind Uploads',
        result.uploads.filter((u) => u.kind === 'chunk').length >= 3,
        result.uploads.filter((u) => u.kind === 'chunk').length);
    check('kleine Weltdateien werden nicht gechunkt',
        Boolean(result.manifest.entries.find((e) => e.path === 'saves/Welt/level.dat').blob));

    if (await fs.pathExists(websiteRules)) {
        const { validateManifest } = require(websiteRules);
        const validation = validateManifest(result.manifest);
        check('auch das gechunkte Manifest ist serverseitig gueltig', validation.valid === true, validation.issues);
        check('der Server erkennt Weltdaten', validation.stats.hasWorlds === true, validation.stats);
    }

    section('8) Zusammenfassung und Worker');
    const overview = summarize(result);
    check('die Zusammenfassung nennt Upload- und Referenzbytes',
        overview.uploadBytes > 0 && overview.referencedBytes > 0, overview);
    check('die Zusammenfassung listet die Ausschlussgruende', Boolean(overview.excluded));

    const progress = [];
    const viaWorker = await buildManifestInWorker({
        ...common,
        syncWorlds: false
    }, { onProgress: (p) => progress.push(p) });

    check('der Worker liefert dasselbe Manifest wie der Direktaufruf',
        JSON.stringify(viaWorker.manifest.entries) === JSON.stringify(second.manifest.entries),
        { worker: viaWorker.manifest.entries.length, direct: second.manifest.entries.length });
    check('der Worker liefert die Uploads mit Puffern zurueck',
        viaWorker.uploads.some((u) => Buffer.isBuffer(u.buffer)));

    await fs.remove(root);

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('\nTEST HARNESS ERROR:', err);
    process.exit(2);
});
