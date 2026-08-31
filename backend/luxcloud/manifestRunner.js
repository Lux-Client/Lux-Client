const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'luxcloudManifestWorker.js');

function toBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return value;
}

function buildManifestInWorker(options, { onProgress = null, timeoutMs = 15 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH, { workerData: options });

        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate().catch(() => {});
            fn(value);
        };

        const timer = setTimeout(() => {
            const error = new Error('Building the manifest timed out');
            error.code = 'manifest_timeout';
            finish(reject, error);
        }, timeoutMs);

        worker.on('message', (message) => {
            if (!message || typeof message !== 'object') return;

            if (message.type === 'progress') {
                if (onProgress) onProgress(message);
                return;
            }
            if (message.type === 'done') {
                finish(resolve, {
                    manifest: message.manifest,
                    manifestBlob: {
                        ...message.manifestBlob,
                        buffer: toBuffer(message.manifestBlob.buffer)
                    },
                    uploads: message.uploads.map((upload) => (upload.buffer
                        ? { ...upload, buffer: toBuffer(upload.buffer) }
                        : upload)),
                    stats: message.stats
                });
                return;
            }
            if (message.type === 'error') {
                const error = new Error(message.error.message);
                error.code = message.error.code;
                finish(reject, error);
            }
        });

        worker.on('error', (error) => finish(reject, error));
        worker.on('exit', (code) => {
            if (settled) return;
            const error = new Error(`Manifest worker exited with code ${code}`);
            error.code = 'manifest_worker_exit';
            finish(reject, error);
        });
    });
}

module.exports = { buildManifestInWorker };
