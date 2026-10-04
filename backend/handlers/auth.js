const { Auth, wrapError } = require('msmc');
const Store = require('electron-store');
const store = new Store();
const { getUserProfile, setUserProfile, getAccounts, setAccounts } = require('../utils/secureProfileStore');
const { ensureValidSession } = require('../utils/minecraftSession');

const authManager = new Auth('select_account');

module.exports = (ipcMain, mainWindow) => {
    ipcMain.handle('auth:login', async () => {
        try {
            const electron = require('electron');
            const BrowserWindow = electron.BrowserWindow || electron.remote.BrowserWindow;
            
            const xboxManager = await new Promise((resolve, reject) => {
                const redirectUri = authManager.token.redirect;
                const authUrl = authManager.createLink();
                
                const win = new BrowserWindow({
                    width: 500,
                    height: 650,
                    resizable: false,
                    title: 'Microsoft Login',
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    }
                });
                
                win.setMenu(null);
                win.loadURL(authUrl);
                
                let isResolved = false;
                
                const handleUrl = async (url) => {
                    if (isResolved) return;
                    if (url.startsWith(redirectUri)) {
                        isResolved = true;
                        const urlObj = new URL(url);
                        const code = urlObj.searchParams.get('code');
                        
                        try {
                            if (code) {
                                const mgr = await authManager.login(code);
                                resolve(mgr);
                            } else {
                                reject(new Error('No code present in redirect URL'));
                            }
                        } catch (err) {
                            reject(err);
                        } finally {
                            if (!win.isDestroyed()) {
                                win.close();
                            }
                        }
                    }
                };
                
                win.webContents.on('will-redirect', (event, url) => {
                    handleUrl(url);
                });
                
                win.webContents.on('did-navigate', (event, url) => {
                    handleUrl(url);
                });
                
                win.on('closed', () => {
                    if (!isResolved) {
                        reject(new Error('Login window closed by user'));
                    }
                });
            });

            let token;
            try {
                token = await xboxManager.getMinecraft();
            } catch (innerError) {
                if (innerError && innerError.ts === 'error.auth.minecraft.profile' && innerError.response?.status === 404) {
                    throw new Error('This Microsoft account does not own Minecraft Java Edition. Please sign in with an account that owns it.');
                }
                throw innerError;
            }

            if (typeof token.isDemo === 'function' && token.isDemo()) {
                throw new Error('This Microsoft account does not own Minecraft Java Edition. Please sign in with an account that owns it.');
            }

            let name, uuid, accessToken;

            if (token.profile) {
                name = token.profile.name;
                uuid = token.profile.id;
                accessToken = token.mcToken || token.access_token;
            } else if (token.name && token.uuid) {
                name = token.name;
                uuid = token.uuid;
                accessToken = token.mcToken || token.access_token;
            } else {
                const luxAuth = token.lux ? token.lux() : null;
                if (luxAuth) {
                    name = luxAuth.name;
                    uuid = luxAuth.uuid;
                    accessToken = luxAuth.access_token;
                } else {
                    throw new Error("Unable to parse authentication token");
                }
            }

            if (!name || !uuid || !accessToken) {
                throw new Error("Missing required auth fields");
            }
            const refreshToken = xboxManager.save();
            const xuid = token.xuid || '';

            const profile = {
                name,
                uuid,
                access_token: accessToken,
                refresh_token: refreshToken,
                exp: token.exp,
                xuid
            };
            let accounts = getAccounts(store);
            const existingIndex = accounts.findIndex(a => a.uuid === uuid);
            if (existingIndex !== -1) {
                accounts[existingIndex] = profile;
            } else {
                accounts.push(profile);
            }

            setAccounts(store, accounts);
            setUserProfile(store, profile);

            mainWindow.webContents.send('auth:success', { name, uuid });
            return { success: true, profile: { name, uuid } };
        } catch (e) {
            console.error("Login failed:", e);
            let errorMessage = 'Login failed';
            if (e instanceof Error && e.message) {
                errorMessage = e.message;
            } else if (e && typeof e === 'object') {
                if (e.ts) {
                    errorMessage = wrapError(e).message || errorMessage;
                } else if (e.message) {
                    errorMessage = e.message;
                }
            } else if (typeof e === 'string') {
                errorMessage = e;
            }
            return { success: false, error: errorMessage };
        }
    });

    ipcMain.handle('auth:validate', async () => {
        const profile = getUserProfile(store);
        if (!profile || !profile.access_token) return { success: false, error: 'Not logged in' };

        try {
            const { refreshed } = await ensureValidSession(store);
            return refreshed ? { success: true, refreshed: true } : { success: true };
        } catch (e) {
            console.error("Validation/Refresh failed:", e.message);

            if (!e.authRejected) {
                // Netzwerkfehler o.ae.: Account nicht abmelden, beim naechsten Mal erneut versuchen.
                return { success: true, offline: true };
            }

            store.delete('user_profile');
            return { success: false, error: 'Session expired', loggedOut: true };
        }
    });

    ipcMain.handle('auth:get-profile', () => {
        return getUserProfile(store);
    });

    ipcMain.handle('auth:get-accounts', () => {
        const accounts = getAccounts(store);

        return accounts.map(a => ({ name: a.name, uuid: a.uuid }));
    });

    ipcMain.handle('auth:switch-account', (_, uuid) => {
        const accounts = getAccounts(store);
        const account = accounts.find(a => a.uuid === uuid);
        if (account) {
            setUserProfile(store, account);
            return { success: true, profile: { name: account.name, uuid: account.uuid } };
        }
        return { success: false, error: 'Account not found' };
    });

    ipcMain.handle('auth:remove-account', (_, uuid) => {
        let accounts = getAccounts(store);
        accounts = accounts.filter(a => a.uuid !== uuid);
        setAccounts(store, accounts);
        const current = getUserProfile(store);
        if (current && current.uuid === uuid) {
            store.delete('user_profile');
            return { success: true, loggedOut: true };
        }
        return { success: true, loggedOut: false };
    });

    ipcMain.handle('auth:logout', () => {
        const profile = getUserProfile(store);
        if (profile && profile.access_token) {
            try {
                const { clearCache } = require('../utils/profileCache');
                clearCache(profile.access_token);
            } catch (e) { }
        }
        store.delete('user_profile');
        return { success: true };
    });
};