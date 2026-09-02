const crypto = require('crypto');
const fs = require('fs-extra');

const ALGO = 'fastcdc-1M';

const MIN_SIZE = 256 * 1024;
const AVG_SIZE = 1024 * 1024;
const MAX_SIZE = 4 * 1024 * 1024;

const MASK_S = 0x003f_ffff;
const MASK_L = 0x0003_ffff;

const GEAR = buildGearTable();

function buildGearTable() {
    const table = new Uint32Array(256);
    let state = 0x1a2b3c4d;

    for (let i = 0; i < 256; i += 1) {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        table[i] = state;
    }

    return table;
}

function nextBoundary(buffer, start, end) {
    const length = end - start;
    if (length <= MIN_SIZE) return end;

    let hash = 0;
    let i = start + MIN_SIZE;

    const normalPoint = Math.min(start + AVG_SIZE, end);

    for (; i < normalPoint; i += 1) {
        hash = ((hash << 1) + GEAR[buffer[i]]) >>> 0;
        if ((hash & MASK_S) === 0) return i + 1;
    }

    for (; i < end; i += 1) {
        hash = ((hash << 1) + GEAR[buffer[i]]) >>> 0;
        if ((hash & MASK_L) === 0) return i + 1;
    }

    return end;
}

function chunkBuffer(buffer) {
    const chunks = [];
    let offset = 0;

    while (offset < buffer.length) {
        const limit = Math.min(offset + MAX_SIZE, buffer.length);
        const boundary = nextBoundary(buffer, offset, limit);
        const slice = buffer.subarray(offset, boundary);

        chunks.push({
            offset,
            size: slice.length,
            sha256: crypto.createHash('sha256').update(slice).digest('hex')
        });

        offset = boundary;
    }

    return chunks;
}

async function chunkFile(filePath) {
    const stat = await fs.stat(filePath);
    const chunks = [];

    let carry = Buffer.alloc(0);
    let baseOffset = 0;

    const stream = fs.createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 });

    for await (const piece of stream) {
        carry = carry.length === 0 ? piece : Buffer.concat([carry, piece]);

        let offset = 0;
        while (carry.length - offset >= MAX_SIZE) {
            const limit = offset + MAX_SIZE;
            const boundary = nextBoundary(carry, offset, limit);
            const slice = carry.subarray(offset, boundary);

            chunks.push({
                offset: baseOffset + offset,
                size: slice.length,
                sha256: crypto.createHash('sha256').update(slice).digest('hex')
            });
            offset = boundary;
        }

        if (offset > 0) {
            baseOffset += offset;
            carry = Buffer.from(carry.subarray(offset));
        }
    }

    let offset = 0;
    while (offset < carry.length) {
        const limit = Math.min(offset + MAX_SIZE, carry.length);
        const boundary = nextBoundary(carry, offset, limit);
        const slice = carry.subarray(offset, boundary);

        chunks.push({
            offset: baseOffset + offset,
            size: slice.length,
            sha256: crypto.createHash('sha256').update(slice).digest('hex')
        });
        offset = boundary;
    }

    return { algo: ALGO, size: stat.size, chunks };
}

function chunkListBlob(chunks) {
    const list = chunks.map((chunk) => chunk.sha256);
    const json = JSON.stringify({ algo: ALGO, chunks: list });
    const buffer = Buffer.from(json, 'utf8');

    return {
        buffer,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
    };
}

module.exports = {
    ALGO,
    AVG_SIZE,
    MAX_SIZE,
    MIN_SIZE,
    chunkBuffer,
    chunkFile,
    chunkListBlob
};
