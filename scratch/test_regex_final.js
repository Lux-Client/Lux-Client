// Test with the EXACT line from the ACTUAL latest.log
const line = "\t - Mod 'SodiumCoreShaderSupport' (sodiumcoreshadersupport) 1.4.6 requires version 0.8.4+mc1.21.11 of mod 'Sodium' (sodium), but only the wrong version is present: 0.8.7+mc1.21.11!";
const replaceLine = "\t - Replace mod 'Sodium' (sodium) 0.8.7+mc1.21.11 with version 0.8.4+mc1.21.11.";

// New patterns from logAnalyzer.ts
const outdatedRegex = /Mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+requires\s+version\s+([^\s]+)\s+(?:or\s+later\s+)?of\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\),\s+but\s+only\s+the\s+wrong\s+version\s+is\s+present:\s*([^!\r\n]+)/ig;
const replaceRegex = /Replace\s+mod\s+['"]?([^'"]+)['"]?\s+\(([^)]+)\)\s+([0-9A-Za-z.+\-]+)\s+with\s+version\s+([0-9A-Za-z.+\-]+)/ig;

console.log("Testing OUTDATED pattern:");
outdatedRegex.lastIndex = 0;
const m1 = outdatedRegex.exec(line);
if (m1) {
    console.log("  ✅ MATCH:");
    console.log("    Source Mod:", m1[1]);
    console.log("    Target Mod:", m1[5]);
    console.log("    Required:", m1[4]);
    console.log("    Found:", m1[7]);
} else {
    console.log("  ❌ NO MATCH");
}

console.log("\nTesting REPLACE pattern:");
replaceRegex.lastIndex = 0;
const m2 = replaceRegex.exec(replaceLine);
if (m2) {
    console.log("  ✅ MATCH:");
    console.log("    Target Mod Name:", m2[1]);
    console.log("    Target Mod ID:", m2[2]);
    console.log("    Current Version:", m2[3]);
    console.log("    Required Version:", m2[4]);
} else {
    console.log("  ❌ NO MATCH");
}
