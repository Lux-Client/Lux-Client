const axios = require('axios');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'Client/Lux/1.0 (fernsehheft@pluginhub.de)';
const TIMEOUT_MS = 8000;
const BATCH_SIZE = 100;
const MAX_LOOKUPS = 2000;

function emptyResult() {
    return { resolved: new Map(), attempted: 0, failed: false };
}

async function resolveBySha1(hashes, { onProgress = null } = {}) {
    const wanted = [...new Set(hashes.filter((hash) => typeof hash === 'string' && hash.length === 40))];
    const result = emptyResult();

    if (wanted.length === 0) return result;
    if (wanted.length > MAX_LOOKUPS) wanted.length = MAX_LOOKUPS;

    for (let i = 0; i < wanted.length; i += BATCH_SIZE) {
        const batch = wanted.slice(i, i + BATCH_SIZE);
        result.attempted += batch.length;

        try {
            const response = await axios.post(
                `${API}/version_files`,
                { hashes: batch, algorithm: 'sha1' },
                { headers: { 'User-Agent': USER_AGENT }, timeout: TIMEOUT_MS }
            );

            const payload = response.data || {};
            for (const [sha1, version] of Object.entries(payload)) {
                if (!version || !version.project_id || !version.id) continue;
                result.resolved.set(sha1, {
                    type: 'modrinth',
                    projectId: String(version.project_id),
                    versionId: String(version.id),
                    sha1,
                    versionNumber: version.version_number || null
                });
            }
        } catch (_) {
            result.failed = true;
            break;
        }

        if (onProgress) {
            onProgress({ done: Math.min(i + BATCH_SIZE, wanted.length), total: wanted.length });
        }
    }

    return result;
}

function toModCacheEntries(resolved, filesBySha1) {
    const updates = {};

    for (const [sha1, source] of resolved.entries()) {
        const file = filesBySha1.get(sha1);
        if (!file) continue;

        const fileName = file.relPath.split('/').pop();
        updates[`${fileName}-${file.size}`] = {
            title: fileName,
            icon: null,
            version: source.versionNumber,
            hash: sha1,
            projectId: source.projectId,
            versionId: source.versionId,
            source: 'modrinth'
        };
    }

    return updates;
}

module.exports = { BATCH_SIZE, MAX_LOOKUPS, resolveBySha1, toModCacheEntries };
