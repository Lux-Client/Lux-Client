// Die einzige Wahrheit darueber, welche Dateien einer Instanz in die Cloud gehoeren.
// Entspricht der Tabelle in docs/cloud-sync/02-ARCHITEKTUR.md, Abschnitt B.3.
//
// Bewusst ohne glob-Bibliothek und ohne Electron-Abhaengigkeit: die Datei ist rein und
// laesst sich damit direkt testen. Spaeter wird dieselbe Logik serverseitig gespiegelt,
// um Manifeste zu validieren -- deshalb keine Abhaengigkeit auf Node-Interna ausser path.

const CATEGORY = {
    METADATA: 'metadata',
    MODS: 'mods',
    CONFIG: 'config',
    RESOURCEPACKS: 'resourcepacks',
    SHADERPACKS: 'shaderpacks',
    SERVERS: 'servers',
    MODDATA: 'moddata',
    WORLDS: 'worlds',
    SCREENSHOTS: 'screenshots',
    NONE: 'none'
};

// Wird nie synchronisiert. Entweder reproduzierbar (die Minecraft-Runtime laedt der
// Ziel-PC ueber den bestehenden Installer neu), geraetelokal oder schlicht Muell.
// Ein Eintrag hier ist der wirksamste Kostenhebel ueberhaupt: 'libraries', 'versions'
// und 'assets' machen bei einer typischen Instanz weit ueber 80 Prozent aus.
const NEVER_SYNC_DIRS = new Set([
    'versions',
    'libraries',
    'natives',
    'assets',
    '.fabric',
    '.quilt',
    '.mixin.out',
    'cache',
    'downloads',
    'logs',
    'crash-reports',
    'debug',
    'backups',
    '.lux-sync',

    // Von Mods erzeugte Karten-, Bild- und Video-Caches. Alle drei Eigenschaften
    // treffen zu: gross, staendig in Bewegung und durch Weiterspielen regenerierbar.
    // Gemessen an einer echten Instanz: xaero/world-map allein 178 MB, essential
    // (nachgeladene Mod-JARs plus screenshot-cache) 257 MB -- zusammen mehr als das
    // Doppelte von allem, was tatsaechlich synchronisiert werden muss.
    // Die wertvollen Kleinigkeiten dieser Mods (Wegpunkte) rettet die
    // waypoints-Ausnahme weiter unten.
    'world-map',
    'screenshot-cache',
    'essential',
    'journeymap',
    'voxelmap',
    'replay_recordings',
    'replay_videos',
    'tiles'
]);

// Einzige Ausnahme von NEVER_SYNC_DIRS: Wegpunkte. Sie liegen bei mehreren Mods
// innerhalb sonst ausgeschlossener Kartenordner (xaero, journeymap), sind winzig und
// nicht regenerierbar -- ihr Verlust waere fuer Spieler der schmerzhafteste Teil
// eines Umzugs auf einen neuen PC.
const ALWAYS_INCLUDE_SEGMENTS = new Set(['waypoints']);

// Ausgeschlossene Ordner, die trotzdem betreten werden muessen, weil tiefer darin
// Wegpunkte liegen koennen. Der Rest ihres Inhalts faellt danach ganz normal durch
// die Ausschlussregeln in classify().
// (xaero legt seine Wegpunkte unter xaero/minimap ab, nicht unter world-map --
// world-map darf deshalb komplett uebersprungen werden.)
const MAY_CONTAIN_WAYPOINTS = new Set(['journeymap', 'voxelmap']);

const NEVER_SYNC_FILES = new Set([
    'usercache.json',
    'usernamecache.json',
    'session.lock',
    'servers.dat_old',
    'install.log',
    '.ds_store',
    'thumbs.db',
    'desktop.ini'
]);

const NEVER_SYNC_EXTENSIONS = new Set([
    '.log',
    '.tmp',
    '.temp',
    '.lock',
    '.bak',
    '.crdownload',
    '.part'
]);

// Ordner mit Nutzerdaten von Mods. Klein, aber ihr Verlust tut weh (Wegpunkte,
// Schematics, Tastenbelegungen), deshalb standardmaessig an.
// Bewusst kurz gehalten und auf tatsaechlich geprueften Instanzen verifiziert.
// Ein Ordner kommt hier nur hinein, wenn er klein UND nicht regenerierbar ist --
// alles andere kostet Quota, ohne dem User etwas zurueckzugeben.
const MOD_DATA_DIRS = new Set([
    'schematics',
    'xaero',
    'meteor-client',
    'data',
    'irisconfig'
]);

