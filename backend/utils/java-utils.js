// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);

const ADOPTIUM_API = 'https://api.adoptium.net/v3';

async function downloadFile(url, destPath, onProgress) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000
    });

    if (response.status !== 200) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const totalLength = parseInt(response.headers['content-length'], 10);
    let downloaded = 0;

    response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && !isNaN(totalLength) && totalLength > 0) {
            const percent = Math.round((downloaded / totalLength) * 100);
            onProgress(percent);
        }
    });

    const writer = fs.createWriteStream(destPath);
    await streamPipeline(response.data, writer);

    const stats = await fs.stat(destPath);
    if (stats.size === 0) throw new Error("Downloaded file is empty");
}

async function extractTarGz(source, destination) {
    await fs.ensureDir(destination);
    await execFileAsync('tar', ['-xzf', source, '-C', destination]);
}

async function installJava(version, runtimesDir, onProgress) {
    console.log(`[JavaUtils] Installing Java ${version}`);
    if (onProgress) onProgress('Fetching release info...', 0);

    let osName = 'windows';
    let arch = 'x64';
    let ext = 'zip';

    switch (process.platform) {
        case 'win32': osName = 'windows'; ext = 'zip'; break;
        case 'darwin': osName = 'mac'; ext = 'tar.gz'; break;
        case 'linux': osName = 'linux'; ext = 'tar.gz'; break;
        default: throw new Error(`Unsupported platform: ${process.platform}`);
    }

    if (process.arch === 'arm64') arch = 'aarch64';
    const apiUrl = `${ADOPTIUM_API}/assets/feature_releases/${version}/ga?architecture=${arch}&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=${osName}`;
    console.log(`[JavaUtils] Querying: ${apiUrl}`);

    const res = await axios.get(apiUrl);
    if (!res.data || res.data.length === 0) {
        throw new Error(`No release found for Java ${version} on ${osName} (${arch})`);
    }

    const binary = res.data[0].binaries[0];
    const downloadUrl = binary.package.link;
    const fileName = binary.package.name;
    const releaseName = res.data[0].release_name;
    const javaBinName = process.platform === 'win32' ? 'java.exe' : 'java';
    await fs.ensureDir(runtimesDir);
    const tempPath = path.join(runtimesDir, fileName);

    await downloadFile(downloadUrl, tempPath, (percent) => {
        if (onProgress) onProgress(`Downloading Java ${version}...`, percent);
    });

    if (onProgress) onProgress('Extracting...', 100);

    if (fileName.endsWith('.zip')) {
        const zip = new AdmZip(tempPath);
        zip.extractAllTo(runtimesDir, true);
    } else if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        await extractTarGz(tempPath, runtimesDir);
    } else {
        throw new Error(`Unsupported archive format: ${fileName}`);
    }

    await fs.remove(tempPath);
    const subdirs = await fs.readdir(runtimesDir);
    for (const dir of subdirs) {
        const potentialPath = path.join(runtimesDir, dir, 'bin', javaBinName);

        if ((dir.includes(`jdk-${version}`) || dir.includes(`jre-${version}`) || dir === releaseName)) {
            if (await fs.pathExists(potentialPath)) {

                if (process.platform !== 'win32') {
                    await fs.chmod(potentialPath, 0o755);
                }
                return { success: true, path: potentialPath };
            }
        }
        if (await fs.pathExists(potentialPath)) {
            if (process.platform !== 'win32') {
                await fs.chmod(potentialPath, 0o755);
            }
            return { success: true, path: potentialPath };
        }
    }

    throw new Error(`Could not locate ${javaBinName} after extraction in ${runtimesDir}`);
}

module.exports = {
    installJava
};
