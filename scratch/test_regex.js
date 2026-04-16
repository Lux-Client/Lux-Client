// Test script using the EXACT lines from the real crash log
const lines = [
    "\t - Install cloth-config, any version.",
    "\t - Mod 'FastQuit' (fastquit) 3.1.3+mc1.21.11 requires any version of cloth-config, which is missing!",
    // Also test versioned equivalents to ensure we didn't break them
    "\t - Install cloth-config, version 16.0.0 or later.",
    "\t - Mod 'More Culling' (moreculling) 1.6.2 requires version 16.0.0 or later of cloth-config, which is missing!",
];

const PATTERNS = [
    {
        type: 'missing_dependency_simple_versioned',
        regex: /Install\s+([A-Za-z0-9_.\-]+),\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later/ig,
        mapMatch: (m) => ({ dep: m[1].trim(), ver: m[2].trim() })
    },
    {
        type: 'missing_dependency_simple_any',
        regex: /Install\s+([A-Za-z0-9_.\-]+),\s+any\s+version/ig,
        mapMatch: (m) => ({ dep: m[1].trim(), ver: 'any' })
    },
    {
        type: 'missing_dependency_detailed_versioned',
        regex: /Mod\s+'([^']+)'\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+([A-Za-z0-9_.\-]+)(?:,\s+which\s+is\s+missing!)?/ig,
        mapMatch: (m) => ({ mod: m[1], dep: m[4].trim(), ver: m[3].trim() })
    },
    {
        type: 'missing_dependency_detailed_any',
        regex: /Mod\s+'([^']+)'\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+any\s+version\s+of\s+([A-Za-z0-9_.\-]+)(?:,\s+which\s+is\s+missing!)?/ig,
        mapMatch: (m) => ({ mod: m[1], dep: m[3].trim(), ver: 'any' })
    },
];

let totalMatches = 0;
let totalLines = lines.length;

lines.forEach(line => {
    console.log(`\nTest: "${line.trim()}"`);
    let matched = false;
    PATTERNS.forEach(rule => {
        rule.regex.lastIndex = 0;
        const m = rule.regex.exec(line);
        if (m) {
            matched = true;
            totalMatches++;
            const data = rule.mapMatch(m);
            console.log(`  ✅ [${rule.type}]`, JSON.stringify(data));
        }
    });
    if (!matched) {
        console.log(`  ❌ NO MATCH`);
    }
});

console.log(`\n--- Summary: ${totalMatches}/${totalLines} lines matched ---`);
