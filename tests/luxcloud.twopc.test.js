// Zwei-PC-Szenario: genau der Ablauf, der im Alltag schiefging.
//
// PC A laedt eine Instanz hoch, PC B laedt sie herunter. Danach darf ein "Sync now" auf
// PC B keine Revision erzeugen, denn es hat sich nichts geaendert. Und wenn PC A
// weiterarbeitet, muss PC B das als Update angeboten bekommen statt den neueren Stand
// mit seinem alten zu ueberschreiben.

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

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luxcloud-twopc-'));
    process.env.LUXCLOUD_DIR = path.join(tmp, 'luxcloud');

    const { Harness } = require(path.join(WEBSITE, 'tests', 'luxcloudHarness.js'));
    const h = new Harness();
    await h.start();
    process.env.LUXCLOUD_BASE_URL = `http://127.0.0.1:${h.server.address().port}`;

    const userId = await h.createUser({ googleId: 'g-twopc', username: 'testuser' });
    const tokens = await h.authorizeDevice({
        user: { id: userId, username: 'testuser', role: 'user', banned: false },
        deviceUuid: 'dev-twopc-0001'
    });

    const auth = require('../backend/luxcloud/auth');
    auth.getValidAccessToken = async () => tokens.accessToken;

    const api = require('../backend/luxcloud/api');
    const uploader = require('../backend/luxcloud/uploader');
    const downloader = require('../backend/luxcloud/downloader');
    const luxState = require('../backend/luxcloud/state');
    const { ensureInstanceId } = require('../backend/luxcloud/instanceIdentity');
    const { readInstanceState } = require('../backend/luxcloud/syncState');

    // Beide Maschinen laufen hier im selben Prozess und teilen sich damit die
    // state.json, die es in Wirklichkeit zweimal gibt. Jeder "PC" bekommt deshalb
    // seinen eigenen Schnappschuss, der vor seinen Aktionen eingespielt wird -- sonst
    // wuesste PC B, was PC A gerade hochgeladen hat, und der Test waere wertlos.
    const snapshots = { A: {}, B: {}, C: {}, D: {} };
    let current = 'A';

    async function switchToMachine(which) {
        const state = await luxState.readState();
        snapshots[current] = JSON.parse(JSON.stringify(state.instances || {}));
        current = which;
        await luxState.patchState({ instances: JSON.parse(JSON.stringify(snapshots[which])) });
    }

    const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
    const capabilities = me.capabilities || {};

    // ---- PC A ----------------------------------------------------------------
    const pcA = path.join(tmp, 'A', 'PVP MISCHE');
    await fs.ensureDir(path.join(pcA, 'config'));
    await fs.writeFile(path.join(pcA, 'instance.json'), JSON.stringify({
        name: 'PVP MISCHE',
        version: '1.21.11',
        // Gross geschrieben wie in echten Instanzen -- der Server nimmt den Loader nur
        // klein an, und genau daran scheiterte jeder Sync mit "Invalid loader".
        loader: 'Fabric',
        loaderVersion: '0.16.9',
        memory: 8192,
        icon: 'instance-icon.png',
        javaPath: 'C:/pc-a/java.exe',
        playtime: 999
    }, null, 4));
    await fs.writeFile(path.join(pcA, 'instance-icon.png'), Buffer.from('PNGDATA-A'));
    await fs.writeFile(path.join(pcA, 'config', 'a.json'), '{"fov":90}');

    const { instanceId } = await ensureInstanceId(pcA);

    section('1) PC A laedt hoch');

    const up = await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false }
    });
    check('Revision 1 entsteht', up.revision === 1 && up.skipped === false, up.revision);
    check('das Manifest kennt Version und Loader',
        Boolean(up.instance) && up.instance.mcVersion === '1.21.11' && up.instance.loader === 'fabric',
        { mc: up.instance && up.instance.mcVersion, loader: up.instance && up.instance.loader });

    // ---- PC B ----------------------------------------------------------------
    section('2) PC B laedt herunter');

    await switchToMachine('B');

    const pcB = path.join(tmp, 'B', 'PVP MISCHE');
    await fs.ensureDir(pcB);
    // PC B hat eigene geraetelokale Werte, die den Download ueberleben muessen.
    await fs.writeFile(path.join(pcB, 'instance.json'), JSON.stringify({
        name: 'PVP MISCHE', javaPath: 'D:/pc-b/java.exe', playtime: 42
    }, null, 4));

    const down = await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: pcB, instanceName: 'PVP MISCHE'
    });
    check('der Download meldet Revision 1', down.revision === 1, down.revision);

    const configB = await fs.readJson(path.join(pcB, 'instance.json'));
    check('das Icon kommt mit', configB.icon === 'instance-icon.png', configB.icon);
    check('die Icon-Datei liegt auf PC B',
        await fs.pathExists(path.join(pcB, 'instance-icon.png')), null);
    check('die Loader-Version kommt mit', configB.loaderVersion === '0.16.9', configB.loaderVersion);
    check('der Arbeitsspeicher kommt mit', configB.memory === 8192, configB.memory);
    check('der javaPath von PC B bleibt erhalten',
        configB.javaPath === 'D:/pc-b/java.exe', configB.javaPath);
    check('die Spielzeit von PC B bleibt erhalten', configB.playtime === 42, configB.playtime);

    section('3) "Sync now" auf PC B ohne jede Aenderung');

    const commonB = {
        instanceDir: pcB, instanceId, instanceName: 'PVP MISCHE', capabilities
    };
    const noop = await uploader.uploadInstance({ ...commonB, options: { enableChunking: false } });
    check('es entsteht KEINE neue Revision', noop.skipped === true, noop);
    check('die Revision bleibt 1', Number(noop.revision) === 1, noop.revision);

    section('4) PC A arbeitet weiter, PC B ist hinterher');

    await switchToMachine('A');
    await fs.writeFile(path.join(pcA, 'config', 'a.json'), '{"fov":70}');
    const up2 = await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false }
    });
    check('PC A erzeugt Revision 2', up2.revision === 2 && up2.skipped === false, up2.revision);

    await switchToMachine('B');
    const behind = await uploader.uploadInstance({ ...commonB, options: { enableChunking: false } });
    check('PC B ueberschreibt die neuere Revision NICHT', behind.skipped === true, behind);
    check('PC B meldet, dass geholt werden muss', behind.pullRequired === true, behind.pullRequired);
    check('und erkennt den lokalen Stand als unveraendert',
        behind.contentUnchanged === true, behind.contentUnchanged);
    check('die Cloud steht weiterhin auf Revision 2', Number(behind.revision) === 2, behind.revision);

    section('5) PC B holt das Update und ist danach ruhig');

    const pulled = await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: pcB, instanceName: 'PVP MISCHE'
    });
    check('PC B ist auf Revision 2', pulled.revision === 2, pulled.revision);
    check('die Aenderung von PC A ist angekommen',
        (await fs.readFile(path.join(pcB, 'config', 'a.json'), 'utf8')) === '{"fov":70}', null);

    const afterPull = await uploader.uploadInstance({ ...commonB, options: { enableChunking: false } });
    check('ein Sync danach erzeugt wieder KEINE Revision', afterPull.skipped === true, afterPull);
    check('und meldet auch kein Update mehr', !afterPull.pullRequired, afterPull.pullRequired);

    const stateB = await readInstanceState(instanceId);
    check('der lokale Stand kennt den Content-Hash',
        typeof stateB.lastContentHash === 'string' && stateB.lastContentHash.length === 64,
        stateB.lastContentHash);

    section('6) Echter Konflikt bleibt ein Konflikt');

    await switchToMachine('A');
    await fs.writeFile(path.join(pcA, 'config', 'a.json'), '{"fov":50}');
    await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false }
    });
    await switchToMachine('B');
    await fs.writeFile(path.join(pcB, 'config', 'a.json'), '{"fov":110}');

    const clash = await uploader.uploadInstance({ ...commonB, options: { enableChunking: false } });
    check('PC B pusht nicht blind', clash.skipped === true && clash.pullRequired === true, clash);
    check('und meldet lokale Aenderungen', clash.contentUnchanged === false, clash.contentUnchanged);

    section('7) Das Tor vor dem Spielstart');

    const preLaunch = require('../backend/luxcloud/preLaunch');
    const { withSyncScope } = require('../backend/luxcloud/syncScope');

    // Der Umfang muss ueber withSyncScope aufgeloest werden -- der Launcher hat keinen
    // anderen Weg, an die serverseitigen Einstellungen zu kommen.
    const scope = await withSyncScope(instanceId, {});
    check('der Sync-Umfang laesst sich ausserhalb des IPC-Handlers aufloesen',
        typeof scope === 'object' && scope !== null, scope);

    // Lage aus Abschnitt 6: beide Seiten haben sich geaendert.
    let gate = await preLaunch.checkBeforeLaunch({
        instanceDir: pcB, instanceId, instanceName: 'PVP MISCHE', options: scope
    });
    check('beidseitige Aenderung haelt den Start an',
        gate.decision === 'conflict' && gate.canLaunch === false, gate.decision);
    check('und nennt beide Revisionen',
        gate.remoteRevision > gate.localRevision, [gate.localRevision, gate.remoteRevision]);

    // Lokale Aenderung zuruecknehmen: jetzt ist nur noch die Cloud weiter.
    await switchToMachine('A');
    const headRev = (await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false, force: true }
    })).revision;
    await switchToMachine('B');
    await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: pcB, instanceName: 'PVP MISCHE'
    });

    await switchToMachine('A');
    await fs.writeFile(path.join(pcA, 'config', 'a.json'), '{"fov":33}');
    const newest = await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false }
    });
    check('PC A ist voraus', newest.revision > headRev, [headRev, newest.revision]);

    await switchToMachine('B');
    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: pcB, instanceId, instanceName: 'PVP MISCHE', options: scope
    });
    check('sauberer Stand wird vor dem Start nachgezogen',
        gate.decision === 'updated' && gate.canLaunch === true, gate.decision);
    check('und der Inhalt von PC A ist da',
        (await fs.readFile(path.join(pcB, 'config', 'a.json'), 'utf8')) === '{"fov":33}', null);

    gate = await preLaunch.checkBeforeLaunch({
        instanceDir: pcB, instanceId, instanceName: 'PVP MISCHE', options: scope
    });
    check('der zweite Start findet nichts mehr zu tun',
        gate.decision === 'launch' && gate.canLaunch === true, gate.decision);
    check('und will hinterher auch nichts hochschieben', !gate.pushAfterLaunch, gate.pushAfterLaunch);

    section('8) Fehler und Abbruch enden, statt zu haengen');

    const transfers = require('../backend/luxcloud/transfers');

    // Ein Loader wie in echten Instanzen darf den Server nicht mehr zu "Invalid loader"
    // bewegen -- die instance.json von PC A traegt "Fabric" gross geschrieben.
    const { normalizeInstanceConfig } = require('../backend/luxcloud/manifest');
    const rawA = await fs.readJson(path.join(pcA, 'instance.json'));
    check('der Loader steht gross in der instance.json',
        normalizeInstanceConfig(rawA).loader === 'Fabric', normalizeInstanceConfig(rawA).loader);

    // Jeder Fehlschlag meldet genau einen Schlusszustand. Nachgestellt wird eine
    // Ablehnung mitten im Ablauf - genau die Form, in der "Invalid loader" auftrat.
    const phases = [];
    let threw = null;

    const realAuthed = api.authed;
    api.authed = async (config, opts) => {
        if (String(config.url || '').includes('/negotiate')) {
            throw new api.LuxCloudError('invalid_request', 'Invalid loader');
        }
        return realAuthed(config, opts);
    };

    try {
        await uploader.uploadInstance({
            instanceDir: pcA,
            instanceId,
            instanceName: 'PVP MISCHE',
            capabilities,
            options: { enableChunking: false, force: true },
            onProgress: (p) => phases.push(p.phase)
        });
    } catch (err) {
        threw = err;
    } finally {
        api.authed = realAuthed;
    }

    check('ein fehlgeschlagener Upload wirft', Boolean(threw), threw && threw.code);
    check('und zwar mit dem Servercode', threw && threw.code === 'invalid_request', threw && threw.code);
    check('und meldet zum Schluss "error"',
        phases[phases.length - 1] === 'error', phases);
    check('und hinterlaesst keinen laufenden Transfer',
        transfers.list().length === 0, transfers.list());

    // Abbruch: das Flag wird zwischen zwei Dateien geprueft.
    transfers.begin('Abbruchtest', 'upload');
    check('ein Transfer ist registriert', transfers.list().length === 1, transfers.list());
    check('cancel greift', transfers.cancel('Abbruchtest') === true, null);
    check('und wird als abgebrochen gefuehrt', transfers.isCancelled('Abbruchtest') === true, null);

    let cancelledError = null;
    try {
        transfers.throwIfCancelled('Abbruchtest');
    } catch (err) {
        cancelledError = err;
    }
    check('der Abbruch bricht die Schleife mit code "cancelled"',
        cancelledError && cancelledError.code === 'cancelled', cancelledError && cancelledError.code);

    transfers.end('Abbruchtest');
    check('nach dem Ende ist die Liste leer', transfers.list().length === 0, transfers.list());

    section('9) Abweichender Ordnername auf dem zweiten PC');

    // Ein zweiter Download legt "Name (1)" an, weil der Ordner schon existiert. Fruehe
    // Fassungen nahmen den Ordnernamen als Manifest-Namen; dadurch unterschied sich der
    // Vergleichshash zwischen den Geraeten und der erste Sync nach dem Download erzeugte
    // eine Revision, obwohl niemand etwas geaendert hatte.
    await switchToMachine('C');

    const pcC = path.join(tmp, 'C', 'PVP MISCHE (1)');
    await fs.ensureDir(pcC);
    const downC = await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: pcC, instanceName: 'PVP MISCHE (1)'
    });
    check('der Download in den abweichenden Ordner klappt', downC.revision > 0, downC.revision);

    const syncC = await uploader.uploadInstance({
        instanceDir: pcC, instanceId, instanceName: 'PVP MISCHE (1)', capabilities,
        options: { enableChunking: false }
    });
    check('trotz anderem Ordnernamen entsteht KEINE Revision', syncC.skipped === true,
        { skipped: syncC.skipped, revision: syncC.revision });
    check('und die Cloud-Instanz behaelt ihren Namen',
        !syncC.instance || syncC.instance.name === 'PVP MISCHE',
        syncC.instance && syncC.instance.name);

    section('10) Mods werden referenziert, nicht neu hochgeladen');

    // Der hochladende PC kennt seine Mods aus dem Mod-Browser (mod_cache.json) und
    // verweist im Manifest aufs Modrinth-CDN, statt die JARs mitzuschicken. Der
    // herunterladende PC hat diesen Cache nicht - ohne Uebernahme der Verweise baut er
    // ein anderes Manifest, was eine Revision aus dem Nichts erzeugt und die JARs beim
    // naechsten Upload als Blobs mitschickt.
    const crypto = require('crypto');

    const modBytes = Buffer.from('FAKE-JAR-CONTENT-FOR-A-MOD');
    const modSha1 = crypto.createHash('sha1').update(modBytes).digest('hex');

    await switchToMachine('A');
    await fs.ensureDir(path.join(pcA, 'mods'));
    await fs.writeFile(path.join(pcA, 'mods', 'sodium.jar'), modBytes);

    const modCacheA = path.join(tmp, 'A', 'mod_cache.json');
    await fs.writeJson(modCacheA, {
        [modSha1]: { projectId: 'AANobbMI', versionId: 'abc123', hash: modSha1, source: 'modrinth' }
    });

    const withMod = await uploader.uploadInstance({
        instanceDir: pcA, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false, modCachePath: modCacheA }
    });
    check('PC A laedt die Mod hoch', withMod.skipped === false, withMod.revision);

    const uploadedManifest = await api.authed({
        method: 'GET', url: `/api/cloud/instances/${instanceId}/manifest?revision=latest`
    });
    const modEntry = uploadedManifest.manifest.entries.find((e) => e.path === 'mods/sodium.jar');
    check('die Mod steht als CDN-Verweis im Manifest',
        Boolean(modEntry && modEntry.source && modEntry.source.type === 'modrinth'),
        modEntry && modEntry.source);

    // PC D: frischer Rechner mit leerem Mod-Cache. Die JAR liegt hier schon, weil der
    // Test kein echtes Modrinth-CDN hat -- geprueft wird ohnehin nur, ob der Verweis
    // uebernommen wird und der naechste Sync deshalb ruhig bleibt.
    await switchToMachine('D');
    const pcD = path.join(tmp, 'D', 'PVP MISCHE');
    await fs.ensureDir(path.join(pcD, 'mods'));
    await fs.writeFile(path.join(pcD, 'mods', 'sodium.jar'), modBytes);
    const modCacheD = path.join(tmp, 'D', 'mod_cache.json');

    await downloader.restoreInstance({
        instanceUuid: instanceId, instanceDir: pcD, instanceName: 'PVP MISCHE',
        modCachePath: modCacheD
    });

    const adopted = await fs.readJson(modCacheD).catch(() => ({}));
    check('der Download uebernimmt den CDN-Verweis',
        Boolean(adopted[modSha1] && adopted[modSha1].projectId === 'AANobbMI'),
        Object.keys(adopted));

    const syncD = await uploader.uploadInstance({
        instanceDir: pcD, instanceId, instanceName: 'PVP MISCHE', capabilities,
        options: { enableChunking: false, modCachePath: modCacheD }
    });
    check('und danach entsteht KEINE Revision aus dem Nichts', syncD.skipped === true,
        { skipped: syncD.skipped, revision: syncD.revision });

    h.stop();
    await fs.remove(tmp).catch(() => {});

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
