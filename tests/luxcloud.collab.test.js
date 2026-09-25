// Zusammenarbeit an einer Instanz, Ende zu Ende: zwei Konten, zwei "PCs", ein echter
// Server (Harness aus dem Website-Repo).
//
// Der Host teilt eine Instanz, ein Mitglied holt sie, fuegt eine Mod hinzu und entfernt
// eine andere. Dabei darf nie etwas Privates die Seite wechseln: die options.txt (mit den
// Tastenbelegungen) des Hosts landet nicht beim Mitglied, die des Mitglieds nicht beim
// Host.

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

async function main() {
    if (!WEBSITE) {
        console.log('Website-Repo nicht gefunden, Test wird uebersprungen.');
        process.exit(0);
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-collab-'));
    process.env.LUXCLOUD_DIR = path.join(tmp, 'host', 'luxcloud');

    const { Harness } = require(path.join(WEBSITE, 'tests', 'luxcloudHarness.js'));
    const h = new Harness();
    await h.start();
    process.env.LUXCLOUD_BASE_URL = `http://127.0.0.1:${h.server.address().port}`;

    const hostId = await h.createUser({ googleId: 'g-host', username: 'host', email: 'host@example.com' });
    const bobId = await h.createUser({ googleId: 'g-bob', username: 'bob', email: 'bob@example.com' });
    const hostTokens = await h.authorizeDevice({
        user: { id: hostId, username: 'host', role: 'user', banned: false }, deviceUuid: 'dev-collab-host'
    });
    const bobTokens = await h.authorizeDevice({
        user: { id: bobId, username: 'bob', role: 'user', banned: false }, deviceUuid: 'dev-collab-bob1'
    });

    const auth = require('../backend/luxcloud/auth');
    const api = require('../backend/luxcloud/api');
    const uploader = require('../backend/luxcloud/uploader');
    const downloader = require('../backend/luxcloud/downloader');
    const preLaunch = require('../backend/luxcloud/preLaunch');
    const { ensureInstanceId } = require('../backend/luxcloud/instanceIdentity');
    const { readInstanceState } = require('../backend/luxcloud/syncState');

    // Jeder "PC" hat seinen eigenen Lux-Cloud-Ordner (Buchfuehrung, Abbilder, Caches) und
    // sein eigenes Konto -- so wie in echt.
    // state.js haelt den Zustand im Speicher; in echt gibt es ihn pro PC einmal. Beim
    // Umschalten wird deshalb der Instanz-Teil des jeweiligen PCs gesichert und eingespielt.
    const luxState = require('../backend/luxcloud/state');
    const machines = {
        host: { dir: path.join(tmp, 'host', 'luxcloud'), token: hostTokens.accessToken, instances: {} },
        bob: { dir: path.join(tmp, 'bob', 'luxcloud'), token: bobTokens.accessToken, instances: {} }
    };
    let current = null;
    const useMachine = async (name) => {
        if (current) {
            machines[current].instances = JSON.parse(JSON.stringify((await luxState.readState()).instances || {}));
        }
        current = name;
        process.env.LUXCLOUD_DIR = machines[name].dir;
        auth.getValidAccessToken = async () => machines[name].token;
        await luxState.patchState({ instances: JSON.parse(JSON.stringify(machines[name].instances)) });
    };

    await useMachine('host');
    const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
    const capabilities = me.capabilities || {};
    const opts = { enableChunking: false };

    // ---- Host ----------------------------------------------------------------------
    const hostDir = path.join(tmp, 'host', 'instances', 'Team Pack');
    await fs.ensureDir(path.join(hostDir, 'mods'));
    await fs.ensureDir(path.join(hostDir, 'config'));
    await fs.writeJson(path.join(hostDir, 'instance.json'), {
        name: 'Team Pack', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.0'
    }, { spaces: 4 });
    await fs.writeFile(path.join(hostDir, 'mods', 'a.jar'), 'mod-a');
    await fs.writeFile(path.join(hostDir, 'config', 'a.toml'), 'speed = 1');
    await fs.writeFile(path.join(hostDir, 'options.txt'), 'key_key.jump:key.keyboard.space\n');
    await fs.writeFile(path.join(hostDir, 'servers.dat'), 'HOST-SERVERS');
    const { instanceId } = await ensureInstanceId(hostDir);

    const hostCommon = { instanceDir: hostDir, instanceId, instanceName: 'Team Pack', capabilities };

    section('1) Der Host teilt die Instanz');

    const first = await uploader.uploadInstance({ ...hostCommon, options: opts });
    check('Revision 1 liegt in der Cloud', first.revision === 1, first.revision);

    const added = await api.authed({
        method: 'POST', url: `/api/cloud/instances/${instanceId}/members`, data: { email: 'bob@example.com' }
    });
    check('Bob ist Mitglied', added.members.some((m) => m.username === 'bob'), added.members);

    // ---- Bob -----------------------------------------------------------------------
    section('2) Bob holt die geteilte Instanz');

    await useMachine('bob');
    const shared = await api.authed({ method: 'GET', url: '/api/cloud/shared' });
    check('Bob sieht sie unter "geteilt"', shared.instances.some((i) => i.instanceUuid === instanceId), shared.instances);

    const bobDir = path.join(tmp, 'bob', 'instances', 'Team Pack');
    await fs.ensureDir(bobDir);
    const joined = await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: bobDir, instanceName: 'Team Pack', shareInfo: { owner: { username: 'host' } }
    });
    check('der Download meldet Revision 1', joined.revision === 1, joined.revision);
    check('als Mitglied', joined.access === 'member', joined.access);
    check('die Mod ist da', await fs.pathExists(path.join(bobDir, 'mods', 'a.jar')), null);
    check('die Config ist da', await fs.pathExists(path.join(bobDir, 'config', 'a.toml')), null);
    check('Version und Loader sind da', (await fs.readJson(path.join(bobDir, 'instance.json'))).loader === 'fabric', null);
    check('die Tastenbelegung des Hosts NICHT', !await fs.pathExists(path.join(bobDir, 'options.txt')), null);
    check('seine Serverliste auch nicht', !await fs.pathExists(path.join(bobDir, 'servers.dat')), null);

    const bobState = await readInstanceState(instanceId);
    check('Bob ist lokal als Mitglied vermerkt', bobState && bobState.shareRole === 'member', bobState);

    const bobCommon = { instanceDir: bobDir, instanceId, instanceName: 'Team Pack', capabilities };

    const bobNoop = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('ein Sync ohne Aenderung erzeugt keine Revision', bobNoop.skipped === true, bobNoop);

    section('3) Bob fuegt eine Mod hinzu');

    await fs.writeFile(path.join(bobDir, 'mods', 'b.jar'), 'mod-b-von-bob');
    await fs.writeFile(path.join(bobDir, 'options.txt'), 'key_key.jump:key.keyboard.j\n');
    await fs.writeFile(path.join(bobDir, 'servers.dat'), 'BOB-SERVERS');

    const bobUp = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('Bobs Upload erzeugt Revision 2', bobUp.skipped === false && bobUp.revision === 2, bobUp);

    const bobAgain = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('danach ist Bob ruhig (keine leere Revision)', bobAgain.skipped === true && !bobAgain.pullRequired, bobAgain);

    // ---- Host holt nach, waehrend er selbst etwas geaendert hat ------------------
    section('4) Der Host hat inzwischen selbst etwas geaendert');

    await useMachine('host');
    await fs.writeFile(path.join(hostDir, 'options.txt'), 'key_key.jump:key.keyboard.space\nfov:90\n');

    const hostMerged = await uploader.uploadInstance({ ...hostCommon, options: opts });
    check('kein Konflikt, sondern zusammengefuehrt: Revision 3', hostMerged.skipped === false && hostMerged.revision === 3, hostMerged);
    check('Bobs Mod ist beim Host angekommen',
        (await fs.readFile(path.join(hostDir, 'mods', 'b.jar'), 'utf8')) === 'mod-b-von-bob', null);
    check('die Tastenbelegung des Hosts ist unangetastet',
        (await fs.readFile(path.join(hostDir, 'options.txt'), 'utf8')).includes('fov:90'), null);
    check('seine Serverliste auch',
        (await fs.readFile(path.join(hostDir, 'servers.dat'), 'utf8')) === 'HOST-SERVERS', null);

    const hostManifest = await api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/manifest` });
    const hostPaths = hostManifest.manifest.entries.map((e) => e.path);
    check('in der Cloud liegt die options.txt des Hosts', hostPaths.includes('options.txt'), hostPaths);

    const authors = await api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/authors` });
    check('b.jar wird Bob zugeschrieben', authors.authors['mods/b.jar'] && authors.authors['mods/b.jar'].username === 'bob', authors.authors);

    // ---- Bob zieht nach ----------------------------------------------------------
    section('5) Bob startet und bekommt den neuen Stand');

    await useMachine('bob');
    const gate = await preLaunch.checkBeforeLaunch({
        instanceDir: bobDir, instanceId, instanceName: 'Team Pack', options: {}
    });
    check('Bob darf starten', gate.canLaunch === true, gate.decision);
    check('seine eigene Tastenbelegung bleibt',
        (await fs.readFile(path.join(bobDir, 'options.txt'), 'utf8')) === 'key_key.jump:key.keyboard.j\n', null);
    check('seine Serverliste bleibt',
        (await fs.readFile(path.join(bobDir, 'servers.dat'), 'utf8')) === 'BOB-SERVERS', null);

    section('6) Bob entfernt eine Mod');

    await fs.remove(path.join(bobDir, 'mods', 'a.jar'));
    let denied = null;
    try {
        await uploader.uploadInstance({ ...bobCommon, options: opts });
    } catch (err) {
        denied = err;
    }
    check('ohne Erlaubnis des Hosts wird das Loeschen abgelehnt',
        denied && denied.code === 'permission_denied', denied && denied.code);

    await useMachine('host');
    await api.authed({
        method: 'PATCH',
        url: `/api/cloud/instances/${instanceId}/members/${bobId}`,
        data: { permissions: { removeContent: true } }
    });
    await useMachine('bob');

    const bobRemove = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('mit Erlaubnis erzeugt Bobs Entfernen eine Revision', bobRemove.skipped === false, bobRemove);

    // Abschalten (Umbenennen zu .disabled) ist eine Aenderung, kein Loeschen.
    await useMachine('host');
    await api.authed({
        method: 'PATCH',
        url: `/api/cloud/instances/${instanceId}/members/${bobId}`,
        data: { permissions: { removeContent: false } }
    });
    await useMachine('bob');
    await fs.move(path.join(bobDir, 'mods', 'b.jar'), path.join(bobDir, 'mods', 'b.jar.disabled'));
    const bobToggle = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('eine Mod abschalten geht auch ohne Loeschrecht', bobToggle.skipped === false, bobToggle);
    await fs.move(path.join(bobDir, 'mods', 'b.jar.disabled'), path.join(bobDir, 'mods', 'b.jar'));
    const bobToggleBack = await uploader.uploadInstance({ ...bobCommon, options: opts });
    check('und wieder einschalten', bobToggleBack.skipped === false, bobToggleBack);

    await useMachine('host');
    const hostGate = await preLaunch.checkBeforeLaunch({
        instanceDir: hostDir, instanceId, instanceName: 'Team Pack', options: {}
    });
    check('der Host holt den Stand vor dem Start', hostGate.canLaunch === true && hostGate.decision === 'updated', hostGate.decision);
    check('a.jar ist beim Host verschwunden', !await fs.pathExists(path.join(hostDir, 'mods', 'a.jar')), null);
    check('b.jar ist noch da', await fs.pathExists(path.join(hostDir, 'mods', 'b.jar')), null);
    check('die Config ist noch da', await fs.pathExists(path.join(hostDir, 'config', 'a.toml')), null);

    section('7) Der Host entfernt Bob');

    await api.authed({ method: 'DELETE', url: `/api/cloud/instances/${instanceId}/members/${bobId}` });

    await useMachine('bob');
    await fs.writeFile(path.join(bobDir, 'mods', 'c.jar'), 'mod-c');
    let revoked = null;
    try {
        await uploader.uploadInstance({ ...bobCommon, options: opts });
    } catch (err) {
        revoked = err;
    }
    check('Bob kann danach nichts mehr hochladen', revoked && revoked.code === 'share_revoked', revoked && revoked.code);

    await useMachine('host');
    const finalManifest = await api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/manifest` });
    check('c.jar ist nicht in der Cloud', !finalManifest.manifest.entries.some((e) => e.path === 'mods/c.jar'), null);

    h.stop();
    await fs.remove(tmp).catch(() => {});

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
