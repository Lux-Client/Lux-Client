import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { load, Store } from "@tauri-apps/plugin-store";

// Lazy initialize store to prevent top-level await issues
let _storePromise: Promise<Store> | null = null;
const getStore = async () => {
  if (!_storePromise) {
    _storePromise = load("settings.json");
  }
  return _storePromise;
};

const tauriBridge: any = {
  platform: "win32", // Simplified
  isPackaged: true,
  isDeveloperMode: false,
  getVersion: () => Promise.resolve("1.7.0"),

  minimize: () => invoke("minimize"),
  maximize: () => invoke("maximize"),
  close: () => invoke("close"),
  
  getSettings: async () => {
    try {
      const store = await getStore();
      const entries = await store.entries();
      const settings: any = {};
      for (const [key, value] of entries) {
        settings[key] = value;
      }
      return { success: true, settings };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  
  saveSettings: async (settings: any) => {
    try {
      const store = await getStore();
      for (const key in settings) {
        await store.set(key, settings[key]);
      }
      await store.save();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  
  getInstances: () => invoke("get_instances"),
  launchGame: (instanceName: string, quickPlay?: any) => invoke("launch_game", { instanceName, quickPlay }),
  
  login: async () => {
    try {
      const profile = await invoke("login");
      return { success: true, profile };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, 
  getProfile: () => invoke("get_profile"),
  validateSession: () => Promise.resolve({ success: true }),

  onWindowStateChange: (callback: any) => {
    let unlisten: any;
    listen("tauri://window-state-change", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
  onCrashReport: (callback: any) => {
    let unlisten: any;
    listen("crash-report", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
  
  // Event listeners
  onSettingsUpdated: (callback: any) => {
    let unlisten: any;
    listen("settings-updated", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
  onInstanceStatus: (callback: any) => {
    let unlisten: any;
    listen("instance-status", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
  onLaunchProgress: (callback: any) => {
    let unlisten: any;
    listen("launch-progress", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
  onLaunchLog: (callback: any) => {
    let unlisten: any;
    listen("launch-log", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onThemeUpdated: (callback: any) => {
    let unlisten: any;
    listen("theme-updated", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onServerStatus: (callback: any) => {
    let unlisten: any;
    listen("server-status", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onInstallProgress: (callback: any) => {
    let unlisten: any;
    listen("install-progress", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onJavaRequired: (callback: any) => {
    let unlisten: any;
    listen("java-required", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onUpdateAvailable: (callback: any) => {
    let unlisten: any;
    listen("update-available", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onUpdateProgress: (callback: any) => {
    let unlisten: any;
    listen("update-progress", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onUpdateDownloaded: (callback: any) => {
    let unlisten: any;
    listen("update-downloaded", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onUpdateError: (callback: any) => {
    let unlisten: any;
    listen("update-error", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  
  // Methods
  getVanillaVersions: () => invoke("get_vanilla_versions"),
  getSupportedGameVersions: (loader: string) => invoke("get_supported_game_versions", { loader }),
  getAccounts: () => Promise.resolve([]),
  switchAccount: (uuid: string) => Promise.resolve({ success: false }),
  removeAccount: (uuid: string) => Promise.resolve({ success: true }),
  createInstance: (name: string, version: string, loader: string, icon: any) => invoke("create_instance", { name, version, loader, icon }),
  installSharedContent: (instanceName: string, data: any) => Promise.resolve({ success: true }),
  
  // UI stubs
  getCustomPresets: () => Promise.resolve([]),
  installThemeFromMarketplace: () => Promise.resolve({ success: false }),
  deleteCustomPreset: () => Promise.resolve({ success: true }),
  exportCustomPreset: () => Promise.resolve({ success: true }),
  importCustomPreset: () => Promise.resolve({ success: false }),
  selectCustomFont: () => Promise.resolve({ success: false }),
  deleteCustomFont: () => Promise.resolve({ success: true }),
  selectBackgroundMedia: () => invoke("select_background_media"),
  deleteBackgroundMedia: () => Promise.resolve({ success: true }),
  getCurrentSkin: (token: string) => invoke("get_current_skin", { token }),
  saveLocalSkin: (data: any) => invoke("save_local_skin", { data }),
  saveLocalSkinFromUrl: (skinUrl: string) => invoke("save_local_skin_from_url", { skinUrl }),
  saveLocalSkinFromUsername: (username: string) => invoke("save_local_skin_from_username", { username }),
  uploadSkin: (token: string, skinPath: string, variant: string) => invoke("upload_skin", { token, skinPath, variant }),
  uploadSkinFromUrl: (token: string, skinUrl: string, variant: string) => invoke("upload_skin_from_url", { token, skinUrl, variant }),
  getLocalSkins: () => invoke("get_local_skins"),
  
  restartAndInstall: () => {
    invoke("relaunch");
  },

  searchModrinth: (query: string, facets: any[], options: any) => 
    invoke("search_modrinth", { query, facets, offset: options.offset || 0, limit: options.limit || 20, index: options.index || "relevance" }),
  
  modrinthSearch: (query: string, facets: any[], options: any) => 
    invoke("search_modrinth", { query, facets, offset: options.offset || 0, limit: options.limit || 20, index: options.index || "relevance" }),

  getModrinthProject: (projectId: string) => 
    invoke("get_modrinth_project", { projectId }),

  getModVersions: (projectId: string, loaders: string[], gameVersions: string[]) => 
    invoke("get_mod_versions", { projectId, loaders, gameVersions }),

  onJavaProgress: (callback: any) => {
    let unlisten: any;
    listen("java-progress", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  onUpdaterProgress: (callback: any) => {
    let unlisten: any;
    listen("updater-progress", (event) => callback(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  },
  
  installJava: (version: number) => invoke("install_java", { version }),
  getJavaRuntimes: () => invoke("get_java_runtimes"),
  deleteJavaRuntime: (path: string) => invoke("delete_java_runtime", { path }),

  checkForUpdates: () => invoke("check_for_updates"),
  downloadUpdate: (url: string, name: string) => invoke("download_update", { url, name }),
  installUpdate: (path: string) => invoke("install_update", { path }),
  setTestVersion: (version: string) => invoke("set_test_version", { version }),

  softReset: () => invoke("soft_reset"),
  factoryReset: () => invoke("factory_reset"),
  uninstallLauncher: () => invoke("uninstall_launcher"),

  openFileDialog: (options: any) => invoke("open_file_dialog", { options }),
  selectFolder: () => invoke("select_folder"),
  
  getServers: () => invoke("get_instances"), // Alias for get_instances
  getServerMods: (instanceName: string) => invoke("get_server_mods", { instanceName }),
  
  resolveDependencies: (versionId: string, loaders: string[], gameVersions: string[]) => 
    invoke("resolve_dependencies", { versionId, loaders, gameVersions }),

  modrinthInstall: (payload: any) => invoke("modrinth_install", { payload }),

  restartApp: () => invoke("relaunch"),

  deleteInstance: (name: string) => invoke("delete_instance", { name }),
  getMods: (instanceName: string) => invoke("get_mods", { instanceName }),
  getResourcePacks: (instanceName: string) => invoke("get_resource_packs", { instanceName }),
  getShaders: (instanceName: string) => invoke("get_shaders", { instanceName }),
  listInstanceFiles: (instanceName: string, relativePath?: string) => invoke("list_instance_files", { instanceName, relativePath }),
  readInstanceFile: (instanceName: string, relativePath: string) => invoke("read_instance_file", { instanceName, relativePath }),
  writeInstanceFile: (instanceName: string, relativePath: string, content: string) => invoke("write_instance_file", { instanceName, relativePath, content }),
  deleteInstanceFile: (instanceName: string, relativePath: string) => invoke("delete_instance_file", { instanceName, relativePath }),
  uploadInstanceFile: (instanceName: string, relativePath: string, localFilePath: string) => invoke("upload_instance_file", { instanceName, relativePath, localFilePath }),
  createInstanceDirectory: (instanceName: string, relativePath: string) => invoke("create_instance_directory", { instanceName, relativePath }),
  toggleMod: (instanceName: string, fileName: string) => invoke("toggle_mod", { instanceName, fileName }),
  deleteMod: (instanceName: string, fileName: string, type?: string) => invoke("delete_mod", { instanceName, fileName, type }),
  getWorlds: (instanceName: string) => invoke("get_worlds", { instanceName }),
  openWorldFolder: (instanceName: string, folderName: string) => invoke("open_world_folder", { instanceName, folderName }),
  backupWorld: (instanceName: string, folderName: string, forceCloud?: boolean) => invoke("backup_world", { instanceName, folderName, forceCloud }),
  deleteWorld: (instanceName: string, folderName: string) => invoke("delete_world", { instanceName, folderName }),
  exportWorld: (instanceName: string, folderName: string) => invoke("export_world", { instanceName, folderName }),
  getLogFiles: (instanceName: string) => invoke("get_log_files", { instanceName }),
  getLog: (instanceName: string, filename: string) => invoke("get_log", { instanceName, filename }),
  uploadInstanceLog: (instanceName: string, filename: string) => invoke("upload_instance_log", { instanceName, filename }),
  getLiveLogs: (instanceName: string) => invoke("get_live_logs", { instanceName }),
  killGame: (instanceName: string) => invoke("kill_game", { instanceName }),
  abortLaunch: (instanceName: string) => invoke("abort_launch", { instanceName }),
  updateInstance: (name: string, config: any) => invoke("update_instance", { name, config }),
  updateInstanceConfig: (name: string, config: any) => invoke("update_instance_config", { name, config }),
  setInstanceFolderPath: (instanceRef: any, folderPath: string) => invoke("set_instance_folder_path", { instanceRef, folderPath }),
  migrateInstance: (name: string, config: any) => invoke("migrate_instance", { name, config }),
  reinstallInstance: (name: string, type?: string) => invoke("reinstall_instance", { name, type }),
  renameInstance: (oldName: string, newName: string) => invoke("rename_instance", { oldName, newName }),
  duplicateInstance: (name: string) => invoke("duplicate_instance", { name }),
  resetInstanceConfig: (name: string) => invoke("reset_instance_config", { name }),
  exportInstance: (name: string) => invoke("export_instance", { name }),
  importInstance: () => invoke("import_instance"),
  importMrPack: () => invoke("import_mrpack"),
  importFile: () => invoke("import_file"),
  openInstanceFolder: (name: string) => invoke("open_instance_folder", { name }),
};

// Inject into window
(window as any).electronAPI = tauriBridge;

export default tauriBridge;
