// Der automatische Upload nach einer lokalen Aenderung.
//
// Bis zu dieser Fassung gab es genau einen Ausloeser fuer einen Upload: das Ende einer
// Spielsitzung. Alles andere -- eine geloeschte Mod, eine geaenderte Tastenbelegung, eine
// im Dateimanager abgelegte Datei -- blieb liegen, bis jemand von Hand
// "Jetzt synchronisieren" druckte. Diese Tests halten die Gegenprobe fest.

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

process.env.LUXCLOUD_DIR = process.env.LUXCLOUD_DIR
    || path.join(os.tmpdir(), `lux-autoupload-${process.pid}`);

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

// mtime-Aufloesung: zwei Schreibvorgaenge in derselben Millisekunde waeren fuer den
// Fingerabdruck nicht zu unterscheiden. Im Test wird die mtime deshalb gesetzt.
async function writeFile(root, relPath, content, mtimeSeconds = 1000) {
    const abs = path.join(root, relPath);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content);
    await fs.utimes(abs, mtimeSeconds, mtimeSeconds);
}

async function makeInstance(root) {
    await writeFile(root, 'instance.json', JSON.stringify({ name: 'Test', instanceId: 'uuid-1' }));
    await writeFile(root, 'options.txt', 'key_key.attack:key.mouse.0\n');
    await writeFile(root, 'mods/alpha.jar', 'alpha');
    await writeFile(root, 'mods/beta.jar', 'beta');
    await writeFile(root, 'config/some-mod.toml', 'a = 1');
    await writeFile(root, 'saves/world/level.dat', 'world');
    await writeFile(root, 'logs/latest.log', 'noise');
}

