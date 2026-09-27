// Checks the launch gate for code imports: an instance must stay blocked until every
// mod, resource pack and shader from the code is really on disk. Runs without Electron.

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

const state = require('../backend/utils/sharedImportState');

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lux-shared-import-'));
    const instanceDir = path.join(root, 'Pack');
    await fs.ensureDir(instanceDir);

    try {
        section('buildImportItems');
        const items = state.buildImportItems({
            mods: [{ projectId: 'a', title: 'Mod A', fileName: 'a.jar' }, 'legacy-id'],
            resourcePacks: [{ projectId: 'r', title: 'Pack R' }],
            shaders: [{ projectId: 's', title: 'Shader S' }]
        });
        check('counts every item', items.length === 4, items.length);
        check('all start pending', items.every((item) => item.state === 'pending'));
        check('kinds are kept', items.map((item) => item.kind).join(',') === 'mod,mod,resourcepack,shader');

        section('launch gate');
        check('no marker -> launch allowed', (await state.getLaunchBlock('Pack', instanceDir)) === null);

        await fs.writeJson(path.join(instanceDir, 'instance.json'), {
            name: 'Pack',
            status: 'installing',
            sharedImport: { pending: true, items }
        });

        let resumed = null;
        state.setResumeHandler((name) => { resumed = name; });
        state.markActive('Pack');
        const block = await state.getLaunchBlock('Pack', instanceDir);
        check('pending marker -> launch blocked', Boolean(block && block.error), block);
        check('message shows progress', /0\/4/.test(block?.error || ''), block?.error);
        await new Promise((resolve) => setImmediate(resolve));
        check('running import is not resumed twice', resumed === null, resumed);

        state.markInactive('Pack');
        await state.getLaunchBlock('Pack', instanceDir);
        await new Promise((resolve) => setImmediate(resolve));
        check('interrupted import gets resumed on launch attempt', resumed === 'Pack', resumed);

        section('verifyItems');
        const modItem = items[0];
        modItem.state = 'installed';
        let missing = await state.verifyItems(instanceDir, items);
        check('installed item without file falls back to pending', missing.length === 1 && modItem.state === 'pending');

        await fs.ensureDir(path.join(instanceDir, 'mods'));
        await fs.writeFile(path.join(instanceDir, 'mods', 'a.jar'), 'jar');
        modItem.state = 'installed';
        missing = await state.verifyItems(instanceDir, items);
        check('installed item with file stays installed', missing.length === 0 && modItem.state === 'installed');

        await fs.writeFile(path.join(instanceDir, 'mods', 'empty.jar'), '');
        const emptyItem = { kind: 'mod', fileName: 'empty.jar', state: 'installed' };
        await state.verifyItems(instanceDir, [emptyItem]);
        check('empty file does not count as installed', emptyItem.state === 'pending');

        const escapeItem = { kind: 'mod', fileName: '../../instance.json', state: 'installed' };
        check('file names cannot leave the content folder',
            state.itemPath(instanceDir, escapeItem) === path.join(instanceDir, 'mods', 'instance.json'));

        section('summarize');
        items[1].state = 'failed';
        const summary = state.summarize(items);
        check('summary counts', summary.total === 4 && summary.installed === 1 && summary.failed === 1 && summary.pending === 2, summary);

        section('finished import');
        await fs.writeJson(path.join(instanceDir, 'instance.json'), { name: 'Pack', status: 'ready' });
        check('marker removed -> launch allowed', (await state.getLaunchBlock('Pack', instanceDir)) === null);
    } finally {
        state.setResumeHandler(null);
        await fs.remove(root);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
