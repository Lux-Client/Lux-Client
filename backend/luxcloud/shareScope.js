// Die Grenze der Zusammenarbeit, aus Sicht des Launchers.
//
// Muss zu MCLC-Website/cloudShare.js passen: der Server setzt sie durch (ein Mitglied
// bekommt nur diese Dateien zu sehen und kann nur diese aendern), der Client haelt sich
// daran, damit er nichts Privates hochlaedt und seine Buchfuehrung dieselbe Sicht hat wie
// der Server.

const { contentHashOf } = require('./manifest');

const SHARED_WRITABLE_DIRS = new Set(['mods', 'resourcepacks', 'shaderpacks', 'config', 'defaultconfigs']);
const SHARED_READONLY_FILES = new Set(['instance.json']);
const SHARED_READONLY_PREFIX = 'instance-icon.';

function normalize(relPath) {
    return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isMemberWritable(relPath) {
    const segments = normalize(relPath).split('/');
    return segments.length > 1 && SHARED_WRITABLE_DIRS.has(segments[0].toLowerCase());
}

function isMemberReadable(relPath) {
    if (isMemberWritable(relPath)) return true;
    const value = normalize(relPath);
    if (value.includes('/')) return false;
    const lower = value.toLowerCase();
    return SHARED_READONLY_FILES.has(lower) || lower.startsWith(SHARED_READONLY_PREFIX);
}

function isMemberState(tracked) {
    return Boolean(tracked && tracked.shareRole === 'member');
}

// Was ein Mitglied beitraegt: nur der gemeinsame Teil, ohne Name, Laufzeit und Icon --
// die gehoeren dem Host, und der Server nimmt sie ohnehin von dessen Stand.
function memberContribution(manifest) {
    return {
        ...manifest,
        entries: (manifest.entries || []).filter((entry) => isMemberWritable(entry.path))
    };
}

// Der Vergleichswert "hat sich etwas geaendert?" fuer ein Mitglied. Er muss beim Upload
// und beim Download ueber genau dieselbe Menge gebildet werden, sonst hielte jeder Sync
// die Instanz fuer geaendert und schoebe eine leere Revision hinterher.
function memberContentHash(manifest) {
    return contentHashOf({
        instanceId: manifest.instanceId,
        name: null,
        runtime: null,
        settings: null,
        icon: null,
        entries: (manifest.entries || []).filter((entry) => isMemberWritable(entry.path))
    });
}

module.exports = {
    SHARED_WRITABLE_DIRS,
    isMemberReadable,
    isMemberState,
    isMemberWritable,
    memberContentHash,
    memberContribution
};
