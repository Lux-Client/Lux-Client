const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { describeSandbox } = require('./sandbox');

// Developer-only: run a second (third, ...) Lux next to the normal one on the same machine,
// e.g. to test Lux Cloud sharing between two accounts without a VM. A profile gets its own
// userData folder, and since Electron ties the single-instance lock, electron-store,
// localStorage and cookies to that folder, the two copies never touch each other's data.
//
//   npm run dev:second            -> profile "dev2" next to a running `npm run dev`
//   npm run dev:dual              -> vite + default instance + profile "dev2"
//   electron . --lux-profile=foo  -> any other name
//
// Packaged builds ignore all of this.

const ARG_PREFIX = '--lux-profile=';

function sanitize(name) {
    if (typeof name !== 'string') return null;
    const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    return cleaned || null;
}

let cached;

function getDevProfile() {
    if (cached !== undefined) return cached;
    cached = null;
    if (app.isPackaged) return cached;

    const arg = process.argv.find(a => typeof a === 'string' && a.startsWith(ARG_PREFIX));
    cached = sanitize(arg ? arg.slice(ARG_PREFIX.length) : process.env.LUX_PROFILE);
    return cached;
}

// Must run before anything reads app.getPath('userData'), i.e. at the very top of main.
function applyDevProfile() {
    const profile = getDevProfile();
    if (!profile) return null;

    const dir = path.join(app.getPath('appData'), `${app.getName()}-dev-${profile}`);
    // main.js appends to startup.log before Electron would create the folder itself.
    fs.mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
    app.setPath('sessionData', dir);
    console.log(`[DevProfile] Running as profile "${profile}" with userData ${dir}`);
    return profile;
}

// luxclient:// has exactly one handler per OS user. Pointing it at this process (plus its
// profile argument) makes the browser's sign-in callback start a helper process with the
// same userData, which then hands the link to the matching running instance through the
// single-instance lock instead of to whichever Lux happened to register last.
function registerProtocolClient() {
    const sandbox = describeSandbox();
    if (sandbox.confined) {
        // Registering a scheme from inside a Flatpak/Snap sandbox cannot work: the write
        // lands in the sandboxed ~/.local/share the host never reads, and process.execPath
        // points at a path that only exists in here. The handler has to come from the
        // package's own desktop entry (MimeType=x-scheme-handler/luxclient) instead, so
        // do not pretend otherwise - the sign-in falls back to the pairing code.
        console.log(`[DeepLink] ${sandbox.kind} build (${sandbox.appId || 'unknown app id'}) — leaving luxclient:// registration to the package.`);
        return false;
    }

    if (app.isPackaged) {
        const result = app.setAsDefaultProtocolClient('luxclient');
        console.log('[DeepLink] prod mode setAsDefaultProtocolClient result:', result);
        return result;
    }

    const args = [app.getAppPath()];
    const profile = getDevProfile();
    if (profile) args.push(`${ARG_PREFIX}${profile}`);
    const result = app.setAsDefaultProtocolClient('luxclient', process.execPath, args);
    console.log('[DeepLink] dev mode registration — execPath:', process.execPath, 'args:', args);
    console.log('[DeepLink] setAsDefaultProtocolClient result:', result);
    return result;
}

module.exports = {
    getDevProfile,
    applyDevProfile,
    registerProtocolClient
};
