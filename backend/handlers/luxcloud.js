const { app } = require('electron');

const api = require('../luxcloud/api');
const auth = require('../luxcloud/auth');

function ok(payload = {}) {
    return { success: true, ...payload };
}

function fail(err) {
    if (err instanceof api.LuxCloudError) {
        return { success: false, error: err.code, message: err.message, details: err.details };
    }
    console.error('[LuxCloud] Unexpected handler error:', err);
    return { success: false, error: 'unknown_error', message: (err && err.message) || 'Unknown error' };
}

module.exports = (ipcMain, mainWindow) => {
    auth.events.on('account-changed', (payload) => {
        try {
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('luxcloud:account-changed', payload);
            }
        } catch (e) {
            console.warn('[LuxCloud] Could not deliver account-changed to the renderer:', e.message);
        }
    });

    ipcMain.handle('luxcloud:get-account', async () => {
        try {
            return ok({ account: await auth.getAccount() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:login', async () => {
        try {
            const account = await auth.login({ appVersion: app.getVersion() });
            return ok({ account });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:cancel-login', async () => {
        auth.cancelPendingLogin('Cancelled from the client');
        return ok();
    });

    ipcMain.handle('luxcloud:logout', async () => {
        try {
            return ok({ account: await auth.logout() });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:get-me', async () => {
        try {
            const me = await api.authed({ method: 'GET', url: '/api/cloud/me' });
            return ok({ me });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:update-settings', async (_event, patch) => {
        try {
            const result = await api.authed({
                method: 'PATCH',
                url: '/api/cloud/me/settings',
                data: patch || {}
            });
            return ok({ settings: result.settings });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:list-devices', async () => {
        try {
            const result = await api.authed({ method: 'GET', url: '/api/cloud/devices' });
            return ok({ devices: result.devices || [] });
        } catch (err) {
            return fail(err);
        }
    });

    ipcMain.handle('luxcloud:revoke-device', async (_event, deviceUuid) => {
        try {
            if (typeof deviceUuid !== 'string' || deviceUuid.length === 0) {
                return { success: false, error: 'invalid_request', message: 'Missing device id' };
            }

            const account = await auth.getAccount();
            await api.authed({
                method: 'DELETE',
                url: `/api/cloud/devices/${encodeURIComponent(deviceUuid)}`
            });

            if (account.device && account.device.uuid === deviceUuid) {
                await auth.handleRevocation({ code: 'device_revoked' });
            }
            return ok();
        } catch (err) {
            return fail(err);
        }
    });
};
