const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { isPathInside, validateExtensionId, sanitizeIconPath } = require('../backend/utils/path-safety');

// Temporary directories for symlink tests
const testBaseDir = path.join(os.tmpdir(), 'path-safety-test-base');
const testOutsideDir = path.join(os.tmpdir(), 'path-safety-test-outside');

before(() => {
  // Create base test directory with a file inside
  fs.mkdirSync(testBaseDir, { recursive: true });
  fs.writeFileSync(path.join(testBaseDir, 'file.txt'), 'test content');

  // Create outside directory with a file
  fs.mkdirSync(testOutsideDir, { recursive: true });
  fs.writeFileSync(path.join(testOutsideDir, 'secret.txt'), 'secret content');
});

after(() => {
  // Clean up test directories
  fs.rmSync(testBaseDir, { recursive: true, force: true });
  fs.rmSync(testOutsideDir, { recursive: true, force: true });
});

describe('isPathInside', () => {
  it('returns true for normal path inside base directory', () => {
    // Arrange
    const baseDir = testBaseDir;
    const targetPath = path.join(testBaseDir, 'file.txt');

    // Act
    const result = isPathInside(baseDir, targetPath);

    // Assert
    assert.strictEqual(result, true);
  });

  it('returns false for path with .. traversal', () => {
    // Arrange
    const baseDir = testBaseDir;
    const targetPath = path.join(testBaseDir, '..', 'etc', 'passwd');

    // Act
    const result = isPathInside(baseDir, targetPath);

    // Assert
    assert.strictEqual(result, false);
  });

  it('returns false for symlink pointing outside base directory', () => {
    // Arrange
    const baseDir = testBaseDir;
    const symlinkPath = path.join(testBaseDir, 'evil-link');
    try {
      fs.symlinkSync(testOutsideDir, symlinkPath);

      // Act
      const result = isPathInside(baseDir, symlinkPath);

      // Assert
      assert.strictEqual(result, false);
    } finally {
      // Cleanup
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }
  });

  it('returns true for symlink pointing inside base directory', () => {
    // Arrange
    const baseDir = testBaseDir;
    const innerDir = path.join(testBaseDir, 'inner');
    fs.mkdirSync(innerDir, { recursive: true });
    const symlinkPath = path.join(testBaseDir, 'good-link');
    try {
      fs.symlinkSync(innerDir, symlinkPath);

      // Act
      const result = isPathInside(baseDir, symlinkPath);

      // Assert
      assert.strictEqual(result, true);
    } finally {
      // Cleanup
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.rmSync(innerDir, { recursive: true, force: true });
    }
  });

  it('does not crash for non-existent path', () => {
    // Arrange
    const baseDir = testBaseDir;
    const targetPath = '/tmp/nonexistent/file/that/does/not/exist';

    // Act
    const result = isPathInside(baseDir, targetPath);

    // Assert
    assert.strictEqual(result, false);
  });

  it('returns true for same path', () => {
    // Arrange
    const baseDir = testBaseDir;

    // Act
    const result = isPathInside(baseDir, baseDir);

    // Assert
    assert.strictEqual(result, true);
  });

  it('returns false for absolute path outside base directory', () => {
    // Arrange
    const baseDir = testBaseDir;
    const targetPath = '/etc/passwd';

    // Act
    const result = isPathInside(baseDir, targetPath);

    // Assert
    assert.strictEqual(result, false);
  });
});

describe('validateExtensionId', () => {
  it('rejects traversal sequences', () => {
    // Arrange
    const id = '../etc/passwd';

    // Act
    const result = validateExtensionId(id);

    // Assert
    assert.strictEqual(result.valid, false);
  });

  it('rejects absolute paths', () => {
    // Arrange
    const id = '/etc/passwd';

    // Act
    const result = validateExtensionId(id);

    // Assert
    assert.strictEqual(result.valid, false);
  });

  it('accepts valid extension IDs', () => {
    // Arrange
    const id = 'my-extension';

    // Act
    const result = validateExtensionId(id);

    // Assert
    assert.strictEqual(result.valid, true);
  });

  it('rejects null bytes', () => {
    // Arrange
    const id = 'ext\0id';

    // Act
    const result = validateExtensionId(id);

    // Assert
    assert.strictEqual(result.valid, false);
  });

  it('rejects path separators', () => {
    // Arrange
    const id = 'ext/sub';

    // Act
    const result = validateExtensionId(id);

    // Assert
    assert.strictEqual(result.valid, false);
  });
});

describe('isPathInside prefix-confusion', () => {
  it('returns false when target is sibling with similar prefix', () => {
    // Arrange - the old startsWith bug: '/tmp/foo-bar' starts with '/tmp/foo' but is NOT inside '/tmp/foo'
    const baseDir = '/tmp/foo';
    const targetPath = '/tmp/foo-bar';

    // Act
    const result = isPathInside(baseDir, targetPath);

    // Assert
    assert.strictEqual(result, false);
  });
});

describe('sanitizeIconPath', () => {
  it('returns valid for icon path inside extension directory', () => {
    // Arrange
    const extensionDir = testBaseDir;
    const iconPath = 'icon.png';

    // Act
    const result = sanitizeIconPath(extensionDir, iconPath);

    // Assert
    assert.strictEqual(result.valid, true);
    assert.ok(result.resolvedPath);
  });

  it('returns invalid for icon path escaping extension directory', () => {
    // Arrange
    const extensionDir = testBaseDir;
    const iconPath = '../../etc/passwd';

    // Act
    const result = sanitizeIconPath(extensionDir, iconPath);

    // Assert
    assert.strictEqual(result.valid, false);
  });
});
