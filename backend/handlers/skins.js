const { app, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const crypto = require('crypto');

module.exports = (ipcMain, mainWindow) => {
    console.log('[SkinsHandler] Initializing...');
    const appData = app.getPath('userData');
    const skinsDir = path.join(appData, 'skins');
    const skinManifestPath = path.join(skinsDir, 'skins.json');
    fs.ensureDir(skinsDir).catch(err => console.error('[Skins] Failed to ensure skins dir:', err));

    async function getSkinManifest() {
        try {
            if (await fs.pathExists(skinManifestPath)) {
                return await fs.readJson(skinManifestPath);
            }
        } catch (e) {
            console.error('Failed to read skin manifest', e);
        }
        return { skins: [] };
    }

    async function saveSkinManifest(manifest) {
        try {
            await fs.writeJson(skinManifestPath, manifest, { spaces: 4 });
        } catch (e) {
            console.error('Failed to save skin manifest', e);
        }
    }

    function sanitizeSkinName(name, fallback = 'Skin') {
        const trimmed = `${name || ''}`.trim();
        return trimmed || fallback;
    }

    function sanitizeFileName(name, fallback = 'skin') {
        const sanitized = sanitizeSkinName(name, fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
        return sanitized || fallback;
    }

    function normalizeOptionalOutputPath(outputPath) {
        if (typeof outputPath !== 'string') {
            return null;
        }

        const trimmed = outputPath.trim();
        if (!trimmed) {
            return null;
        }

        if (path.extname(trimmed).toLowerCase() !== '.png') {
            return `${trimmed}.png`;
        }

        return trimmed;
    }

    function getSkinNameFromUrl(skinUrl) {
        try {
            const parsedUrl = new URL(skinUrl);
            const fileName = path.basename(parsedUrl.pathname, path.extname(parsedUrl.pathname));
            if (fileName) {
                return decodeURIComponent(fileName);
            }
            return parsedUrl.hostname.replace(/^www\./, '');
        } catch (e) {
            return 'Downloaded Skin';
        }
    }

    async function validateSkinBuffer(fileBuffer) {
        const image = nativeImage.createFromBuffer(fileBuffer);
        const size = image.getSize();
        if (!((size.width === 64 && size.height === 64) || (size.width === 64 && size.height === 32))) {
            throw new Error(`Invalid skin dimensions: ${size.width}x${size.height}. Must be 64x64 or 64x32.`);
        }
    }

    async function saveSkinBuffer(fileBuffer, name, extraData = {}, options = {}) {
        await validateSkinBuffer(fileBuffer);

        const hash = crypto.createHash('sha1').update(fileBuffer).digest('hex');
        const destPath = path.join(skinsDir, `${hash}.png`);

        await fs.writeFile(destPath, fileBuffer);

        const manifest = await getSkinManifest();
        let skin = manifest.skins.find(s => s.id === hash);
        let changed = false;

        if (!skin) {
            skin = {
                id: hash,
                path: destPath,
                added: Date.now(),
                name: sanitizeSkinName(name),
                ...extraData
            };
            manifest.skins.push(skin);
            changed = true;
        } else {
            if (skin.path !== destPath) {
                skin.path = destPath;
                changed = true;
            }
            if (!skin.name) {
                skin.name = sanitizeSkinName(name);
                changed = true;
            }
            if (extraData.model && skin.model !== extraData.model) {
                skin.model = extraData.model;
                changed = true;
            }
        }

        if (changed) {
            await saveSkinManifest(manifest);
        }

        const outputPath = normalizeOptionalOutputPath(options.outputPath);
        if (outputPath) {
            await fs.ensureDir(path.dirname(outputPath));
            await fs.writeFile(outputPath, fileBuffer);
        }

        return {
            success: true,
            skin: {
                ...skin,
                data: `data:image/png;base64,${fileBuffer.toString('base64')}`
            },
            savedToPath: outputPath || undefined
        };
    }

    async function fetchSkinBuffer(skinUrl) {
        const response = await axios.get(skinUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 5 * 1024 * 1024
        });
        return Buffer.from(response.data);
    }

    async function resolveSkinFromUsername(username) {
        const trimmedUsername = `${username || ''}`.trim();
        if (!trimmedUsername) {
            throw new Error('No username provided');
        }

        const profileResponse = await axios.get(
            `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(trimmedUsername)}`,
            {
                timeout: 30000,
                validateStatus: status => status === 200 || status === 204
            }
        );

        if (profileResponse.status === 204 || !profileResponse.data?.id) {
            throw new Error('Minecraft username not found');
        }

        const sessionResponse = await axios.get(
            `https://sessionserver.mojang.com/session/minecraft/profile/${profileResponse.data.id}`,
            { timeout: 30000 }
        );

        const textureProperty = (sessionResponse.data?.properties || []).find(property => property.name === 'textures');
        if (!textureProperty?.value) {
            throw new Error('No skin data found for username');
        }

        const decodedTextures = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8'));
        const skinUrl = decodedTextures?.textures?.SKIN?.url;
        if (!skinUrl) {
            throw new Error('No skin data found for username');
        }

        return {
            name: profileResponse.data.name || trimmedUsername,
            skinUrl,
            model: decodedTextures?.textures?.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic'
        };
    }
    ipcMain.handle('skin:get-current', async (_, token) => {
        try {
            if (!token) return { success: false, error: 'No token provided' };
            const { getCachedProfile, clearCache } = require('../utils/profileCache');
            const data = await getCachedProfile(token);

            const skins = data.skins || [];
            const currentSkin = skins.find(s => s.state === 'ACTIVE');

            if (currentSkin) {
                return {
                    success: true,
                    url: currentSkin.url,
                    variant: currentSkin.variant,
                    capes: data.capes || []
                };
            }
            return { success: false, error: 'No active skin found', capes: data.capes || [] };
        } catch (e) {
            console.error('Failed to fetch current skin:', e.response?.data || e.message);
            if (e.response?.status === 401) {
                return { success: false, error: 'Unauthorized', authError: true };
            }
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('skin:upload', async (_, token, skinPath, variant = 'classic') => {
        try {
            if (!token) return { success: false, error: 'No token provided' };
            if (!await fs.pathExists(skinPath)) return { success: false, error: 'Skin file not found' };
            const FormData = require('form-data');
            const form = new FormData();
            form.append('variant', variant);
            form.append('file', fs.createReadStream(skinPath));

            const res = await axios.post('https://api.minecraftservices.com/minecraft/profile/skins', form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...form.getHeaders()
                },
                timeout: 30000
            });
            const { clearCache } = require('../utils/profileCache');
            clearCache(token);

            return { success: true };
        } catch (e) {
            console.error('Failed to upload skin:', e.response?.data || e.message);
            if (e.response?.status === 401) {
                return { success: false, error: 'Unauthorized', authError: true };
            }
            return { success: false, error: e.response?.data?.errorMessage || e.message };
        }
    });
    ipcMain.handle('skin:upload-from-url', async (_, token, skinUrl, variant = 'classic') => {
        try {
            if (!token) return { success: false, error: 'No token provided' };
            if (!skinUrl) return { success: false, error: 'No URL provided' };
            const skinBuffer = await fetchSkinBuffer(skinUrl);
            await validateSkinBuffer(skinBuffer);
            const FormData = require('form-data');
            const form = new FormData();
            form.append('variant', variant);
            form.append('file', skinBuffer, {
                filename: 'skin.png',
                contentType: 'image/png'
            });

            await axios.post('https://api.minecraftservices.com/minecraft/profile/skins', form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...form.getHeaders()
                }
            });

            const { clearCache } = require('../utils/profileCache');
            clearCache(token);

            return { success: true };
        } catch (e) {
            console.error('Failed to upload skin from URL:', e.response?.data || e.message);
            if (e.response?.status === 401) {
                return { success: false, error: 'Unauthorized', authError: true };
            }
            return { success: false, error: e.response?.data?.errorMessage || e.message };
        }
    });
    ipcMain.handle('skin:set-cape', async (_, token, capeId) => {
        try {
            if (!token) return { success: false, error: 'No token provided' };

            if (capeId) {

                await axios.put(
                    'https://api.minecraftservices.com/minecraft/profile/capes/active',
                    { capeId },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
            } else {

                await axios.delete(
                    'https://api.minecraftservices.com/minecraft/profile/capes/active',
                    { headers: { Authorization: `Bearer ${token}` } }
                );
            }
            return { success: true };
        } catch (e) {
            console.error('Failed to set cape:', e.response?.data || e.message);
            return { success: false, error: e.response?.data?.errorMessage || e.message };
        }
    });
    ipcMain.handle('skin:save-local', async (_, filePath) => {
        try {
            if (filePath && typeof filePath === 'object' && !Buffer.isBuffer(filePath)) {
                const source = `${filePath.source || ''}`.trim();
                const value = `${filePath.value || ''}`.trim();

                console.log('[Skin:save-local] Received payload:', { source, valueLength: value.length, valuePreview: value.substring(0, 100) });

                if (source === 'url' || source.startsWith('http')) {
                    if (!value) return { success: false, error: 'No URL provided' };
                    const fileBuffer = await fetchSkinBuffer(value);
                    return await saveSkinBuffer(fileBuffer, getSkinNameFromUrl(value), {}, { outputPath: filePath.outputPath });
                }

                if (source === 'username') {
                    if (!value) return { success: false, error: 'No username provided' };
                    const resolvedSkin = await resolveSkinFromUsername(value);
                    const fileBuffer = await fetchSkinBuffer(resolvedSkin.skinUrl);
                    return await saveSkinBuffer(
                        fileBuffer,
                        resolvedSkin.name,
                        { model: resolvedSkin.model },
                        { outputPath: filePath.outputPath }
                    );
                }

                if (value) {
                    let base64Payload = value;
                    
                    const dataUrlMatch = value.match(/^data:image\/png;base64,(.+)$/i);
                    if (dataUrlMatch && dataUrlMatch[1]) {
                        base64Payload = dataUrlMatch[1];
                    }

                    if (/^[A-Za-z0-9+/=]+$/.test(base64Payload) && base64Payload.length > 100) {
                        try {
                            const fileBuffer = Buffer.from(base64Payload, 'base64');
                            if (fileBuffer && fileBuffer.length > 0) {
                                const model = filePath.model === 'slim' ? 'slim' : (filePath.model === 'classic' ? 'classic' : undefined);
                                const extraData = model ? { model } : {};
                                return await saveSkinBuffer(fileBuffer, filePath.name || 'Skin', extraData, { outputPath: filePath.outputPath });
                            }
                        } catch (e) {
                            console.error('[Skin] Base64 parse error:', e.message);
                        }
                    }
                }

                return { success: false, error: 'Invalid skin data. Please try again.' };
            }

            if (filePath && typeof filePath !== 'string') {
                return { success: false, error: 'Invalid skin file path' };
            }

            let sourcePath = filePath;
            if (!sourcePath) {
                const { canceled, filePaths } = await dialog.showOpenDialog({
                    properties: ['openFile'],
                    filters: [{ name: 'Images', extensions: ['png'] }]
                });
                if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
                sourcePath = filePaths[0];
            }
            const fileBuffer = await fs.readFile(sourcePath);
            return await saveSkinBuffer(fileBuffer, path.basename(sourcePath, path.extname(sourcePath)));
        } catch (e) {
            console.error('Failed to save local skin:', e);
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('skin:save-local-from-url', async (_, skinUrl) => {
        try {
            if (!skinUrl) return { success: false, error: 'No URL provided' };
            const fileBuffer = await fetchSkinBuffer(skinUrl);
            return await saveSkinBuffer(fileBuffer, getSkinNameFromUrl(skinUrl));
        } catch (e) {
            console.error('Failed to save local skin from URL:', e.response?.data || e.message);
            return { success: false, error: e.response?.data?.errorMessage || e.message };
        }
    });
    ipcMain.handle('skin:save-local-from-username', async (_, username) => {
        try {
            const resolvedSkin = await resolveSkinFromUsername(username);
            const fileBuffer = await fetchSkinBuffer(resolvedSkin.skinUrl);
            return await saveSkinBuffer(fileBuffer, resolvedSkin.name, { model: resolvedSkin.model });
        } catch (e) {
            console.error('Failed to save local skin from username:', e.response?.data || e.message);
            return { success: false, error: e.response?.data?.errorMessage || e.message };
        }
    });
    ipcMain.handle('skin:get-local', async () => {
        try {
            const manifest = await getSkinManifest();

            const validSkins = [];
            for (const skin of manifest.skins) {
                if (await fs.pathExists(skin.path)) {

                    try {
                        const buffer = await fs.readFile(skin.path);
                        skin.data = `data:image/png;base64,${buffer.toString('base64')}`;
                        validSkins.push(skin);
                    } catch (e) {
                        console.error(`Failed to read skin file ${skin.path}`, e);
                    }
                }
            }

            if (validSkins.length !== manifest.skins.length) {
                manifest.skins = validSkins.map(s => ({ ...s, data: undefined }));
                await saveSkinManifest(manifest);
            }
            return validSkins;
        } catch (e) {
            console.error('Failed to get local skins:', e);
            return [];
        }
    });
    ipcMain.handle('skin:delete-local', async (_, id) => {
        try {
            const manifest = await getSkinManifest();
            const skinIndex = manifest.skins.findIndex(s => s.id === id);

            if (skinIndex !== -1) {
                const skin = manifest.skins[skinIndex];
                await fs.remove(skin.path);
                manifest.skins.splice(skinIndex, 1);
                await saveSkinManifest(manifest);
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('skin:export-local', async (_, id) => {
        try {
            const manifest = await getSkinManifest();
            const skin = manifest.skins.find(s => s.id === id);
            if (!skin) {
                return { success: false, error: 'Skin not found' };
            }
            if (!await fs.pathExists(skin.path)) {
                return { success: false, error: 'Skin file not found' };
            }

            const downloadsDir = app.getPath('downloads');
            const baseName = sanitizeFileName(skin.name);
            let fileName = `${baseName}.png`;
            let destinationPath = path.join(downloadsDir, fileName);
            let duplicateIndex = 1;

            while (await fs.pathExists(destinationPath)) {
                fileName = `${baseName} (${duplicateIndex}).png`;
                destinationPath = path.join(downloadsDir, fileName);
                duplicateIndex += 1;
            }

            await fs.copy(skin.path, destinationPath, { overwrite: false, errorOnExist: true });
            return { success: true, path: destinationPath };
        } catch (e) {
            console.error('Failed to export local skin:', e);
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('skin:rename-local', async (_, id, newName) => {
        try {
            const manifest = await getSkinManifest();
            const skin = manifest.skins.find(s => s.id === id);
            if (skin) {
                skin.name = newName;
                await saveSkinManifest(manifest);
                return { success: true };
            }
            return { success: false, error: 'Skin not found' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
};
