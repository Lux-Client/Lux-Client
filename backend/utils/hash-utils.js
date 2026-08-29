// @ts-nocheck
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');

/**
 * Calculate the SHA-256 hash of a file.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded SHA-256 digest.
 */
async function calculateFileSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Parse a SHA-256 hash from a checksum text file (sha256sums format or bare hash).
 * Supports lines like: `<hex>  *filename` or bare `<hex>`.
 * @param {string} content - Raw text content of the checksum file.
 * @param {string} targetFileName - The filename to match against.
 * @returns {string|null} Lowercase hex hash, or null if not found.
 */
function parseSha256FromText(content, targetFileName) {
    const normalizedTarget = String(targetFileName || '').trim().toLowerCase();
    const lines = String(content || '').split(/\r?\n/);

    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        const directHash = line.match(/^([a-f0-9]{64})$/i);
        if (directHash) return directHash[1].toLowerCase();

        const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        if (!match) continue;

        const fileNameInLine = path.basename(match[2].trim()).toLowerCase();
        if (fileNameInLine === normalizedTarget) {
            return match[1].toLowerCase();
        }
    }

    return null;
}

/**
 * Resolve the expected SHA-256 hash for a release asset from GitHub.
 * Searches for a sidecar `.sha256` file or a combined checksums file.
 * Throws if no checksum file can be found (fail-closed).
 * @param {Object} axios - Axios instance for HTTP requests.
 * @param {Object} release - GitHub release object.
 * @param {string} assetName - Name of the asset to find the hash for.
 * @returns {Promise<string>} The expected hex SHA-256 hash.
 * @throws {Error} If no checksum file is found or hash cannot be parsed.
 */
async function resolveExpectedReleaseSha256(axios, release, assetName) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const targetName = String(assetName || '').trim().toLowerCase();

    const sidecarAsset = assets.find((a) => {
        const name = String(a?.name || '').toLowerCase();
        return name === `${targetName}.sha256` || name === `${targetName}.sha256.txt`;
    });

    if (sidecarAsset?.browser_download_url) {
        const response = await axios.get(sidecarAsset.browser_download_url, { timeout: 10000, responseType: 'text' });
        const hash = parseSha256FromText(response.data, assetName);
        if (hash) return hash;
    }

    const checksumsAsset = assets.find((a) => /sha256sums(\.txt)?$/i.test(String(a?.name || '')) || /checksums?(\.txt)?$/i.test(String(a?.name || '')));
    if (checksumsAsset?.browser_download_url) {
        const response = await axios.get(checksumsAsset.browser_download_url, { timeout: 10000, responseType: 'text' });
        const hash = parseSha256FromText(response.data, assetName);
        if (hash) return hash;
    }

    throw new Error(
        `Update aborted: No checksum file found for "${assetName}". ` +
        'Releases must include a .sha256 sidecar or checksums file to verify integrity.'
    );
}

module.exports = {
    calculateFileSha256,
    parseSha256FromText,
    resolveExpectedReleaseSha256
};
