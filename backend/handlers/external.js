const { shell } = require('electron');
const fs = require('fs-extra');

function isAllowedExternalProtocol(protocol) {
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
}

module.exports = (ipcMain) => {

    ipcMain.handle('open-external', async (_event, url) => {
        try {
            if (!url || typeof url !== 'string') {
                return { success: false, error: 'Invalid URL' };
            }

            let parsed;
            try {
                parsed = new URL(url);
            } catch {
                return { success: false, error: 'Malformed URL' };
            }

            if (!isAllowedExternalProtocol(parsed.protocol)) {
                return { success: false, error: 'Blocked URL protocol' };
            }

            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('external:run-file', async (_event, filePath) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                return { success: false, error: 'Invalid path' };
            }

            const normalizedPath = filePath.trim();
            if (!normalizedPath) {
                return { success: false, error: 'Path is empty' };
            }

            const exists = await fs.pathExists(normalizedPath);
            if (!exists) {
                return { success: false, error: 'File does not exist' };
            }

            const stat = await fs.stat(normalizedPath);
            if (!stat.isFile()) {
                return { success: false, error: 'Path is not a file' };
            }

            const openResult = await shell.openPath(normalizedPath);
            if (openResult) {
                return { success: false, error: openResult };
            }

            return { success: true };
        } catch (error) {
            console.error('Error running external file:', error);
            return { success: false, error: error.message };
        }
    });
};