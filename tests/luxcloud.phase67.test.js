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

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function manifest(entries) {
    return { manifestVersion: 1, entries };
}

function entry(p, content) {
    return { path: p, size: content.length, mtime: 1, sha256: sha256(content), blob: sha256(content) };
}

async function main() {
    const conflict = require('../backend/luxcloud/conflict');
    const autoSync = require('../backend/luxcloud/autoSync');

    section('1) Drei-Wege-Diff');

    const base = manifest([entry('config/a.json', 'A'), entry('mods/x.jar', 'X')]);

    let diff = conflict.diffManifests(base, base, base);
    check('identische Manifeste sind konfliktfrei', diff.clean === true, diff.summary);

    diff = conflict.diffManifests(
        base,
        manifest([entry('config/a.json', 'A2'), entry('mods/x.jar', 'X')]),
        base
    );
    check('nur lokal geaendert gewinnt lokal',
        diff.autoLocal.length === 1 && diff.conflicts.length === 0, diff);
    check('und braucht keine Nachfrage', diff.needsUser === false, diff);

    diff = conflict.diffManifests(
        base,
        base,
        manifest([entry('config/a.json', 'A3'), entry('mods/x.jar', 'X')])
    );
    check('nur remote geaendert gewinnt remote',
        diff.autoRemote.length === 1 && diff.conflicts.length === 0, diff);

    diff = conflict.diffManifests(
        base,
        manifest([entry('config/a.json', 'LOKAL'), entry('mods/x.jar', 'X')]),
        manifest([entry('config/a.json', 'CLOUD'), entry('mods/x.jar', 'X')])
    );
    check('beidseitig geaenderte Config ist ein Konflikt', diff.conflicts.length === 1, diff.conflicts);
    check('der Konflikt braucht den Nutzer', diff.needsUser === true, diff);
    check('er ist als config eingeordnet', diff.conflicts[0].kind === 'config', diff.conflicts[0]);

    diff = conflict.diffManifests(
        base,
        manifest([entry('config/a.json', 'A'), entry('mods/x.jar', 'X'), entry('mods/neu.jar', 'N')]),
        manifest([entry('config/a.json', 'A'), entry('mods/x.jar', 'X'), entry('mods/andere.jar', 'B')])
    );
    check('zwei verschiedene neue Mods sind kein Konflikt',
        diff.conflicts.length === 0 && diff.autoLocal.length === 1 && diff.autoRemote.length === 1, diff);

    diff = conflict.diffManifests(
        base,
        manifest([entry('config/a.json', 'A'), entry('mods/x.jar', 'X'), entry('mods/gleich.jar', 'G')]),
        manifest([entry('config/a.json', 'A'), entry('mods/x.jar', 'X'), entry('mods/gleich.jar', 'ANDERS')])
    );
    check('dieselbe neue Mod mit anderem Inhalt wird automatisch vereinigt',
        diff.conflicts.length === 1 && diff.conflicts[0].automatic === true
        && diff.conflicts[0].suggested === 'both', diff.conflicts[0]);

    diff = conflict.diffManifests(
        base,
        manifest([entry('mods/x.jar', 'X')]),
        manifest([entry('config/a.json', 'GEAENDERT'), entry('mods/x.jar', 'X')])
    );
    check('Loeschen gegen Aendern: die Aenderung gewinnt',
        diff.conflicts.length === 1 && diff.conflicts[0].reason === 'delete-vs-modify'
        && diff.conflicts[0].suggested === 'remote' && diff.conflicts[0].automatic === true,
        diff.conflicts[0]);

    section('2) Welten sind eine eigene Konflikteinheit');

    const worldBase = manifest([
        entry('saves/Welt/level.dat', 'L'),
        entry('saves/Welt/region/r.0.0.mca', 'R')
    ]);

    diff = conflict.diffManifests(
        worldBase,
        manifest([entry('saves/Welt/level.dat', 'L1'), entry('saves/Welt/region/r.0.0.mca', 'R1')]),
        manifest([entry('saves/Welt/level.dat', 'L2'), entry('saves/Welt/region/r.0.0.mca', 'R2')])
    );
    check('eine Welt wird als eine Einheit gemeldet', diff.worldConflicts.length === 1, diff.worldConflicts);
    check('mit der Zahl der betroffenen Dateien', diff.worldConflicts[0].fileCount === 2, diff.worldConflicts[0]);
    check('sie taucht nicht zusaetzlich als Dateikonflikt auf', diff.conflicts.length === 0, diff.conflicts);
    check('und wird nie automatisch geloest', diff.worldConflicts[0].automatic === false, diff.worldConflicts[0]);

    section('3) Plan bauen');

    diff = conflict.diffManifests(
        base,
        manifest([entry('config/a.json', 'LOKAL'), entry('mods/x.jar', 'X')]),
        manifest([entry('config/a.json', 'CLOUD'), entry('mods/x.jar', 'X')])
    );

    let plan = conflict.buildPlan(diff, conflict.RESOLUTION.LOCAL);
    check('bei local landet die Datei auf der Behalten-Seite',
        plan.keepLocal.includes('config/a.json') && !plan.takeRemote.includes('config/a.json'), plan);

    plan = conflict.buildPlan(diff, conflict.RESOLUTION.REMOTE);
    check('bei remote andersherum',
        plan.takeRemote.includes('config/a.json') && !plan.keepLocal.includes('config/a.json'), plan);

    section('4) Sicherung der Verliererseite');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-p67-'));
    const instanceDir = path.join(tmp, 'Skyblock');
    await fs.ensureDir(path.join(instanceDir, 'config'));
    await fs.writeFile(path.join(instanceDir, 'config', 'a.json'), 'MEINE FASSUNG');
    await fs.writeFile(path.join(instanceDir, 'options.txt'), 'fov:90');

    const backup = await conflict.backupLosers(instanceDir, 7, ['config/a.json', 'options.txt', 'fehlt.txt']);
    check('vorhandene Dateien werden gesichert', backup.saved === 2, backup);
    check('der Inhalt bleibt erhalten',
        await fs.readFile(path.join(backup.dir, 'config', 'a.json'), 'utf8') === 'MEINE FASSUNG', null);
    check('die Sicherung liegt unter .lux-sync/conflicts',
        backup.dir.includes(path.join('.lux-sync', 'conflicts')), backup.dir);
    check('fehlende Dateien stoeren nicht',
        !await fs.pathExists(path.join(backup.dir, 'fehlt.txt')), null);

    section('5) Auto-Sync-Scheduler');

    autoSync.reset();

    const calls = [];
    autoSync.setRunner(async (name, opts) => {
        calls.push({ name, reason: opts.reason });
        return { revision: calls.length };
    });

    autoSync.schedule('A', { delayMs: 20 });
    autoSync.schedule('A', { delayMs: 20 });
    autoSync.schedule('A', { delayMs: 20 });
    check('mehrfaches Anstossen ergibt einen Eintrag', autoSync.pendingInstances().length === 1,
        autoSync.pendingInstances());

    await new Promise((r) => setTimeout(r, 80));
    check('nach dem Entprellen laeuft er genau einmal', calls.length === 1, calls);

    autoSync.suspend('B');
    autoSync.schedule('B', { delayMs: 10 });
    check('eine laufende Instanz wird nicht eingeplant', autoSync.pendingInstances().length === 0,
        autoSync.pendingInstances());

    autoSync.resume('B');
    await autoSync.schedule('B', { immediate: true, reason: 'test' });
    check('nach dem Fortsetzen laeuft sie wieder',
        calls.some((c) => c.name === 'B' && c.reason === 'test'), calls);

    autoSync.reset();
    autoSync.setRunner(async () => {
        const err = new Error('offline');
        err.code = 'offline';
        throw err;
    });

    const errors = [];
    autoSync.events.on('error', (payload) => errors.push(payload));
    await autoSync.schedule('C', { immediate: true });

    check('ein Offline-Fehler wird als wiederholbar gemeldet',
        errors.length === 1 && errors[0].retryable === true, errors[0]);
    check('und ein neuer Versuch ist eingeplant', autoSync.pendingInstances().includes('C'),
        autoSync.pendingInstances());

    check('der Backoff waechst',
        autoSync.backoffFor(0) < autoSync.backoffFor(3)
        && autoSync.backoffFor(3) < autoSync.backoffFor(5), {
            a: autoSync.backoffFor(0), b: autoSync.backoffFor(3), c: autoSync.backoffFor(5)
        });
    check('und ist gedeckelt', autoSync.backoffFor(99) === autoSync.backoffFor(5), null);

    autoSync.reset();

    if (!WEBSITE) {
        console.log('\nWebsite-Repo nicht gefunden - der Server-Teil wird uebersprungen.');
        await fs.remove(tmp).catch(() => {});
        console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
        process.exit(failed === 0 ? 0 : 1);
    }

    section('6) Kein Commit ohne Aenderung');

    process.env.LUXCLOUD_DIR = path.join(tmp, 'luxcloud');

    const { Harness } = require(path.join(WEBSITE, 'tests', 'luxcloudHarness.js'));
    const h = new Harness();
    await h.start();
    process.env.LUXCLOUD_BASE_URL = `http://127.0.0.1:${h.server.address().port}`;

    const userId = await h.createUser({ googleId: 'g-p67', username: 'beatv' });
    const tokens = await h.authorizeDevice({
        user: { id: userId, username: 'beatv', role: 'user', banned: false },
        deviceUuid: 'dev-p67-0001'
    });

    const auth = require('../backend/luxcloud/auth');
    auth.getValidAccessToken = async () => tokens.accessToken;

    const api = require('../backend/luxcloud/api');
    const uploader = require('../backend/luxcloud/uploader');
    const preLaunch = require('../backend/luxcloud/preLaunch');
    const { ensureInstanceId } = require('../backend/luxcloud/instanceIdentity');

    const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
    const capabilities = me.capabilities || {};

    const syncDir = path.join(tmp, 'instances', 'Skyblock');
    await fs.ensureDir(path.join(syncDir, 'config'));
    await fs.writeFile(path.join(syncDir, 'instance.json'), JSON.stringify({
        name: 'Skyblock', version: '1.21.11', loader: 'fabric', playtime: 0
    }, null, 4));
    await fs.writeFile(path.join(syncDir, 'config', 'a.json'), '{"fov":90}');
    await fs.writeFile(path.join(syncDir, 'options.txt'), 'fov:90');

    const { instanceId } = await ensureInstanceId(syncDir);
    const common = { instanceDir: syncDir, instanceId, instanceName: 'Skyblock', capabilities };

    const first = await uploader.uploadInstance({ ...common, options: { enableChunking: false } });
    check('der erste Sync erzeugt Revision 1', first.revision === 1 && first.skipped === false, first);

    const second = await uploader.uploadInstance({ ...common, options: { enableChunking: false } });
    check('ein Sync ohne Aenderung erzeugt KEINE neue Revision',
        second.skipped === true && second.revision === 1, second);

    await fs.writeFile(path.join(syncDir, 'config', 'a.json'), '{"fov":70}');
    const third = await uploader.uploadInstance({ ...common, options: { enableChunking: false } });
    check('nach einer Aenderung wird wieder committet',
        third.skipped === false && third.revision === 2, third);

    const forced = await uploader.uploadInstance({ ...common, options: { enableChunking: false, force: true } });
    check('force erzwingt trotzdem eine Revision', forced.skipped === false && forced.revision === 3, forced);

    section('7) Pre-Launch-Gate');

    let gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir,
        instanceId,
        instanceName: 'Skyblock',
        options: {}
    });
    check('alles aktuell: es wird sofort gestartet',
        gate.decision === 'launch' && gate.canLaunch === true, gate);
    check('und nichts muss nachgeschoben werden', gate.pushAfterLaunch === false, gate);

    await fs.writeFile(path.join(syncDir, 'options.txt'), 'fov:70');
    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId, instanceName: 'Skyblock', options: {}
    });
    check('lokale Aenderung ohne Cloud-Aenderung: starten und danach schieben',
        gate.decision === 'launch' && gate.canLaunch === true && gate.pushAfterLaunch === true, gate);

    const unknown = 'inst-nicht-verknuepft';
    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId: unknown, instanceName: 'Fremd', options: {}
    });
    check('eine nicht verknuepfte Instanz startet sofort',
        gate.decision === 'not-linked' && gate.canLaunch === true, gate);

    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId, instanceName: 'Skyblock', options: { enabled: false }
    });
    check('abgeschaltet wird gar nicht erst gefragt',
        gate.decision === 'disabled' && gate.canLaunch === true, gate);

    section('8) Offline blockiert nie');

    const goodBase = process.env.LUXCLOUD_BASE_URL;
    process.env.LUXCLOUD_BASE_URL = 'http://127.0.0.1:1';

    const started = Date.now();
    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId, instanceName: 'Skyblock', options: {}
    });
    const took = Date.now() - started;

    check('offline wird gestartet', gate.decision === 'offline' && gate.canLaunch === true, gate);
    check('und zwar zuegig', took < preLaunch.HEAD_TIMEOUT_MS + 1500, { took });

    process.env.LUXCLOUD_BASE_URL = goodBase;

    section('9) Cloud ist weiter, lokal sauber');

    await fs.writeFile(path.join(syncDir, 'config', 'a.json'), '{"fov":30}');
    const ahead = await uploader.uploadInstance({ ...common, options: { enableChunking: false } });

    const { rememberRevision } = require('../backend/luxcloud/syncState');
    await fs.writeFile(path.join(syncDir, 'config', 'a.json'), '{"fov":70}');
    await rememberRevision(instanceId, { lastKnownRevision: ahead.revision - 1 });

    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId, instanceName: 'Skyblock', options: {}
    });
    check('lokale Aenderung plus neuere Cloud ergibt einen Konflikt',
        gate.decision === 'conflict' && gate.canLaunch === false, gate.decision);
    check('der Konflikt liefert das Cloud-Manifest mit', Boolean(gate.remoteManifest), null);
    check('und benennt die lokalen Aenderungen', gate.changedLocally > 0, gate.changedLocally);

    await fs.writeFile(path.join(syncDir, 'config', 'a.json'), '{"fov":30}');
    await uploader.uploadInstance({ ...common, options: { enableChunking: false, force: true } });
    const settled = await uploader.uploadInstance({ ...common, options: { enableChunking: false } });
    await rememberRevision(instanceId, { lastKnownRevision: settled.revision - 1 });

    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: syncDir, instanceId, instanceName: 'Skyblock', options: {}
    });
    check('bei sauberem Stand wird vor dem Start aktualisiert',
        gate.decision === 'updated' && gate.canLaunch === true, gate.decision);
    check('und der Start bleibt erlaubt', gate.canLaunch === true, gate);

    h.stop();
    await fs.remove(tmp).catch(() => {});

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
