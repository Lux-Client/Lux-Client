// Checks how the launcher reads Lux Client mod jars from GitHub releases, without Electron.

const {
    parseMcVersionFromAssetName,
    parseLoaderFromAssetName,
    collectBuildsFromReleases,
    findBuild,
    buildInstalledFileName,
    isLuxModFileName
} = require('../backend/utils/luxModReleases');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}  -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
}

check('mc prefix', parseMcVersionFromAssetName('lux-client-1.0.0-mc1.21.11.jar'), '1.21.11');
check('mc prefix short version', parseMcVersionFromAssetName('lux-client-1.0.0-mc26.2.jar'), '26.2');
check('plus convention', parseMcVersionFromAssetName('lux-client-1.0.0+1.21.8.jar'), '1.21.8');
check('last token', parseMcVersionFromAssetName('lux-client-1.0.0-1.20.1.jar'), '1.20.1');
check('only mc version', parseMcVersionFromAssetName('LuxClient-26.2.jar'), '26.2');
check('1.21.1 is not 1.21.11', parseMcVersionFromAssetName('lux-client-2.0.0-mc1.21.1.jar'), '1.21.1');
check('sources jar ignored', parseMcVersionFromAssetName('lux-client-1.0.0-mc1.21.11-sources.jar'), null);
check('non jar ignored', parseMcVersionFromAssetName('checksums-1.21.11.txt'), null);
check('loader default fabric', parseLoaderFromAssetName('lux-client-1.0.0-mc1.21.11.jar'), 'fabric');
check('loader forge', parseLoaderFromAssetName('lux-client-forge-1.0.0-mc1.20.1.jar'), 'forge');

const asset = (name) => ({ name, size: 10, browser_download_url: `https://example.invalid/${name}` });
const builds = collectBuildsFromReleases([
    { tag_name: 'v1.2.0-beta', prerelease: true, assets: [asset('lux-client-1.2.0-mc1.21.11.jar')] },
    { tag_name: 'v1.1.0', assets: [asset('lux-client-1.1.0-mc1.21.11.jar')] },
    { tag_name: 'v1.0.0', assets: [asset('lux-client-1.0.0-mc1.21.11.jar'), asset('lux-client-1.0.0-mc1.20.1.jar')] },
    { tag_name: 'v0.9.0', draft: true, assets: [asset('lux-client-0.9.0-mc26.2.jar')] }
]);

check('newest stable release wins', findBuild(builds, '1.21.11', 'fabric')?.tag, 'v1.1.0');
check('older release still serves other versions', findBuild(builds, '1.20.1', 'fabric')?.tag, 'v1.0.0');
check('drafts skipped', findBuild(builds, '26.2', 'fabric'), null);
check('wrong loader', findBuild(builds, '1.21.11', 'forge'), null);
check('installed file name', buildInstalledFileName(findBuild(builds, '1.21.11', 'fabric')), 'LuxClient-1.1.0-mc1.21.11.jar');
check('detects installed jar', isLuxModFileName('LuxClient-1.1.0-mc1.21.11.jar'), true);
check('detects disabled jar', isLuxModFileName('LuxClient-1.1.0-mc1.21.11.jar.disabled'), true);
check('ignores other mods', isLuxModFileName('sodium-fabric-0.6.0.jar'), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
