// @ts-nocheck
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_EXTENSIONS = ['.exe', '.AppImage', '.deb', '.rpm', '.dmg', '.zip'];
const REPO = 'Lux-Client/Lux-Client';

/**
 * Compute SHA-256 hash of a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA-256 hex digest
 */
function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Check if a file has a supported release artifact extension
 * @param {string} filename - Name of the file
 * @returns {boolean}
 */
function isSupportedArtifact(filename) {
  return SUPPORTED_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

/**
 * Scan a directory for release artifacts and compute their SHA-256 hashes
 * @param {string} dirPath - Path to directory containing release artifacts
 * @returns {Promise<{name: string, sha256: string, size: number}[]>}
 */
async function scanArtifacts(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const artifacts = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isSupportedArtifact(entry.name)) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const stat = fs.statSync(filePath);
    const sha256 = await computeSha256(filePath);

    artifacts.push({
      name: entry.name,
      sha256,
      size: stat.size,
    });
  }

  return artifacts;
}

/**
 * Generate a release manifest object
 * @param {string} version - Version string (e.g. "1.2.3")
 * @param {Array<{name: string, sha256: string, size: number}>} artifacts - Scanned artifacts
 * @returns {object} Manifest object
 */
function createManifest(version, artifacts) {
  const artifactsMap = {};
  for (const artifact of artifacts) {
    artifactsMap[artifact.name] = {
      sha256: artifact.sha256,
      size: artifact.size,
    };
  }

  return {
    version,
    timestamp: new Date().toISOString(),
    repo: REPO,
    artifacts: artifactsMap,
    signature: '',
  };
}

/**
 * Write manifest JSON to a file
 * @param {object} manifest - Manifest object
 * @param {string} outputPath - Path to write the manifest file
 */
function writeManifest(manifest, outputPath) {
  const json = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(outputPath, json, 'utf8');
}

/**
 * Generate a release manifest from a directory of artifacts
 * @param {string} dirPath - Directory containing release artifacts
 * @param {string} version - Version string
 * @param {string} [outputDir] - Output directory (defaults to dirPath)
 * @returns {Promise<object>} The generated manifest
 */
async function generateReleaseManifest(dirPath, version, outputDir) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Directory path is required');
  }
  if (!version || typeof version !== 'string') {
    throw new Error('Version string is required');
  }

  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory does not exist: ${resolvedDir}`);
  }

  const artifacts = await scanArtifacts(resolvedDir);
  const manifest = createManifest(version, artifacts);

  const output = outputDir ? path.resolve(outputDir) : resolvedDir;
  const manifestPath = path.join(output, 'release-manifest.json');
  writeManifest(manifest, manifestPath);

  return manifest;
}

/**
 * Parse CLI arguments and run manifest generation
 * Usage: node release-manifest.js <directory> <version> [output-dir]
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    // eslint-disable-next-line no-console
    console.error('Usage: node release-manifest.js <directory> <version> [output-dir]');
    process.exit(1);
  }

  const [dirPath, version, outputDir] = args;

  try {
    const manifest = await generateReleaseManifest(dirPath, version, outputDir);
    // eslint-disable-next-line no-console
    console.log(`Manifest generated for version ${manifest.version}`);
    // eslint-disable-next-line no-console
    console.log(`Artifacts: ${Object.keys(manifest.artifacts).length}`);
    // eslint-disable-next-line no-console
    console.log(`Timestamp: ${manifest.timestamp}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error generating manifest: ${error.message}`);
    process.exit(1);
  }
}

// Run as script if invoked directly, export if imported as module
if (require.main === module) {
  main();
}

module.exports = {
  generateReleaseManifest,
  createManifest,
  scanArtifacts,
  computeSha256,
  isSupportedArtifact,
  writeManifest,
  SUPPORTED_EXTENSIONS,
  REPO,
};
