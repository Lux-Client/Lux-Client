const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

function tone(freqStart, freqEnd, durationMs, amplitude, fadeMs = 8) {
    const numSamples = Math.floor(SAMPLE_RATE * durationMs / 1000);
    const samples = new Float32Array(numSamples);
    const fadeSamples = Math.floor(SAMPLE_RATE * fadeMs / 1000);
    for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const freq = freqStart + (freqEnd - freqStart) * (i / numSamples);
        let env = 1;
        if (i < fadeSamples) env = i / fadeSamples;
        else if (i > numSamples - fadeSamples) env = (numSamples - i) / fadeSamples;
        const decay = Math.exp(-3 * (i / numSamples));
        samples[i] = Math.sin(2 * Math.PI * freq * t) * amplitude * env * decay;
    }
    return samples;
}

function silence(durationMs) {
    return new Float32Array(Math.floor(SAMPLE_RATE * durationMs / 1000));
}

function concat(...arrays) {
    const total = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Float32Array(total);
    let offset = 0;
    for (const a of arrays) {
        result.set(a, offset);
        offset += a.length;
    }
    return result;
}

function toInt16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        out[i] = Math.round(s * 32767);
    }
    return out;
}

function writeWav(filePath, floatSamples) {
    const samples = toInt16(floatSamples);
    const blockAlign = 2;
    const byteRate = SAMPLE_RATE * blockAlign;
    const dataSize = samples.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i], 44 + i * 2);
    }
    fs.writeFileSync(filePath, buffer);
}

const outDir = path.join(__dirname, '..', 'public', 'assets', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

writeWav(path.join(outDir, 'click.wav'), tone(1100, 900, 45, 0.18, 5));

writeWav(path.join(outDir, 'notification.wav'), concat(
    tone(880, 880, 90, 0.16, 10),
    silence(20),
    tone(1318, 1318, 140, 0.16, 12)
));

writeWav(path.join(outDir, 'error.wav'), concat(
    tone(480, 480, 110, 0.18, 8),
    silence(15),
    tone(330, 330, 160, 0.18, 12)
));

console.log('Generated sound effects in', outDir);
