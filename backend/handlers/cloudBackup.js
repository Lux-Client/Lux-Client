const fs = require('fs-extra');
const axios = require('axios');
const crypto = require('crypto');
const Store = require('electron-store');
const { app, shell, BrowserWindow } = require('electron');
const path = require('path');

// OAuth client identifiers, injected at build time (see .github/workflows/*.yml).
// A desktop app cannot hold a secret - anything shipped in the binary can be read
// back out of it - so security here comes from PKCE instead: every login derives a
// one-time code_verifier that never leaves this machine, which makes an intercepted
// authorization code worthless on its own.
//
// Dropbox is a public PKCE client and has no secret at all.
// Google still requires a client_secret at the token endpoint even for "Desktop app"
// clients; their own docs note it "is obviously not treated as a secret" in that
// context. This MUST be a Desktop app client - a Web application client's secret is
// genuinely confidential and must never be shipped.
let injectedClients = {};
try {
    injectedClients = require('../generated/oauthClients');
} catch {
    // Local development: read from a .env in the repo root. That file is never
    // packaged, so this path does not exist in a released build.
    require('dotenv').config({ path: path.join(app.getAppPath(), '.env') });
}

const store = new Store();

const PROVIDERS = {
    GOOGLE_DRIVE: {
        name: 'Google Drive',
        clientId: injectedClients.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
        clientSecret: injectedClients.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/drive.file openid profile email',
        authParams: { access_type: 'offline', prompt: 'consent' }
    },
    DROPBOX: {
        name: 'Dropbox',
        clientId: injectedClients.DROPBOX_CLIENT_ID || process.env.DROPBOX_CLIENT_ID,
        clientSecret: null,
        authUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        scope: '',
        authParams: { token_access_type: 'offline' }
    }
};

const REDIRECT_URI = 'https://localhost/callback';

