import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import LoadingOverlay from '../components/LoadingOverlay';
import ConfirmationModal from '../components/ConfirmationModal';
import ServerConsole from '../components/ServerConsole';
import Dropdown from '../components/Dropdown';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import { Analytics } from '../services/Analytics';
import { fetchVersionsFor, fetchDetailsFor } from '../services/serverJars';

const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='4' width='20' height='16' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='8' y1='9' x2='16' y2='9'%3E%3C/line%3E%3Cline x1='8' y1='13' x2='16' y2='13'%3E%3C/line%3E%3Cline x1='8' y1='17' x2='12' y2='17'%3E%3C/line%3E%3C/svg%3E";
const formatUptime = (seconds, t) => {
    if (!seconds || seconds <= 0) return t('server.offline');
    const days = Math.floor(seconds / 84600);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

function ServerDashboard({ onServerClick, runningInstances = {}, isGuest }) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [servers, setServers] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [serverToDelete, setServerToDelete] = useState(null);
    const [selectedServer, setSelectedServer] = useState(null);
    const [showConsole, setShowConsole] = useState(false);
    const [newServerName, setNewServerName] = useState('');
    const [selectedVersion, setSelectedVersion] = useState('');
    const [selectedSoftware, setSelectedSoftware] = useState('vanilla');
    const [newServerIcon, setNewServerIcon] = useState(DEFAULT_ICON);
    const [serverPort, setServerPort] = useState('25565');
    const [maxPlayers, setMaxPlayers] = useState(new Date().getFullYear().toString());
    const [serverMemory, setServerMemory] = useState('1024');

    const [availableVersions, setAvailableVersions] = useState([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [platforms, setPlatforms] = useState([]);

    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef(null);
    const [showNameConflictModal, setShowNameConflictModal] = useState(false);
    const [conflictServer, setConflictServer] = useState(null);
    const [conflictOtherName, setConflictOtherName] = useState('');
    const [pendingServerData, setPendingServerData] = useState(null);
    const [actionBarActions, setActionBarActions] = useState([]);
    const serverSoftware = [
        { value: 'vanilla', label: 'Vanilla' },
        { value: 'paper', label: 'Paper' },
        { value: 'purpur', label: 'Purpur' },
        { value: 'spigot', label: 'Spigot' },
        { value: 'bukkit', label: 'Bukkit' },
        { value: 'fabric', label: 'Fabric' },
        { value: 'forge', label: 'Forge' },
        { value: 'neoforge', label: 'NeoForge' },
        { value: 'folia', label: 'Folia' },
        { value: 'bungeecord', label: 'BungeeCord' },
        { value: 'velocity', label: 'Velocity' }
    ];
    const memoryOptions = [
        { value: '4096', label: '4 GB' },
        { value: '6144', label: '6 GB' },
        { value: '8192', label: '8 GB' },
        { value: '10240', label: '10 GB' },
        { value: '16384', label: '16 GB' },
        { value: '32768', label: '32 GB' }
    ];

    useEffect(() => {
        loadServers();
        loadPlatforms();

        const removeListener = window.electronAPI.onServerStatus(({ serverName, status }) => {
            loadServers();
            if (selectedServer?.name === serverName && status === 'stopped') {
                addNotification(t('server.stop_notification', { name: serverName }), 'info');
            }
        });

        return () => {
            if (removeListener) removeListener();
        };
    }, [selectedServer]);

    useEffect(() => {
        const loadActionBarActions = async () => {
            try {
                const settingsRes = await window.electronAPI.getSettings();
                if (settingsRes?.success) {
                    const existingActions = Array.isArray(settingsRes.settings?.actionBarActions)
                        ? settingsRes.settings.actionBarActions
                        : [];
                    setActionBarActions(existingActions);
                }
            } catch (e) { }
        };

        loadActionBarActions();

        const removeSettingsListener = window.electronAPI?.onSettingsUpdated?.((newSettings) => {
            const existingActions = Array.isArray(newSettings?.actionBarActions)
                ? newSettings.actionBarActions
                : [];
            setActionBarActions(existingActions);
        });

        return () => {
            if (removeSettingsListener) removeSettingsListener();
        };
    }, []);

    const hasServerAction = (serverName) => {
        return actionBarActions.some((action) =>
            action?.target === serverName &&
            (action?.type === 'server:start' || action?.type === 'server:stop')
        );
    };

    useEffect(() => {
        if (showCreateModal) {
            resetCreateForm();
        }
    }, [showCreateModal]);

    useEffect(() => {
        if (!showCreateModal) return;

        const loadVersionsForSoftware = async () => {
            setLoadingVersions(true);
            try {
                const data = await fetchVersionsFor(selectedSoftware);

                let versionsList = [];
                if (Array.isArray(data)) {
                    versionsList = data.map(v => typeof v === 'string' ? { version: v } : v);
                } else if (data && data.versions) {
                    versionsList = data.versions.map(v => typeof v === 'string' ? { version: v } : v);
                }

                setAvailableVersions(versionsList);

                if (versionsList.length > 0) {
                    setSelectedVersion(versionsList[0].version);
                } else {
                    setSelectedVersion('');
                }
            } catch (error) {
                console.error('Failed to load versions:', error);
                addNotification(t('server.versions_failed', { software: selectedSoftware }), 'error');
                setAvailableVersions([]);
                setSelectedVersion('');
            } finally {
                setLoadingVersions(false);
            }
        };

        loadVersionsForSoftware();
    }, [showCreateModal, selectedSoftware]);

    useEffect(() => {
        if (selectedSoftware === 'bungeecord' || selectedSoftware === 'velocity') {
            setServerPort('25577');
        } else if (serverPort === '25577') {
            setServerPort('25565');
        }
    }, [selectedSoftware]);

    const loadPlatforms = async () => {
        try {

            const list = [
                { type: 'vanilla', name: 'Vanilla' },
                { type: 'paper', name: 'Paper' },
                { type: 'purpur', name: 'Purpur' },
                { type: 'spigot', name: 'Spigot' },
                { type: 'bukkit', name: 'Bukkit' },
                { type: 'fabric', name: 'Fabric' },
                { type: 'forge', name: 'Forge' },
                { type: 'neoforge', name: 'NeoForge' },
                { type: 'folia', name: 'Folia' },
                { type: 'bungeecord', name: 'BungeeCord' },
                { type: 'velocity', name: 'Velocity' }
            ];
            setPlatforms(list);
        } catch (error) {
            console.error('Failed to load platforms:', error);
        }
    };

    const loadServers = async () => {
        try {
            const list = await window.electronAPI.getServers();
            setServers(list || []);
        } catch (error) {
            console.error('Failed to load servers:', error);
            addNotification(t('server.load_failed'), 'error');
        }
    };

    const sanitizeFileNameFrontend = (name) => {
        if (!name) return '';
        return name.replace(/[^a-z0-9()\-\. ]/gi, '_').toLowerCase();
    };

    const resetCreateForm = () => {
        setNewServerName('');
        setNewServerIcon(DEFAULT_ICON);
        setSelectedSoftware('vanilla');
        setSelectedVersion('');
        setServerPort('25565');
        setMaxPlayers('20');
        setServerMemory('1024');
        setIsCreating(false);
    };

    const handleCreate = async (e) => {
        e.preventDefault();

        if (isCreating) return;

        if (!selectedVersion) {
            addNotification(t('server.select_version_error'), 'error');
            return;
        }

        setIsCreating(true);
        const nameToUse = newServerName.trim() || "New Server";
        const newPort = parseInt(serverPort) || 25565;
        let details;

        try {
            details = await fetchDetailsFor(selectedSoftware, selectedVersion);
        } catch (error) {
            setIsCreating(false);
            addNotification(t('server.create_failed', { error: error.message || 'Could not resolve download URL' }), 'error');
            return;
        }

        const downloadUrl = details?.downloadUrl;

        if (!downloadUrl) {
            setIsCreating(false);
            addNotification(t('server.create_failed', { error: 'No download URL found for selected version' }), 'error');
            return;
        }

        const serverData = {
            name: nameToUse,
            version: selectedVersion,
            software: selectedSoftware,
            port: newPort,
            maxPlayers: parseInt(maxPlayers) || 20,
            memory: parseInt(serverMemory) || 1024,
            icon: newServerIcon || DEFAULT_ICON,
            downloadUrl: downloadUrl
        };
        const existing = servers.find(s => s.name && s.name.toLowerCase() === nameToUse.toLowerCase());
        if (existing) {

            setConflictServer(existing);
            setConflictOtherName(nameToUse);
            setPendingServerData(serverData);
            setShowNameConflictModal(true);
            setIsCreating(false);
            return;
        }
        await doCreate(serverData);
    };

    const doCreate = async (serverData) => {
        setIsCreating(true);
        try {
            console.log(`Using direct provider fetch for ${serverData.software}/${serverData.version}`);
            console.log('Sending server data:', serverData);

            const result = await window.electronAPI.createServer(serverData);

            if (result && result.success) {
                setShowCreateModal(false);
                setShowNameConflictModal(false);
                await loadServers();
                addNotification(t('server.create_started', { name: result.serverName || serverData.name }), 'success');
                Analytics.trackServerCreation(serverData.software, serverData.version);
            } else {
                const errorMsg = result?.error || 'Unknown error occurred';
                addNotification(t('server.create_failed', { error: errorMsg }), 'error');
                console.error('Create server failed:', result);
            }
        } catch (err) {
            console.error('Error creating server:', err);
            addNotification(t('server.create_error', { error: err.message }), 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const performOverwrite = async () => {
        if (!conflictServer || !pendingServerData) return;
        setIsCreating(true);
        try {
            await window.electronAPI.deleteServer(conflictServer.name);
            await doCreate(pendingServerData);
        } catch (err) {
            console.error('Overwrite failed:', err);
            addNotification(t('server.overwrite_failed', { error: err.message }), 'error');
        } finally {
            setIsCreating(false);
            setShowNameConflictModal(false);
            setConflictServer(null);
            setPendingServerData(null);
        }
    };

    const performRename = async () => {
        if (!pendingServerData) return;
        setIsCreating(true);
        try {

            let counter = 1;
            let candidateRaw;
            while (true) {
                candidateRaw = `${pendingServerData.name} (${counter})`;
                const exists = await window.electronAPI.getServer(candidateRaw);
                if (!exists) break;
                counter++;
                if (counter > 200) break;
            }

            const dataWithSafe = { ...pendingServerData, safeName: candidateRaw };
            await doCreate(dataWithSafe);
        } catch (err) {
            console.error('Rename create failed:', err);
            addNotification(t('server.rename_failed', { error: err.message }), 'error');
        } finally {
            setIsCreating(false);
            setShowNameConflictModal(false);
            setConflictServer(null);
            setPendingServerData(null);
        }
    };

    const performUseOtherName = async () => {
        if (!pendingServerData) return;
        const newName = (conflictOtherName || '').trim();
        if (!newName) {
            addNotification(t('server.name_valid_error'), 'error');
            return;
        }
        const existing = servers.find(s => s.name && s.name.toLowerCase() === newName.toLowerCase());
        if (existing) {
            addNotification(t('server.name_in_use_error'), 'error');
            return;
        }

        const data = { ...pendingServerData, name: newName };
        await doCreate(data);
        setShowNameConflictModal(false);
        setConflictServer(null);
        setPendingServerData(null);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setNewServerIcon(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleContextMenu = (e, server) => {
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 180;
        const menuHeight = 280;
        let x = e.clientX;
        let y = e.clientY;

        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 10;
        }
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 10;
        }

        setContextMenu({ x, y, server });
    };

    const handleContextAction = async (action) => {
        const server = contextMenu?.server;
        if (!server) return;
        setContextMenu(null);

        try {
            switch (action) {
                case 'add-to-actionbar': {
                    const settingsRes = await window.electronAPI.getSettings();
                    if (!settingsRes?.success) {
                        addNotification('Failed to load settings', 'error');
                        break;
                    }

                    const existingActions = Array.isArray(settingsRes.settings?.actionBarActions)
                        ? settingsRes.settings.actionBarActions
                        : [];

                    const liveStatus = runningInstances[server.name] || server.status;
                    const isRunning = liveStatus === 'running';
                    const nextAction = {
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: isRunning ? `${server.name} (${t('server.stop')})` : `${server.name} (${t('server.start')})`,
                        type: isRunning ? 'server:stop' : 'server:start',
                        icon: server.icon && server.icon.startsWith('data:') ? server.icon : '',
                        path: '',
                        target: server.name
                    };

                    const saveRes = await window.electronAPI.saveSettings({
                        ...settingsRes.settings,
                        actionBarActions: [...existingActions, nextAction]
                    });

                    if (saveRes?.success) {
                        addNotification(t('action_bar.added', 'Added to Actionbar'), 'success');
                        setActionBarActions([...existingActions, nextAction]);
                    } else {
                        addNotification('Failed to save action', 'error');
                    }
                    break;
                }
                case 'remove-from-actionbar': {
                    const settingsRes = await window.electronAPI.getSettings();
                    if (!settingsRes?.success) {
                        addNotification('Failed to load settings', 'error');
                        break;
                    }

                    const existingActions = Array.isArray(settingsRes.settings?.actionBarActions)
                        ? settingsRes.settings.actionBarActions
                        : [];

                    const filteredActions = existingActions.filter((entry) =>
                        !(entry?.target === server.name && (entry?.type === 'server:start' || entry?.type === 'server:stop'))
                    );

                    const saveRes = await window.electronAPI.saveSettings({
                        ...settingsRes.settings,
                        actionBarActions: filteredActions
                    });

                    if (saveRes?.success) {
                        addNotification(t('action_bar.removed', 'Removed from Actionbar'), 'success');
                        setActionBarActions(filteredActions);
                    } else {
                        addNotification('Failed to remove action', 'error');
                    }
                    break;
                }
                case 'start':
                    if (isGuest) {
                        addNotification("To do that you have to be logged in", 'error');
                        return;
                    }
                    await window.electronAPI.startServer(server.name);
                    addNotification(t('server.start_notification', { name: server.name }), 'info');
                    break;
                case 'stop':
                    await window.electronAPI.stopServer(server.name);
                    addNotification(t('server.stop_notification', { name: server.name }), 'info');
                    break;
                case 'restart':
                    await window.electronAPI.restartServer(server.name);
                    addNotification(t('server.restart_notification', { name: server.name }), 'info');
                    break;
                case 'console':
                    handleServerClick(server);
                    break;
                case 'duplicate':
                    const duplicateResult = await window.electronAPI.duplicateServer(server.name);
                    if (duplicateResult.success) {
                        addNotification(t('server.duplicate_success', { name: server.name }), 'success');
                        await loadServers();
                    } else {
                        addNotification(t('server.duplicate_failed', { error: duplicateResult.error }), 'error');
                    }
                    break;
                case 'backup':
                    const backupResult = await window.electronAPI.backupServer(server.name);
                    if (backupResult.success) {
                        addNotification(t('server.backup_success', { path: backupResult.path }), 'success');
                    } else if (backupResult.error !== 'Cancelled') {
                        addNotification(t('server.backup_failed', { error: backupResult.error }), 'error');
                    }
                    break;
                case 'folder':
                    await window.electronAPI.openServerFolder(server.name);
                    break;
                case 'delete':
                    setServerToDelete(server);
                    setShowDeleteModal(true);
                    break;
                default:
                    break;
            }
        } catch (error) {
            console.error(`Error in context action ${action}:`, error);
            addNotification(t('server.action_failed', { error: error.message }), 'error');
        }
    };
    const handleServerAction = async (action, server) => {
        try {
            switch (action) {
                case 'start':
                    await window.electronAPI.startServer(server.name);
                    addNotification(`Starting ${server.name}...`, 'info');
                    break;
                case 'stop':
                    await window.electronAPI.stopServer(server.name);
                    addNotification(`Stopping ${server.name}...`, 'info');
                    break;
                case 'restart':
                    await window.electronAPI.restartServer(server.name);
                    addNotification(`Restarting ${server.name}...`, 'info');
                    break;
                default:
                    break;
            }
        } catch (error) {
            addNotification(t('server.action_failed', { error: error.message }), 'error');
        }
    };

    const handleDeleteConfirm = async () => {
        if (!serverToDelete) return;

        setIsLoading(true);
        try {
            const status = runningInstances[serverToDelete.name];
            if (status === 'running') {
                await window.electronAPI.stopServer(serverToDelete.name);
                addNotification(`Stopped ${serverToDelete.name}`, 'info');

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const result = await window.electronAPI.deleteServer(serverToDelete.name);

            if (result && result.success) {
                addNotification(t('server.delete_success', { name: serverToDelete.name }), 'info');
                await loadServers();
                if (selectedServer?.name === serverToDelete.name) {
                    setShowConsole(false);
                    setSelectedServer(null);
                }
            } else {
                addNotification(t('server.delete_failed_error', { error: result?.error || 'Unknown error' }), 'error');
            }
        } catch (e) {
            console.error('Delete error:', e);
            addNotification(t('server.delete_failed_error', { error: e.message }), 'error');
        } finally {
            setIsLoading(false);
            setShowDeleteModal(false);
            setServerToDelete(null);
        }
    };

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && showConsole) {
                setShowConsole(false);
                setSelectedServer(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showConsole]);

    const versionOptions = availableVersions.map(v => ({
        value: v.version,
        label: v.version
    }));

    const handleServerClick = (server) => {
        setSelectedServer(server);

        if (onServerClick) {
            onServerClick(server);
        }
    };

    return (
        <div className="p-8 h-full flex flex-col">
            {isLoading && <LoadingOverlay message="Processing..." />}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-foreground mb-1">{t('server.title')}</h1>
                    <p className="text-muted-foreground text-sm">{t('server.desc')}</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-primary hover:bg-primary-hover text-black font-bold px-6 py-3 rounded-xl shadow-md transition-all transform flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    {t('server.new_btn')}
                </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 pb-20 overflow-y-auto custom-scrollbar">
                {servers.map((server) => {
                    const liveStatus = runningInstances[server.name];
                    const status = liveStatus || server.status;
                    const isRunning = status === 'running';
                    const isStarting = status === 'starting';
                    const isStopping = status === 'stopping';

                    return (
                        <div
                            key={server.name}
                            onClick={() => handleServerClick(server)}
                            onContextMenu={(e) => handleContextMenu(e, server)}
                            className={`group bg-card/40 backdrop-blur-sm border rounded-xl p-4 transition-all cursor-pointer relative overflow-hidden shadow-lg hover:shadow-xl hover:shadow-black/50 ${isRunning ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-muted to-transparent opacity-0 group-hover:opacity-40 transition-opacity"></div>

                            { }
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleContextMenu(e, server);
                                }}
                                className="absolute top-3 right-3 z-20 w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                            >
                                <svg className="w-5 h-5 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                </svg>
                            </button>

                            <div className="flex items-start gap-4 mb-3 relative z-10">
                                <div className="w-16 h-16 bg-background rounded-lg flex items-center justify-center text-4xl shadow-inner border border-border overflow-hidden">
                                    {server.icon && server.icon.startsWith('data:') ? (
                                        <img src={server.icon} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" strokeWidth={1.5} />
                                            <line x1="8" y1="9" x2="16" y2="9" strokeWidth={1.5} />
                                            <line x1="8" y1="13" x2="16" y2="13" strokeWidth={1.5} />
                                            <line x1="8" y1="17" x2="12" y2="17" strokeWidth={1.5} />
                                        </svg>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-lg text-foreground truncate group-hover:text-primary transition-colors">{server.name}</h3>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                        <span className="bg-muted px-2 py-0.5 rounded capitalize border border-border">{server.software}</span>
                                        <span>{server.version}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Port: {server.port || '25565'}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-border relative z-10">
                                <div className="text-xs text-muted-foreground">
                                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{t('server.players')}</span>
                                    <span className="font-mono">{server.players || '0'}/{server.maxPlayers || '20'}</span>
                                </div>
                                <div className="text-xs text-muted-foreground text-right">
                                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{t('server.uptime')}</span>
                                    <span className="font-mono">{formatUptime(server.uptime, t)}</span>
                                </div>
                            </div>

                            <div className="flex justify-end mt-3 relative z-10">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (isGuest) {
                                            addNotification("To do that you have to be logged in", 'error');
                                            return;
                                        }
                                        if (isRunning) {
                                            window.electronAPI.stopServer(server.name);
                                            addNotification(`Stopping ${server.name}...`, 'info');
                                        } else if (!isStarting && !isStopping) {
                                            window.electronAPI.startServer(server.name);
                                            addNotification(`Starting ${server.name}...`, 'info');
                                        }
                                    }}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-lg z-20 ${isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : (isStarting || isStopping) ? 'bg-gray-700 text-muted-foreground cursor-wait' : 'bg-primary/20 text-primary hover:bg-primary/30'}`}
                                    disabled={isStarting || isStopping}
                                >
                                    {isRunning ? (
                                        <>
                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>
                                            {t('server.stop')}
                                        </>
                                    ) : isStarting ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                            {t('common.starting')}
                                        </>
                                    ) : isStopping ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin"></div>
                                            {t('server.stop_dots')}
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                            {t('server.start')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}

                {servers.length === 0 && (
                    <div className="col-span-full py-20 text-center text-muted-foreground border-2 border-border border-dashed rounded-xl flex flex-col items-center justify-center">
                        <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" strokeWidth={1.5} />
                            <line x1="8" y1="9" x2="16" y2="9" strokeWidth={1.5} />
                            <line x1="8" y1="13" x2="16" y2="13" strokeWidth={1.5} />
                            <line x1="8" y1="17" x2="12" y2="17" strokeWidth={1.5} />
                        </svg>
                        <p className="text-xl font-medium mb-2 text-muted-foreground">{t('server.no_servers')}</p>
                        <p className="text-sm">{t('server.create_prompt')}</p>
                    </div>
                )}
            </div>

            {contextMenu && createPortal(
                <div
                    className="fixed bg-card border border-border rounded-lg shadow-2xl py-2 z-[9999] min-w-[180px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.server.status === 'running' ? (
                        <>
                            <button onClick={() => handleContextAction('stop')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm text-red-400">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>
                                {t('server.stop')}
                            </button>
                            <button onClick={() => handleContextAction('restart')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                {t('server.restart')}
                            </button>
                        </>
                    ) : (
                        <button onClick={() => handleContextAction('start')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm text-primary">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                            {t('server.start')}
                        </button>
                    )}
                    <div className="border-t border-border my-1"></div>
                    <button onClick={() => handleContextAction('console')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        {t('server.console')}
                    </button>
                    <button onClick={() => handleContextAction('duplicate')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        {t('server.duplicate')}
                    </button>
                    <button onClick={() => handleContextAction('backup')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                        {t('server.backup_create')}
                    </button>
                    <button onClick={() => handleContextAction('folder')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        {t('server.folder')}
                    </button>
                    {hasServerAction(contextMenu.server?.name) ? (
                        <button onClick={() => handleContextAction('remove-from-actionbar')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm text-red-300">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7" /></svg>
                            {t('action_bar.remove_from_actionbar', 'Remove from Actionbar')}
                        </button>
                    ) : (
                        <button onClick={() => handleContextAction('add-to-actionbar')} className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm">
                            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            {t('action_bar.add_to_actionbar', 'Add to Actionbar')}
                        </button>
                    )}
                    <div className="border-t border-border my-1"></div>
                    <button onClick={() => handleContextAction('delete')} className="w-full px-4 py-2 text-left hover:bg-red-500/20 text-red-400 flex items-center gap-3 text-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        {t('server.delete')}
                    </button>
                </div>,
                document.body
            )}

            {showNameConflictModal && (
                <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 999999, background: 'transparent' }}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 shadow-2xl">
                        <h3 className="text-xl font-bold text-foreground mb-2">{t('server.conflict.title')}</h3>
                        <p className="text-sm text-muted-foreground mb-4">{t('server.conflict.desc', { name: conflictServer?.name })}</p>

                        <div className="grid grid-cols-1 gap-3 mb-4">
                            <button onClick={performOverwrite} className="w-full bg-red-500/20 text-red-400 px-4 py-2 rounded-xl font-bold">{t('server.conflict.overwrite')}</button>
                            <button onClick={performRename} className="w-full bg-primary/20 text-primary px-4 py-2 rounded-xl font-bold">{t('server.conflict.rename')}</button>
                        </div>

                        <div className="pt-2 border-t border-border">
                            <label className="block text-muted-foreground text-sm font-bold mb-2">{t('server.conflict.another')}</label>
                            <div className="flex gap-2">
                                <input value={conflictOtherName} onChange={(e) => setConflictOtherName(e.target.value)} className="flex-1 bg-background border border-border rounded-xl p-3 text-foreground" />
                                <button onClick={performUseOtherName} className="bg-primary px-4 py-2 rounded-xl font-bold">{t('server.conflict.use_name')}</button>
                            </div>
                        </div>

                        <div className="flex justify-end mt-4">
                            <button onClick={() => { setShowNameConflictModal(false); setPendingServerData(null); setConflictServer(null); }} className="px-4 py-2 rounded-xl text-muted-foreground">{t('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            )}

            { }
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card border border-border rounded-xl w-full max-w-2xl p-8 shadow-2xl transform transition-all scale-100 max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <h2 className="text-2xl font-bold mb-6 text-foreground text-center">{t('server.create_title')}</h2>
                        <form onSubmit={handleCreate} className="space-y-6">
                            { }
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-24 h-24 bg-background rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden relative group cursor-pointer hover:border-primary/50 transition-colors"
                                    onClick={() => fileInputRef.current?.click()}>
                                    <img src={newServerIcon} alt="Icon" className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        accept="image/*"
                                        className="hidden"
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground uppercase tracking-wide font-bold">{t('server.icon_label')}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.name_label')}</label>
                                    <input
                                        type="text"
                                        value={newServerName}
                                        onChange={(e) => setNewServerName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        placeholder="My Server"
                                    />
                                </div>

                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.port_label')}</label>
                                    <input
                                        type="number"
                                        value={serverPort}
                                        onChange={(e) => setServerPort(e.target.value)}
                                        className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        min="1"
                                        max="65535"
                                    />
                                </div>

                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.players_label')}</label>
                                    <input
                                        type="number"
                                        value={maxPlayers}
                                        onChange={(e) => setMaxPlayers(e.target.value)}
                                        placeholder="20"
                                        className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                        min="1"
                                        max="100000"
                                    />
                                </div>

                                <div>
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.memory_label')}</label>
                                    <Dropdown
                                        options={memoryOptions}
                                        value={serverMemory}
                                        onChange={setServerMemory}
                                        placeholder={t('server.memory_label')}
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.software_label')}</label>
                                    <Dropdown
                                        options={serverSoftware}
                                        value={selectedSoftware}
                                        onChange={setSelectedSoftware}
                                        placeholder={t('server.software_label')}
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide">{t('server.version_label')}</label>
                                    {loadingVersions ? (
                                        <div className="p-3 text-muted-foreground bg-background border border-border rounded-xl flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                            {t('server.versions_loading')}
                                        </div>
                                    ) : (
                                        <Dropdown
                                            options={versionOptions}
                                            value={selectedVersion}
                                            onChange={setSelectedVersion}
                                            placeholder={t('server.version_label')}
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between gap-3 pt-4 border-t border-border">
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={isCreating}
                                        onClick={async () => {
                                            try {
                                                const result = await window.electronAPI.importServer();
                                                if (result && result.success) {
                                                    addNotification(`Imported server: ${result.serverName}`, 'success');
                                                    setShowCreateModal(false);
                                                    loadServers();
                                                } else if (result && result.error !== 'Cancelled') {
                                                    addNotification(`Import failed: ${result.error}`, 'error');
                                                }
                                            } catch (error) {
                                                addNotification(`Import failed: ${error.message}`, 'error');
                                            }
                                        }}
                                        className="px-4 py-2 rounded-xl text-xs text-muted-foreground font-bold hover:text-accent-foreground hover:bg-accent transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border border-border"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                        Import Server
                                    </button>
                                </div>

                                <div className="flex gap-3 ml-auto">
                                    <button
                                        type="button"
                                        disabled={isCreating}
                                        onClick={() => setShowCreateModal(false)}
                                        className="px-6 py-2 rounded-xl text-muted-foreground font-bold hover:text-accent-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreating || loadingVersions || !selectedVersion}
                                        className="bg-primary hover:bg-primary-hover text-black font-bold px-8 py-2 rounded-xl shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                                    >
                                        {isCreating && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>}
                                        {isCreating ? 'Creating...' : 'Create Server'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            { }
            {showDeleteModal && (
                <ConfirmationModal
                    title="Delete Server"
                    message={`Are you sure you want to delete "${serverToDelete?.name}"? This will delete all server files and cannot be undone.`}
                    confirmText="Delete"
                    isDangerous={true}
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => {
                        setShowDeleteModal(false);
                        setServerToDelete(null);
                    }}
                />
            )}

            { }
            {showConsole && selectedServer && (
                <ServerConsole
                    server={selectedServer}
                    onClose={() => {
                        setShowConsole(false);
                        setSelectedServer(null);
                    }}
                    onServerAction={handleServerAction}
                />
            )}
        </div>
    );
}

export default ServerDashboard;