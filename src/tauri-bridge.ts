import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { load, Store } from "@tauri-apps/plugin-store";

// Lazy initialize store to prevent top-level await issues
let _store: Store | null = null;
const getStore = async () => {
  if (!_store) {
    _store = await load("settings.json");
  }
  return _store;
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
  launchGame: (instanceName: string) => invoke("launch_game", { instanceName }),
  
  login: async () => {
    try {
      const profile = await invoke("login");
      return { success: true, profile };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, 
  getProfile: () => invoke("get_profile"),
  
  backupInstance: (instanceName: string) => invoke("manual_backup", { instanceName }),
  
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
    listen("launch-log", (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten?.();
  },
};

// Inject into window
(window as any).electronAPI = tauriBridge;

export default tauriBridge;
