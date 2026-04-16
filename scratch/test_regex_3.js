// Test with the EXACT line from the ACTUAL latest.log
const line = "\t - Mod 'SodiumCoreShaderSupport' (sodiumcoreshadersupport) 1.4.6 requires version 0.8.4+mc1.21.11 of mod 'Sodium' (sodium), but only the wrong version is present: 0.8.7+mc1.21.11!";
const replaceLine = "\t - Replace mod 'Sodium' (sodium) 0.8.7+mc1.21.11 with version 0.8.4+mc1.21.11.";

// Pattern from logAnalyzer.ts line 153
const outdatedRegex = /mod\s+'([^']+)'\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([^\s]+)\s+or\s+later\s+of\s+mod\s+'([^']+)'\s+\(([^)]+)\),\s+but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!\r\n]+)/ig;

console.log("Testing outdated_dependency_fabric pattern:");
outdatedRegex.lastIndex = 0;
const m1 = outdatedRegex.exec(line);
if (m1) {
    console.log("  ✅ MATCH:", JSON.stringify({
        requestingMod: m1[1],
        dependencyMod: m1[5],
        requiredVersion: m1[4],
        foundVersion: m1[7]
    }));
} else {
    console.log("  ❌ NO MATCH");
}

// Also test "Replace mod" line — we have no pattern for this
const replaceRegex = /Replace\s+mod\s+'([^']+)'\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+with\s+version\s+([0-9A-Za-z.+\-]+)/ig;
console.log("\nTesting Replace pattern:");
replaceRegex.lastIndex = 0;
const m2 = replaceRegex.exec(replaceLine);
if (m2) {
    console.log("  ✅ MATCH:", JSON.stringify({
        mod: m2[1],
        modId: m2[2],
        currentVersion: m2[3],
        targetVersion: m2[4]
    }));
} else {
    console.log("  ❌ NO MATCH");
}

// Now test what "requires version X" patterns match the real line
const detailedVersioned = /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+[0-9A-Za-z.+\-]+\s+requires\s+version\s+([0-9A-Za-z.+\-]+)\s+or\s+later\s+of\s+['"]?([A-Za-z0-9_.\-]+)['"]?/ig;
console.log("\nTesting missing_dependency_detailed_versioned (from our patterns):");
detailedVersioned.lastIndex = 0;
const m3 = detailedVersioned.exec(line);
if (m3) {
    console.log("  ✅ MATCH:", JSON.stringify({ mod: m3[1], dep: m3[4], ver: m3[3] }));
} else {
    console.log("  ❌ NO MATCH — the line says 'of mod ...' not just 'of sodium'");
}
