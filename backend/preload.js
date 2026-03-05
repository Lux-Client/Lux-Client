const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] 🚀 Preload script wird ausgeführt...');
try {
    console.log('[Preload] ipcRenderer verfügbar:', !!ipcRenderer);
    console.log('[Preload] ipcRenderer.invoke verfügbar:', typeof ipcRenderer.invoke === 'function');
} catch (e) {
    console.error('[Preload] ipcRenderer Fehler:', e);
}

const electronAPI = {
    platform: process.platform,
    isPackaged: ipcRenderer.sendSync('app:is-packaged'),
    isDeveloperMode: ipcRenderer.sendSync('app:is-developer-mode'),
    getVersion: () => ipcRenderer.invoke('app:get-version'),

    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    openFileDialog: (options) => ipcRenderer.invoke('dialog:open-file', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:save-file', options),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    validateSession: () => ipcRenderer.invoke('auth:validate'),
    getProfile: () => ipcRenderer.invoke('auth:get-profile'),
    getAccounts: () => ipcRenderer.invoke('auth:get-accounts'),
    switchAccount: (uuid) => ipcRenderer.invoke('auth:switch-account', uuid),
    removeAccount: (uuid) => ipcRenderer.invoke('auth:remove-account', uuid),
    selectBackgroundMedia: () => ipcRenderer.invoke('settings:select-background'),
    deleteBackgroundMedia: (path) => ipcRenderer.invoke('settings:delete-background', path),
    selectCustomFont: () => ipcRenderer.invoke('settings:select-font'),
    deleteCustomFont: (fontId) => ipcRenderer.invoke('settings:delete-font', fontId),
    getCustomPresets: () => ipcRenderer.invoke('theme:get-custom-presets'),
    saveCustomPreset: (preset) => ipcRenderer.invoke('theme:save-custom-preset', preset),
    deleteCustomPreset: (handle) => ipcRenderer.invoke('theme:delete-custom-preset', handle),
    exportCustomPreset: (preset) => ipcRenderer.invoke('theme:export-custom-preset', preset),
    importCustomPreset: () => ipcRenderer.invoke('theme:import-custom-preset'),
    installThemeFromMarketplace: (url) => ipcRenderer.invoke('theme:install-from-marketplace', url),

    softReset: () => ipcRenderer.invoke('app:soft-reset'),
    factoryReset: () => ipcRenderer.invoke('app:factory-reset'),

    openInstanceFolder: (name) => ipcRenderer.invoke('instance:open-folder', name),
    getMods: (instanceName) => ipcRenderer.invoke('instance:get-mods', instanceName),
    getResourcePacks: (instanceName) => ipcRenderer.invoke('instance:get-resourcepacks', instanceName),
    getShaders: (instanceName) => ipcRenderer.invoke('instance:get-shaders', instanceName),
    toggleMod: (instanceName, fileName) => ipcRenderer.invoke('instance:toggle-mod', instanceName, fileName),
    deleteMod: (instanceName, fileName, type) => ipcRenderer.invoke('instance:delete-mod', instanceName, fileName, type),
    getWorlds: (instanceName) => ipcRenderer.invoke('instance:get-worlds', instanceName),
    openWorldFolder: (instanceName, folderName) => ipcRenderer.invoke('instance:open-world-folder', instanceName, folderName),
    backupWorld: (instanceName, folderName, forceCloud) => ipcRenderer.invoke('instance:backup-world', instanceName, folderName, forceCloud),
    deleteWorld: (instanceName, folderName) => ipcRenderer.invoke('instance:delete-world', instanceName, folderName),
    exportWorld: (instanceName, folderName) => ipcRenderer.invoke('instance:export-world', instanceName, folderName),
    getLogFiles: (instanceName) => ipcRenderer.invoke('instance:get-log-files', instanceName),
    getLog: (instanceName, filename) => ipcRenderer.invoke('instance:get-log', instanceName, filename),
    launchGame: (instanceName, quickPlay) => ipcRenderer.invoke('launcher:launch', instanceName, quickPlay),
    getLiveLogs: (instanceName) => ipcRenderer.invoke('launcher:get-live-logs', instanceName),
    killGame: (instanceName) => ipcRenderer.invoke('launcher:kill', instanceName),
    abortLaunch: (instanceName) => ipcRenderer.invoke('launcher:abort-launch', instanceName),
    createInstance: (name, version, loader, icon, loaderVersion) => ipcRenderer.invoke('instance:create', { name, version, loader, icon, loaderVersion }),
    updateInstance: (name, config) => ipcRenderer.invoke('instance:update', name, config),
    updateInstanceConfig: (name, config) => ipcRenderer.invoke('instance:update', name, config),
    migrateInstance: (name, config) => ipcRenderer.invoke('instance:migrate', name, config),
    reinstallInstance: (name, type) => ipcRenderer.invoke('instance:reinstall', name, type),
    deleteInstance: (name) => ipcRenderer.invoke('instance:delete', name),
    renameInstance: (oldName, newName) => ipcRenderer.invoke('instance:rename', oldName, newName),
    duplicateInstance: (name) => ipcRenderer.invoke('instance:duplicate', name),
    exportInstance: (name) => ipcRenderer.invoke('instance:export', name),
    importInstance: () => ipcRenderer.invoke('instance:import'),
    importMrPack: () => ipcRenderer.invoke('instance:import-mrpack'),
    importFile: () => ipcRenderer.invoke('instance:unified-import-v3'),
    ping: () => ipcRenderer.invoke('ping'),
    restartApp: () => ipcRenderer.invoke('app:restart'),
    getInstances: () => ipcRenderer.invoke('instance:get-all'),
    installModpack: (url, name, iconUrl) => ipcRenderer.invoke('instance:install-modpack', url, name, iconUrl),
    searchModrinth: (query, facets, options) => ipcRenderer.invoke('modrinth:search', query, facets, options),
    modrinthSearch: (query, facets, options) => ipcRenderer.invoke('modrinth:search', query, facets, options),
    getServerMods: (serverName) => ipcRenderer.invoke('server:get-mods', serverName),
    deleteServerMod: (serverName, fileName, type) => ipcRenderer.invoke('server:delete-mod', serverName, fileName, type),
    installMod: (data) => ipcRenderer.invoke('modrinth:install', data),
    modrinthInstall: (data) => ipcRenderer.invoke('modrinth:install', data),
    installLocalMod: (instanceName, filePath) => ipcRenderer.invoke('instance:install-local-mod', instanceName, filePath),
    getModVersions: (projectId, loaders, gameVersions) => ipcRenderer.invoke('modrinth:get-versions', projectId, loaders, gameVersions),
    getModrinthProject: (projectId) => ipcRenderer.invoke('modrinth:get-project', projectId),
    resolveDependencies: (versionId, loaders, gameVersions) => ipcRenderer.invoke('modrinth:resolve-dependencies', versionId, loaders, gameVersions),
    checkUpdates: (instanceName, files) => ipcRenderer.invoke('instance:check-updates', instanceName, files),
    updateFile: (data) => ipcRenderer.invoke('instance:update-file', data),
    getVanillaVersions: () => ipcRenderer.invoke('data:get-vanilla-versions'),
    getLoaderVersions: (loader, mcVersion) => ipcRenderer.invoke('instance:get-loader-versions', loader, mcVersion),
    getSupportedGameVersions: (loader) => ipcRenderer.invoke('instance:get-supported-game-versions', loader),
    getLoaders: (mcVersion, loaderType) => ipcRenderer.invoke('data:get-loaders', mcVersion, loaderType),
    getNews: () => ipcRenderer.invoke('data:get-news'),
    installJava: (version) => ipcRenderer.invoke('java:install', version),
    getJavaRuntimes: () => ipcRenderer.invoke('java:list'),
    deleteJavaRuntime: (path) => ipcRenderer.invoke('java:delete', path),
    openJavaFolder: () => ipcRenderer.invoke('java:open-folder'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    runExternalFile: (filePath) => ipcRenderer.invoke('external:run-file', filePath),
    exportModpackAsCode: (data) => {
        console.log('[Preload] 📤 exportModpackAsCode aufgerufen mit:', data);
        return ipcRenderer.invoke('modpack:export-code', data);
    },
    importModpackFromCode: (code) => {
        console.log('[Preload] 📥 importModpackFromCode aufgerufen mit:', code);
        return ipcRenderer.invoke('modpack:import-code', code);
    },
    getModpackCodes: () => {
        console.log('[Preload] 📋 getModpackCodes aufgerufen');
        return ipcRenderer.invoke('modpack:list-codes');
    },
    deleteModpackCode: (code) => {
        console.log('[Preload] 🗑️ deleteModpackCode aufgerufen:', code);
        return ipcRenderer.invoke('modpack:delete-code', code);
    },
    installSharedContent: (instanceName, modpackData) => {
        console.log('[Preload] 📥 installSharedContent aufgerufen');
        return ipcRenderer.invoke('modpack:install-shared-content', { instanceName, modpackData });
    },
    getCurrentSkin: (token) => ipcRenderer.invoke('skin:get-current', token),
    uploadSkin: (token, skinPath, variant) => ipcRenderer.invoke('skin:upload', token, skinPath, variant),
    uploadSkinFromUrl: (token, skinUrl, variant) => ipcRenderer.invoke('skin:upload-from-url', token, skinUrl, variant),
    setCape: (token, capeId) => ipcRenderer.invoke('skin:set-cape', token, capeId),
    saveLocalSkin: (filePath) => ipcRenderer.invoke('skin:save-local', filePath),
    getLocalSkins: () => ipcRenderer.invoke('skin:get-local'),
    deleteLocalSkin: (id) => ipcRenderer.invoke('skin:delete-local', id),
    onUpdateAvailable: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('update:available', subscription);
        return () => ipcRenderer.removeListener('update:available', subscription);
    },
    onUpdateNotAvailable: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('update:not-available', subscription);
        return () => ipcRenderer.removeListener('update:not-available', subscription);
    },
    onUpdateProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('update:progress', subscription);
        return () => ipcRenderer.removeListener('update:progress', subscription);
    },
    onUpdateDownloaded: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('update:downloaded', subscription);
        return () => ipcRenderer.removeListener('update:downloaded', subscription);
    },
    onUpdateError: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('update:error', subscription);
        return () => ipcRenderer.removeListener('update:error', subscription);
    },
    restartAndInstall: () => ipcRenderer.send('update:quit-and-install'),
    renameLocalSkin: (id, newName) => ipcRenderer.invoke('skin:rename-local', id, newName),
    onLaunchProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('launch:progress', subscription);
        return () => ipcRenderer.removeListener('launch:progress', subscription);
    },
    onLaunchLog: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('launch:log', subscription);
        return () => ipcRenderer.removeListener('launch:log', subscription);
    },
    onInstanceStatus: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('instance:status', subscription);
        return () => ipcRenderer.removeListener('instance:status', subscription);
    },
    onInstallProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('install:progress', subscription);
        return () => ipcRenderer.removeListener('install:progress', subscription);
    },
    onLoginSuccess: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('auth:success', subscription);
        return () => ipcRenderer.removeListener('auth:success', subscription);
    },
    onThemeUpdated: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('theme:updated', subscription);
        return () => ipcRenderer.removeListener('theme:updated', subscription);
    },
    onSettingsUpdated: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('settings:updated', subscription);
        return () => ipcRenderer.removeListener('settings:updated', subscription);
    },
    onJavaProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('java:progress', subscription);
        return () => ipcRenderer.removeListener('java:progress', subscription);
    },
    onWindowStateChange: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('window-state', subscription);
        return () => ipcRenderer.removeListener('window-state', subscription);
    },
    getServers: () => ipcRenderer.invoke('server:get-all'),
    createServer: (data) => ipcRenderer.invoke('server:create', data),
    deleteServer: (name) => ipcRenderer.invoke('server:delete', name),
    duplicateServer: (name) => ipcRenderer.invoke('server:duplicate', name),
    getServer: (name) => ipcRenderer.invoke('server:get', name),
    updateServerConfig: (name, updates) => ipcRenderer.invoke('server:update-config', name, updates),
    importServer: () => ipcRenderer.invoke('server:import'),
    startServer: (name) => ipcRenderer.invoke('server:start', name),
    stopServer: (name) => ipcRenderer.invoke('server:stop', name),
    restartServer: (name) => ipcRenderer.invoke('server:restart', name),
    getServerLogs: (name) => ipcRenderer.invoke('server:get-logs', name),
    getServerProperties: (serverName) => ipcRenderer.invoke('server:get-properties', serverName),
    saveServerProperties: (serverName, properties) => ipcRenderer.invoke('server:save-properties', serverName, properties),
    listServerPluginConfigs: (serverName) => ipcRenderer.invoke('server:list-plugin-configs', serverName),
    createServerPluginConfig: (serverName, pluginName) => ipcRenderer.invoke('server:create-plugin-config', serverName, pluginName),
    saveServerPluginConfig: (serverName, configFile, config) => ipcRenderer.invoke('server:save-plugin-config', serverName, configFile, config),
    listServerFiles: (serverName, relativePath) => ipcRenderer.invoke('server:list-files', serverName, relativePath),
    readServerFile: (serverName, relativePath) => ipcRenderer.invoke('server:read-file', serverName, relativePath),
    writeServerFile: (serverName, relativePath, content) => ipcRenderer.invoke('server:write-file', serverName, relativePath, content),
    deleteServerFile: (serverName, relativePath) => ipcRenderer.invoke('server:delete-file', serverName, relativePath),
    createServerDirectory: (serverName, relativePath) => ipcRenderer.invoke('server:create-directory', serverName, relativePath),
    renameServerFile: (serverName, oldPath, newPath) => ipcRenderer.invoke('server:rename-file', serverName, oldPath, newPath),
    getServerStatus: (name) => ipcRenderer.invoke('server:get-status', name),
    getServerConsole: (name) => ipcRenderer.invoke('server:get-console', name),
    sendServerCommand: (serverName, command) => ipcRenderer.invoke('server:send-command', serverName, command),
    getServerStats: (name) => ipcRenderer.invoke('server:get-stats', name),
    saveServerLogs: (serverName, logs) => ipcRenderer.invoke('server:save-logs', serverName, logs),
    openServerFolder: (name) => ipcRenderer.invoke('server:open-folder', name),
    backupServer: (name) => ipcRenderer.invoke('server:backup', name),
    downloadServerSoftware: (data) => ipcRenderer.invoke('server:download-software', data),
    checkServerEula: (serverName) => ipcRenderer.invoke('server:check-eula', serverName),
    acceptServerEula: (serverName) => ipcRenderer.invoke('server:accept-eula', serverName),
    checkPlayitAvailable: (software, version) => ipcRenderer.invoke('server:check-playit-available', software, version),
    installPlayitPlugin: (serverName) => ipcRenderer.invoke('server:install-playit', serverName),
    removePlayit: (serverName) => ipcRenderer.invoke('server:remove-playit', serverName),
    getServerSettings: () => ipcRenderer.invoke('server:get-settings'),
    saveServerSettings: (settings) => ipcRenderer.invoke('server:save-settings', settings),
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    onServerStatus: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:status', subscription);
        return () => ipcRenderer.removeListener('server:status', subscription);
    },
    onServerConsoleOutput: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:console', subscription);
        return () => ipcRenderer.removeListener('server:console', subscription);
    },
    onServerLog: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:console', subscription);
        return () => ipcRenderer.removeListener('server:console', subscription);
    },
    onServerStats: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:stats', subscription);
        return () => ipcRenderer.removeListener('server:stats', subscription);
    },
    onServerConsoleCleared: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:console-cleared', subscription);
        return () => ipcRenderer.removeListener('server:console-cleared', subscription);
    },
    onServerStats: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:stats', subscription);
        return () => ipcRenderer.removeListener('server:stats', subscription);
    },
    onServerBackupProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:backup-progress', subscription);
        return () => ipcRenderer.removeListener('server:backup-progress', subscription);
    },
    onServerDownloadProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:download-progress', subscription);
        return () => ipcRenderer.removeListener('server:download-progress', subscription);
    },
    onServerConsoleCleared: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:console-cleared', subscription);
        return () => ipcRenderer.removeListener('server:console-cleared', subscription);
    },
    onServerEulaRequired: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:eula-required', subscription);
        return () => ipcRenderer.removeListener('server:eula-required', subscription);
    },
    onServerPluginProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('server:plugin-progress', subscription);
        return () => ipcRenderer.removeListener('server:plugin-progress', subscription);
        ipcRenderer.on('server:plugin-progress', subscription);
        return () => ipcRenderer.removeListener('server:plugin-progress', subscription);
    },
    getExtensions: () => ipcRenderer.invoke('extensions:list'),
    installExtension: (sourcePath) => ipcRenderer.invoke('extensions:install', sourcePath),
    removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
    toggleExtension: (id, enabled) => ipcRenderer.invoke('extensions:toggle', id, enabled),
    onExtensionFile: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('extension:open-file', subscription);
        return () => ipcRenderer.removeListener('extension:open-file', subscription);
    },
    getActiveProcesses: () => ipcRenderer.invoke('launcher:get-active-processes'),
    getProcessStats: (pid) => ipcRenderer.invoke('launcher:get-process-stats', pid),

    invokeExtension: (extId, channel, ...args) => ipcRenderer.invoke(`ext:${extId}:${channel}`, ...args),
    onExtensionMessage: (extId, channel, callback) => {
        const subscription = (_event, ...args) => callback(...args);
        ipcRenderer.on(`ext:${extId}:${channel}`, subscription);
        return () => ipcRenderer.removeListener(`ext:${extId}:${channel}`, subscription);
    },
    fetchMarketplace: () => ipcRenderer.invoke('extensions:fetch-marketplace'),
    cloudLogin: (providerId) => ipcRenderer.invoke('cloud:login', providerId),
    cloudLogout: (providerId) => ipcRenderer.invoke('cloud:logout', providerId),
    cloudGetStatus: () => ipcRenderer.invoke('cloud:get-status'),
    cloudListBackups: (providerId, instanceName) => ipcRenderer.invoke('cloud:list-backups', providerId, instanceName),
    cloudUpload: (providerId, filePath, instanceName) => ipcRenderer.invoke('cloud:upload', providerId, filePath, instanceName),
    cloudDownload: (providerId, fileId, targetPath) => ipcRenderer.invoke('cloud:download', providerId, fileId, targetPath),
    backupInstance: (instanceName) => ipcRenderer.invoke('backup:manual', instanceName),
    listLocalBackups: (instanceName) => ipcRenderer.invoke('instance:list-local-backups', instanceName),
    getBackupsDir: (instanceName) => ipcRenderer.invoke('instance:get-backups-dir', instanceName),
    restoreLocalBackup: (instanceName, backupFileName) => ipcRenderer.invoke('instance:restore-local-backup', instanceName, backupFileName),
    removeFile: (filePath) => ipcRenderer.invoke('instance:remove-file', filePath),

    // Custom Updater
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: (url, name) => ipcRenderer.invoke('updater:download', url, name),
    installUpdate: (path) => ipcRenderer.invoke('updater:install', path),
    setTestVersion: (version) => ipcRenderer.invoke('updater:set-test-version', version),
    onUpdaterProgress: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('updater:progress', subscription);
        return () => ipcRenderer.removeListener('updater:progress', subscription);
    },
    onCrashReport: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('launcher:crash-report', subscription);
        return () => ipcRenderer.removeListener('launcher:crash-report', subscription);
    }
};
try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
    console.log('[Preload] ElectronAPI erfolgreich exposed');
    console.log('[Preload] Verfügbare Methoden:', Object.keys(electronAPI));
    console.log('[Preload] Modpack-Methoden:', {
        exportModpackAsCode: typeof electronAPI.exportModpackAsCode === 'function',
        importModpackFromCode: typeof electronAPI.importModpackFromCode === 'function',
        getModpackCodes: typeof electronAPI.getModpackCodes === 'function'
    });
} catch (error) {
    console.error('[Preload] Fehler beim Exposen:', error);
}