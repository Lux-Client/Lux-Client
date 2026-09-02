const zlib = require('zlib');

const ZSTD_AVAILABLE = typeof zlib.zstdCompressSync === 'function';

const ALWAYS_COMPRESS = new Set([
    '.json', '.txt', '.cfg', '.toml', '.properties', '.snbt',
    '.yaml', '.yml', '.lang', '.mcmeta', '.dat', '.nbt5', '.ini', '.conf'
]);

const NEVER_COMPRESS = new Set([
    '.jar', '.zip', '.png', '.jpg', '.jpeg', '.ogg', '.mp3', '.webp',
    '.mca', '.nbt', '.gz', '.xz', '.zst', '.7z', '.rar', '.mp4', '.webm',
    '.litemod', '.disabled'
]);

const PROBE_BYTES = 128 * 1024;
const PROBE_MIN_GAIN = 0.10;
const MIN_WORTHWHILE_BYTES = 512;

function extensionOf(relPath) {
    const name = String(relPath || '').toLowerCase();
    const idx = name.lastIndexOf('.');
    return idx <= 0 ? '' : name.slice(idx);
}

function compress(buffer, level = 3) {
    if (!ZSTD_AVAILABLE) return null;
    try {
        return zlib.zstdCompressSync(buffer, {
            params: { [zlib.constants.ZSTD_c_compressionLevel]: level }
        });
    } catch {
        return null;
    }
}

function decompress(buffer, compression) {
    if (compression !== 'zstd') return buffer;
    if (!ZSTD_AVAILABLE) return null;
    try {
        return zlib.zstdDecompressSync(buffer);
    } catch {
        return null;
    }
}

function decideByExtension(relPath) {
    const ext = extensionOf(relPath);
    if (NEVER_COMPRESS.has(ext)) return 'none';
    if (ALWAYS_COMPRESS.has(ext)) return 'zstd';
    return 'probe';
}

function probe(buffer) {
    const sample = buffer.length > PROBE_BYTES ? buffer.subarray(0, PROBE_BYTES) : buffer;
    const compressed = compress(sample);
    if (!compressed) return 'none';

    const gain = 1 - compressed.length / sample.length;
    return gain >= PROBE_MIN_GAIN ? 'zstd' : 'none';
}

function chooseCompression(relPath, size, sample = null) {
    if (!ZSTD_AVAILABLE) return 'none';
    if (!Number.isFinite(size) || size < MIN_WORTHWHILE_BYTES) return 'none';

    const decision = decideByExtension(relPath);
    if (decision !== 'probe') return decision;
    if (!sample || sample.length === 0) return 'none';

    return probe(sample);
}

function compressIfWorthwhile(relPath, buffer) {
    const decision = chooseCompression(relPath, buffer.length, buffer);
    if (decision !== 'zstd') return { compression: 'none', data: buffer };

    const compressed = compress(buffer);
    if (!compressed || compressed.length >= buffer.length) {
        return { compression: 'none', data: buffer };
    }
    return { compression: 'zstd', data: compressed };
}

module.exports = {
    ALWAYS_COMPRESS,
    NEVER_COMPRESS,
    PROBE_BYTES,
    ZSTD_AVAILABLE,
    chooseCompression,
    compressIfWorthwhile,
    decompress,
    extensionOf
};
