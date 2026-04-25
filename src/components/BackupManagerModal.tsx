import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';
import {
    CloudArrowUpIcon,
    CloudArrowDownIcon,
    MagnifyingGlassIcon,
    XMarkIcon,
    ArrowLeftIcon,
    FolderIcon,
    ArchiveBoxIcon,
    CheckIcon,
    ArrowUpTrayIcon,
    ArrowDownTrayIcon
} from '@heroicons/react/24/outline';
import {
    CheckCircleIcon as CheckCircleIconSolid
} from '@heroicons/react/24/solid';

const BackupManagerModal = ({ instance, onClose, worlds, onBackupStatusChange }: { instance: any; onClose: any; worlds: any; onBackupStatusChange?: any }) => {
    const [view, setView] = useState('mode-select');
    const [mode, setMode] = useState('backup');
    const [type, setType] = useState('local');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedItems, setSelectedItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [localBackups, setLocalBackups] = useState([]);
    const [cloudBackups, setCloudBackups] = useState([]);
    const [cloudStatus, setCloudStatus] = useState<Record<string, any>>({});
    const [selectedProvider, setSelectedProvider] = useState(null);
    const { addNotification } = useNotification();

    useEffect(() => {
        loadCloudStatus();
    }, []);

    const loadCloudStatus = async () => {
        try {
            const status = await window.electronAPI.cloudGetStatus();
            setCloudStatus(status);

            if (status.GOOGLE_DRIVE?.loggedIn) setSelectedProvider('GOOGLE_DRIVE');
            else if (status.DROPBOX?.loggedIn) setSelectedProvider('DROPBOX');
        } catch (e) {
            console.error("Failed to load cloud status", e);
        }
    };

    useEffect(() => {
        if (view === 'setup') {
            if (mode === 'import') {
                if (type === 'local') loadLocalBackups();
                else if (selectedProvider) loadCloudBackups();
            }
        }
    }, [view, type, mode, selectedProvider]);

    const loadLocalBackups = async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.listLocalBackups(instance.name);
            if (res.success) setLocalBackups(res.backups);
            else addNotification('Failed to load local backups: ' + res.error, 'error');
        } catch (e) {
            addNotification('Error loading local backups', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadCloudBackups = async () => {
        if (!selectedProvider) return;
        setLoading(true);
        try {
            const res = await window.electronAPI.cloudListBackups(selectedProvider, instance.name);
            if (res.success) setCloudBackups(res.files);
            else addNotification('Failed to load cloud backups: ' + res.error, 'error');
        } catch (e) {
            addNotification('Error loading cloud backups', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async () => {
        setLoading(true);
        let successCount = 0;
        try {
            if (mode === 'backup') {
                for (const worldFolder of selectedItems) {
                    const res = await window.electronAPI.backupWorld(instance.name, worldFolder, type === 'cloud' ? selectedProvider : false);
                    if (res.success) {
                        successCount++;
                    }
                }
                addNotification(`Successfully backed up ${successCount} world(s)`, 'success');
            } else {
                const provider = type === 'local' ? null : selectedProvider;

                for (const itemId of selectedItems) {
                    let res;
                    if (type === 'local') {
                        res = await window.electronAPI.restoreLocalBackup(instance.name, itemId);
                    } else {

                        const backupItem = cloudBackups.find(b => b.id === itemId);
                        if (!backupItem) continue;

                        addNotification(`Downloading ${backupItem.name}...`, 'info');
                        const backupsDir = await window.electronAPI.getBackupsDir(instance.name);
                        const fileName = `cloud_temp_${backupItem.name}`;
                        const tempPath = `${backupsDir}/${fileName}`;

                        const downloadRes = await window.electronAPI.cloudDownload(provider, backupItem.id, tempPath);
                        if (downloadRes.success) {
                            addNotification(`Restoring ${backupItem.name}...`, 'info');
                            res = await window.electronAPI.restoreLocalBackup(instance.name, fileName);

                            await window.electronAPI.removeFile(tempPath);
                        } else {
                            addNotification(`Download failed: ${downloadRes.error}`, 'error');
                        }
                    }
                    if (res?.success) successCount++;
                }
                if (successCount > 0) addNotification(`Successfully restored ${successCount} backup(s)`, 'success');
            }
            onClose();
        } catch (e) {
            addNotification(`Action failed: ${e.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (id) => {
        if (type === 'cloud') {
            const isLogged = cloudStatus[selectedProvider]?.loggedIn;
            if (!isLogged) return;
        }

        setSelectedItems(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const renderItem = (item, isSelectable) => {
        const id = mode === 'backup' ? item.folderName : (type === 'local' ? item.name : item.id);
        const name = mode === 'backup' ? item.name : item.name;
        const sub = mode === 'backup' ? item.folderName : (item.date ? new Date(item.date).toLocaleString() : '');
        const isSelected = selectedItems.includes(id);

        const isCloudRestricted = type === 'cloud' && !cloudStatus[selectedProvider]?.loggedIn;

        return (
            <div
                key={id}
                onClick={() => !isCloudRestricted && toggleItem(id)}
                 className={`p-4 rounded-xl border transition-all flex items-center justify-between group ${isCloudRestricted ? 'opacity-40 grayscale cursor-not-allowed border-stroke' : 'cursor-pointer'} ${isSelected ? 'bg-primary/10 border-primary shadow-lg shadow-primary/5' : 'bg-muted border-stroke hover:border-stroke'}`}
            >
                <div className="flex items-center gap-4">
                     <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? 'bg-primary text-black' : (isCloudRestricted ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground')}`}>
                        {mode === 'backup' ? <FolderIcon className="h-6 w-6" /> : <ArchiveBoxIcon className="h-6 w-6" />}
                    </div>
                    <div>
                         <h4 className={`font-bold transition-colors ${isSelected ? 'text-foreground' : (isCloudRestricted ? 'text-muted-foreground' : 'text-foreground group-hover:text-primary')}`}>{name}</h4>
                         <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">{sub}</p>
                    </div>
                </div>
                {!isCloudRestricted && (
                     <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-primary border-primary' : 'border-stroke group-hover:border-stroke'}`}>
                        {isSelected && <CheckIcon className="h-4 w-4 text-black stroke-[3]" />}
                    </div>
                )}
            </div>
        );
    };

    const getFilteredList = () => {
        let list = mode === 'backup' ? worlds : (type === 'local' ? localBackups : cloudBackups);
        return list.filter(i => (i.name || i.folderName || '').toLowerCase().includes(searchQuery.toLowerCase()));
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-surface border border-stroke rounded-xl p-6 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center mb-6">
                    <div>
                         <h3 className="text-xl font-bold text-foreground">Backup Manager</h3>
                         <p className="text-sm text-muted-foreground">Manage your instance backups and world storage</p>
                    </div>
                     <button onClick={onClose} className="p-2 hover:bg-accent rounded-xl transition-colors">
                         <XMarkIcon className="h-6 w-6 text-muted-foreground" />
                    </button>
                </div>

                {view === 'mode-select' ? (
                    <div className="grid grid-cols-2 gap-4 py-8">
                        <button
                            onClick={() => { setMode('backup'); setView('setup'); }}
                             className="bg-muted border border-stroke p-8 rounded-xl flex flex-col items-center gap-4 hover:bg-primary/5 hover:border-primary/50 transition-all group"
                         >
                             <div className="w-20 h-20 rounded-xl bg-primary/10 text-primary flex items-center justify-center transition-transform">
                                 <ArrowUpTrayIcon className="h-10 w-10" />
                             </div>
                             <span className="font-bold text-lg text-foreground">Create Backup</span>
                             <span className="text-xs text-center text-muted-foreground">Backup your worlds to local storage or the cloud</span>
                        </button>
                        <button
                            onClick={() => { setMode('import'); setView('setup'); }}
                             className="bg-muted border border-stroke p-8 rounded-xl flex flex-col items-center gap-4 hover:bg-primary/5 hover:border-primary/50 transition-all group"
                         >
                             <div className="w-20 h-20 rounded-xl bg-primary/10 text-primary flex items-center justify-center transition-transform">
                                 <ArrowDownTrayIcon className="h-10 w-10" />
                             </div>
                             <span className="font-bold text-lg text-foreground">Import Backup</span>
                             <span className="text-xs text-center text-muted-foreground">Restore worlds from local files or cloud backups</span>
                        </button>
                    </div>
                ) : (
                    <>
                         <div className="flex bg-canvas p-1 rounded-xl border border-stroke mb-4">
                            <button
                                onClick={() => { setType('local'); setSelectedItems([]); }}
                                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${type === 'local' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                            >
                                Local Storage
                            </button>
                            <button
                                onClick={() => { setType('cloud'); setSelectedItems([]); }}
                                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${type === 'cloud' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                            >
                                Cloud Storage
                            </button>
                        </div>

                        {type === 'cloud' && (
                            <div className="grid grid-cols-2 gap-2 mb-6 animate-in slide-in-from-top-1 duration-200">
                                <button
                                    onClick={() => { setSelectedProvider('GOOGLE_DRIVE'); setSelectedItems([]); }}
                                    disabled={!cloudStatus.GOOGLE_DRIVE?.loggedIn}
                                     className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${selectedProvider === 'GOOGLE_DRIVE' ? 'bg-primary/10 border-primary text-primary shadow-lg shadow-primary/5' : 'bg-muted border-stroke text-muted-foreground hover:border-stroke'} ${!cloudStatus.GOOGLE_DRIVE?.loggedIn ? 'opacity-30 grayscale cursor-not-allowed border-dashed' : ''}`}
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 20h20L12 2z" /></svg>
                                    Google Drive
                                    {!cloudStatus.GOOGLE_DRIVE?.loggedIn && <span className="text-[8px] bg-red-500/20 text-red-500 px-1 rounded ml-1">Offline</span>}
                                </button>
                                <button
                                    onClick={() => { setSelectedProvider('DROPBOX'); setSelectedItems([]); }}
                                    disabled={!cloudStatus.DROPBOX?.loggedIn}
                                     className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${selectedProvider === 'DROPBOX' ? 'bg-primary/10 border-primary text-primary shadow-lg shadow-primary/5' : 'bg-muted border-stroke text-muted-foreground hover:border-stroke'} ${!cloudStatus.DROPBOX?.loggedIn ? 'opacity-30 grayscale cursor-not-allowed border-dashed' : ''}`}
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5-10-5-10 5z" /></svg>
                                    Dropbox
                                    {!cloudStatus.DROPBOX?.loggedIn && <span className="text-[8px] bg-red-500/20 text-red-500 px-1 rounded ml-1">Offline</span>}
                                </button>
                            </div>
                        )}

                        <div className="relative mb-4">
                             <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder={`Search for ${mode === 'backup' ? 'worlds' : 'backups'}...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                 className="w-full bg-muted border border-stroke rounded-xl py-2 pl-9 pr-3 text-sm text-foreground focus:border-primary outline-none transition-all"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 space-y-2 mb-6 custom-scrollbar min-h-[300px]">
                            {loading ? (
                                <div className="flex justify-center py-20">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                                </div>
                            ) : getFilteredList().length === 0 ? (
                                 <div className="text-center py-20 text-muted-foreground bg-muted rounded-xl border border-stroke border-dashed">
                                    No {mode === 'backup' ? 'worlds' : 'backups'} found.
                                </div>
                            ) : (
                                getFilteredList().map(item => renderItem(item, true))
                            )}
                        </div>

                         <div className="flex gap-3 pt-4 border-t border-stroke">
                            <button
                                onClick={() => setView('mode-select')}
                                 className="px-6 py-3 rounded-xl bg-muted hover:bg-accent text-foreground font-bold transition-all flex items-center gap-2"
                            >
                                <ArrowLeftIcon className="h-4 w-4" />
                                Back
                            </button>
                            <button
                                onClick={handleAction}
                                disabled={selectedItems.length === 0 || loading}
                                 className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg ${selectedItems.length === 0 || loading ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-black shadow-sm'}`}
                            >
                                {loading ? 'Processing...' : `${mode === 'backup' ? 'Create' : 'Restore'} ${selectedItems.length} Item(s)`}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BackupManagerModal;