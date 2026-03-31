const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

let DiscordRPC = null;
try {
    DiscordRPC = require('discord-rpc');
} catch (e) {
    console.error('Failed to load discord-rpc module', e);
}

const clientId = '1469842361830866985';

let rpc = null;
let isReady = false;
let isEnabled = true;

const loadSettings = async () => {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        if (await fs.pathExists(settingsPath)) {
            const settings = await fs.readJson(settingsPath);
            isEnabled = settings.enableDiscordRPC !== false;
        }
    } catch (e) {
        console.error('Failed to load settings for Discord RPC', e);
    }
};

const initRPC = async () => {
    await loadSettings();
    if (!isEnabled || !DiscordRPC) return;

    try {
        if (rpc) await stopRPC();

        rpc = new DiscordRPC.Client({ transport: 'ipc' });

        rpc.on('ready', () => {
            console.log('Discord RPC Ready');
            isReady = true;
            setActivity('In Launcher', 'Idle');
        });

        rpc.on('disconnected', () => {
            isReady = false;
            rpc = null;
        });

        await rpc.login({ clientId }).catch(e => {
            console.error('Discord RPC Login failed', e);
            isReady = false;
            rpc = null;
        });
    } catch (e) {
        console.error('Failed to init Discord RPC', e);
    }
};

const stopRPC = async () => {
    isReady = false;

    if (rpc) {
        try {
            rpc.clearActivity();
        } catch (e) {
            console.error('Failed to clear activity', e);
        }

        try {
            const currentRpc = rpc;
            rpc = null;
            await currentRpc.destroy();
        } catch (e) {
            console.error('Failed to destroy RPC launcher', e);
        }
    }
};

const setActivity = (details, state, largeImageKey = 'lux_icon', largeImageText = 'Lux Client', startTimestamp = null) => {
    if (!isEnabled || !rpc || !isReady) return;

    try {
        rpc.setActivity({
            details,
            state,
            startTimestamp: startTimestamp || Date.now(),
            largeImageKey,
            largeImageText,
            instance: false,
        });
    } catch (e) {
        console.error('Failed to set Discord activity', e);
    }
};

const clearActivity = () => {
    if (!rpc || !isReady) return;
    try {
        rpc.clearActivity();
    } catch (e) {
        console.error('Failed to clear Discord activity', e);
    }
};

app.on('settings-updated', (newSettings) => {
    const wasEnabled = isEnabled;
    isEnabled = newSettings.enableDiscordRPC !== false;

    if (isEnabled && !wasEnabled) {
        initRPC();
    } else if (!isEnabled && wasEnabled) {
        stopRPC();
    }
});

module.exports = {
    initRPC,
    stopRPC,
    setActivity,
    clearActivity
};