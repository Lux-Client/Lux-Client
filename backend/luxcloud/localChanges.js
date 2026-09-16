// Erkennt, dass sich an einer Instanz lokal etwas geaendert hat -- ohne dafuer auch nur
// eine einzige Datei zu lesen.
//
// Bis hierher kannte der Client genau einen Ausloeser fuer einen Upload: das Ende einer
// Spielsitzung (handlers/launcher.js, 'after-play'). Alles andere blieb unbemerkt --
// eine im Launcher geloeschte Mod, eine geaenderte Einstellung, eine im Dateimanager
// abgelegte Datei. Wer nicht gespielt hat, musste "Jetzt synchronisieren" druecken, und
// wer das nicht wusste, hatte eine Cloud, die still hinterherhinkte.
//
// Der Fingerabdruck besteht aus Pfad, Groesse und mtime jeder Datei, die nach syncPolicy
// ueberhaupt in die Cloud gehoert. Bewusst nicht der contentHash des Manifests: der
// kostet das Lesen und Hashen jeder Datei und ist damit fuer eine regelmaessige
// Kontrolle im Hintergrund zu teuer. Ein Fehlalarm (gleicher Inhalt, neue mtime --
// Minecraft schreibt options.txt bei jedem Beenden neu) ist dabei einkalkuliert: der
// Upload erkennt ihn am contentHash und endet ohne neue Revision.

const crypto = require('crypto');

const { scanInstance } = require('./manifest');
const { readInstanceState, rememberRevision } = require('./syncState');

// Welche Teile einer Instanz ueberhaupt mitgehen, entscheidet der Server; der zuletzt
// gemerkte Stand steht in der lokalen Buchfuehrung. Genau diese Quelle benutzen auch
// Upload und Download, wenn sie den Fingerabdruck festschreiben -- stammten die beiden
// Seiten aus verschiedenen Quellen, saehe jede Kontrolle einen Unterschied, den es gar
// nicht gibt.
function scopeOf(tracked) {
    return {
        syncWorlds: Boolean(tracked && tracked.syncWorlds),
        syncScreenshots: Boolean(tracked && tracked.syncScreenshots),
        worldNames: tracked && Array.isArray(tracked.syncWorldNames) ? tracked.syncWorldNames : null
    };
}

async function signatureOf(instanceDir, options = {}) {
    // scanInstance liefert die Dateien sortiert; ohne das haenge der Fingerabdruck an der
    // Reihenfolge des Dateisystems und waere damit wertlos.
    const { files } = await scanInstance(instanceDir, options);

    const hash = crypto.createHash('sha256');
    for (const file of files) {
        hash.update(`${file.relPath}|${file.size}|${file.mtimeMs}\n`);
    }

    return { signature: hash.digest('hex'), files: files.length };
}

async function signatureForInstance(instanceId, instanceDir) {
    const tracked = await readInstanceState(String(instanceId)).catch(() => null);
    return signatureOf(instanceDir, scopeOf(tracked));
}

// Haelt fest: bis hierher stimmen lokaler Stand und Cloud ueberein. Alles, was danach
// einen anderen Fingerabdruck ergibt, ist eine echte Aenderung und gehoert hochgeladen.
//
// Der Wert wird bewusst erst nach einem erfolgreichen Sync geschrieben und nicht schon
// beim Einplanen: wird der Launcher vorher geschlossen, waehrend die Wartezeit laeuft,
// erkennt die naechste Kontrolle nach dem Start die Aenderung erneut, statt sie fuer
// immer zu verlieren.
async function rememberLocalSignature(instanceId, instanceDir, signature = null) {
    if (!instanceId || !instanceDir) return null;

    try {
        const value = signature || (await signatureForInstance(instanceId, instanceDir)).signature;
        await rememberRevision(String(instanceId), {
            lastLocalSignature: value,
            lastLocalSignatureAt: Date.now()
        });
        return value;
    } catch (err) {
        // Ohne den Fingerabdruck laeuft der Sync weiter, die Hintergrundkontrolle meldet
        // hoechstens einmal zu viel. Kein Grund, einen fertigen Upload scheitern zu lassen.
        console.warn('[LuxCloud] Could not record the local fingerprint:', err.message);
        return null;
    }
}

module.exports = {
    rememberLocalSignature,
    scopeOf,
    signatureForInstance,
    signatureOf
};
