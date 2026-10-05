// Dieselbe Mod mehrfach in einer Cloud-Instanz.
//
// Der Abgleich arbeitet Datei fuer Datei. Ein Mod-Update ist aber kein "Datei geaendert",
// sondern "alte JAR weg, neue JAR mit anderem Namen da". Haben zwei PCs dieselbe Mod
// unterschiedlich aktualisiert, sah der Abgleich zwei voneinander unabhaengige neue
// Dateien und behielt beide -- und mit jedem weiteren Update kam eine Version dazu.
// Ohne Cloud passiert das nie, denn dort gibt es nur einen Ordner.

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

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

function fabricJar(id, version, extra = '') {
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id, version })));
    zip.addFile('payload.txt', Buffer.from(`${id}@${version}${extra}`));
    return zip.toBuffer();
}

function forgeJar(modId, version) {
    const zip = new AdmZip();
    zip.addFile('META-INF/mods.toml', Buffer.from(
        `modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="${modId}"\nversion="${version}"\n`
    ));
    return zip.toBuffer();
}

async function modsIn(dir) {
    const names = await fs.readdir(path.join(dir, 'mods')).catch(() => []);
    return names.filter((name) => !name.startsWith('.')).sort();
}

async function unitTests() {
    const modDuplicates = require('../backend/luxcloud/modDuplicates');

    section('0) Erkennen, welche JARs dieselbe Mod sind');

    check('Versionen werden numerisch verglichen',
        modDuplicates.compareVersions('1.10.0', '1.9.2') > 0
        && modDuplicates.compareVersions('1.2.0+mc1.21', '1.2.0+mc1.20') === 0
        && modDuplicates.compareVersions('2.0.0-beta.1', '2.0.0') < 0, null);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-dups-unit-'));
    const dir = path.join(tmp, 'inst');
    await fs.ensureDir(path.join(dir, 'mods'));
    await fs.writeFile(path.join(dir, 'mods', 'Essential-1.3.0.jar'), fabricJar('essential', '1.3.0'));
    await fs.writeFile(path.join(dir, 'mods', 'Essential-1.10.0.jar'), fabricJar('essential', '1.10.0'));
    await fs.writeFile(path.join(dir, 'mods', 'essential_old.jar'), fabricJar('essential', '1.2.5'));
    await fs.writeFile(path.join(dir, 'mods', 'sodium.jar'), fabricJar('sodium', '0.6.0'));
    await fs.writeFile(path.join(dir, 'mods', 'jei-a.jar'), forgeJar('jei', '15.2.0'));
    await fs.writeFile(path.join(dir, 'mods', 'jei-b.jar'), forgeJar('jei', '15.20.0'));
    await fs.writeFile(path.join(dir, 'mods', 'broken.jar'), Buffer.from('not a zip'));
    await fs.writeFile(path.join(dir, 'mods', 'other-broken.jar'), Buffer.from('also not a zip'));
    // Deaktivierte Mods bleiben wie sie sind -- das hat jemand bewusst so eingestellt.
    await fs.writeFile(path.join(dir, 'mods', 'sodium-old.jar.disabled'), fabricJar('sodium', '0.5.0'));

    const result = await modDuplicates.removeDuplicateMods(dir);
    const left = await modsIn(dir);
    check('von Essential bleibt nur die neueste Version',
        left.includes('Essential-1.10.0.jar') && !left.includes('Essential-1.3.0.jar') && !left.includes('essential_old.jar'),
        left);
    check('Forge-Mods (mods.toml) werden genauso erkannt',
        left.includes('jei-b.jar') && !left.includes('jei-a.jar'), left);
    check('andere Mods, unlesbare JARs und deaktivierte Mods bleiben',
        ['sodium.jar', 'broken.jar', 'other-broken.jar', 'sodium-old.jar.disabled'].every((name) => left.includes(name)), left);
    check('das Ergebnis nennt die entfernten Dateien',
        result.removed.length === 3, result.removed);
    check('die entfernten Dateien liegen als Sicherung im Instanzordner',
        result.backupDir && await fs.pathExists(path.join(result.backupDir, 'mods', 'Essential-1.3.0.jar')), result.backupDir);

    const again = await modDuplicates.removeDuplicateMods(dir);
    check('ein zweiter Lauf findet nichts mehr', again.removed.length === 0, again.removed);

    // Bevorzugt wird die Datei, die die Cloud fuehrt -- auch wenn eine andere eine hoehere
    // Versionsnummer hat. Sonst wuerde jeder PC seine eigene Wahl wieder hochladen.
    await fs.writeFile(path.join(dir, 'mods', 'Essential-1.3.0.jar'), fabricJar('essential', '1.3.0'));
    const preferred = await modDuplicates.removeDuplicateMods(dir, { prefer: new Set(['mods/Essential-1.3.0.jar']) });
    const leftPreferred = await modsIn(dir);
    check('eine bevorzugte Datei (aus der Cloud) gewinnt',
        leftPreferred.includes('Essential-1.3.0.jar') && !leftPreferred.includes('Essential-1.10.0.jar'),
        { left: leftPreferred, removed: preferred.removed });

    await fs.remove(tmp).catch(() => {});
}