// Dateien direkt im Instanzstamm, die zur Konfiguration gehoeren.
const ROOT_CONFIG_FILES = new Set([
    'options.txt',
    'optionsof.txt',
    'optionsshaders.txt',
    'servers.dat',
    'hotbar.nbt',
    'knownhosts.txt',
    'command_history.txt'
]);

const ROOT_CONFIG_EXTENSIONS = new Set(['.json', '.properties', '.toml', '.cfg', '.txt']);

// Instanz-Metadaten, die immer mitgehen.
const ALWAYS_SYNC_FILES = new Set([
    'instance.json',
    'playtime.txt',
    'instance-icon.png',
    'instance-icon.jpg',
    'instance-icon.gif',
    'instance-icon.webp',
    'instance-icon.svg',
    'instance-icon.ico',
    'instance-icon.bmp'
]);

// Einzeldateien oberhalb dieser Groesse werden uebersprungen und im UI als Warnung
// gelistet. Schuetzt vor versehentlich abgelegten ISO-Dateien und aehnlichem.
const MAX_FILE_BYTES = 200 * 1024 * 1024;

// Ab dieser Groesse lohnt sich Content-Defined Chunking (nur innerhalb von saves/).
const CHUNKING_THRESHOLD_BYTES = 4 * 1024 * 1024;

// Dateitypen, die bereits komprimiert sind -- zstd kostet dort nur CPU.
const PRECOMPRESSED_EXTENSIONS = new Set([
    '.jar', '.zip', '.gz', '.xz', '.7z', '.rar', '.zst',
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
    '.ogg', '.mp3', '.wav', '.mp4', '.webm',
    '.mca', '.mcr', '.nbt', '.dat_mcr'
]);