async function main() {
    const { signatureOf, scopeOf } = require('../backend/luxcloud/localChanges');
    const changeMonitor = require('../backend/luxcloud/changeMonitor');
    const autoSync = require('../backend/luxcloud/autoSync');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lux-autoupload-'));
    const instanceDir = path.join(tmp, 'Test');
    await makeInstance(instanceDir);

    section('1) Der Fingerabdruck sieht genau das, was auch synchronisiert wird');

    const first = await signatureOf(instanceDir, {});
    const again = await signatureOf(instanceDir, {});
    check('zweimal derselbe Ordner ergibt denselben Wert', first.signature === again.signature, {
        a: first.signature, b: again.signature
    });
    // instance.json, options.txt, zwei Mods, eine Config -- die Welt und das Log nicht.
    check('und zaehlt nur die synchronisierten Dateien', first.files === 5, first.files);

    await writeFile(instanceDir, 'logs/latest.log', 'more noise', 2000);
    const afterLog = await signatureOf(instanceDir, {});
    check('eine neue Logzeile ist keine Aenderung', afterLog.signature === first.signature, {
        before: first.signature, after: afterLog.signature
    });

    await writeFile(instanceDir, 'options.txt', 'key_key.attack:key.mouse.1\n', 3000);
    const afterKeybind = await signatureOf(instanceDir, {});
    check('eine geaenderte Tastenbelegung schon', afterKeybind.signature !== first.signature, {
        before: first.signature, after: afterKeybind.signature
    });

    await fs.remove(path.join(instanceDir, 'mods', 'beta.jar'));
    const afterDelete = await signatureOf(instanceDir, {});
    check('eine geloeschte Mod auch', afterDelete.signature !== afterKeybind.signature, {
        before: afterKeybind.signature, after: afterDelete.signature
    });

    const withWorlds = await signatureOf(instanceDir, { syncWorlds: true });
    check('abgewaehlte Welten bleiben aussen vor', withWorlds.signature !== afterDelete.signature, {
        without: afterDelete.signature, with: withWorlds.signature
    });

    check('der Umfang kommt aus der lokalen Buchfuehrung', scopeOf({
        syncWorlds: true,
        syncScreenshots: false,
        syncWorldNames: ['world']
    }).worldNames[0] === 'world', scopeOf({ syncWorlds: true }));

    section('2) Die Hintergrundkontrolle meldet jede Aenderung genau einmal');

    let stored = null;
    const queued = [];

    const candidates = async () => ([{
        instanceId: 'uuid-1',
        instanceName: 'Test',
        instanceDir,
        options: {},
        lastSignature: stored
    }]);

    changeMonitor.reset();
    changeMonitor.configure({ candidates, onChanged: (hit) => { queued.push(hit); } });

    await changeMonitor.scan();
    check('eine Instanz ohne Vergleichswert wird einmal hochgeladen', queued.length === 1, queued.length);
    check('und als erster Durchgang gekennzeichnet', queued[0] && queued[0].firstCheck === true, queued[0]);

    await changeMonitor.scan();
    check('derselbe Stand wird nicht erneut gemeldet', queued.length === 1, queued.length);

    // Der Upload war erfolgreich: der Fingerabdruck steht jetzt in der Buchfuehrung.
    stored = queued[0].signature;
    await changeMonitor.scan();
    check('nach einem erfolgreichen Sync bleibt es still', queued.length === 1, queued.length);

    await writeFile(instanceDir, 'mods/gamma.jar', 'gamma', 4000);
    await changeMonitor.scan();
    check('eine neue Mod meldet sich', queued.length === 2, queued.length);
    check('und nicht mehr als erster Durchgang', queued[1] && queued[1].firstCheck === false, queued[1]);

    await changeMonitor.scan();
    check('auch sie nur einmal, solange der Upload aussteht', queued.length === 2, queued.length);

    // Der Upload ist gescheitert (Server nicht erreichbar): der Vergleichswert bleibt der
    // alte. Ein Neustart des Launchers leert den Merker im Arbeitsspeicher -- danach wird
    // die Aenderung erneut eingeplant, statt fuer immer liegen zu bleiben.
    changeMonitor.forget('uuid-1');
    await changeMonitor.scan();
    check('nach einem Neustart wird ein ausstehender Upload wieder aufgenommen',
        queued.length === 3, queued.length);

    // Ein Ordner, der gerade nicht erreichbar ist, darf keine Revision ausloesen, die in
    // der Cloud alles loescht.
    const emptyDir = path.join(tmp, 'Gone');
    await fs.ensureDir(emptyDir);
    changeMonitor.reset();
    const emptyQueued = [];
    changeMonitor.configure({
        candidates: async () => ([{
            instanceId: 'uuid-2',
            instanceName: 'Gone',
            instanceDir: emptyDir,
            options: {},
            lastSignature: 'etwas-anderes'
        }]),
        onChanged: (hit) => { emptyQueued.push(hit); }
    });
    await changeMonitor.scan();
    check('ein leerer Instanzordner loest nichts aus', emptyQueued.length === 0, emptyQueued);

    section('3) Ein eingeplanter Upload ist sichtbar');

    autoSync.reset();
    const events = [];
    autoSync.events.on('scheduled', (payload) => events.push(payload));
    autoSync.setRunner(async () => ({ revision: 1 }));

    autoSync.notifyChanged('Test', 'local-change');
    check('das Einplanen meldet sich', events.length === 1, events);
    check('mit dem Grund', events[0] && events[0].reason === 'local-change', events[0]);
    check('und der Wartezeit', events[0] && events[0].delayMs === autoSync.DEBOUNCE_MS, events[0]);

    autoSync.notifyChanged('Test', 'after-play', { delayMs: autoSync.AFTER_PLAY_DEBOUNCE_MS });
    check('nach dem Spielen wird kuerzer gewartet',
        autoSync.AFTER_PLAY_DEBOUNCE_MS < autoSync.DEBOUNCE_MS,
        { afterPlay: autoSync.AFTER_PLAY_DEBOUNCE_MS, normal: autoSync.DEBOUNCE_MS });
    check('und die Wartezeit wird uebernommen',
        events[1] && events[1].delayMs === autoSync.AFTER_PLAY_DEBOUNCE_MS, events[1]);

    autoSync.suspend('Test');
    const before = events.length;
    const rejected = autoSync.notifyChanged('Test', 'local-change');
    check('eine laufende Instanz nimmt nichts an', rejected === false, rejected);
    check('und meldet dann auch nichts', events.length === before, events.length);

    section('4) Ein verlorener Lauf bleibt nicht fuer immer liegen');

    // Faellig waehrend einer Spielpause: frueher still verworfen.
    autoSync.reset();
    const runs = [];
    autoSync.setRunner(async (name, { reason }) => { runs.push(reason); return { revision: 2 }; });
    autoSync.notifyChanged('Test', 'local-change', { delayMs: 5 });
    autoSync.suspend('Test');
    await new Promise((resolve) => setTimeout(resolve, 30));
    check('in der Pause laeuft nichts', runs.length === 0, runs);
    check('bleibt aber vorgemerkt', autoSync.isQueued('Test') === true);
    autoSync.resume('Test');
    check('nach der Pause wird neu eingeplant', autoSync.pendingInstances().includes('Test'));
    await autoSync.flush();
    check('und dann hochgeladen', runs.length === 1, runs);

    const cancelledEvents = [];
    autoSync.events.on('cancelled', (payload) => cancelledEvents.push(payload));
    autoSync.notifyChanged('Test', 'local-change');
    autoSync.cancel('Test');
    check('ein Abbruch meldet sich', cancelledEvents.length === 1, cancelledEvents);
    check('und nichts steht mehr an', autoSync.isQueued('Test') === false);

    // Dieselbe Aenderung, nie hochgeladen: nach der Ruhezeit meldet sie sich erneut --
    // aber nicht, solange noch etwas eingeplant ist.
    changeMonitor.reset();
    const reannounced = [];
    let queuedFlag = false;
    changeMonitor.configure({
        candidates: async () => ([{
            instanceId: 'uuid-1',
            instanceName: 'Test',
            instanceDir,
            options: {},
            lastSignature: 'alt',
            queued: queuedFlag
        }]),
        onChanged: (hit) => { reannounced.push(hit); }
    });
    const realNow = Date.now;
    try {
        await changeMonitor.scan();
        await changeMonitor.scan();
        check('dieselbe Aenderung wird nicht sofort erneut gemeldet', reannounced.length === 1, reannounced.length);

        const later = realNow() + changeMonitor.REANNOUNCE_AFTER_MS + 1000;
        Date.now = () => later;
        queuedFlag = true;
        await changeMonitor.scan();
        check('auch spaeter nicht, solange sie eingeplant ist', reannounced.length === 1, reannounced.length);

        queuedFlag = false;
        await changeMonitor.scan();
        check('liegt sie verloren, meldet sie sich erneut', reannounced.length === 2, reannounced.length);
    } finally {
        Date.now = realNow;
    }

    autoSync.reset();
    changeMonitor.reset();
    await fs.remove(tmp);

    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