function base64Url(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function createPkcePair() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

class CloudBackupHandler {
    constructor(ipcMain, mainWindow) {
        this.ipcMain = ipcMain;
        this.mainWindow = mainWindow;
        this.registerHandlers();
    }

    registerHandlers() {
        this.ipcMain.handle('cloud:login', async (_, providerId) => {
            return await this.login(providerId);
        });

        this.ipcMain.handle('cloud:logout', async (_, providerId) => {
            return this.logout(providerId);
        });

        this.ipcMain.handle('cloud:get-status', async () => {
            return this.getStatus();
        });

        this.ipcMain.handle('cloud:list-backups', async (_, providerId, instanceName) => {
            return await this.listBackups(providerId, instanceName);
        });

        this.ipcMain.handle('cloud:upload', async (_, providerId, filePath, instanceName) => {
            return await this.uploadBackup(providerId, filePath, instanceName);
        });

        this.ipcMain.handle('cloud:download', async (_, providerId, fileId, targetPath) => {
            return await this.downloadBackup(providerId, fileId, targetPath);
        });
        const { app } = require('electron');
        app.on('backup:created', async ({ providerId, filePath, instanceName }) => {
            console.log(`[CloudBackup] Event received: backup:created for ${instanceName} to ${providerId}`);
            console.log(`[CloudBackup] Path: ${filePath}`);
            try {
                const result = await this.uploadBackup(providerId, filePath, instanceName);
                if (result.success) {
                    console.log(`[CloudBackup] Upload successful: ${instanceName}`);

                    try {
                        await fs.remove(filePath);
                        console.log(`[CloudBackup] Temporary local backup deleted: ${filePath}`);
                    } catch (cleanupErr) {
                        console.error(`[CloudBackup] Failed to delete temporary local backup:`, cleanupErr.message);
                    }
                } else {
                    console.error(`[CloudBackup] Upload failed: ${result.error}`);
                }
            } catch (err) {
                console.error(`[CloudBackup] Critical error during upload:`, err.message);
            }
        });
    }

    getStatus() {
        const cloudSettings = store.get('cloud_backups') || {};
        const status = {};
        for (const key in PROVIDERS) {
            status[key] = {
                loggedIn: !!cloudSettings[key]?.tokens,
                user: cloudSettings[key]?.user || null
            };
        }
        return status;
    }

    logout(providerId) {
        const cloudSettings = store.get('cloud_backups') || {};
        if (cloudSettings[providerId]) {
            delete cloudSettings[providerId];
            store.set('cloud_backups', cloudSettings);
            return { success: true };
        }
        return { success: false, error: 'Not logged in' };
    }

    async login(providerId) {
        const provider = PROVIDERS[providerId];
        if (!provider) return { success: false, error: 'Invalid provider' };
        if (!provider.clientId) {
            return { success: false, error: `${provider.name} is not configured in this build` };
        }

        const pkce = createPkcePair();
        const state = base64Url(crypto.randomBytes(16));

        return new Promise((resolve) => {
            const authWin = new BrowserWindow({
                width: 600,
                height: 800,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            const authParams = new URLSearchParams({
                client_id: provider.clientId,
                redirect_uri: REDIRECT_URI,
                response_type: 'code',
                code_challenge: pkce.challenge,
                code_challenge_method: 'S256',
                state,
                ...(provider.authParams || {})
            });

            if (provider.scope) {
                authParams.set('scope', provider.scope);
            }

            authWin.loadURL(`${provider.authUrl}?${authParams.toString()}`);
            authWin.show();

            const handleCallback = async (url) => {
                if (url.startsWith(REDIRECT_URI)) {
                    const urlParams = new URL(url).searchParams;
                    const code = urlParams.get('code');
                    const error = urlParams.get('error');

                    if (error) {
                        resolve({ success: false, error });
                        authWin.close();
                        return;
                    }

                    // Guards against a callback that did not originate from the
                    // request we just started.
                    if (urlParams.get('state') !== state) {
                        resolve({ success: false, error: 'Authentication failed: state mismatch' });
                        authWin.close();
                        return;
                    }

                    if (code) {
                        try {
                            const tokens = await this.exchangeCodeForTokens(providerId, code, pkce.verifier);
                            const user = await this.getUserInfo(providerId, tokens.access_token);

                            const cloudSettings = store.get('cloud_backups') || {};
                            cloudSettings[providerId] = {
                                tokens,
                                user,
                                lastLogin: Date.now()
                            };
                            store.set('cloud_backups', cloudSettings);

                            resolve({ success: true, user });
                        } catch (e) {
                            resolve({ success: false, error: e.message });
                        }
                        authWin.close();
                    }
                }
            };

            authWin.webContents.on('will-navigate', (event, url) => {
                handleCallback(url);
            });

            authWin.webContents.on('will-redirect', (event, url) => {
                handleCallback(url);
            });

            authWin.on('closed', () => {
                resolve({ success: false, error: 'Authentication canceled' });
            });
        });
    }

    async exchangeCodeForTokens(providerId, code, codeVerifier) {
        const provider = PROVIDERS[providerId];
        const params = new URLSearchParams();
        params.append('client_id', provider.clientId);
        params.append('code', code);
        params.append('code_verifier', codeVerifier);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('grant_type', 'authorization_code');

        // Only Google still demands one; Dropbox is a public PKCE client.
        if (provider.clientSecret) {
            params.append('client_secret', provider.clientSecret);
        }

        const response = await axios.post(provider.tokenUrl, params);
        return response.data;
    }

    async getUserInfo(providerId, accessToken) {
        try {
            if (providerId === 'GOOGLE_DRIVE') {
                const res = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                return { name: res.data.name, email: res.data.email };
            } else if (providerId === 'DROPBOX') {
                const res = await axios.post('https://api.dropboxapi.com/2/users/get_current_account', null, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                });
                return { name: res.data.name.display_name, email: res.data.email };
            }
        } catch (e) {
            console.error(`[CloudBackup] Failed to get user info for ${providerId}:`, e.message);
            return { name: 'Unknown User', email: '' };
        }
    }

    async refreshTokens(providerId) {
        const cloudSettings = store.get('cloud_backups') || {};
        const providerData = cloudSettings[providerId];
        if (!providerData || !providerData.tokens.refresh_token) return null;

        const provider = PROVIDERS[providerId];
        const params = new URLSearchParams();
        params.append('client_id', provider.clientId);
        params.append('refresh_token', providerData.tokens.refresh_token);
        params.append('grant_type', 'refresh_token');

        if (provider.clientSecret) {
            params.append('client_secret', provider.clientSecret);
        }

        try {
            const response = await axios.post(provider.tokenUrl, params);
            providerData.tokens = { ...providerData.tokens, ...response.data };
            cloudSettings[providerId] = providerData;
            store.set('cloud_backups', cloudSettings);
            return providerData.tokens.access_token;
        } catch (e) {
            console.error(`[CloudBackup] Token refresh failed for ${providerId}:`, e.message);
            return null;
        }
    }

    async getAccessToken(providerId) {
        const cloudSettings = store.get('cloud_backups') || {};
        const providerData = cloudSettings[providerId];
        if (!providerData) return null;
        return providerData.tokens.access_token;
    }

    async getOrCreateFolder(providerId, folderName, parentId = null) {
        let accessToken = await this.getAccessToken(providerId);
        if (!accessToken) return null;

        try {
            if (providerId === 'GOOGLE_DRIVE') {
                let q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
                if (parentId) q += ` and '${parentId}' in parents`;
                else q += ` and 'root' in parents`;

                const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: {
                        q,
                        fields: 'files(id)'
                    }
                });

                if (res.data.files && res.data.files.length > 0) {
                    return res.data.files[0].id;
                }

                const metadata = {
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder'
                };
                if (parentId) metadata.parents = [parentId];

                const createRes = await axios.post('https://www.googleapis.com/drive/v3/files', metadata, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                return createRes.data.id;
            }
            return null;
        } catch (e) {
            if (e.response?.status === 401) {
                console.log(`[CloudBackup] 401 in getOrCreateFolder for ${providerId}, refreshing token...`);
                accessToken = await this.refreshTokens(providerId);
                if (accessToken) {
                    return this.getOrCreateFolder(providerId, folderName, parentId);
                } else {
                    console.log(`[CloudBackup] Refresh failed, triggering auto-login for ${providerId}`);
                    const loginRes = await this.login(providerId);
                    if (loginRes.success) return this.getOrCreateFolder(providerId, folderName, parentId);
                }
            }
            console.error(`[CloudBackup] Error managing folder ${folderName}:`, e.message);
            return null;
        }
    }

    async uploadBackup(providerId, filePath, instanceName) {
        let accessToken = await this.getAccessToken(providerId);
        if (!accessToken) return { success: false, error: 'Not logged in' };

        const fileName = path.basename(filePath);

        try {
            if (providerId === 'GOOGLE_DRIVE') {
                const rootFolderId = await this.getOrCreateFolder(providerId, 'Lux_Backups');
                const instanceFolderId = await this.getOrCreateFolder(providerId, instanceName, rootFolderId);
                const fileContent = await fs.readFile(filePath);

                const boundary = '-------314159265358979323846';
                const delimiter = "\r\n--" + boundary + "\r\n";
                const close_delim = "\r\n--" + boundary + "--";

                const metadata = {
                    name: fileName,
                    parents: instanceFolderId ? [instanceFolderId] : (rootFolderId ? [rootFolderId] : [])
                };

                const multipartBody = Buffer.concat([
                    Buffer.from(delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata)),
                    Buffer.from(delimiter + 'Content-Type: application/zip\r\n\r\n'),
                    fileContent,
                    Buffer.from(close_delim)
                ]);

                const res = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', multipartBody, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': `multipart/related; boundary=${boundary}`
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
                return { success: true, fileId: res.data.id };

            } else if (providerId === 'DROPBOX') {
                const fileContent = await fs.readFile(filePath);
                const res = await axios.post('https://content.dropboxapi.com/2/files/upload', fileContent, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Dropbox-API-Arg': JSON.stringify({
                            path: `/Lux_Backups/${instanceName}/${fileName}`,
                            mode: 'overwrite',
                            autorename: true,
                            mute: false
                        }),
                        'Content-Type': 'application/octet-stream'
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
                return { success: true, fileId: res.data.id };
            }
        } catch (e) {
            if (e.response?.status === 401) {
                accessToken = await this.refreshTokens(providerId);
                if (accessToken) {
                    return this.uploadBackup(providerId, filePath, instanceName);
                } else {
                    console.log(`[CloudBackup] Refresh failed, triggering auto-login for ${providerId}`);
                    const loginRes = await this.login(providerId);
                    if (loginRes.success) return this.uploadBackup(providerId, filePath, instanceName);
                }
            }
            return { success: false, error: e.message };
        }
    }

    async listBackups(providerId, instanceName) {
        let accessToken = await this.getAccessToken(providerId);
        if (!accessToken) return { success: false, error: 'Not logged in' };

        try {
            if (providerId === 'GOOGLE_DRIVE') {
                const rootFolderId = await this.getOrCreateFolder(providerId, 'Lux_Backups');
                const instanceFolderId = await this.getOrCreateFolder(providerId, instanceName, rootFolderId);

                const q = instanceFolderId
                    ? `'${instanceFolderId}' in parents and trashed = false`
                    : "name contains '.zip' and trashed = false";

                const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: {
                        q,
                        fields: 'files(id, name, size, createdTime)',
                        orderBy: 'createdTime desc'
                    }
                });
                return { success: true, files: res.data.files };
            } else if (providerId === 'DROPBOX') {
                const res = await axios.post('https://api.dropboxapi.com/2/files/list_folder', {
                    path: `/Lux_Backups/${instanceName}`,
                    recursive: false
                }, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                return {
                    success: true,
                    files: res.data.entries.filter(f => f['.tag'] === 'file').map(f => ({
                        id: f.id,
                        name: f.name,
                        size: f.size,
                        createdTime: f.server_modified
                    })).sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
                };
            }
        } catch (e) {
            if (e.response?.status === 401) {
                accessToken = await this.refreshTokens(providerId);
                if (accessToken) {
                    return this.listBackups(providerId, instanceName);
                } else {
                    console.log(`[CloudBackup] Refresh failed, triggering auto-login for ${providerId}`);
                    const loginRes = await this.login(providerId);
                    if (loginRes.success) return this.listBackups(providerId, instanceName);
                }
            }
            return { success: false, error: e.message };
        }
    }

    async downloadBackup(providerId, fileId, targetPath) {
        let accessToken = await this.getAccessToken(providerId);
        if (!accessToken) return { success: false, error: 'Not logged in' };

        try {
            let url = '';
            let headers = { Authorization: `Bearer ${accessToken}` };

            if (providerId === 'GOOGLE_DRIVE') {
                url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            } else if (providerId === 'DROPBOX') {
                url = 'https://content.dropboxapi.com/2/files/download';
                headers['Dropbox-API-Arg'] = JSON.stringify({ path: fileId });
            }

            const response = await axios.get(url, {
                headers,
                responseType: 'arraybuffer'
            });

            await fs.writeFile(targetPath, response.data);
            return { success: true, path: targetPath };
        } catch (e) {
            if (e.response?.status === 401) {
                accessToken = await this.refreshTokens(providerId);
                if (accessToken) {
                    return this.downloadBackup(providerId, fileId, targetPath);
                } else {
                    console.log(`[CloudBackup] Refresh failed, triggering auto-login for ${providerId}`);
                    const loginRes = await this.login(providerId);
                    if (loginRes.success) return this.downloadBackup(providerId, fileId, targetPath);
                }
            }
            return { success: false, error: e.message };
        }
    }
}

module.exports = (ipcMain, mainWindow) => {
    return new CloudBackupHandler(ipcMain, mainWindow);
};