function normalizeRelPath(relPath) {
    return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function extensionOf(name) {
    const idx = name.lastIndexOf('.');
    return idx <= 0 ? '' : name.slice(idx).toLowerCase();
}

// Ein Ergebnis dieser Funktion beschreibt eine Datei vollstaendig fuer den Sync:
// ob sie mitgeht, warum, zu welcher Kategorie sie zaehlt und wie sie behandelt wird.
function classify(relPath, options = {}) {
    const {
        syncWorlds = false,
        syncScreenshots = false,
        worldNames = null,
        size = null
    } = options;

    const normalized = normalizeRelPath(relPath);
    if (!normalized) {
        return { include: false, category: CATEGORY.NONE, reason: 'empty-path' };
    }

    const segments = normalized.split('/');
    const fileName = segments[segments.length - 1];
    const lowerName = fileName.toLowerCase();
    const topLevel = segments[0].toLowerCase();
    const ext = extensionOf(lowerName);

    const hasProtectedSegment = segments.some((s) => ALWAYS_INCLUDE_SEGMENTS.has(s.toLowerCase()));

    // Ein hartes Nein gewinnt immer -- auch wenn der Pfad sonst zu einer erlaubten
    // Kategorie gehoeren wuerde (z.B. saves/x/logs/foo.log). Einzige Ausnahme sind
    // Wegpunkte, die bei mehreren Mods innerhalb der Kartenordner liegen.
    if (!hasProtectedSegment) {
        for (const segment of segments.slice(0, -1)) {
            if (NEVER_SYNC_DIRS.has(segment.toLowerCase())) {
                return { include: false, category: CATEGORY.NONE, reason: 'policy:excluded-dir' };
            }
        }
    }
    if (NEVER_SYNC_FILES.has(lowerName)) {
        return { include: false, category: CATEGORY.NONE, reason: 'policy:excluded-file' };
    }
    if (NEVER_SYNC_EXTENSIONS.has(ext)) {
        return { include: false, category: CATEGORY.NONE, reason: 'policy:excluded-ext' };
    }
    if (lowerName.startsWith('instance.json.corrupt-')) {
        return { include: false, category: CATEGORY.NONE, reason: 'policy:repair-backup' };
    }

    if (size !== null && Number.isFinite(size) && size > MAX_FILE_BYTES) {
        return { include: false, category: CATEGORY.NONE, reason: 'size:too-large' };
    }

    const decide = (category, include, reason) => ({
        include,
        category,
        reason,
        chunk: include && category === CATEGORY.WORLDS
            && Number.isFinite(size) && size >= CHUNKING_THRESHOLD_BYTES,
        compressible: include && !PRECOMPRESSED_EXTENSIONS.has(ext)
    });

    // Wurzeldateien
    if (segments.length === 1) {
        if (ALWAYS_SYNC_FILES.has(lowerName)) {
            return decide(CATEGORY.METADATA, true, 'metadata');
        }
        if (ROOT_CONFIG_FILES.has(lowerName)) {
            const category = lowerName === 'servers.dat' ? CATEGORY.SERVERS : CATEGORY.CONFIG;
            return decide(category, true, 'root-config');
        }
        if (ROOT_CONFIG_EXTENSIONS.has(ext)) {
            return decide(CATEGORY.CONFIG, true, 'root-config-ext');
        }
        return { include: false, category: CATEGORY.NONE, reason: 'policy:unknown-root-file' };
    }

    switch (topLevel) {
        case 'mods':
            return decide(CATEGORY.MODS, true, 'mods');
        case 'config':
        case 'defaultconfigs':
            return decide(CATEGORY.CONFIG, true, 'config');
        case 'resourcepacks':
            return decide(CATEGORY.RESOURCEPACKS, true, 'resourcepacks');
        case 'shaderpacks':
            return decide(CATEGORY.SHADERPACKS, true, 'shaderpacks');
        case 'saves': {
            if (!syncWorlds) return { include: false, category: CATEGORY.WORLDS, reason: 'opt-out:worlds' };
            if (Array.isArray(worldNames) && !worldNames.includes(segments[1])) {
                return { include: false, category: CATEGORY.WORLDS, reason: 'opt-out:world-not-selected' };
            }
            return decide(CATEGORY.WORLDS, true, 'worlds');
        }
        case 'screenshots':
            return syncScreenshots
                ? decide(CATEGORY.SCREENSHOTS, true, 'screenshots')
                : { include: false, category: CATEGORY.SCREENSHOTS, reason: 'opt-out:screenshots' };
        default:
            break;
    }

    if (MOD_DATA_DIRS.has(topLevel) || /^xaerowaypoints/i.test(topLevel) || hasProtectedSegment) {
        return decide(CATEGORY.MODDATA, true, hasProtectedSegment ? 'waypoints' : 'mod-data');
    }

    return { include: false, category: CATEGORY.NONE, reason: 'policy:unknown-dir' };
}

// Erlaubt es, ganze Ordnerbaeume beim Scannen zu ueberspringen, statt jede Datei darin
// einzeln zu klassifizieren. Bei 'libraries' mit zehntausenden Dateien ist das der
// Unterschied zwischen Sekunden und Minuten.
function shouldSkipDirectory(relDirPath, options = {}) {
    const { syncWorlds = false, syncScreenshots = false, worldNames = null } = options;
    const normalized = normalizeRelPath(relDirPath);
    if (!normalized) return false;

    const segments = normalized.split('/');
    const topLevel = segments[0].toLowerCase();

    // Ein ausgeschlossener Ordner darf nur dann komplett uebersprungen werden, wenn
    // darin nichts Geschuetztes liegen kann. xaero/ etwa ist ausgeschlossen, enthaelt
    // aber xaero/minimap/.../waypoints -- deshalb hier nur ueberspringen, wenn der
    // Ordner selbst nicht auf dem Weg zu einem waypoints-Ordner liegen kann.
    for (const segment of segments) {
        if (ALWAYS_INCLUDE_SEGMENTS.has(segment.toLowerCase())) return false;
    }
    for (const segment of segments) {
        if (NEVER_SYNC_DIRS.has(segment.toLowerCase())) {
            return !MAY_CONTAIN_WAYPOINTS.has(segment.toLowerCase());
        }
    }
    if (!syncWorlds && topLevel === 'saves') return true;
    if (syncWorlds && topLevel === 'saves' && segments.length > 1
        && Array.isArray(worldNames) && !worldNames.includes(segments[1])) return true;
    if (!syncScreenshots && topLevel === 'screenshots') return true;

    return false;
}

module.exports = {
    CATEGORY,
    MAX_FILE_BYTES,
    CHUNKING_THRESHOLD_BYTES,
    NEVER_SYNC_DIRS,
    PRECOMPRESSED_EXTENSIONS,
    normalizeRelPath,
    classify,
    shouldSkipDirectory
};
