// Der Hintergrund, der mit dem Lux-Konto mitwandert.
//
// Die Tests spielen zwei Geraete gegen ein gemeinsames, nachgebautes Konto durch: was
// das eine hochlaedt, muss auf dem anderen ankommen, und wer den Sync ausschaltet,
// bekommt seinen eigenen Hintergrund zurueck.

const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

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

class FakeError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

function createAccount() {
    const account = { background: null, file: null, uploads: 0, offline: false };

    const api = {
        LuxCloudError: FakeError,
        async authed(config) {
            if (account.offline) throw new FakeError('offline', 'offline');
            if (config.method === 'GET' && config.url === '/api/cloud/me/background') {
                return { background: account.background };
            }
            if (config.method === 'GET' && config.url === '/api/cloud/me/background/file') {
                if (!account.file) throw new FakeError('not_found');
                return account.file;
            }
            if (config.method === 'DELETE') {
                account.background = null;
                account.file = null;
                return { ok: true, background: null };
            }
            if (config.method === 'PUT') {
                const body = config.data.getBuffer();
                const start = body.indexOf('\r\n\r\n') + 4;
                const end = body.lastIndexOf(Buffer.from('\r\n--'));
                const content = body.subarray(start, end);
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                const isVideo = content.toString('ascii', 0, 4) === 'VID!';
                account.file = Buffer.from(content);
                account.background = {
                    hash,
                    mime: isVideo ? 'video/mp4' : 'image/png',
                    type: isVideo ? 'video' : 'image',
                    ext: isVideo ? 'mp4' : 'png',
                    bytes: content.length
                };
                account.uploads += 1;
                return { ok: true, background: account.background };
            }
            throw new Error(`unexpected request ${config.method} ${config.url}`);
        }
    };

    return { account, api };
}

async function createDevice(root, name, api, { userId = 7 } = {}) {
    const { createAccountBackgroundSync } = require('../backend/luxcloud/accountBackground');
    const backgroundsDir = path.join(root, name, 'backgrounds');
    await fs.ensureDir(backgroundsDir);

    const device = {
        backgroundsDir,
        loggedIn: true,
        userId,
        settings: { accountBackgroundSync: false, accountBackgroundBase: null, localBgMedia: null, theme: { bgMedia: { url: '', type: 'none' } } },
        statuses: []
    };

    device.sync = createAccountBackgroundSync({
        backgroundsDir,
        readSettings: async () => JSON.parse(JSON.stringify(device.settings)),
        patchSettings: async (update) => {
            const next = update(JSON.parse(JSON.stringify(device.settings)));
            if (next) device.settings = next;
            return JSON.parse(JSON.stringify(device.settings));
        },
        api,
        isLoggedIn: async () => device.loggedIn,
        getUserId: async () => device.userId,
        onStatus: (status) => device.statuses.push(status)
    });

    device.pick = async (fileName, content) => {
        const url = path.join(backgroundsDir, fileName).replace(/\\/g, '/');
        await fs.writeFile(url, content);
        device.settings.theme.bgMedia = { url, type: fileName.endsWith('.mp4') ? 'video' : 'image' };
        return url;
    };

    return device;
}

