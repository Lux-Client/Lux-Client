// Fuehrt die Cloud-Aenderungen auf diesem PC nach, ohne die eigenen zu verlieren.
// Genutzt vom Upload (bevor er auf einer neueren Revision aufbaut) und vom Tor vor dem
// Spielstart (damit ein Mitspieler, der gerade eine Mod hinzugefuegt hat, niemanden am
// Spielen hindert, der selbst nur an seinen Einstellungen gedreht hat).

const api = require('./api');
const manifestSnapshot = require('./manifestSnapshot');
const { contentHashOf } = require('./manifest');
const { rememberRevision } = require('./syncState');
const { memberContentHash } = require('./shareScope');
const { planMerge } = require('./reconcile');

// Die Cloud ist weiter, dieser PC hat aber auch etwas geaendert. Statt das sofort zum
// Konflikt zu erklaeren, werden die Aenderungen Datei fuer Datei zusammengefuehrt (siehe
// reconcile.js). Gelingt das, steht dieser PC danach auf dem Cloud-Stand plus seinen
// eigenen Aenderungen, und der Upload kann ganz normal darauf aufbauen.
async function rebaseOntoCloud({ instanceDir, instanceId, instanceName, member, localManifest, localRevision, options = {}, report = () => {} }) {
    // Die Basis ist die Revision, auf der dieser PC zuletzt stand -- und zwar so, wie der
    // Server sie kennt. Ein lokales Abbild koennte veraltet sein; eine falsche Basis
    // hielte fremde Aenderungen fuer eigene und wuerde sie wieder zurueckdrehen.
    if (!(localRevision > 0)) return null;
    let baseManifest;
    try {
        baseManifest = (await api.authed({
            method: 'GET',
            url: `/api/cloud/instances/${instanceId}/manifest?revision=${localRevision}`
        })).manifest;
    } catch (_) {
        return null;
    }
    const base = {
        entries: Object.fromEntries((baseManifest.entries || []).map((entry) => [entry.path, `${entry.sha256}|`]))
    };

    const remote = await api.authed({
        method: 'GET',
        url: `/api/cloud/instances/${instanceId}/manifest?revision=latest`
    });
    const plan = planMerge({ base, local: localManifest, remote: remote.manifest, member });

    if (plan.conflicts.length > 0) return { conflicts: plan.conflicts };
    // Hier hat sich nichts geaendert: das ist ein schlichtes Update, fuer das es den
    // bestehenden Weg gibt (Pull beim Start bzw. ueber "Jetzt synchronisieren").
    if (!plan.localChanged) return null;

    report('rebase', { fetch: plan.fetch.length, remove: plan.remove.length, revision: remote.revision });
    const downloader = require('./downloader');

    await downloader.applyEntries({ instanceDir, entries: plan.fetch, cancelKeys: [instanceName] });
    // Nur genau die geplanten Pfade, und jeder wird vor dem Loeschen noch einmal gegen
    // die Basis geprueft.
    const toRemove = { entries: Object.fromEntries(plan.remove.map((relPath) => [relPath, base.entries[relPath]])) };
    await downloader.removeStaleFiles(instanceDir, toRemove, []);
    await downloader.adoptModSources(options.modCachePath, plan.fetch).catch(() => {});

    const instanceConfig = (remote.manifest.entries || []).find((entry) => entry.path === 'instance.json');
    await rememberRevision(instanceId, {
        lastKnownRevision: Number(remote.revision),
        lastManifestHash: remote.manifestHash || null,
        lastContentHash: member ? memberContentHash(remote.manifest) : contentHashOf(remote.manifest),
        lastInstanceConfigHash: instanceConfig ? instanceConfig.sha256 : null
    });
    await manifestSnapshot.save(instanceId, remote.manifest, { revision: remote.revision }).catch(() => {});

    console.log(`[LuxCloud] ${instanceName}: merged revision ${remote.revision} from the cloud (${plan.fetch.length} file(s) updated, ${plan.remove.length} removed) before uploading.`);
    return { rebased: true, revision: Number(remote.revision), fetched: plan.fetch.length, removed: plan.remove.length };
}

module.exports = { rebaseOntoCloud };
