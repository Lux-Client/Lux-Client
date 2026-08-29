const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { parseSha256FromText, calculateFileSha256 } = require('../backend/utils/hash-utils');

/**
 * Helper: create a temp file with the given content.
 * Returns the absolute path. Caller is responsible for cleanup.
 */
function createTempFile(content, ext = '.txt') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
    const filePath = path.join(tmpDir, `testfile${ext}`);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

/**
 * Helper: create a temp file of approximately the given size in bytes.
 */
function createTempFileOfSize(sizeInBytes) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
    const filePath = path.join(tmpDir, 'largefile.bin');
    const fd = fs.openSync(filePath, 'w');
    const chunkSize = 65536;
    let written = 0;
    while (written < sizeInBytes) {
        const toWrite = Math.min(chunkSize, sizeInBytes - written);
        const buf = Buffer.alloc(toWrite, 0xab);
        fs.writeSync(fd, buf, 0, toWrite, written);
        written += toWrite;
    }
    fs.closeSync(fd);
    return filePath;
}

/**
 * Helper: compute the expected SHA-256 of a string (same as sha256sum output).
 */
function expectedSha256(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ─── parseSha256FromText ────────────────────────────────────────────

describe('parseSha256FromText', () => {
    it('parses standard "hash  filename" format', () => {
        // Arrange
        const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const content = `${hash}  *app.deb\n`;

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, hash);
    });

    it('parses standard "hash  filename" format without asterisk', () => {
        // Arrange
        const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
        const content = `${hash}  app.deb\n`;

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, hash);
    });

    it('parses bare hash format (no filename)', () => {
        // Arrange
        const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const content = `${hash}\n`;

        // Act
        const result = parseSha256FromText(content, 'anything.txt');

        // Assert
        assert.strictEqual(result, hash);
    });

    it('returns null for empty input', () => {
        // Arrange
        const content = '';

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, null);
    });

    it('returns null for null/undefined input', () => {
        // Arrange & Act & Assert
        assert.strictEqual(parseSha256FromText(null, 'app.deb'), null);
        assert.strictEqual(parseSha256FromText(undefined, 'app.deb'), null);
    });

    it('returns null for invalid format (not a hex hash)', () => {
        // Arrange
        const content = 'not-a-valid-hash  app.deb\n';

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, null);
    });

    it('returns null for hash that is not 64 characters', () => {
        // Arrange
        const content = 'abc123  app.deb\n';

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, null);
    });

    it('returns null when target filename does not match', () => {
        // Arrange
        const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const content = `${hash}  app.deb\n`;

        // Act
        const result = parseSha256FromText(content, 'other.rpm');

        // Assert
        assert.strictEqual(result, null);
    });

    it('handles Windows line endings (\\r\\n)', () => {
        // Arrange
        const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const content = `${hash}  *app.deb\r\n`;

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, hash);
    });

    it('handles multiple lines and picks the correct one', () => {
        // Arrange
        const hash1 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const hash2 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
        const content = `${hash1}  *app.deb\n${hash2}  *app.rpm\n`;

        // Act
        const resultDeb = parseSha256FromText(content, 'app.deb');
        const resultRpm = parseSha256FromText(content, 'app.rpm');

        // Assert
        assert.strictEqual(resultDeb, hash1);
        assert.strictEqual(resultRpm, hash2);
    });

    it('normalizes uppercase hex to lowercase', () => {
        // Arrange
        const hash = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
        const content = `${hash}  *app.deb\n`;

        // Act
        const result = parseSha256FromText(content, 'app.deb');

        // Assert
        assert.strictEqual(result, hash.toLowerCase());
    });
});

// ─── calculateFileSha256 ────────────────────────────────────────────

