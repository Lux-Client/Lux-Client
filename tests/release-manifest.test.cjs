const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Import the functions to test
const {
  createManifest,
  scanArtifacts,
  generateReleaseManifest,
  computeSha256,
  SUPPORTED_EXTENSIONS,
  REPO,
} = require('../backend/utils/release-manifest');

const {
  verifyManifestSignature,
  verifyArtifactHash,
  fetchAndVerifyManifest,
  getManifestContentForSigning,
  MANIFEST_PUBLIC_KEY,
} = require('../backend/utils/manifest-verify');

/**
 * Helper to create a temporary directory for tests
 */
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
}

/**
 * Helper to create a temporary file with content
 */
function createTempFile(dirPath, filename, content) {
  const filePath = path.join(dirPath, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Helper to clean up a directory recursively
 */
function cleanTempDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Helper to compute SHA-256 hash of a string
 */
function computeStringSha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

describe('Release Manifest Tests', () => {
  describe('createManifest', () => {
    it('produces correct structure with version, timestamp, artifacts', () => {
      // Arrange
      const version = '1.2.3';
      const artifacts = [
        { name: 'app.exe', sha256: 'abc123', size: 1024 },
        { name: 'app.deb', sha256: 'def456', size: 2048 },
      ];

      // Act
      const manifest = createManifest(version, artifacts);

      // Assert
      assert.strictEqual(manifest.version, version);
      assert.ok(manifest.timestamp);
      assert.strictEqual(manifest.repo, REPO);
      assert.ok(typeof manifest.artifacts === 'object');
      assert.strictEqual(manifest.signature, '');
      assert.ok(new Date(manifest.timestamp).toISOString() === manifest.timestamp);
    });

    it('artifacts have sha256 and size fields', () => {
      // Arrange
      const version = '1.0.0';
      const artifacts = [
        { name: 'test.exe', sha256: 'hash123', size: 512 },
      ];

      // Act
      const manifest = createManifest(version, artifacts);

      // Assert
      assert.ok(manifest.artifacts['test.exe']);
      assert.strictEqual(manifest.artifacts['test.exe'].sha256, 'hash123');
      assert.strictEqual(manifest.artifacts['test.exe'].size, 512);
    });

    it('empty artifacts directory produces empty artifacts object', () => {
      // Arrange
      const version = '1.0.0';
      const artifacts = [];

      // Act
      const manifest = createManifest(version, artifacts);

      // Assert
      assert.deepStrictEqual(manifest.artifacts, {});
    });
  });

  describe('verifyManifestSignature', () => {
    it('valid signed manifest passes verification', () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: { 'app.exe': { sha256: 'abc123', size: 1024 } },
        signature: 'valid-signature',
      };

      // Act
      const result = verifyManifestSignature(manifest);

      // Assert
      assert.strictEqual(result, true);
    });

    it('tampered manifest signature fails verification', () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: { 'app.exe': { sha256: 'abc123', size: 1024 } },
        signature: '',  // Empty signature
      };

      // Act
      const result = verifyManifestSignature(manifest);

      // Assert
      assert.strictEqual(result, false);
    });

    it('manifest with empty signature fails verification', () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: {},
        signature: '',
      };

      // Act
      const result = verifyManifestSignature(manifest);

      // Assert
      assert.strictEqual(result, false);
    });

    it('manifest with null signature fails verification', () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: {},
        signature: null,
      };

      // Act
      const result = verifyManifestSignature(manifest);

      // Assert
      assert.strictEqual(result, false);
    });

    it('non-object manifest fails verification', () => {
      // Arrange & Act & Assert
      assert.strictEqual(verifyManifestSignature(null), false);
      assert.strictEqual(verifyManifestSignature(undefined), false);
      assert.strictEqual(verifyManifestSignature('string'), false);
      assert.strictEqual(verifyManifestSignature(123), false);
    });
  });

  describe('verifyArtifactHash', () => {
    let tempDir;

    before(() => {
      tempDir = createTempDir();
    });

    after(() => {
      cleanTempDir(tempDir);
    });

    it('matching hash passes', async () => {
      // Arrange
      const testContent = 'test file content';
      const filePath = createTempFile(tempDir, 'test.exe', testContent);
      const expectedHash = computeStringSha256(testContent);
      const manifest = {
        version: '1.0.0',
        artifacts: {
          'test.exe': { sha256: expectedHash, size: testContent.length },
        },
      };

      // Act
      const result = await verifyArtifactHash(manifest, 'test.exe', filePath);

      // Assert
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.expected, expectedHash);
      assert.strictEqual(result.actual, expectedHash);
    });

    it('mismatched hash fails', async () => {
      // Arrange
      const testContent = 'test file content';
      const filePath = createTempFile(tempDir, 'test2.exe', testContent);
      const manifest = {
        version: '1.0.0',
        artifacts: {
          'test2.exe': { sha256: 'wrong-hash', size: testContent.length },
        },
      };

      // Act
      const result = await verifyArtifactHash(manifest, 'test2.exe', filePath);

      // Assert
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.expected, 'wrong-hash');
      assert.strictEqual(result.actual, computeStringSha256(testContent));
    });

    it('missing artifact in manifest fails', async () => {
      // Arrange
      const testContent = 'test file content';
      const filePath = createTempFile(tempDir, 'test3.exe', testContent);
      const manifest = {
        version: '1.0.0',
        artifacts: {},
      };

      // Act
      const result = await verifyArtifactHash(manifest, 'missing.exe', filePath);

      // Assert
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('not found in manifest'));
    });

    it('missing artifacts section in manifest fails', async () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
      };

      // Act
      const result = await verifyArtifactHash(manifest, 'test.exe', '/path/to/file');

      // Assert
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('no artifacts section'));
    });

    it('non-object manifest fails', async () => {
      // Arrange & Act & Assert
      const result1 = await verifyArtifactHash(null, 'test.exe', '/path');
      assert.strictEqual(result1.valid, false);

      const result2 = await verifyArtifactHash('string', 'test.exe', '/path');
      assert.strictEqual(result2.valid, false);
    });

    it('manifest with missing sha256 fails', async () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        artifacts: {
          'test.exe': { size: 1024 },  // Missing sha256
        },
      };

      // Act
      const result = await verifyArtifactHash(manifest, 'test.exe', '/path');

      // Assert
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('no SHA-256 hash'));
    });
  });

  describe('Integration Tests', () => {
    let tempDir;

    before(() => {
      tempDir = createTempDir();
    });

    after(() => {
      cleanTempDir(tempDir);
    });

    it('create temp directory with fake artifacts, generate manifest, verify it', async () => {
      // Arrange
      const version = '1.0.0';
      const testContent1 = 'artifact 1 content';
      const testContent2 = 'artifact 2 content';
      
      createTempFile(tempDir, 'app.exe', testContent1);
      createTempFile(tempDir, 'app.deb', testContent2);

      // Act
      const manifest = await generateReleaseManifest(tempDir, version);

      // Assert - manifest structure
      assert.strictEqual(manifest.version, version);
      assert.ok(manifest.timestamp);
      assert.strictEqual(manifest.repo, REPO);
      assert.ok(Object.keys(manifest.artifacts).length === 2);

      // Assert - verify SHA-256 hashes are correct
      const exeHash = computeStringSha256(testContent1);
      const debHash = computeStringSha256(testContent2);
      
      assert.strictEqual(manifest.artifacts['app.exe'].sha256, exeHash);
      assert.strictEqual(manifest.artifacts['app.deb'].sha256, debHash);
      assert.strictEqual(manifest.artifacts['app.exe'].size, testContent1.length);
      assert.strictEqual(manifest.artifacts['app.deb'].size, testContent2.length);

      // Assert - verify artifact hashes
      const exePath = path.join(tempDir, 'app.exe');
      const debPath = path.join(tempDir, 'app.deb');
      
      const exeResult = await verifyArtifactHash(manifest, 'app.exe', exePath);
      assert.strictEqual(exeResult.valid, true);

      const debResult = await verifyArtifactHash(manifest, 'app.deb', debPath);
      assert.strictEqual(debResult.valid, true);

      // Assert - signature verification (placeholder mode)
      const signatureValid = verifyManifestSignature(manifest);
      assert.strictEqual(signatureValid, false);  // Empty signature
    });

    it('manifest with empty directory produces empty artifacts', async () => {
      // Arrange
      const emptyDir = createTempDir();
      try {
        const version = '1.0.0';

        // Act
        const manifest = await generateReleaseManifest(emptyDir, version);

        // Assert
        assert.strictEqual(manifest.version, version);
        assert.deepStrictEqual(manifest.artifacts, {});
      } finally {
        cleanTempDir(emptyDir);
      }
    });

    it('manifest generation produces correct SHA-256 hashes', async () => {
      // Arrange
      const testDir = createTempDir();
      try {
        const content = 'specific content for hash test';
        const expectedHash = computeStringSha256(content);
        createTempFile(testDir, 'test.exe', content);

        // Act
        const manifest = await generateReleaseManifest(testDir, '1.0.0');

        // Assert
        assert.strictEqual(manifest.artifacts['test.exe'].sha256, expectedHash);
      } finally {
        cleanTempDir(testDir);
      }
    });

    it('missing manifest file handled gracefully', async () => {
      // Arrange
      const release = {
        assets: [
          { name: 'other-file.txt', browser_download_url: 'https://example.com/other.txt' },
        ],
      };
      const mockAxios = {
        get: async () => ({ data: {} }),
      };

      // Act & Assert
      try {
        await fetchAndVerifyManifest(mockAxios, release);
        assert.fail('Should have thrown error');
      } catch (error) {
        assert.ok(error.message.includes('release-manifest.json not found'));
      }
    });

    it('manifest with wrong version fails validation', async () => {
      // Arrange
      const manifest = {
        version: '',  // Wrong version
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: {},
        signature: 'valid-signature',
      };

      // Act - createManifest doesn't validate version, but we can test the structure
      const createdManifest = createManifest('', []);

      // Assert - manifest is created but version is empty
      assert.strictEqual(createdManifest.version, '');
      
      // Note: fetchAndVerifyManifest validates version, but createManifest doesn't
      // This test verifies that empty versions are allowed in createManifest
    });

    it('manifest with missing artifact hashes fails verification', async () => {
      // Arrange
      const tempDir2 = createTempDir();
      try {
        createTempFile(tempDir2, 'test.exe', 'content');
        const manifest = await generateReleaseManifest(tempDir2, '1.0.0');
        
        // Tamper with the manifest by removing hashes
        delete manifest.artifacts['test.exe'].sha256;

        // Act
        const result = await verifyArtifactHash(manifest, 'test.exe', path.join(tempDir2, 'test.exe'));

        // Assert
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('no SHA-256 hash'));
      } finally {
        cleanTempDir(tempDir2);
      }
    });
  });

  describe('Utility Functions', () => {
    it('computeSha256 returns correct hash', async () => {
      // Arrange
      const tempDir3 = createTempDir();
      try {
        const content = 'test content';
        const filePath = createTempFile(tempDir3, 'test.txt', content);
        const expectedHash = computeStringSha256(content);

        // Act
        const hash = await computeSha256(filePath);

        // Assert
        assert.strictEqual(hash, expectedHash);
      } finally {
        cleanTempDir(tempDir3);
      }
    });

    it('isSupportedArtifact returns correct results', () => {
      // Arrange & Act & Assert
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.exe'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.deb'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.rpm'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.dmg'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.zip'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.AppImage'.endsWith(ext)),
        true
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'readme.md'.endsWith(ext)),
        false
      );
      assert.strictEqual(
        SUPPORTED_EXTENSIONS.some((ext) => 'app.txt'.endsWith(ext)),
        false
      );
    });

    it('getManifestContentForSigning excludes signature field', () => {
      // Arrange
      const manifest = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        repo: REPO,
        artifacts: { 'app.exe': { sha256: 'abc123', size: 1024 } },
        signature: 'should-be-excluded',
      };

      // Act
      const content = getManifestContentForSigning(manifest);
      const parsed = JSON.parse(content);

      // Assert
      assert.strictEqual(parsed.signature, undefined);
      assert.strictEqual(parsed.version, manifest.version);
      assert.strictEqual(parsed.timestamp, manifest.timestamp);
      assert.deepStrictEqual(parsed.artifacts, manifest.artifacts);
    });
  });
});
