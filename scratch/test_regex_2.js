// Test script with the EXACT line from the user's log
const log = `[09:31:40] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install sodium, any version.
More details:
	 - Mod 'Sodium Extra' (sodium-extra) 0.6.0 requires any version of sodium, which is missing!`;

const PATTERNS = [
    {
        type: 'missing_dependency_simple_any',
        regex: /Install\s+([A-Za-z0-9_.\-]+),\s+any\s+version/ig,
    },
    {
        type: 'missing_dependency_detailed_any',
        regex: /Mod\s+'([^']+)'\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+any\s+version\s+of\s+([A-Za-z0-9_.\-]+)(?:,\s+which\s+is\s+missing!)?/ig,
    }
];

PATTERNS.forEach(p => {
    p.regex.lastIndex = 0;
    let match;
    console.log(`Checking pattern: ${p.type}`);
    while ((match = p.regex.exec(log)) !== null) {
        console.log(`  MATCH: ${match[0]}`);
        console.log(`  GROUPS: ${JSON.stringify(match.slice(1))}`);
    }
});
