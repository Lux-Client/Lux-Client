const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const axios = require('axios');
const { app, dialog } = require('electron');
const { resolveInstanceDirByName } = require('../utils/instances-path');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const DEFAULT_MODRINTH_PROJECT_ID = 'rkT8RY3X';

function safeFileName(name) {
    const normalized = String(name || '').trim();
    const fallback = 'resourcepack';
    const base = (normalized || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);

    return base || fallback;
}

function flattenDescriptionNode(node) {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(flattenDescriptionNode).join('');
    if (node && typeof node === 'object') {
        const text = typeof node.text === 'string' ? node.text : '';
        const extra = node.extra ? flattenDescriptionNode(node.extra) : '';
        return `${text}${extra}`;
    }
    return '';
}

function parsePackMeta(zip) {
    const entry = zip.getEntry('pack.mcmeta');
    if (!entry) {
        return {
            title: '',
            author: '',
            description: '',
            packFormat: 15
        };
    }

    try {
        const parsed = JSON.parse(entry.getData().toString('utf8'));
        const pack = parsed?.pack || {};
        const description = flattenDescriptionNode(pack.description || '').trim();

        let title = '';
        let author = '';
        let cleanDescription = description;

        // Very small convenience parser for descriptions formatted as "Title - by Author".
        const firstLine = description.split(/\r?\n/)[0] || '';
        const match = firstLine.match(/^(.*?)\s*(?:-|:)\s*by\s+(.+)$/i);
        if (match) {
            title = match[1].trim();
            author = match[2].trim();
            cleanDescription = description;
        }

        return {
            title,
            author,
            description: cleanDescription,
            packFormat: Number(pack.pack_format) || 15
        };
    } catch (error) {
        console.warn('[Texturepacks] Failed to parse pack.mcmeta:', error.message);
        return {
            title: '',
            author: '',
            description: '',
            packFormat: 15
        };
    }
}

function makeMcmetaJson({ title, author, description, packFormat }) {
    const titleValue = String(title || '').trim();
    const authorValue = String(author || '').trim();
    const descriptionValue = String(description || '').trim();

    const descParts = [];
    if (titleValue && authorValue) {
        descParts.push(`${titleValue} by ${authorValue}`);
    } else if (titleValue) {
        descParts.push(titleValue);
    }
    if (descriptionValue) {
        descParts.push(descriptionValue);
    }

    const packDescription = descParts.join('\n').trim() || 'Edited resource pack';

    return {
        pack: {
            pack_format: Number(packFormat) || 15,
            description: packDescription
        }
    };
}

function pngDataUrlToBuffer(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('Invalid PNG data URL');
    }

    const base64 = dataUrl.split(',')[1] || '';
    return Buffer.from(base64, 'base64');
}

function findTextureEntries(zip) {
    const entries = zip.getEntries();

    return entries
        .filter((entry) => {
            if (entry.isDirectory) return false;
            const normalized = entry.entryName.replace(/\\/g, '/').toLowerCase();
            if (!normalized.endsWith('.png')) return false;
            return normalized.includes('/textures/block/') || normalized.includes('/textures/item/');
        })
        .map((entry) => {
            const normalized = entry.entryName.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const assetsIndex = parts.indexOf('assets');
            const namespace = assetsIndex >= 0 && parts[assetsIndex + 1] ? parts[assetsIndex + 1] : 'minecraft';
            const type = normalized.toLowerCase().includes('/textures/item/') ? 'item' : 'block';
            const fileName = path.basename(normalized, '.png');
            const dataUrl = `data:image/png;base64,${entry.getData().toString('base64')}`;

            return {
                id: normalized,
                entryPath: normalized,
                namespace,
                type,
                name: fileName,
                dataUrl
            };
        })
        .sort((a, b) => {
            const byType = a.type.localeCompare(b.type);
            if (byType !== 0) return byType;
            const byName = a.name.localeCompare(b.name);
            if (byName !== 0) return byName;
            return a.entryPath.localeCompare(b.entryPath);
        });
}

async function fetchDefaultPackZipPath(projectId) {
    const targetProjectId = String(projectId || DEFAULT_MODRINTH_PROJECT_ID).trim() || DEFAULT_MODRINTH_PROJECT_ID;

    const versionsResponse = await axios.get(`${MODRINTH_API}/project/${targetProjectId}/version`, {
        timeout: 30000,
        headers: {
            'User-Agent': 'LuxClient/1.0 (TexturepackEditor)'
        }
    });

    const versions = Array.isArray(versionsResponse.data) ? versionsResponse.data : [];
    const selectedVersion = versions[0];
    if (!selectedVersion || !Array.isArray(selectedVersion.files)) {
        throw new Error('No downloadable version found for default project');
    }

    const zipFile = selectedVersion.files.find((file) => file?.primary && String(file?.filename || '').toLowerCase().endsWith('.zip'))
        || selectedVersion.files.find((file) => String(file?.filename || '').toLowerCase().endsWith('.zip'));

    if (!zipFile?.url) {
        throw new Error('No ZIP file found in default project version');
    }

    const tempDir = path.join(app.getPath('temp'), 'lux-texturepacks');
    await fs.ensureDir(tempDir);

    const tempZipPath = path.join(tempDir, `${targetProjectId}-${Date.now()}.zip`);
    const fileResponse = await axios.get(zipFile.url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'LuxClient/1.0 (TexturepackEditor)'
        }
    });

    await fs.writeFile(tempZipPath, Buffer.from(fileResponse.data));
    return {
        zipPath: tempZipPath,
        versionName: selectedVersion.name || selectedVersion.version_number || 'Default Pack',
        projectId: targetProjectId
    };
}

