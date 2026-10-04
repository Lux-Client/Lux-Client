// Live codes: an instance installed from a live code swaps only the files the code
// brought in when a newer revision appears. Runs without Electron.

const os = require('os');
const path = require('path');
const fs = require('fs-extra');

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

const live = require('../backend/utils/liveCodeState');
const shared = require('../backend/utils/sharedImportState');

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lux-live-code-'));
    const instanceDir = path.join(root, 'Server');
    await fs.ensureDir(path.join(instanceDir, 'mods'));
    await fs.ensureDir(path.join(instanceDir, 'resourcepacks'));

    try {
        section('state file');
        check('no file -> null', (await live.readLiveState(instanceDir)) === null);

        await fs.writeFile(path.join(instanceDir, 'mods', 'sodium-1.jar'), 'x');
        await fs.writeFile(path.join(instanceDir, 'mods', 'fabric-api.jar'), 'x');
        await fs.writeFile(path.join(instanceDir, 'mods', 'old-mod.jar'), 'x');
        await fs.writeFile(path.join(instanceDir, 'mods', 'player-own.jar'), 'x');
        await fs.writeFile(path.join(instanceDir, 'resourcepacks', 'pack.zip'), 'x');

        const state = {
            code: 'AbCd1234',
            revision: 1,
            gameVersion: '1.21.1',
            loader: 'fabric',
            items: [
                { kind: 'mod', projectId: 'sodium', versionId: 'v1', fileName: 'sodium-1.jar' },
                { kind: 'mod', projectId: 'fabric', versionId: 'f1', fileName: 'fabric-api.jar' },
                { kind: 'mod', projectId: 'old', versionId: 'o1', fileName: 'old-mod.jar' },
                { kind: 'resourcepack', projectId: 'pack', versionId: 'p1', fileName: 'pack.zip' }
            ]
        };
        await live.writeLiveState(instanceDir, state);
        const read = await live.readLiveState(instanceDir);
        check('round trip', read && read.code === 'AbCd1234' && read.items.length === 4, read);

        section('revision check');
        check('same revision is not newer', !live.isNewer(state, { revision: 1 }));
        check('higher revision is newer', live.isNewer(state, { revision: 2 }));
        check('same target', !live.targetChanged(state, { version: '1.21.1', loader: 'Fabric' }));
        check('new game version is a target change', live.targetChanged(state, { version: '1.21.4', loader: 'fabric' }));

        section('planUpdate');
        const remote = {
            revision: 2,
            version: '1.21.1',
            loader: 'fabric',
            mods: [
                { projectId: 'sodium', versionId: 'v2', fileName: 'sodium-2.jar', title: 'Sodium' },
                { projectId: 'fabric', versionId: 'f1', fileName: 'fabric-api.jar', title: 'Fabric API' },
                { projectId: 'new', versionId: 'n1', fileName: 'new-mod.jar', title: 'New Mod' }
            ],
            resourcePacks: [{ projectId: 'pack', versionId: 'p1', fileName: 'pack.zip', title: 'Pack' }],
            shaders: []
        };
        const plan = await live.planUpdate(instanceDir, state, remote);
        const byId = Object.fromEntries(plan.items.map((item) => [item.projectId, item]));
        check('unchanged mod counts as installed', byId.fabric.state === 'installed', byId.fabric);
        check('unchanged pack counts as installed', byId.pack.state === 'installed', byId.pack);
        check('new version is downloaded', byId.sodium.state === 'pending', byId.sodium);
        check('new mod is downloaded', byId.new.state === 'pending', byId.new);

        const removed = plan.remove.map((file) => path.basename(file)).sort();
        check('old version and dropped mod are removed', removed.join(',') === 'old-mod.jar,sodium-1.jar', removed);
        check('player\'s own mod is left alone', !removed.includes('player-own.jar'), removed);

        section('missing file is downloaded again');
        await fs.remove(path.join(instanceDir, 'mods', 'fabric-api.jar'));
        const plan2 = await live.planUpdate(instanceDir, state, remote);
        const fabric = plan2.items.find((item) => item.projectId === 'fabric');
        check('deleted file -> pending', fabric.state === 'pending', fabric);

        section('launch hook');
        let called = null;
        shared.setLiveUpdateHandler(async (name) => { called = name; return { success: true }; });
        const result = await shared.runLiveUpdate('Server');
        check('handler runs before launch', called === 'Server' && result && result.success, { called, result });

        shared.markActive('Server');
        called = null;
        await shared.runLiveUpdate('Server');
        check('skipped while an import runs', called === null, called);
        shared.markInactive('Server');

        shared.setLiveUpdateHandler(async () => { throw new Error('offline'); });
        check('errors never block the launch', (await shared.runLiveUpdate('Server')) === null);
        shared.setLiveUpdateHandler(null);
    } finally {
        await fs.remove(root);
    }

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
