// Writes backend/generated/oauthClients.js from the build environment.
//
// This replaces the old approach of shipping a .env file inside the installer,
// where every value sat in plain text under resources/.env. Only identifiers that
// are safe to publish belong here - see backend/handlers/cloudBackup.js for why a
// desktop build cannot hold a real secret, and what PKCE does about it.
const fs = require('fs');
const path = require('path');

const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DROPBOX_CLIENT_ID'];

const values = {};
for (const key of KEYS) {
    const value = process.env[key];
    if (!value) {
        console.warn(`[oauth] ${key} is not set - the matching provider will be unavailable in this build.`);
        continue;
    }
    values[key] = value;
}

const outDir = path.join(__dirname, '..', 'backend', 'generated');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
    path.join(outDir, 'oauthClients.js'),
    `// Generated at build time by scripts/write-oauth-clients.js - do not edit, do not commit.\nmodule.exports = ${JSON.stringify(values, null, 4)};\n`,
    'utf8'
);

console.log(`[oauth] Wrote ${Object.keys(values).length} client identifier(s) to backend/generated/oauthClients.js`);
