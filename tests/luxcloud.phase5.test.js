const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const WEBSITE_CANDIDATES = ['Lux-Website', 'MCLC-Website'];

function findWebsiteRepo() {
    const parent = path.resolve(__dirname, '..', '..');
    for (const name of WEBSITE_CANDIDATES) {
        const candidate = path.join(parent, name);
        if (fs.existsSync(path.join(candidate, 'tests', 'luxcloudHarness.js'))) return candidate;
    }
    return null;
}

const WEBSITE = findWebsiteRepo();

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

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function makeInstance(root, name, files) {
    const dir = path.join(root, name);
    await fs.ensureDir(dir);

    for (const [relPath, content] of Object.entries(files)) {
        const target = path.join(dir, relPath);
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, content);
    }
    return dir;
}

async function main() {
    if (!WEBSITE) {
        console.log('\nWebsite-Repo nicht gefunden - Phase-5-Test uebersprungen.');
        console.log('Erwartet wird eines von: ' + WEBSITE_CANDIDATES.join(', ') + ' neben MCLC-Client.');
        console.log('\n=== 0 bestanden, 0 fehlgeschlagen (uebersprungen) ===');
        return;
    }

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-p5-'));
    process.env.LUXCLOUD_DIR = path.join(tmpRoot, 'luxcloud');

    const { Harness } = require(path.join(WEBSITE, 'tests', 'luxcloudHarness.js'));
    const h = new Harness();
    await h.start();

    const port = h.server.address().port;
    process.env.LUXCLOUD_BASE_URL = `http://127.0.0.1:${port}`;

    const userId = await h.createUser({ googleId: 'g-p5', username: 'beatv' });
    const session = { id: userId, username: 'beatv', role: 'user', banned: false };
    const tokens = await h.authorizeDevice({ user: session, deviceUuid: 'dev-p5-0001' });

    const auth = require('../backend/luxcloud/auth');
    auth.getValidAccessToken = async () => tokens.accessToken;

    const uploader = require('../backend/luxcloud/uploader');
    const downloader = require('../backend/luxcloud/downloader');
    const blobStore = require('../backend/luxcloud/blobStore');
    const api = require('../backend/luxcloud/api');
    const { ensureInstanceId } = require('../backend/luxcloud/instanceIdentity');

    const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
    const capabilities = me.capabilities || {};

    const instancesRoot = path.join(tmpRoot, 'instances');
    const bigMod = Buffer.alloc(700 * 1024, 7);

    const instanceDir = await makeInstance(instancesRoot, 'Skyblock', {
        'instance.json': JSON.stringify({
            name: 'Skyblock',
            version: '1.21.11',
            loader: 'fabric',
            loaderVersion: '0.19.3',
            playtime: 1234,
            icon: null
        }, null, 4),
        'options.txt': 'fov:90\n',
        'config/sodium.json': JSON.stringify({ quality: 'high' }),
        'config/nested/deep.toml': 'a = 1\n',
        'mods/privat.jar': bigMod,
        'servers.dat': Buffer.from('serverliste'),
        'logs/latest.log': 'darf nicht hoch',
        'libraries/foo/bar.jar': Buffer.alloc(1024, 1)
    });

    const { instanceId } = await ensureInstanceId(instanceDir);

    section('1) Erster Upload');

    const first = await uploader.uploadInstance({
        instanceDir,
        instanceId,
        instanceName: 'Skyblock',
        capabilities,
        options: { enableChunking: false }
    });

    check('der erste Upload erzeugt Revision 1', first.revision === 1, first);
    check('es wurden Blobs hochgeladen', first.uploadedBlobs > 0, first);
    check('nichts wurde uebersprungen', first.skippedBlobs === 0, first);

    const manifestRes = await api.authed({
        method: 'GET',
        url: `/api/cloud/instances/${instanceId}/manifest`
    });
    const paths = manifestRes.manifest.entries.map((entry) => entry.path).sort();

    check('logs/ ist nicht im Manifest', !paths.some((p) => p.startsWith('logs/')), paths);
    check('libraries/ ist nicht im Manifest', !paths.some((p) => p.startsWith('libraries/')), paths);
    check('die Config ist drin', paths.includes('config/sodium.json'), paths);
    check('verschachtelte Configs sind drin', paths.includes('config/nested/deep.toml'), paths);
    check('servers.dat ist drin', paths.includes('servers.dat'), paths);
    check('instance.json ist drin', paths.includes('instance.json'), paths);
    check('die private Mod ist drin', paths.includes('mods/privat.jar'), paths);

    section('2) Zweiter Upload ohne Aenderung');

    const unchanged = await uploader.uploadInstance({
        instanceDir,
        instanceId,
        instanceName: 'Skyblock',
        capabilities,
        options: { enableChunking: false, parentRevision: first.revision }
    });

    check('ohne Aenderung wird nichts hochgeladen', unchanged.uploadedBlobs === 0, unchanged);
    check('der Commit wird uebersprungen', unchanged.skipped === true, unchanged);
    check('die Revision bleibt stehen', unchanged.revision === 1, unchanged);

    section('3) Delta-Upload nach kleiner Aenderung');

    await fs.writeFile(path.join(instanceDir, 'config/sodium.json'), JSON.stringify({ quality: 'low' }));

    const delta = await uploader.uploadInstance({
        instanceDir,
        instanceId,
        instanceName: 'Skyblock',
        capabilities,
        options: { enableChunking: false, parentRevision: unchanged.revision }
    });

    check('nur die geaenderte Datei geht hoch', delta.uploadedBlobs === 1, delta);
    check('die 700-KB-Mod wird nicht erneut uebertragen', delta.uploadedBytes < 10 * 1024, delta);
    check('Revision 2 ist entstanden', delta.revision === 2, delta);

    section('4) Konflikt bei veraltetem parentRevision');

    let conflict = null;
    try {
        await uploader.uploadInstance({
            instanceDir,
            instanceId,
            instanceName: 'Skyblock',
            capabilities,
            options: { enableChunking: false, parentRevision: 0, force: true }
        });
    } catch (err) {
        conflict = err;
    }

    check('ein veralteter parentRevision wird abgewiesen', conflict !== null, conflict);
    check('der Fehler heisst revision_conflict', conflict && conflict.code === 'revision_conflict', conflict && conflict.code);
    check('der Fehler nennt die aktuelle Revision',
        conflict && conflict.details && conflict.details.currentRevision === 2,
        conflict && conflict.details);

    section('5) Restore auf einem leeren Rechner');

    await fs.emptyDir(path.join(tmpRoot, 'luxcloud', 'blobs'));
    const freshRoot = path.join(tmpRoot, 'pc2');
    const freshDir = path.join(freshRoot, 'Skyblock');
    await fs.ensureDir(freshDir);

    const restored = await downloader.restoreInstance({
        instanceUuid: instanceId,
        instanceDir: freshDir,
        instanceName: 'Skyblock'
    });

    check('der Restore holt die aktuelle Revision', restored.revision === 2, restored);
    check('nichts blieb unauffindbar', restored.unavailable.length === 0, restored.unavailable);

    const original = await fs.readFile(path.join(instanceDir, 'mods/privat.jar'));
    const copy = await fs.readFile(path.join(freshDir, 'mods/privat.jar'));
    check('die Mod kommt byte-genau an', sha256(original) === sha256(copy), {
        original: sha256(original),
        copy: sha256(copy)
    });

    const restoredConfig = await fs.readFile(path.join(freshDir, 'config/sodium.json'), 'utf8');
    check('die geaenderte Config kommt in der neuen Fassung an',
        JSON.parse(restoredConfig).quality === 'low', restoredConfig);

    check('verschachtelte Ordner werden angelegt',
        await fs.pathExists(path.join(freshDir, 'config/nested/deep.toml')), null);
    check('das Staging-Verzeichnis ist wieder weg',
        !await fs.pathExists(path.join(freshDir, '.lux-sync', 'staging')), null);
    check('logs/ wurde nicht wiederhergestellt',
        !await fs.pathExists(path.join(freshDir, 'logs')), null);

    section('6) Zweiter Restore kostet keine Bytes');

    const again = await downloader.restoreInstance({
        instanceUuid: instanceId,
        instanceDir: freshDir,
        instanceName: 'Skyblock'
    });

    check('alles liegt schon lokal', again.counters.local === again.files, again.counters);
    check('es wurden 0 Bytes geladen', again.downloadedBytes === 0, again);

    section('7) Restore in ein drittes Verzeichnis nutzt den Blob-Cache');

    const thirdDir = path.join(tmpRoot, 'pc3', 'Skyblock');
    await fs.ensureDir(thirdDir);

    const third = await downloader.restoreInstance({
        instanceUuid: instanceId,
        instanceDir: thirdDir,
        instanceName: 'Skyblock'
    });

    check('der lokale Cache bedient den Restore', third.counters.cache > 0, third.counters);
    check('vom Server kam nichts mehr', (third.counters.server || 0) === 0, third.counters);
    check('auch hier 0 Bytes aus dem Netz', third.downloadedBytes === 0, third);

    section('8) Blob-Cache');

    const stats = await blobStore.stats();
    check('der Cache enthaelt Blobs', stats.count > 0, stats);

    const pruned = await blobStore.prune({ maxBytes: 1 });
    check('prune raeumt bis unter das Limit', pruned.removed > 0, pruned);
    check('danach ist der Cache praktisch leer', (await blobStore.stats()).totalBytes <= 1, await blobStore.stats());

    section('9) Ein manipuliertes Manifest wird abgewiesen');

    let unsafe = null;
    const original_authed = api.authed;
    api.authed = async (config) => {
        if (String(config.url || '').includes('/manifest')) {
            return {
                revision: 99,
                manifestHash: 'x'.repeat(64),
                manifest: {
                    manifestVersion: 1,
                    instanceId,
                    name: 'Boese',
                    entries: [{
                        path: '../../evil.txt',
                        size: 4,
                        mtime: 1,
                        sha256: sha256(Buffer.from('evil')),
                        blob: sha256(Buffer.from('evil'))
                    }]
                }
            };
        }
        return original_authed(config);
    };

    try {
        await downloader.restoreInstance({
            instanceUuid: instanceId,
            instanceDir: path.join(tmpRoot, 'pc4'),
            instanceName: 'Boese'
        });
    } catch (err) {
        unsafe = err;
    }
    api.authed = original_authed;

    check('ein Pfad ausserhalb der Instanz wird abgelehnt', unsafe !== null, unsafe);
    check('der Fehler heisst invalid_path', unsafe && unsafe.code === 'invalid_path', unsafe && unsafe.code);
    check('nichts wurde ausserhalb geschrieben',
        !await fs.pathExists(path.join(tmpRoot, 'evil.txt')), null);

    h.stop();
    await fs.remove(tmpRoot).catch(() => {});

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
