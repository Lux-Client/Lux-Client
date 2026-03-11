const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { app } = require('electron');
const { resolvePrimaryInstancesDir, resolveInstanceDirByName } = require('./utils/instances-path');

class BackupManager {
    constructor() {
        this.backupsDir = path.join(app.getPath('userData'), 'backups');
        this.instancesDir = resolvePrimaryInstancesDir();
        this.intervals = new Map();
    }

    async init(ipcMain) {
        await fs.ensureDir(this.backupsDir);
        console.log('[BackupManager] Initialized at:', this.backupsDir);

        if (ipcMain) {
            ipcMain.handle('backup:manual', async (_, instanceName) => {
                return await this.createBackup(instanceName);
            });
            console.log('[BackupManager] IPC handler registered.');
        }
    }

    
    async createBackup(instanceName) {
        this.instancesDir = resolvePrimaryInstancesDir();
        const instanceDir = resolveInstanceDirByName(instanceName) || path.join(this.instancesDir, instanceName);
        const savesDir = path.join(instanceDir, 'saves');
        const instanceBackupsDir = path.join(this.backupsDir, instanceName);

        if (!(await fs.pathExists(savesDir))) {
            console.log(`[BackupManager] No saves found for ${instanceName}, skipping backup.`);
            return { success: false, error: 'No saves found' };
        }

        await fs.ensureDir(instanceBackupsDir);
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
        const fileName = `${instanceName}_${timestamp}.zip`;
        const filePath = path.join(instanceBackupsDir, fileName);

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(filePath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('error', (err) => {
                console.error('[BackupManager] WriteStream error:', err);
                if (err.code === 'ENOSPC') {
                    console.error('[BackupManager] Backup failed: Insufficient disk space.');
                }
                reject(err);
            });

            output.on('close', async () => {
                console.log(`[BackupManager] Backup created: ${fileName} (${archive.pointer()} bytes)`);
                try {
                    const configPath = path.join(instanceDir, 'instance.json');
                    if (await fs.pathExists(configPath)) {
                        const config = await fs.readJson(configPath);
                        config.lastBackup = Date.now();
                        await fs.writeJson(configPath, config, { spaces: 4 });
                    }
                } catch (e) {
                    console.error('[BackupManager] Failed to update instance lastBackup:', e);
                }

                await this.cleanupBackups(instanceName);
                try {
                    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
                    if (await fs.pathExists(settingsPath)) {
                        const settings = await fs.readJson(settingsPath);
                        if (settings.cloudBackupSettings?.enabled && settings.cloudBackupSettings?.provider) {
                            console.log(`[BackupManager] Triggering cloud upload for ${instanceName} to ${settings.cloudBackupSettings.provider}`);
                            app.emit('backup:created', { providerId: settings.cloudBackupSettings.provider, filePath, instanceName });
                        }
                    }
                } catch (e) {
                    console.error('[BackupManager] Cloud upload trigger failed:', e);
                }

                resolve({ success: true, path: filePath, name: fileName });
            });

            archive.on('error', (err) => {
                console.error('[BackupManager] Archiver error:', err);
                reject(err);
            });

            archive.pipe(output);
            archive.directory(savesDir, false);
            archive.finalize();
        });
    }

    
    async cleanupBackups(instanceName) {
        const instanceBackupsDir = path.join(this.backupsDir, instanceName);
        if (!(await fs.pathExists(instanceBackupsDir))) return;
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        let maxBackups = 10;
        if (await fs.pathExists(settingsPath)) {
            const settings = await fs.readJson(settingsPath);
            if (settings.backupSettings && settings.backupSettings.maxBackups) {
                maxBackups = settings.backupSettings.maxBackups;
            }
        }

        const files = await fs.readdir(instanceBackupsDir);
        const backupFiles = files
            .filter(f => f.endsWith('.zip'))
            .map(f => ({
                name: f,
                path: path.join(instanceBackupsDir, f),
                time: fs.statSync(path.join(instanceBackupsDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (backupFiles.length > maxBackups) {
            const toDelete = backupFiles.slice(maxBackups);
            for (const file of toDelete) {
                await fs.remove(file.path);
                console.log(`[BackupManager] Deleted old backup: ${file.name}`);
            }
        }
    }

    
    async startScheduler(instanceName, intervalMinutes) {
        this.stopScheduler(instanceName);

        if (intervalMinutes <= 0) return;

        console.log(`[BackupManager] Starting scheduler for ${instanceName} every ${intervalMinutes} minutes.`);
        const interval = setInterval(() => {
            this.createBackup(instanceName).catch(err => {
                console.error(`[BackupManager] Scheduled backup failed for ${instanceName}:`, err);
            });
        }, intervalMinutes * 60 * 1000);

        this.intervals.set(instanceName, interval);
    }

    stopScheduler(instanceName) {
        if (this.intervals.has(instanceName)) {
            clearInterval(this.intervals.get(instanceName));
            this.intervals.delete(instanceName);
            console.log(`[BackupManager] Stopped scheduler for ${instanceName}.`);
        }
    }
}

module.exports = new BackupManager();