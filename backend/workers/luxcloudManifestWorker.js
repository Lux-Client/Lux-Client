const { parentPort, workerData } = require('worker_threads');
const { buildManifest } = require('../luxcloud/manifest');

async function run() {
    try {
        const result = await buildManifest({
            ...workerData,
            onProgress: (progress) => parentPort.postMessage({ type: 'progress', ...progress })
        });

        parentPort.postMessage({
            type: 'done',
            manifest: result.manifest,
            manifestBlob: result.manifestBlob,
            uploads: result.uploads,
            stats: result.stats
        });
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            error: { message: error.message, code: error.code || 'manifest_failed' }
        });
    }
}

run();