const bgUrl = (device) => device.settings.theme.bgMedia.url;

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lux-bg-'));
    const { account, api } = createAccount();

    const desktop = await createDevice(root, 'desktop', api);
    const laptop = await createDevice(root, 'laptop', api);

    section('1) Ausgeschaltet passiert nichts');

    await desktop.pick('bg_1.png', 'PNG-desktop');
    let result = await desktop.sync.reconcile('local');
    check('Sync aus -> disabled', result.state === 'disabled', result);
    check('nichts hochgeladen', account.uploads === 0, account.uploads);

    section('2) Einschalten laedt den lokalen Hintergrund ins leere Konto');

    const desktopLocal = bgUrl(desktop);
    result = await desktop.sync.setEnabled(true);
    check('Einschalten -> synced/push', result.state === 'synced' && result.action === 'push', result);
    check('Konto hat jetzt den Hintergrund', account.background && account.file.toString() === 'PNG-desktop', account.background);
    check('lokaler Hintergrund ist gemerkt', desktop.settings.localBgMedia.url === desktopLocal, desktop.settings.localBgMedia);
    check('Hintergrund zeigt auf die Kontokopie', /account_[0-9a-f]{64}\.png$/.test(bgUrl(desktop)), bgUrl(desktop));

    section('3) Das zweite Geraet uebernimmt ihn');

    await laptop.pick('bg_laptop.png', 'PNG-laptop');
    const laptopLocal = bgUrl(laptop);
    result = await laptop.sync.setEnabled(true);
    check('Einschalten mit vollem Konto -> pull', result.action === 'pull', result);
    check('Laptop zeigt den Konto-Hintergrund',
        fs.readFileSync(bgUrl(laptop), 'utf8') === 'PNG-desktop', bgUrl(laptop));
    check('Upload-Zaehler unveraendert', account.uploads === 1, account.uploads);

    result = await laptop.sync.reconcile('check');
    check('zweiter Abgleich ist still', result.state === 'idle' || (result.state === 'synced' && result.action === 'adopt'), result);

    section('4) Aenderung im Styling auf dem Laptop wandert zum Desktop');

    await laptop.pick('bg_2.mp4', 'VID!-laptop-video');
    result = await laptop.sync.reconcile('local');
    check('lokale Aenderung -> push', result.action === 'push', result);
    check('Konto hat jetzt ein Video', account.background.type === 'video', account.background);

    result = await desktop.sync.reconcile('focus');
    check('Desktop zieht nach', result.action === 'pull', result);
    check('Desktop zeigt das Video', desktop.settings.theme.bgMedia.type === 'video'
        && fs.readFileSync(bgUrl(desktop), 'utf8') === 'VID!-laptop-video', desktop.settings.theme.bgMedia);
    const staleAccountFiles = fs.readdirSync(desktop.backgroundsDir).filter((n) => n.startsWith('account_'));
    check('alte Kontokopie aufgeraeumt', staleAccountFiles.length === 1, staleAccountFiles);

    section('5) Offline geht nichts kaputt');

    account.offline = true;
    await desktop.pick('bg_3.png', 'PNG-offline');
    result = await desktop.sync.reconcile('local');
    check('offline -> error offline', result.state === 'error' && result.error === 'offline', result);
    account.offline = false;
    result = await desktop.sync.reconcile('startup');
    check('spaeter wird die lokale Aenderung nachgeholt', result.action === 'push'
        && account.file.toString() === 'PNG-offline', result);

    section('6) Entfernen gilt fuer das ganze Konto');

    desktop.settings.theme.bgMedia = { url: '', type: 'none' };
    result = await desktop.sync.reconcile('local');
    check('entfernen -> push (delete)', result.action === 'push' && account.background === null, account.background);
    result = await laptop.sync.reconcile('focus');
    check('Laptop hat keinen Hintergrund mehr', result.action === 'pull'
        && laptop.settings.theme.bgMedia.type === 'none', laptop.settings.theme.bgMedia);

    section('7) Ausschalten bringt den eigenen Hintergrund zurueck');

    await laptop.pick('bg_4.png', 'PNG-shared');
    await laptop.sync.reconcile('local');
    result = await laptop.sync.setEnabled(false);
    check('Ausschalten -> disabled', result.state === 'disabled', result);
    check('Laptop hat wieder seinen eigenen', bgUrl(laptop) === laptopLocal, bgUrl(laptop));
    check('Konto behaelt den geteilten', account.file.toString() === 'PNG-shared', account.file.toString());

    await laptop.pick('bg_5.png', 'PNG-only-laptop');
    result = await laptop.sync.reconcile('local');
    check('Aenderung bei Sync aus bleibt lokal', result.state === 'disabled' && account.file.toString() === 'PNG-shared', result);

    section('8) Abmelden zeigt den lokalen, Anmelden wieder den Konto-Hintergrund');

    await desktop.sync.reconcile('focus');
    check('Desktop hat den geteilten', fs.readFileSync(bgUrl(desktop), 'utf8') === 'PNG-shared', bgUrl(desktop));
    desktop.loggedIn = false;
    await desktop.sync.handleSignedOut();
    check('abgemeldet -> lokaler Hintergrund', bgUrl(desktop) === desktopLocal, bgUrl(desktop));
    desktop.loggedIn = true;
    result = await desktop.sync.reconcile('login');
    check('angemeldet -> Konto-Hintergrund', result.action === 'pull'
        && fs.readFileSync(bgUrl(desktop), 'utf8') === 'PNG-shared', result);

    section('9) Ein anderes Konto ohne Hintergrund bekommt nicht ungefragt einen');

    const other = createAccount();
    const guest = await createDevice(root, 'guest', other.api, { userId: 99 });
    await guest.pick('bg_guest.png', 'PNG-guest');
    guest.settings.accountBackgroundSync = true;
    result = await guest.sync.reconcile('login');
    check('Login ohne Konto-Hintergrund -> idle', result.state === 'idle' && other.account.uploads === 0, result);

    await fs.remove(root);
    console.log(`\n=== ${passed} bestanden, ${failed} fehlgeschlagen ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
