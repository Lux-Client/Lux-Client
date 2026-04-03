import { io } from "socket.io-client";
import packageJson from '../../package.json';

class AnalyticsService {
    private socket: any;
    private serverUrl: string;
    private clientVersion: string;
    private os: string;
    private userProfile: any;
    private machineId: string;
    private forcePollingForSession: boolean;
    private initializingPromise: Promise<void> | null;

    constructor() {
        this.socket = null;
        this.serverUrl = 'https://lux.pluginhub.de';
        this.clientVersion = packageJson.version;
        this.os = 'win32';
        this.userProfile = null;
        this.machineId = '';
        this.forcePollingForSession = false;
        this.initializingPromise = null;
    }

    private buildSocketOptions() {
        if (this.forcePollingForSession) {
            return {
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                transports: ['polling'],
                upgrade: false,
                rememberUpgrade: false
            };
        }

        return {
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            upgrade: true,
            rememberUpgrade: false
        };
    }

    private destroySocket() {
        if (!this.socket) return;
        try {
            this.socket.removeAllListeners();
            this.socket.io?.removeAllListeners?.();
            this.socket.disconnect();
            this.socket.close?.();
        } catch (e) {
        }
        this.socket = null;
    }

    private createSocket() {
        this.destroySocket();
        this.socket = io(this.serverUrl, this.buildSocketOptions());

        this.socket.on("connect", () => {
            console.log("[Analytics] Connected to", this.serverUrl, "using", this.socket.io.engine.transport.name);
            this.register();
        });

        this.socket.on("connect_error", (err: any) => {
            console.error("[Analytics] Connection error:", err.message);

            const websocketFailed = String(err?.message || '').toLowerCase().includes('websocket');
            if (websocketFailed && !this.forcePollingForSession) {
                console.log("[Analytics] Falling back to polling permanently for this session");
                this.forcePollingForSession = true;
                this.createSocket();
            }
        });

        this.socket.io.on("reconnect_attempt", () => {
            if (this.forcePollingForSession) {
                this.socket.io.opts.transports = ['polling'];
                this.socket.io.opts.upgrade = false;
            }
        });

        this.socket.on("disconnect", (reason: string) => {
            console.log("[Analytics] Disconnected:", reason);
            if (reason === "io server disconnect") {
                this.socket.connect();
            }
        });
    }

    private generateMachineId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                const bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {
        }
        return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }

    private getLegacyMachineIdFromLocalStorage() {
        const storageKey = 'lux_machine_id';
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return '';
            }
            const existing = window.localStorage.getItem(storageKey);
            if (existing && existing.length >= 16) {
                return existing;
            }

            return '';
        } catch (e) {
            return '';
        }
    }

    private saveLegacyMachineId(machineId: string) {
        const storageKey = 'lux_machine_id';
        try {
            if (typeof window !== 'undefined' && window.localStorage && machineId) {
                window.localStorage.setItem(storageKey, machineId);
            }
        } catch (e) {
        }
    }

    private async getOrCreateMachineId() {
        const legacyId = this.getLegacyMachineIdFromLocalStorage();
        const fallbackId = legacyId || this.generateMachineId();

        if (!window?.electronAPI?.getSettings || !window?.electronAPI?.saveSettings) {
            this.saveLegacyMachineId(fallbackId);
            return fallbackId;
        }

        try {
            const res = await window.electronAPI.getSettings();
            if (res?.success && res.settings) {
                const settingsMachineId = String(res.settings.analyticsMachineId || '').trim();
                if (settingsMachineId.length >= 16) {
                    this.saveLegacyMachineId(settingsMachineId);
                    return settingsMachineId;
                }

                const nextMachineId = fallbackId;
                await window.electronAPI.saveSettings({
                    ...res.settings,
                    analyticsMachineId: nextMachineId
                });
                this.saveLegacyMachineId(nextMachineId);
                return nextMachineId;
            }
        } catch (e) {
        }

        this.saveLegacyMachineId(fallbackId);
        return fallbackId;
    }

    init(serverUrl = 'https://lux.pluginhub.de') {
        if (this.socket || this.initializingPromise) return;

        console.log('[Analytics] Initializing connection to', serverUrl);
        this.serverUrl = serverUrl;

        const connect = async () => {
            this.machineId = await this.getOrCreateMachineId();
            this.createSocket();
        };

        this.initializingPromise = connect()
            .finally(() => {
                this.initializingPromise = null;
            });
    }

    setProfile(profile: any) {
        this.userProfile = profile;
        this.register();
    }

    register() {
        if (!this.socket || !this.machineId) return;
        const data: any = {
            version: this.clientVersion,
            os: this.os,
            machineId: this.machineId
        };
        if (this.userProfile) {
            data.username = this.userProfile.name;
            data.uuid = this.userProfile.id;
        }
        this.socket.emit('register', data);
    }

    updateStatus(isPlaying: boolean, instanceName: string | null = null, metadata: any = {}) {
        if (!this.socket) {
            console.warn('[Analytics] Update status skipped: No socket');
            return;
        }
        console.log('[Analytics] Update Status:', isPlaying, instanceName, metadata);
        this.socket.emit('update-status', {
            isPlaying,
            instance: instanceName,
            software: metadata.loader,
            gameVersion: metadata.version,
            mode: metadata.mode
        });
    }

    trackLaunch(instanceName: string, metadata: any = {}) {
        this.updateStatus(true, instanceName, metadata);
    }

    trackServerCreation(software: string, version: string) {
        if (!this.socket) {
            console.warn('[Analytics] Track server creation skipped: No socket');
            return;
        }
        console.log('[Analytics] Track Server Creation:', software, version);
        this.socket.emit('track-creation', {
            software,
            version,
            mode: 'server'
        });
    }

    trackInstanceCreation(software: string, version: string) {
        if (!this.socket) {
            console.warn('[Analytics] Track instance creation skipped: No socket');
            return;
        }
        console.log('[Analytics] Track Instance Creation:', software, version);
        this.socket.emit('track-creation', {
            software,
            version,
            mode: 'launcher'
        });
    }

    trackDownload(type: string, name: string, id: string) {
        if (!this.socket) return;

        this.socket.emit('track-download', {
            type,
            name,
            id,
            username: this.userProfile ? this.userProfile.name : null
        });
    }
}

export const Analytics = new AnalyticsService();