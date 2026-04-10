const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { app } = require('electron');

async function downloadFile(url, destPath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: { 'User-Agent': 'LuxAGENT/1.0' },
        timeout: 10000
    });
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function downloadAndCacheIcon(iconUrl) {
    if (!iconUrl || typeof iconUrl !== 'string' || (!iconUrl.startsWith('http') && !iconUrl.startsWith('https'))) {
        return iconUrl;
    }
    try {
        const userData = app.getPath('userData');
        const iconCacheDir = path.join(userData, 'cache', 'modpack_icons');
        await fs.ensureDir(iconCacheDir);

        const hash = crypto.createHash('md5').update(iconUrl).digest('hex');
        let ext = '.png';
        try {
            const urlObj = new URL(iconUrl);
            const rawExt = path.extname(urlObj.pathname);
            if (rawExt && rawExt.length > 1 && rawExt.length < 6) {
                ext = rawExt;
            }
        } catch (_) { }

        const iconPath = path.join(iconCacheDir, `${hash}${ext}`);
        if (!await fs.pathExists(iconPath)) {
            await downloadFile(iconUrl, iconPath);
        }

        const normalizedPath = iconPath.replace(/\\/g, '/');
        const uri = `app-media:///${normalizedPath.replace(/^\/+/, '')}`;
        return uri;
    } catch (e) {
        console.warn(`[IconCache] Failed to cache icon (${iconUrl}), falling back:`, e.message);
        return iconUrl;
    }
}

module.exports = {
    downloadAndCacheIcon
};
