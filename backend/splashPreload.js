const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
    onUpdaterStatus: (callback) => {
        const subscription = (_event, payload) => callback(payload);
        ipcRenderer.on('updater:status', subscription);
        return () => ipcRenderer.removeListener('updater:status', subscription);
    }
});
