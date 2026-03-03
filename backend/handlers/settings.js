const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');

module.exports = (ipcMain) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const fontsDir = path.join(app.getPath('userData'), 'fonts');

    const defaultSettings = {
        javaPath: '',
        minMemory: 1024,
        maxMemory: 4096,
        resolutionWidth: 854,
        resolutionHeight: 480,
        enableDiscordRPC: true,
        showDisabledFeatures: false,
        copySettingsEnabled: false,
        copySettingsSourceInstance: '',
        optimization: true,
        focusMode: false,
        minimalMode: true,
        minimizeToTray: false,
        theme: {
            primaryColor: '#22e07a',
            backgroundColor: '#0d1117',
            surfaceColor: '#161b22',
            glassBlur: 10,
            glassOpacity: 0.8,
            consoleOpacity: 0.8,
            borderRadius: 12,
            sidebarGlow: 0,
            globalGlow: 0,
            panelOpacity: 0.85,
            bgOverlay: 0.4,
            autoAdaptColor: false,
            fontFamily: 'Poppins',
            customFonts: [],
            bgMedia: { url: '', type: 'none' }
        },
        backupSettings: {
            enabled: true,
            onLaunch: true,
            onClose: true,
            interval: 60,
            maxBackups: 10
        },
        language: 'en',
        hasAcceptedToS: false,
        hasSelectedLanguage: false
    };

    const buildSettings = (settings = {}) => ({
        ...defaultSettings,
        ...settings,
        theme: {
            ...defaultSettings.theme,
            ...(settings.theme || {})
        },
        backupSettings: {
            ...defaultSettings.backupSettings,
            ...(settings.backupSettings || {})
        }
    });

    const emitSettings = (settings) => {
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('theme:updated', settings.theme);
            win.webContents.send('settings:updated', settings);
        });
        app.emit('settings-updated', settings);
    };

    const readSettingsFile = async () => {
        if (await fs.pathExists(settingsPath)) {
            const settings = await fs.readJson(settingsPath);
            return buildSettings(settings);
        }
        return buildSettings();
    };

    const normalizeFontName = (filePath) => {
        const baseName = path.basename(filePath, path.extname(filePath)).trim();
        return (baseName || 'Custom Font').replace(/[_-]+/g, ' ');
    };

    ipcMain.handle('settings:get', async () => {
        try {
            if (await fs.pathExists(settingsPath)) {
                const settings = await fs.readJson(settingsPath);
                return { success: true, settings: buildSettings(settings) };
            }
            return { success: true, settings: buildSettings() };
        } catch (error) {
            console.error('Failed to get settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings:save', async (_, newSettings) => {
        try {
            const mergedSettings = buildSettings(newSettings);
            await fs.writeJson(settingsPath, mergedSettings, { spaces: 4 });
            emitSettings(mergedSettings);
            return { success: true };
        } catch (error) {
            console.error('Failed to save settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings:select-background', async () => {
        const { dialog } = require('electron');
        const res = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm'] }
            ]
        });

        if (res.canceled || res.filePaths.length === 0) return { success: false };

        const srcPath = res.filePaths[0];
        const ext = path.extname(srcPath).toLowerCase();
        const type = ['.mp4', '.webm'].includes(ext) ? 'video' : 'image';

        try {
            const backgroundsDir = path.join(app.getPath('userData'), 'backgrounds');
            await fs.ensureDir(backgroundsDir);

            const destName = `bg_${Date.now()}${ext}`;
            const destPath = path.join(backgroundsDir, destName);

            await fs.copy(srcPath, destPath);
            const normalizedPath = destPath.replace(/\\/g, '/');

            return {
                success: true,
                url: normalizedPath,
                type: type
            };
        } catch (error) {
            console.error('Failed to copy background:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings:delete-background', async (_, filePath) => {
        try {
            if (!filePath) return { success: false, error: 'No file path provided' };

            const backgroundsDir = path.join(app.getPath('userData'), 'backgrounds');
            const normalize = (p) => path.normalize(p).toLowerCase();
            if (!normalize(filePath).startsWith(normalize(backgroundsDir))) {
                console.error('Attempted to delete file outside backgrounds directory:', filePath);
                return { success: false, error: 'Invalid file path' };
            }

            if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
                return { success: true };
            }
            return { success: false, error: 'File not found' };

        } catch (error) {
            console.error('Failed to delete background:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings:select-font', async () => {
        const { dialog } = require('electron');
        const res = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
            ]
        });

        if (res.canceled || res.filePaths.length === 0) {
            return { success: false, error: 'Cancelled' };
        }

        const srcPath = res.filePaths[0];
        const ext = path.extname(srcPath).toLowerCase();
        const format = ext.replace('.', '');

        try {
            await fs.ensureDir(fontsDir);

            const fontId = `font_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const destPath = path.join(fontsDir, `${fontId}${ext}`);

            await fs.copy(srcPath, destPath);

            const settings = await readSettingsFile();
            const font = {
                id: fontId,
                name: normalizeFontName(srcPath),
                family: `CustomFont_${fontId}`,
                path: destPath.replace(/\\/g, '/'),
                format
            };

            const nextSettings = {
                ...settings,
                theme: {
                    ...settings.theme,
                    fontFamily: font.family,
                    customFonts: [...(settings.theme.customFonts || []), font]
                }
            };

            await fs.writeJson(settingsPath, nextSettings, { spaces: 4 });
            emitSettings(nextSettings);

            return { success: true, font, settings: nextSettings };
        } catch (error) {
            console.error('Failed to import font:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings:delete-font', async (_, fontId) => {
        try {
            const settings = await readSettingsFile();
            const customFonts = settings.theme.customFonts || [];
            const targetFont = customFonts.find(font => font.id === fontId);

            if (!targetFont) {
                return { success: false, error: 'Font not found' };
            }

            if (targetFont.path && await fs.pathExists(targetFont.path)) {
                await fs.remove(targetFont.path);
            }

            const nextSettings = {
                ...settings,
                theme: {
                    ...settings.theme,
                    fontFamily: settings.theme.fontFamily === targetFont.family ? 'Poppins' : settings.theme.fontFamily,
                    customFonts: customFonts.filter(font => font.id !== fontId)
                }
            };

            await fs.writeJson(settingsPath, nextSettings, { spaces: 4 });
            emitSettings(nextSettings);

            return { success: true, settings: nextSettings };
        } catch (error) {
            console.error('Failed to delete font:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('dialog:save-file', async (_, options) => {
        const { dialog } = require('electron');
        const res = await dialog.showSaveDialog(options);
        if (res.canceled) return null;
        return res.filePath;
    });
};