async function loadPackFromZip(zipPath) {
    const resolvedPath = path.resolve(String(zipPath || ''));
    if (!resolvedPath || !await fs.pathExists(resolvedPath)) {
        throw new Error('ZIP file was not found');
    }

    const zip = new AdmZip(resolvedPath);
    const textures = findTextureEntries(zip);
    const meta = parsePackMeta(zip);

    return {
        sourceZipPath: resolvedPath,
        sourceZipName: path.basename(resolvedPath),
        textures,
        packMeta: meta
    };
}

module.exports = (ipcMain, mainWindow) => {
    ipcMain.handle('texturepack:load-zip', async (_event, options = {}) => {
        try {
            let zipPath = options?.zipPath ? String(options.zipPath) : '';

            if (!zipPath) {
                const result = await dialog.showOpenDialog(mainWindow, {
                    title: 'Select resource pack ZIP',
                    properties: ['openFile'],
                    filters: [{ name: 'ZIP files', extensions: ['zip'] }]
                });

                if (result.canceled || !result.filePaths?.[0]) {
                    return { success: false, cancelled: true };
                }

                zipPath = result.filePaths[0];
            }

            const data = await loadPackFromZip(zipPath);
            return { success: true, ...data, source: 'file' };
        } catch (error) {
            console.error('[Texturepacks] load-zip failed:', error);
            return { success: false, error: error.message || 'Failed to load ZIP' };
        }
    });

    ipcMain.handle('texturepack:load-default', async (_event, projectId = DEFAULT_MODRINTH_PROJECT_ID) => {
        try {
            const download = await fetchDefaultPackZipPath(projectId);
            const data = await loadPackFromZip(download.zipPath);

            return {
                success: true,
                ...data,
                source: 'modrinth',
                modrinthProjectId: download.projectId,
                modrinthVersionName: download.versionName
            };
        } catch (error) {
            console.error('[Texturepacks] load-default failed:', error);
            return { success: false, error: error.message || 'Failed to load default pack' };
        }
    });

    ipcMain.handle('texturepack:export', async (_event, payload = {}) => {
        try {
            const sourceZipPath = String(payload?.sourceZipPath || '');
            if (!sourceZipPath) {
                return { success: false, error: 'No source ZIP loaded' };
            }

            if (!await fs.pathExists(sourceZipPath)) {
                return { success: false, error: 'Source ZIP does not exist anymore. Please reload the pack.' };
            }

            const replacements = payload?.replacements && typeof payload.replacements === 'object'
                ? payload.replacements
                : {};

            const title = String(payload?.title || '').trim();
            const author = String(payload?.author || '').trim();
            const description = String(payload?.description || '').trim();

            if (!title || !author || !description) {
                return { success: false, error: 'Title, author and description are required.' };
            }

            let exportFolder = String(payload?.exportFolder || '').trim();
            if (!exportFolder) {
                const folderResult = await dialog.showOpenDialog(mainWindow, {
                    title: 'Choose export folder',
                    properties: ['openDirectory', 'createDirectory']
                });

                if (folderResult.canceled || !folderResult.filePaths?.[0]) {
                    return { success: false, cancelled: true };
                }

                exportFolder = folderResult.filePaths[0];
            }

            const sourceZip = new AdmZip(sourceZipPath);
            const meta = parsePackMeta(sourceZip);

            for (const [entryPath, dataUrl] of Object.entries(replacements)) {
                if (typeof dataUrl !== 'string' || !entryPath) continue;
                const buffer = pngDataUrlToBuffer(dataUrl);
                sourceZip.deleteFile(entryPath);
                sourceZip.addFile(entryPath, buffer);
            }

            const mcmetaObj = makeMcmetaJson({
                title,
                author,
                description,
                packFormat: meta.packFormat
            });
            sourceZip.deleteFile('pack.mcmeta');
            sourceZip.addFile('pack.mcmeta', Buffer.from(`${JSON.stringify(mcmetaObj, null, 2)}\n`, 'utf8'));

            await fs.ensureDir(exportFolder);
            const fileName = `${safeFileName(title)}.zip`;
            const outputPath = path.join(exportFolder, fileName);
            sourceZip.writeZip(outputPath);

            const targetInstanceName = String(payload?.instanceName || '').trim();
            let instanceInstallPath = null;
            if (targetInstanceName) {
                const instanceDir = resolveInstanceDirByName(targetInstanceName);
                if (!instanceDir) {
                    return { success: false, error: `Instance not found: ${targetInstanceName}` };
                }

                const resourcepacksDir = path.join(instanceDir, 'resourcepacks');
                await fs.ensureDir(resourcepacksDir);
                const targetPath = path.join(resourcepacksDir, fileName);
                await fs.copy(outputPath, targetPath, { overwrite: true });
                instanceInstallPath = targetPath;
            }

            return {
                success: true,
                outputPath,
                fileName,
                instanceInstallPath
            };
        } catch (error) {
            console.error('[Texturepacks] export failed:', error);
            return { success: false, error: error.message || 'Export failed' };
        }
    });
};