async function main() {
    await unitTests();

    if (!WEBSITE) {
        console.log('Website-Repo nicht gefunden, Zwei-PC-Teil wird uebersprungen.');
        console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
        process.exit(failed === 0 ? 0 : 1);
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-dups-'));
    process.env.LUXCLOUD_DIR = path.join(tmp, 'luxcloud');

    const { Harness } = require(path.join(WEBSITE, 'tests', 'luxcloudHarness.js'));
    const h = new Harness();
    await h.start();
    process.env.LUXCLOUD_BASE_URL = `http://127.0.0.1:${h.server.address().port}`;

    const userId = await h.createUser({ googleId: 'g-dups', username: 'beatv' });
    const tokens = await h.authorizeDevice({
        user: { id: userId, username: 'beatv', role: 'user', banned: false },
        deviceUuid: 'dev-dups-0001'
    });

    const auth = require('../backend/luxcloud/auth');
    auth.getValidAccessToken = async () => tokens.accessToken;

    const api = require('../backend/luxcloud/api');
    const uploader = require('../backend/luxcloud/uploader');
    const downloader = require('../backend/luxcloud/downloader');
    const preLaunch = require('../backend/luxcloud/preLaunch');
    const luxState = require('../backend/luxcloud/state');
    const { ensureInstanceId } = require('../backend/luxcloud/instanceIdentity');

    const snapshots = { A: {}, B: {} };
    let current = 'A';
    async function switchToMachine(which) {
        const state = await luxState.readState();
        snapshots[current] = JSON.parse(JSON.stringify(state.instances || {}));
        current = which;
        await luxState.patchState({ instances: JSON.parse(JSON.stringify(snapshots[which])) });
    }

    const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
    const capabilities = me.capabilities || {};
    const NAME = 'Cloud Pack';

    const pcA = path.join(tmp, 'A', NAME);
    await fs.ensureDir(path.join(pcA, 'mods'));
    await fs.writeFile(path.join(pcA, 'instance.json'), JSON.stringify({
        name: NAME, version: '1.21.1', loader: 'fabric'
    }, null, 4));
    await fs.writeFile(path.join(pcA, 'mods', 'Essential-1.0.0.jar'), fabricJar('essential', '1.0.0'));
    await fs.writeFile(path.join(pcA, 'mods', 'sodium.jar'), fabricJar('sodium', '0.6.0'));
    const { instanceId } = await ensureInstanceId(pcA);

    const upload = (dir, options = {}) => uploader.uploadInstance({
        instanceDir: dir, instanceId, instanceName: NAME, capabilities,
        options: { enableChunking: false, ...options }
    });
    const cloudMods = async () => {
        const payload = await api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/manifest?revision=latest` });
        return payload.manifest.entries.map((entry) => entry.path).filter((p) => p.startsWith('mods/')).sort();
    };

    section('1) Beide PCs stehen auf demselben Stand');
    await upload(pcA);
    await switchToMachine('B');
    const pcB = path.join(tmp, 'B', NAME);
    await downloader.restoreInstance({ instanceUuid: instanceId, instanceDir: pcB, instanceName: NAME });
    check('PC B hat Essential 1.0.0', (await modsIn(pcB)).includes('Essential-1.0.0.jar'), await modsIn(pcB));

    section('2) Beide aktualisieren Essential -- jeder auf eine andere Version');
    await switchToMachine('A');
    await fs.remove(path.join(pcA, 'mods', 'Essential-1.0.0.jar'));
    await fs.writeFile(path.join(pcA, 'mods', 'Essential-1.1.0.jar'), fabricJar('essential', '1.1.0'));
    await upload(pcA);

    await switchToMachine('B');
    await fs.remove(path.join(pcB, 'mods', 'Essential-1.0.0.jar'));
    await fs.writeFile(path.join(pcB, 'mods', 'Essential-1.2.0.jar'), fabricJar('essential', '1.2.0'));
    const synced = await upload(pcB);
    check('PC B laedt nach dem Zusammenfuehren hoch', synced.skipped === false, synced);

    const essentialB = (await modsIn(pcB)).filter((name) => name.startsWith('Essential'));
    check('auf PC B liegt Essential nur EINMAL', essentialB.length === 1, essentialB);
    check('und zwar die neueste Version', essentialB[0] === 'Essential-1.2.0.jar', essentialB);
    const essentialCloud = (await cloudMods()).filter((p) => p.includes('Essential'));
    check('auch die Cloud fuehrt Essential nur einmal', essentialCloud.length === 1, essentialCloud);

    section('3) PC A holt den Stand und wird dabei nicht doppelt');
    await switchToMachine('A');
    await downloader.restoreInstance({ instanceUuid: instanceId, instanceDir: pcA, instanceName: NAME });
    const essentialA = (await modsIn(pcA)).filter((name) => name.startsWith('Essential'));
    check('PC A hat ebenfalls nur noch Essential 1.2.0',
        essentialA.length === 1 && essentialA[0] === 'Essential-1.2.0.jar', essentialA);

    section('4) Dasselbe ueber das Tor vor dem Spielstart');
    await fs.remove(path.join(pcA, 'mods', 'Essential-1.2.0.jar'));
    await fs.writeFile(path.join(pcA, 'mods', 'Essential-1.3.0.jar'), fabricJar('essential', '1.3.0'));
    await upload(pcA);

    await switchToMachine('B');
    await fs.remove(path.join(pcB, 'mods', 'Essential-1.2.0.jar'));
    await fs.writeFile(path.join(pcB, 'mods', 'Essential-1.4.0.jar'), fabricJar('essential', '1.4.0'));
    const gate = await preLaunch.checkBeforeLaunch({ instanceDir: pcB, instanceId, instanceName: NAME, options: {} });
    check('das Tor fuehrt zusammen und laesst starten', gate.canLaunch === true, gate.decision);
    const essentialGate = (await modsIn(pcB)).filter((name) => name.startsWith('Essential'));
    check('nach dem Zusammenfuehren liegt Essential nur einmal da',
        essentialGate.length === 1 && essentialGate[0] === 'Essential-1.4.0.jar', essentialGate);

    // Nach dem Spielen geht der zusammengefuehrte Stand hoch.
    const afterPlay = await upload(pcB);
    check('nach dem Spielen geht der zusammengefuehrte Stand hoch', afterPlay.skipped === false, afterPlay);

    section('5) Bereits doppelte Mods in der Cloud werden aufgeraeumt');
    // So sehen betroffene Instanzen heute aus: mehrere Versionen liegen schon in der Cloud.
    // Der Upload selbst raeumt nicht auf, er traegt nur hoch, was da liegt.
    await switchToMachine('A');
    await downloader.restoreInstance({ instanceUuid: instanceId, instanceDir: pcA, instanceName: NAME });
    for (const version of ['0.9.0', '0.8.0', '0.7.0']) {
        await fs.writeFile(path.join(pcA, 'mods', `Essential-${version}.jar`), fabricJar('essential', version));
    }
    const polluted = await upload(pcA);
    check('Ausgangslage: die Cloud fuehrt Essential mehrfach',
        polluted.skipped === false && (await cloudMods()).filter((p) => p.includes('Essential')).length === 4,
        await cloudMods());

    await switchToMachine('B');
    const pulled = await downloader.restoreInstance({ instanceUuid: instanceId, instanceDir: pcB, instanceName: NAME });
    const essentialPulled = (await modsIn(pcB)).filter((name) => name.startsWith('Essential'));
    check('der Download legt nur eine Version ab', essentialPulled.length === 1, essentialPulled);
    check('der Download meldet die bereinigten Dateien',
        Array.isArray(pulled.duplicatesRemoved) && pulled.duplicatesRemoved.length === 3, pulled.duplicatesRemoved);

    const cleaned = await upload(pcB);
    check('der naechste Sync nimmt die Duplikate aus der Cloud',
        cleaned.skipped === false && (await cloudMods()).filter((p) => p.includes('Essential')).length === 1,
        await cloudMods());

    await switchToMachine('A');
    await downloader.restoreInstance({ instanceUuid: instanceId, instanceDir: pcA, instanceName: NAME });
    const essentialAfter = (await modsIn(pcA)).filter((name) => name.startsWith('Essential'));
    check('und PC A verliert sie beim naechsten Holen ebenfalls', essentialAfter.length === 1, essentialAfter);
    const quiet = await upload(pcA);
    check('danach entsteht keine weitere Revision', quiet.skipped === true, quiet);

    section('6) Einmaliges Aufraeumen beim Start');
    await fs.writeFile(path.join(pcA, 'mods', 'Essential-0.5.0.jar'), fabricJar('essential', '0.5.0'));
    const { cleanupLinkedInstances } = require('../backend/luxcloud/modDuplicates');
    const { readInstanceState } = require('../backend/luxcloud/syncState');
    const resolveInstanceDir = (name) => (name === NAME ? pcA : null);
    const first = await cleanupLinkedInstances({ resolveInstanceDir });
    check('verknuepfte Instanzen werden beim Start bereinigt',
        first.cleaned.length === 1 && first.cleaned[0].removed[0] === 'mods/Essential-0.5.0.jar', first.cleaned);
    check('und als erledigt vermerkt',
        (await readInstanceState(instanceId)).duplicateModsCleanup === 1, null);
    await fs.writeFile(path.join(pcA, 'mods', 'Essential-0.5.0.jar'), fabricJar('essential', '0.5.0'));
    const second = await cleanupLinkedInstances({ resolveInstanceDir });
    check('beim naechsten Start passiert nichts mehr', second.cleaned.length === 0, second.cleaned);
    await fs.remove(path.join(pcA, 'mods', 'Essential-0.5.0.jar'));

    h.stop();
    await fs.remove(tmp).catch(() => {});

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
