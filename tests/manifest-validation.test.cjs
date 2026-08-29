const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Validates an extension manifest object against the required schema.
 * Mirrors the logic from backend/utils/manifest-schema.ts.
 * Collects all validation errors rather than stopping at the first one.
 *
 * @param {object} manifest - The parsed manifest.json object.
 * @returns {{ valid: true, manifest: object } | { valid: false, errors: string[] }}
 */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const errors = [];

  // Validate name: required string, 1-128 chars, no null bytes
  const { name } = manifest;
  if (typeof name !== 'string' || name.length === 0) {
    errors.push('Manifest "name" must be a non-empty string');
  } else {
    if (name.length > 128) {
      errors.push('Manifest "name" exceeds maximum length (128)');
    }
    if (name.includes('\0')) {
      errors.push('Manifest "name" contains null byte');
    }
  }

  // Validate version: required string, must match semver pattern (x.y.z)
  const { version } = manifest;
  if (typeof version !== 'string') {
    errors.push('Manifest "version" must be a string');
  } else if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push('Manifest "version" must be a valid semver (x.y.z)');
  }

  // Validate main/entry: at least one must be present and be a string
  const mainEntry = manifest.main || manifest.entry;
  if (!mainEntry) {
    errors.push('Manifest must contain either "main" or "entry" field');
  } else if (typeof mainEntry !== 'string') {
    errors.push('Manifest "main"/"entry" must be a string');
  }

  // Validate icon: optional string
  if (manifest.icon !== undefined && typeof manifest.icon !== 'string') {
    errors.push('Manifest "icon" must be a string if provided');
  }

  // Validate id: optional string, if present must be alphanumeric with hyphens/underscores
  if (manifest.id !== undefined) {
    if (typeof manifest.id !== 'string') {
      errors.push('Manifest "id" must be a string if provided');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
      errors.push('Manifest "id" contains invalid characters');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest };
}

describe('validateManifest', () => {
  it('passes validation for a valid manifest with all required fields', () => {
    // Arrange
    const manifest = {
      name: 'my-extension',
      version: '1.0.0',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.manifest, manifest);
  });

  it('fails validation when name field is missing', () => {
    // Arrange
    const manifest = {
      version: '1.0.0',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('"name"')),
      'Error should mention the name field',
    );
  });

  it('fails validation when version field is missing', () => {
    // Arrange
    const manifest = {
      name: 'my-extension',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('"version"')),
      'Error should mention the version field',
    );
  });

  it('fails validation when both main and entry fields are missing', () => {
    // Arrange
    const manifest = {
      name: 'my-extension',
      version: '1.0.0',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('"main"') || e.includes('"entry"')),
      'Error should mention main or entry field',
    );
  });

  it('fails validation for invalid semver version', () => {
    // Arrange
    const manifest = {
      name: 'my-extension',
      version: '1.0',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('semver')),
      'Error should mention semver format',
    );
  });

  it('fails validation when name contains null bytes', () => {
    // Arrange
    const manifest = {
      name: 'my-ext\0ension',
      version: '1.0.0',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('null byte')),
      'Error should mention null byte',
    );
  });

  it('fails validation when name exceeds maximum length', () => {
    // Arrange
    const manifest = {
      name: 'a'.repeat(129),
      version: '1.0.0',
      main: 'index.js',
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('maximum length')),
      'Error should mention maximum length',
    );
  });

  it('reports all errors for an empty manifest object', () => {
    // Arrange
    const manifest = {};

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length >= 3, 'Should report at least name, version, and main/entry errors');
    assert.ok(
      result.errors.some((e) => e.includes('"name"')),
      'Should report missing name',
    );
    assert.ok(
      result.errors.some((e) => e.includes('"version"')),
      'Should report missing version',
    );
    assert.ok(
      result.errors.some((e) => e.includes('"main"') || e.includes('"entry"')),
      'Should report missing main/entry',
    );
  });

  it('ignores extra fields gracefully', () => {
    // Arrange
    const manifest = {
      name: 'my-extension',
      version: '1.0.0',
      main: 'index.js',
      description: 'An extra field',
      author: 'Someone',
      randomKey: 42,
    };

    // Act
    const result = validateManifest(manifest);

    // Assert
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.manifest, manifest);
  });
});
