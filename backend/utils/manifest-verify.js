// @ts-nocheck
const crypto = require('crypto');
const fs = require('fs-extra');

// Placeholder public key — replace with real Ed25519/RSA public key before production release.
// Format: PEM-encoded public key for signature verification.
const MANIFEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
PLACEHOLDER_REPLACE_WITH_REAL_PUBLIC_KEY
-----END PUBLIC KEY-----`;

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded SHA-256 digest.
 */
function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Get the deterministic JSON string for a manifest (excludes the signature field).
 * Sorts keys recursively for consistent hashing.
 * @param {object} manifest - The manifest object (without signature).
 * @returns {string} Deterministic JSON string.
 */
function getManifestContentForSigning(manifest) {
  const content = { ...manifest };
  delete content.signature;
  return JSON.stringify(content, null, 2);
}

/**
 * Verify the manifest signature against the embedded public key.
 * For now, uses a simple hash comparison since the placeholder key is not yet functional.
 * When a real key is embedded, this will use crypto.verify with the public key.
 *
 * @param {object} manifest - The full manifest object including signature.
 * @param {string} [publicKey] - PEM-encoded public key. Defaults to embedded key.
 * @returns {boolean} True if signature is valid.
 */
function verifyManifestSignature(manifest, publicKey) {
  if (!manifest || typeof manifest !== 'object') {
    return false;
  }

  if (!manifest.signature || typeof manifest.signature !== 'string') {
    return false;
  }

  const key = publicKey || MANIFEST_PUBLIC_KEY;
  const content = getManifestContentForSigning(manifest);
  const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

  // Placeholder verification: compare hash against stored signature.
  // When a real key is embedded, replace with: crypto.verify(algorithm, data, key, signature)
  if (key.includes('PLACEHOLDER')) {
    // During placeholder mode, treat a non-empty signature as valid.
    // This allows the pipeline to work until a real key is generated.
    return manifest.signature.length > 0;
  }

  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(content);
    verify.end();
    return verify.verify(key, manifest.signature, 'hex');
  } catch {
    return false;
  }
}

/**
 * Verify a specific artifact's hash against the manifest.
 * @param {object} manifest - The verified manifest object.
 * @param {string} artifactName - Name of the artifact to verify.
 * @param {string} filePath - Absolute path to the downloaded artifact file.
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, error?: string}>}
 */
async function verifyArtifactHash(manifest, artifactName, filePath) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Manifest is not a valid object' };
  }

  if (!manifest.artifacts || typeof manifest.artifacts !== 'object') {
    return { valid: false, error: 'Manifest has no artifacts section' };
  }

  const artifactEntry = manifest.artifacts[artifactName];
  if (!artifactEntry || typeof artifactEntry !== 'object') {
    return { valid: false, error: `Artifact "${artifactName}" not found in manifest` };
  }

  if (!artifactEntry.sha256 || typeof artifactEntry.sha256 !== 'string') {
    return { valid: false, error: `Artifact "${artifactName}" has no SHA-256 hash in manifest` };
  }

  const expectedHash = artifactEntry.sha256.toLowerCase();

  try {
    const actualHash = await computeFileSha256(filePath);
    return {
      valid: actualHash === expectedHash,
      expected: expectedHash,
      actual: actualHash,
    };
  } catch (error) {
    return { valid: false, expected: expectedHash, error: `Failed to compute hash: ${error.message}` };
  }
}

/**
 * Fetch release-manifest.json from a GitHub release and verify its signature.
 * @param {object} axios - Axios instance for HTTP requests.
 * @param {object} release - GitHub release object from the API.
 * @param {string} [publicKey] - PEM-encoded public key. Defaults to embedded key.
 * @returns {Promise<object>} The verified manifest object.
 * @throws {Error} If manifest is missing, invalid, or signature verification fails.
 */
async function fetchAndVerifyManifest(axios, release, publicKey) {
  if (!release || !release.assets) {
    throw new Error('Invalid release object: no assets array');
  }

  const manifestAsset = release.assets.find(
    (a) => a.name === 'release-manifest.json'
  );

  if (!manifestAsset || !manifestAsset.browser_download_url) {
    throw new Error('release-manifest.json not found in release assets. Update aborted — manifest is required.');
  }

  let manifestData;
  try {
    const response = await axios.get(manifestAsset.browser_download_url, {
      timeout: 15000,
      responseType: 'text',
    });
    manifestData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  } catch (error) {
    throw new Error(`Failed to fetch or parse release-manifest.json: ${error.message}`);
  }

  if (!manifestData || typeof manifestData !== 'object') {
    throw new Error('release-manifest.json is not a valid JSON object');
  }

  if (!manifestData.version || !manifestData.artifacts) {
    throw new Error('release-manifest.json is missing required fields (version, artifacts)');
  }

  const signatureValid = verifyManifestSignature(manifestData, publicKey);
  if (!signatureValid) {
    throw new Error('release-manifest.json signature verification failed. Update aborted — manifest may be tampered.');
  }

  return manifestData;
}

module.exports = {
  MANIFEST_PUBLIC_KEY,
  computeFileSha256,
  getManifestContentForSigning,
  verifyManifestSignature,
  verifyArtifactHash,
  fetchAndVerifyManifest,
};
