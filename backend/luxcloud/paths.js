const path = require('path');
const { app } = require('electron');

// Alles, was Lux Cloud Sync lokal ablegt, liegt unter einem einzigen Ordner. Das macht
// "Cloud-Daten loeschen" zu einem rmdir und haelt es getrennt von den Backups des
// bestehenden Google-Drive/Dropbox-Features (handlers/cloudBackup.js), das seine eigenen
// Pfade unter userData/backups benutzt.
function getLuxCloudDir() {
    return path.join(app.getPath('userData'), 'luxcloud');
}

// Laufende Spielsitzungen. Eine Datei je Session, damit ein Absturz nur die eine
// betroffene Session unvollstaendig zuruecklaesst und nicht die ganze Liste.
function getSessionsDir() {
    return path.join(getLuxCloudDir(), 'sessions');
}

// sha256-Cache je Instanz, damit ein Rescan nicht jedes Mal Gigabytes liest.
function getHashCacheDir() {
    return path.join(getLuxCloudDir(), 'hashes');
}

// Lokaler content-addressable Cache, geteilt ueber alle Instanzen dieses PCs.
function getBlobCacheDir() {
    return path.join(getLuxCloudDir(), 'blobs');
}

function getStateFile() {
    return path.join(getLuxCloudDir(), 'state.json');
}

function getQueueFile() {
    return path.join(getLuxCloudDir(), 'queue.jsonl');
}

module.exports = {
    getLuxCloudDir,
    getSessionsDir,
    getHashCacheDir,
    getBlobCacheDir,
    getStateFile,
    getQueueFile
};