describe('calculateFileSha256', () => {
    it('computes correct hash for a file with known content', async () => {
        // Arrange
        const content = 'Hello, World! This is a test file for SHA-256 verification.';
        const filePath = createTempFile(content);
        const expected = expectedSha256(content);

        try {
            // Act
            const hash = await calculateFileSha256(filePath);

            // Assert
            assert.strictEqual(hash, expected);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('computes correct hash for an empty file', async () => {
        // Arrange
        const content = '';
        const filePath = createTempFile(content);
        const expected = expectedSha256(content);

        try {
            // Act
            const hash = await calculateFileSha256(filePath);

            // Assert
            assert.strictEqual(hash, expected);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('computes correct hash for a ~1MB file', async () => {
        // Arrange
        const sizeInBytes = 1024 * 1024; // 1 MB
        const filePath = createTempFileOfSize(sizeInBytes);
        const fileContent = fs.readFileSync(filePath);
        const expected = crypto.createHash('sha256').update(fileContent).digest('hex');

        try {
            // Act
            const hash = await calculateFileSha256(filePath);

            // Assert
            assert.strictEqual(hash, expected);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('is deterministic — same file always produces the same hash', async () => {
        // Arrange
        const content = 'Deterministic content for hash verification.';
        const filePath = createTempFile(content);

        try {
            // Act
            const hash1 = await calculateFileSha256(filePath);
            const hash2 = await calculateFileSha256(filePath);

            // Assert
            assert.strictEqual(hash1, hash2);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('different files produce different hashes', async () => {
        // Arrange
        const filePath1 = createTempFile('Content A');
        const filePath2 = createTempFile('Content B');

        try {
            // Act
            const hash1 = await calculateFileSha256(filePath1);
            const hash2 = await calculateFileSha256(filePath2);

            // Assert
            assert.notStrictEqual(hash1, hash2);
        } finally {
            fs.rmSync(path.dirname(filePath1), { recursive: true, force: true });
            fs.rmSync(path.dirname(filePath2), { recursive: true, force: true });
        }
    });

    it('hash output is a valid 64-character lowercase hex string', async () => {
        // Arrange
        const content = 'Test content for format validation.';
        const filePath = createTempFile(content);

        try {
            // Act
            const hash = await calculateFileSha256(filePath);

            // Assert
            assert.strictEqual(hash.length, 64);
            assert.match(hash, /^[a-f0-9]{64}$/);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });
});

// ─── Integration: calculateFileSha256 + parseSha256FromText ──────────

describe('Integration: hash verification end-to-end', () => {
    it('computes file hash and verifies it matches expected sha256sum output', async () => {
        // Arrange
        const content = 'Integration test: end-to-end hash verification.';
        const filePath = createTempFile(content);

        try {
            // Act
            const actualHash = await calculateFileSha256(filePath);
            const filename = path.basename(filePath);
            const checksumLine = `${actualHash}  *${filename}\n`;

            // Assert — parse the hash back and confirm round-trip
            const parsedHash = parseSha256FromText(checksumLine, filename);
            assert.strictEqual(parsedHash, actualHash);

            // Also verify against independently computed hash
            const independentHash = expectedSha256(content);
            assert.strictEqual(parsedHash, independentHash);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('detects mismatched hash (simulated tampered checksum)', async () => {
        // Arrange
        const content = 'Important release binary content.';
        const filePath = createTempFile(content);

        try {
            // Act
            const actualHash = await calculateFileSha256(filePath);
            const tamperedHash = '0'.repeat(64); // All zeros — definitely wrong

            // Assert — hashes should not match
            assert.notStrictEqual(actualHash, tamperedHash);

            // Parsing the tampered hash should return it, but it won't match the real file
            const parsedHash = parseSha256FromText(`${tamperedHash}  *${path.basename(filePath)}\n`, path.basename(filePath));
            assert.strictEqual(parsedHash, tamperedHash);
            assert.notStrictEqual(parsedHash, actualHash);
        } finally {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
    });

    it('handles empty/missing checksum file gracefully', () => {
        // Arrange
        const emptyContent = '';

        // Act
        const result = parseSha256FromText(emptyContent, 'app.deb');

        // Assert
        assert.strictEqual(result, null);
    });

    it('handles checksum file with wrong format', () => {
        // Arrange
        const wrongFormat = 'this is not a hash at all\n';

        // Act
        const result = parseSha256FromText(wrongFormat, 'app.deb');

        // Assert
        assert.strictEqual(result, null);
    });
});
