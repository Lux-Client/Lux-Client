import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../components/Dropdown';
import InstanceSettingsModal from '../components/InstanceSettingsModal';
import ModpackCodeModal from '../components/ModpackCodeModal';
import { useNotification } from '../context/NotificationContext';
import { Analytics } from '../services/Analytics';
import ToggleBox from '../components/ToggleBox';
import ExtensionSlot from '../components/Extensions/ExtensionSlot';
import BackupManagerModal from '../components/BackupManagerModal';
import { getSourceTags } from '../utils/sourceTags';
function InstanceDetails({ instance, onBack, runningInstances, onInstanceUpdate, isGuest }) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('content');
    const [contentView, setContentView] = useState('mods');
    const [searchCategory, setSearchCategory] = useState('mod');
    const [mods, setMods] = useState([]);
    const [resourcePacks, setResourcePacks] = useState([]);
    const [loadingResourcePacks, setLoadingResourcePacks] = useState(false);
    const [shaders, setShaders] = useState([]);
    const [loadingShaders, setLoadingShaders] = useState(false);
    const [installationStatus, setInstallationStatus] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [searchTimeout, setSearchTimeout] = useState(null);
    const [sortMethod, setSortMethod] = useState('relevance');
    const [provider, setProvider] = useState('modrinth');
    const [searchOffset, setSearchOffset] = useState(0);
    const [totalHits, setTotalHits] = useState(0);
    const limit = 10;
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [codeModalMode, setCodeModalMode] = useState('export');
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [worlds, setWorlds] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [log, setLog] = useState('');
    const [logFiles, setLogFiles] = useState([]);
    const [selectedLog, setSelectedLog] = useState('latest.log');
    const [logFilters, setLogFilters] = useState({
        info: true,
        warn: true,
        error: true,
        debug: false
    });
    const [autoScroll, setAutoScroll] = useState(true);
    const [isUploadingLog, setIsUploadingLog] = useState(false);
    const logContainerRef = useRef(null);
    const status = runningInstances[instance.name];
    const isRunning = status === 'running';
    const isLaunching = status === 'launching';
    const isInstalling = status === 'installing';
    const [showSettings, setShowSettings] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);
    const [projectVersions, setProjectVersions] = useState([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [localPending, setLocalPending] = useState(false);
    const [modToDelete, setModToDelete] = useState(null);
    const [updates, setUpdates] = useState({});
    const [checkingUpdates, setCheckingUpdates] = useState(false);
    const [updatingMod, setUpdatingMod] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [previewProject, setPreviewProject] = useState(null);
    const [lightboxIndex, setLightboxIndex] = useState(-1);
    const [worldToDelete, setWorldToDelete] = useState(null);
    const [showBackupManager, setShowBackupManager] = useState(false);
    const [isBackingUp, setIsBackingUp] = useState(false);

    const handleNextImage = (e) => {
        e.stopPropagation();
        if (previewProject && previewProject.gallery) {
            setLightboxIndex((prev) => (prev + 1) % previewProject.gallery.length);
        }
    };

    const handlePrevImage = (e) => {
        e.stopPropagation();
        if (previewProject && previewProject.gallery) {
            setLightboxIndex((prev) => (prev - 1 + previewProject.gallery.length) % previewProject.gallery.length);
        }
    };
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (lightboxIndex === -1) return;
            if (e.key === 'ArrowRight') handleNextImage(e);
            if (e.key === 'ArrowLeft') handlePrevImage(e);
            if (e.key === 'Escape') setLightboxIndex(-1);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxIndex, previewProject]);

    const handlePreview = async (project) => {
        try {
            const projectId = project.project_id || project.projectId;
            if (!projectId) {
                console.error('[Preview] No project ID found:', project);
                addNotification('No ID found for this project.', 'error');
                return;
            }

            addNotification(t('instance_details.actions.loading_preview', { title: project.title }), 'info');
            const res = await window.electronAPI.getModrinthProject(projectId);
            if (res.success) {
                const fullProject = {
                    ...res.project,
                    project_id: res.project.id,
                    project_type: project.project_type || 'mod'
                };
                setPreviewProject(fullProject);
                setShowPreviewModal(true);
            } else {
                addNotification('Failed to load preview: ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification('Error loading preview.', 'error');
        }
    };

    const handleSettingsSave = (newConfig) => {

        if (onInstanceUpdate) {
            onInstanceUpdate(newConfig);
        }
    };

    useEffect(() => {
        loadWorlds();
        if (activeTab === 'content') {
            if (contentView === 'mods') loadMods();
            if (contentView === 'resourcepacks') loadResourcePacks();
            if (contentView === 'shaders') loadShaders();
            if (contentView === 'search' && searchResults.length === 0) handleSearch(null, true);
        }
        if (activeTab === 'worlds') {
            loadWorlds();
        }
        if (activeTab === 'logs') {
            loadLogFiles();
            loadLog();
        }
    }, [activeTab, contentView, instance, selectedLog]);
    useEffect(() => {
        const installedIds = {};
        mods.forEach(m => { if (m.projectId) installedIds[m.projectId] = 'success'; });
        resourcePacks.forEach(p => { if (p.projectId) installedIds[p.projectId] = 'success'; });
        shaders.forEach(s => { if (s.projectId) installedIds[s.projectId] = 'success'; });

        setInstallationStatus(prev => ({
            ...prev,
            ...installedIds
        }));
    }, [mods, resourcePacks, shaders]);
    useEffect(() => {
        if (activeTab === 'content' && contentView === 'search') {
            handleSearch();
        }
    }, [sortMethod, searchOffset, activeTab, provider]);
    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [log, autoScroll]);
    useEffect(() => {
        if (contentView !== 'search') return;
        if (searchTimeout) clearTimeout(searchTimeout);

        const timeout = setTimeout(() => {
            setSearchOffset(0);
            handleSearch(null, true);
        }, 300);

        setSearchTimeout(timeout);
        return () => clearTimeout(timeout);
    }, [searchQuery, contentView, searchCategory, provider]);

    const loadMods = async () => {
        const res = await window.electronAPI.getMods(instance.name);
        if (res.success) setMods(res.mods);
    };

    const loadResourcePacks = async () => {
        setLoadingResourcePacks(true);
        try {
            const res = await window.electronAPI.getResourcePacks(instance.name);
            if (res.success) setResourcePacks(res.packs);
            else addNotification(t('instance_details.content.failed_packs'), 'error');
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingResourcePacks(false);
        }
    };

    const loadShaders = async () => {
        setLoadingShaders(true);
        try {
            const res = await window.electronAPI.getShaders(instance.name);
            if (res.success) setShaders(res.shaders);
            else addNotification(t('instance_details.content.failed_shaders'), 'error');
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingShaders(false);
        }
    };

    const loadWorlds = async () => {
        const res = await window.electronAPI.getWorlds(instance.name);
        if (res.success) setWorlds(res.worlds);
    };

    const handleOpenWorldFolder = async (world) => {
        const res = await window.electronAPI.openWorldFolder(instance.name, world.folderName);
        if (!res.success) addNotification('Error opening world folder: ' + res.error, 'error');
    };

    const handleBackupWorld = async (world) => {
        addNotification(`Creating backup of ${world.name}...`, 'info');
        const res = await window.electronAPI.backupWorld(instance.name, world.folderName);
        if (res.success) addNotification(`Backup created!`, 'success');
        else addNotification('Error creating backup: ' + res.error, 'error');
    };

    const handleDeleteWorld = async () => {
        if (!worldToDelete) return;
        const res = await window.electronAPI.deleteWorld(instance.name, worldToDelete.folderName);
        if (res.success) {
            addNotification(`World ${worldToDelete.name} deleted.`, 'success');
            loadWorlds();
            setWorldToDelete(null);
        } else {
            addNotification('Error deleting world: ' + res.error, 'error');
        }
    };

    const handleWorldBackupManager = (world) => {

        setShowBackupManager(true);
    };

    const handleExportWorld = async (world) => {
        addNotification(`Exporting ${world.name}...`, 'info');
        const res = await window.electronAPI.exportWorld(instance.name, world.folderName);
        if (res.success) addNotification(`World ${world.name} exported successfully.`, 'success');
        else if (res.error !== 'Export cancelled') addNotification('Error exporting world: ' + res.error, 'error');
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatWorldDate = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const loadLogFiles = async () => {
        const res = await window.electronAPI.getLogFiles(instance.name);
        if (res.success) {

            const names = res.files.map(f => f.name);
            setLogFiles(names);
        }
    };

    const loadLog = async () => {

        if (selectedLog === 'latest.log' && isRunning) {
            const live = await window.electronAPI.getLiveLogs(instance.name);
            setLog(live.join('\n'));
        } else {
            const res = await window.electronAPI.getLog(instance.name, selectedLog);
            if (res.success) setLog(res.content);
        }
    };
    useEffect(() => {

        if (isInstalling && selectedLog === 'latest.log') {
            setSelectedLog('install.log');
        }

        const isLiveRequest = (activeTab === 'logs' && selectedLog === 'latest.log' && (isRunning || isLaunching)) ||
            (activeTab === 'logs' && selectedLog === 'install.log' && isInstalling);

        if (isLiveRequest) {
            const removeListener = window.electronAPI.onLaunchLog((line) => {
                setLog(prev => prev + '\n' + line);
            });
            return () => {
                if (removeListener) removeListener();
            };
        }
    }, [activeTab, isRunning, isLaunching, isInstalling, selectedLog]);
    const prevStatusRef = useRef(status);
    useEffect(() => {

        const wasStopped = !prevStatusRef.current || prevStatusRef.current === 'stopped';
        const isStarting = status === 'launching' || status === 'installing';

        if (wasStopped && isStarting) {
            setActiveTab('logs');
            setSelectedLog(status === 'installing' ? 'install.log' : 'latest.log');
        }

        prevStatusRef.current = status;
    }, [status]);

    const { addNotification } = useNotification();

    const handleCopyLog = () => {
        navigator.clipboard.writeText(log).then(() => {
            addNotification("Log copied to clipboard!", 'success');
        }).catch(err => {
            console.error('Failed to copy: ', err);
            addNotification("Failed to copy log", 'error');
        });
    };

    const handleUploadLog = async () => {
        if (isUploadingLog) return;

        setIsUploadingLog(true);
        try {
            const result = await window.electronAPI.uploadInstanceLog(instance.name, selectedLog);
            if (!result?.success || !result?.url) {
                addNotification(`Upload failed: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }

            try {
                await navigator.clipboard.writeText(result.url);
                addNotification(`Log uploaded: ${result.url} (copied)`, 'success');
            } catch (_) {
                addNotification(`Log uploaded: ${result.url}`, 'success');
            }
        } catch (e) {
            console.error('Failed to upload log:', e);
            addNotification(`Upload failed: ${e.message}`, 'error');
        } finally {
            setIsUploadingLog(false);
        }
    };
    const handleToggleMod = async (fileName) => {
        await window.electronAPI.toggleMod(instance.name, fileName);
        loadMods();
    };

    const handleDeleteMod = (fileName, type = 'mod') => {
        setModToDelete({ name: fileName, type });
    };

    const confirmDeleteMod = async () => {
        if (!modToDelete) return;
        const res = await window.electronAPI.deleteMod(instance.name, modToDelete.name, modToDelete.type);
        const deletedType = modToDelete.type;
        setModToDelete(null);

        if (res && res.success) {
            addNotification(`${deletedType === 'mod' ? 'Mod' : deletedType === 'shader' ? 'Shader' : 'Resource pack'} deleted successfully`, 'success');
            if (deletedType === 'mod') loadMods();
            else if (deletedType === 'resourcepack') loadResourcePacks();
            else if (deletedType === 'shader') loadShaders();
        } else {
            addNotification(`Failed to delete ${deletedType}: ${res?.error || 'Unknown error'}`, 'error');
        }
    };

    const handleCheckUpdates = async (silent = false) => {
        setCheckingUpdates(true);
        try {
            const contentToCheck = [
                ...mods.filter(m => m.projectId).map(m => ({ projectId: m.projectId, versionId: m.versionId, source: m.source, type: 'mod', name: m.name })),
                ...resourcePacks.filter(p => p.projectId).map(p => ({ projectId: p.projectId, versionId: p.versionId, source: p.source, type: 'resourcepack', name: p.name })),
                ...shaders.filter(s => s.projectId).map(s => ({ projectId: s.projectId, versionId: s.versionId, source: s.source, type: 'shader', name: s.name }))
            ];

            if (contentToCheck.length === 0) {
                if (!silent) addNotification("No Modrinth content found to check for updates.", 'info');
                return;
            }

            const res = await window.electronAPI.checkUpdates(instance.name, contentToCheck);
            if (res.success) {
                const updateMap = {};
                res.updates.forEach(u => {
                    updateMap[u.projectId] = u;
                });
                setUpdates(updateMap);
                const count = Object.keys(updateMap).length;
                if (count > 0) {
                    if (!silent) addNotification(`Found ${count} update(s)!`, 'success');
                } else {
                    if (!silent) addNotification("All mods, resource packs and shaders are up to date.", 'success');
                }
            } else {
                if (!silent) addNotification("Failed to check for updates: " + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            if (!silent) addNotification("Error checking updates: " + e.message, 'error');
        } finally {
            setCheckingUpdates(false);
        }
    };
    useEffect(() => {
        if (activeTab === 'content' && (mods.length > 0 || resourcePacks.length > 0 || shaders.length > 0)) {

            if (Object.keys(updates).length === 0 && !checkingUpdates) {
                handleCheckUpdates(true);
            }
        }
    }, [mods.length, resourcePacks.length, shaders.length, activeTab]);

    const handleUpdateMod = async (updateData) => {
        setUpdatingMod(updateData.projectId);
        try {
            const res = await window.electronAPI.updateFile({
                instanceName: instance.name,
                projectType: updateData.type,
                oldFileName: updateData.name,
                newFileName: updateData.filename,
                url: updateData.downloadUrl
            });

            if (res.success) {
                addNotification(`Updated ${updateData.filename}!`, 'success');

                setUpdates(prev => {
                    const next = { ...prev };
                    delete next[updateData.projectId];
                    return next;
                });

                if (updateData.type === 'mod') loadMods();
                else if (updateData.type === 'shader') loadShaders();
                else loadResourcePacks();
            } else {
                addNotification(`Failed to update: ${res.error}`, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(`Update error: ${e.message}`, 'error');
        } finally {
            setUpdatingMod(null);
        }
    };

    const handleUpdateAll = async () => {
        const updateList = Object.values(updates);
        if (updateList.length === 0) return;

        addNotification(`Updating ${updateList.length} item(s)...`, 'info');
        for (const updateData of updateList) {
            await handleUpdateMod(updateData);
        }

        addNotification("All updates completed!", 'success');
    };
    const handleSearch = async (e?: any, isAuto = false) => {
        if (e) e.preventDefault();
        setSearching(true);

        const facets = [
            [`versions:${instance.version}`]
        ];
        if (searchCategory === 'mod' && instance.loader && instance.loader.toLowerCase() !== 'vanilla') {
            facets.push([`categories:${instance.loader.toLowerCase()}`]);
        }
        const index = sortMethod;

        const res = await window.electronAPI.searchModrinth(searchQuery, facets, {
            index,
            offset: searchOffset,
            limit,
            projectType: searchCategory,
            provider
        });
        if (res.success) {
            setSearchResults(res.results);
            setTotalHits(res.total_hits || 0);
        }
        setSearching(false);
    };

    const handleNextPage = () => {
        if (searchOffset + limit < totalHits) setSearchOffset(searchOffset + limit);
    };

    const handlePrevPage = () => {
        if (searchOffset - limit >= 0) setSearchOffset(searchOffset - limit);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (contentView === 'mods' || contentView === 'resourcepacks') {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (contentView !== 'mods' && contentView !== 'resourcepacks') return;

        const files: any[] = Array.from(e.dataTransfer.files);

        if (contentView === 'mods') {
            const validFiles = files.filter(f => f.name.toLowerCase().endsWith('.jar'));
            if (validFiles.length === 0) {
                addNotification("Please drop .jar files only", 'error');
                return;
            }

            let addedCount = 0;
            for (const file of validFiles) {
                if (file.path) {
                    const res = await window.electronAPI.installLocalMod(instance.name, file.path);
                    if (res.success) addedCount++;
                }
            }
            if (addedCount > 0) {
                addNotification(`Successfully added ${addedCount} mod(s)`, 'success');
                loadMods();
            }
        } else {
            const validFiles = files.filter(f => f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar'));
            if (validFiles.length === 0) {
                addNotification("Please drop .zip or .rar files only", 'error');
                return;
            }

            let addedCount = 0;
            for (const file of validFiles) {
                if (file.path) {
                    const res = await window.electronAPI.installLocalMod(instance.name, file.path, 'resourcepack');
                    if (res.success) addedCount++;
                }
            }
            if (addedCount > 0) {
                addNotification(`Successfully added ${addedCount} resource pack(s)`, 'success');
                loadResourcePacks();
            }
        }
    };

    const handleInstall = async (project) => {
        try {
            setInstallationStatus(prev => ({ ...prev, [project.project_id]: 'installing' }));
            const loaders = (searchCategory === 'resourcepack' || searchCategory === 'shader' || !instance.loader || instance.loader.toLowerCase() === 'vanilla')
                ? []
                : [instance.loader.toLowerCase()];
            const res = await window.electronAPI.getModVersions(
                project.project_id,
                loaders,
                [instance.version],
                project.curseforge_project_id || null
            );

            if (!res || !res.success || !res.versions || res.versions.length === 0) {
                addNotification("No compatible version found!", 'error');
                setInstallationStatus(prev => ({ ...prev, [project.project_id]: 'failed' }));
                return;
            }
            const targetVersion = res.versions[0];
            const file = targetVersion.files.find(f => f.primary) || targetVersion.files[0];
            const installProjectId = targetVersion.project_id || project.project_id;

            const installRes = await window.electronAPI.installMod({
                instanceName: instance.name,
                projectId: installProjectId,
                fallbackCurseForgeProjectId: project.curseforge_project_id || null,
                versionId: targetVersion.id,
                filename: file.filename,
                url: file.url,
                projectType: searchCategory
            });

            if (installRes && installRes.success) {
                addNotification(`Installed ${project.title}!`, 'success');
                setInstallationStatus(prev => ({ ...prev, [project.project_id]: 'success' }));
                Analytics.trackDownload(searchCategory, project.title, project.project_id);

                if (contentView === 'mods') loadMods();
                if (contentView === 'resourcepacks') loadResourcePacks();
                if (contentView === 'shaders') loadShaders();
            } else {
                addNotification(`Failed to install: ${installRes?.error || 'Unknown error'}`, 'error');
                setInstallationStatus(prev => ({ ...prev, [project.project_id]: 'failed' }));
            }
        } catch (e) {
            console.error('Install error:', e);
            addNotification(`Installation error: ${e.message}`, 'error');
            setInstallationStatus(prev => ({ ...prev, [project.project_id]: 'failed' }));
        }
    };

    const handleViewProject = async (project) => {
        setSelectedProject(project);
        setProjectVersions([]);
        setLoadingVersions(true);
        try {
            const loaders = (project.project_type === 'resourcepack' || project.project_type === 'shader' || !instance.loader || instance.loader.toLowerCase() === 'vanilla')
                ? []
                : [instance.loader.toLowerCase()];
            const res = await window.electronAPI.getModVersions(
                project.project_id,
                loaders,
                [instance.version],
                project.curseforge_project_id || null
            );
            if (res && res.success && res.versions) {
                setProjectVersions(res.versions);
            }
        } catch (e) {
            console.error('Failed to load versions:', e);
        } finally {
            setLoadingVersions(false);
        }
    };

    const handleInstallVersion = async (version) => {
        try {
            setInstallationStatus(prev => ({ ...prev, [selectedProject.project_id]: 'installing' }));
            const file = version.files.find(f => f.primary) || version.files[0];
            const installProjectId = version.project_id || selectedProject.project_id;
            const installRes = await window.electronAPI.installMod({
                instanceName: instance.name,
                projectId: installProjectId,
                fallbackCurseForgeProjectId: selectedProject.curseforge_project_id || null,
                versionId: version.id,
                filename: file.filename,
                url: file.url,
                projectType: searchCategory
            });

            if (installRes && installRes.success) {
                addNotification(`Installed ${selectedProject.title}!`, 'success');
                setInstallationStatus(prev => ({ ...prev, [selectedProject.project_id]: 'success' }));
                Analytics.trackDownload(searchCategory, selectedProject.title, selectedProject.project_id);
                if (contentView === 'mods') loadMods();
                if (contentView === 'resourcepacks') loadResourcePacks();
                if (contentView === 'shaders') loadShaders();
                setSelectedProject(null);
            } else {
                addNotification(`Failed to install: ${installRes?.error || 'Unknown error'}`, 'error');
                setInstallationStatus(prev => ({ ...prev, [selectedProject.project_id]: 'failed' }));
            }
        } catch (e) {
            console.error('Install error:', e);
            addNotification(`Installation error: ${e.message}`, 'error');
            setInstallationStatus(prev => ({ ...prev, [selectedProject.project_id]: 'failed' }));
        }
    };

    const handleLaunch = async () => {
        if (isGuest) {
            addNotification("To do that you have to be logged in", 'error');
            return;
        }
        if (isRunning || isLaunching || isInstalling || localPending) return;
        setLocalPending(true);
        try {
            const result = await window.electronAPI.launchGame(instance.name);
            if (!result.success) {
                addNotification(`Launch failed: ${result.error}`, 'error');
            }
        } catch (e) {
            console.error('Launch exception:', e);
            addNotification(`Launch failed: ${e.message}`, 'error');
        } finally {
            setLocalPending(false);
        }
    };
    const handleCodeImportComplete = async (modpackData) => {
        addNotification(`Starting background import for "${modpackData.name}"...`, 'info');

        try {

            const createRes = await window.electronAPI.createInstance(
                modpackData.name,
                modpackData.instanceVersion || modpackData.version,
                modpackData.instanceLoader || modpackData.loader,
                null
            );

            if (createRes.success) {
                const instanceName = createRes.instanceName;
                window.electronAPI.installSharedContent(instanceName, modpackData);

                addNotification(`Instance "${instanceName}" created. Mods are being downloaded in the background.`, 'success');
            } else {
                addNotification(`Failed to create instance: ${createRes.error}`, 'error');
            }
        } catch (error) {
            console.error('Code import error:', error);
            addNotification(`Error during import: ${error.message}`, 'error');
        }
    };
    const getFilteredLog = () => {
        if (!log) return [];
        const lines = log.replace(/\r\n/g, '\n').split('\n');
        return lines.filter(line => {
            if (!line.trim()) return false;
            const lower = line.toLowerCase();
            if (logFilters.error && lower.includes('error')) return true;
            if (logFilters.warn && lower.includes('warn')) return true;
            if (logFilters.info && lower.includes('info')) return true;
            if (logFilters.debug && lower.includes('debug')) return true;
            if (!lower.includes('error') && !lower.includes('warn') && !lower.includes('info') && !lower.includes('debug')) {
                return logFilters.error || logFilters.warn || logFilters.info || logFilters.debug;
            }
            return false;
        });
    };

    const TAB_CLASSES = (id) => `px-6 py-2 font-bold transition-all border-b-2 ${activeTab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-accent-foreground'}`;
    const getModVersion = (fileName) => {

        const parts = fileName.replace('.jar', '').replace('.disabled', '').split('-');
        if (parts.length > 1) {

            for (let i = parts.length - 1; i >= 0; i--) {
                if (/\d/.test(parts[i]) && parts[i].includes('.')) return 'v' + parts[i];
            }
            return 'v' + parts[parts.length - 1];
        }
        return '';
    };
    const getModName = (fileName) => {
        return fileName.replace('.jar', '').replace('.disabled', '').split('-')[0].replace(/_/g, ' ');
    };

    const hasImageIcon = typeof instance?.icon === 'string' && (
        instance.icon.startsWith('data:') ||
        instance.icon.startsWith('app-media://') ||
        instance.icon.startsWith('http://') ||
        instance.icon.startsWith('https://') ||
        instance.icon.startsWith('file://')
    );

    return (
        <div className="h-full flex flex-col bg-transparent">
            { }
            <div className="p-8 pb-0 flex items-center gap-6">
                <div className="w-32 h-32 bg-card rounded-xl flex items-center justify-center text-6xl shadow-2xl border border-border overflow-hidden">
                    {hasImageIcon ? (
                        <img src={instance.icon} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-6xl">{instance.icon || '📦'}</span>
                    )}
                </div>
                <div className="flex-1">
                    <h1 className="text-4xl font-bold mb-2 text-foreground tracking-tight flex items-center justify-between">
                        {instance.name}
                    </h1>
                    <div className="flex items-center gap-3 text-muted-foreground">
                        <span className="flex items-center gap-1.5 bg-card px-3 py-1 rounded-full border border-border text-sm">
                            {instance.loader === 'Forge' && <div className="w-2 h-2 rounded-full bg-blue-200"></div>}
                            {instance.loader || 'Vanilla'}
                        </span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-sm font-mono opacity-80">{instance.version}</span>
                    </div>
                </div>
                <div className="flex gap-3">
                    { }
                    {isRunning ? (
                        <button
                            onClick={() => window.electronAPI.killGame(instance.name)}
                            className="px-8 py-3 rounded-xl font-bold flex items-center gap-2 transform transition-all bg-red-700 hover:bg-red-600 text-white shadow-md"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            {t('common.stop')}
                        </button>
                    ) : (
                        <button
                            onClick={handleLaunch}
                            className={`px-8 py-3 rounded-xl font-bold flex items-center gap-2 transform transition-all ${status === 'launching' || status === 'installing' || localPending ? 'bg-gray-600/50 text-gray-300 cursor-not-allowed border-gray-500' : 'bg-primary hover:bg-primary-hover text-black shadow-md border-transparent'}`}
                            disabled={status === 'launching' || status === 'installing' || localPending}
                        >
                            {status === 'launching' || localPending ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white/80" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    {localPending ? t('common.starting') : t('common.launching')}
                                </>
                            ) : status === 'installing' ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white/80" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    {t('common.installing')}
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                    {t('common.play')}
                                </>
                            )}
                        </button>
                    )}

                    { }
                    <button onClick={() => setShowSettings(true)} className="p-3 rounded-xl bg-card hover:bg-accent text-foreground font-bold border border-border transition-colors" title={t('settings.title')}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>

                    { }
                    <div className="relative">
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            className="p-3 rounded-xl bg-card hover:bg-accent text-foreground font-bold border border-border transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                            </svg>
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden text-sm">
                                <button
                                    onClick={() => {
                                        window.electronAPI.openInstanceFolder(instance.name);
                                        setShowMenu(false);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                    {t('common.open_folder')}
                                </button>
                                <button
                                    onClick={async () => {
                                        setShowMenu(false);
                                        addNotification('Exporting instance...', 'info');
                                        try {
                                            const res = await window.electronAPI.exportInstance(instance.name);
                                            if (res.success) addNotification(`Exported to ${res.path}`, 'success');
                                            else if (res.error !== 'Cancelled') addNotification(`Export failed: ${res.error}`, 'error');
                                        } catch (e) {
                                            addNotification(`Export failed: ${e.message}`, 'error');
                                        }
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                    {t('instance_details.actions.export_mcpack')}
                                </button>
                                <button
                                    onClick={async () => {
                                        addNotification('Preparing export...', 'info');

                                        try {
                                            const [modsRes, packsRes, shadersRes] = await Promise.all([
                                                window.electronAPI.getMods(instance.name),
                                                window.electronAPI.getResourcePacks(instance.name),
                                                window.electronAPI.getShaders(instance.name)
                                            ]);

                                            if (modsRes.success) setMods(modsRes.mods);
                                            if (packsRes.success) setResourcePacks(packsRes.packs);
                                            if (shadersRes.success) setShaders(shadersRes.shaders);

                                            setCodeModalMode('export');
                                            setShowCodeModal(true);
                                        } catch (e) {
                                            console.error('Failed to prepare export:', e);
                                            addNotification('Failed to load content for export', 'error');
                                        } finally {
                                            setShowMenu(false);
                                        }
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    {t('instance_details.actions.export_code')}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowMenu(false);
                                        setShowBackupManager(true);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3 transition-colors text-primary"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0l-4-4m4-4v12" />
                                    </svg>
                                    {t('instance_details.actions.backup_manager')}
                                </button>
                                <button
                                    onClick={() => {
                                        window.electronAPI.reinstallInstance(instance.name);
                                        setShowMenu(false);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-3 transition-colors text-yellow-500"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                    {t('instance_details.actions.reinstall')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            { }
            <div className="px-8 mt-4">
                <ExtensionSlot name="instance.details" context={{ instanceName: instance.name, status, isRunning }} className="w-full flex gap-4 overflow-visible" />
            </div>

            { }
            <div className="px-8 mt-4 flex gap-2 border-b border-border">
                <button onClick={() => setActiveTab('content')} className={TAB_CLASSES('content')}>{t('instance_details.tabs.content')}</button>

                <button onClick={() => setActiveTab('worlds')} className={TAB_CLASSES('worlds')}>{t('instance_details.tabs.worlds')}</button>
                <button onClick={() => setActiveTab('logs')} className={TAB_CLASSES('logs')}>{t('instance_details.tabs.logs')}</button>
            </div>

            { }
            <div className="flex-1 overflow-hidden p-8 pt-4">
                {activeTab === 'content' && (
                    <div className="h-full flex flex-col min-h-0">
                        <div className="sticky top-0 z-20 flex justify-between items-center mb-4 py-2 bg-background backdrop-blur-xl -mx-8 px-8 border-b border-border animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="flex gap-1 bg-muted p-1 rounded-xl border border-border">
                                <button
                                    onClick={() => { setContentView('mods'); setLocalSearchQuery(''); }}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${contentView === 'mods' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                                    </svg>
                                    {t('instance_details.content.mods')}
                                </button>
                                <button
                                    onClick={() => { setContentView('resourcepacks'); setLocalSearchQuery(''); }}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${contentView === 'resourcepacks' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {t('instance_details.content.resourcepacks')}
                                </button>
                                <button
                                    onClick={() => { setContentView('shaders'); setLocalSearchQuery(''); }}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${contentView === 'shaders' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" />
                                    </svg>
                                    {t('instance_details.content.shaders')}
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                {contentView === 'search' && (
                                    <div className="flex gap-1 bg-background p-1 rounded-xl border border-border mr-2 animate-in zoom-in-95 duration-200">
                                        <button
                                            onClick={() => { setSearchCategory('mod'); setSearchOffset(0); }}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${searchCategory === 'mod' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                                        >
                                            {t('instance_details.content.mods')}
                                        </button>
                                        <button
                                            onClick={() => { setSearchCategory('resourcepack'); setSearchOffset(0); }}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${searchCategory === 'resourcepack' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                                        >
                                            {t('instance_details.content.packs_short')}
                                        </button>
                                        <button
                                            onClick={() => { setSearchCategory('shader'); setSearchOffset(0); }}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${searchCategory === 'shader' ? 'bg-primary text-black shadow-lg shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                                        >
                                            {t('instance_details.content.shaders')}
                                        </button>
                                    </div>
                                )}

                                {(contentView === 'mods' || contentView === 'resourcepacks' || contentView === 'shaders') && (
                                    <>
                                        <button
                                            onClick={() => { setContentView('search'); setLocalSearchQuery(''); }}
                                            className={`p-2 rounded-xl border transition-all duration-300 flex items-center justify-center ${(contentView as string) === 'search' ? 'bg-primary border-primary text-black shadow-lg shadow-sm' : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border'}`}
                                            title={t('instance_details.actions.add_content')}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                                            </svg>
                                        </button>
                                        {Object.keys(updates).length > 0 && (
                                            <button
                                                onClick={handleUpdateAll}
                                                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-sm transition-all transform"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                                {t('instance_details.actions.update_all')} ({Object.keys(updates).length})
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleCheckUpdates()}
                                            disabled={checkingUpdates}
                                            className={`p-2 rounded-xl border transition-all flex items-center justify-center ${checkingUpdates ? 'bg-muted border-border text-muted-foreground cursor-not-allowed' : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border'}`}
                                            title={t('instance_details.actions.check_updates')}
                                        >
                                            {checkingUpdates ? (
                                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                            )}
                                        </button>
                                        <div className="relative group">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-3 text-muted-foreground group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                            <input
                                                type="text"
                                                placeholder={t('instance_details.content.filter_placeholder')}
                                                value={localSearchQuery}
                                                onChange={(e) => setLocalSearchQuery(e.target.value)}
                                                className="bg-muted border border-border rounded-xl py-2 pl-9 pr-3 text-sm text-foreground w-48 focus:w-64 focus:border-primary focus:bg-accent outline-none transition-all shadow-inner"
                                            />
                                        </div>
                                    </>
                                )}

                                {contentView === 'search' && (
                                    <button
                                        onClick={() => { setContentView('mods'); setLocalSearchQuery(''); }}
                                        className="p-2.5 rounded-xl transition-all duration-300 flex items-center justify-center bg-primary text-black shadow-lg shadow-sm"
                                        title={t('instance_details.actions.back_to_content')}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {contentView === 'mods' ? (
                            <div
                                className={`flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar transition-all rounded-xl relative ${isDragging ? 'bg-primary/5 ring-2 ring-primary ring-dashed ring-offset-4 ring-offset-background' : ''}`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                {isDragging && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-[2px] z-10 rounded-xl pointer-events-none">
                                        <div className="bg-primary text-black p-4 rounded-full shadow-md mb-2 animate-bounce">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                            </svg>
                                        </div>
                                        <div className="text-primary font-bold text-lg">{t('instance_details.content.drop_mods')}</div>
                                        <div className="text-[10px] text-primary/60 uppercase tracking-widest mt-1">{t('instance_details.content.accepting_jars')}</div>
                                    </div>
                                )}
                                {mods.filter(m => m.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || m.name?.toLowerCase().includes(localSearchQuery.toLowerCase())).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <div className="text-4xl mb-4 opacity-50">📂</div>
                                        <p className="text-lg font-medium">{t('instance_details.content.no_mods')}</p>
                                        <button onClick={() => setContentView('search')} className="mt-4 text-primary hover:underline">{t('instance_details.content.browse_mods')}</button>
                                    </div>
                                ) : (
                                    mods.filter(m => m.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || m.name?.toLowerCase().includes(localSearchQuery.toLowerCase()))
                                        .sort((a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || ""))
                                        .map(mod => (
                                            <div key={mod.name} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border hover:border-border hover:bg-accent transition-all group">
                                                <div className="flex items-center gap-4">
                                                    {mod.icon ? (
                                                        <img src={mod.icon} alt="" className="w-10 h-10 rounded-lg bg-background object-cover" />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-background rounded-lg flex items-center justify-center text-muted-foreground font-mono text-xs border border-border">{t('instance.jar_label')}</div>
                                                    )}
                                                    <div>
                                                        <div className={`font-bold ${!mod.enabled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{mod.title || mod.name}</div>
                                                        <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                                                            <span className="bg-background px-1.5 rounded">{mod.version || 'v?'}</span>
                                                            <span className="opacity-50">{mod.name}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-6">
                                                    {updates[mod.projectId] && (
                                                        <button
                                                            onClick={() => handleUpdateMod(updates[mod.projectId])}
                                                            disabled={updatingMod === mod.projectId}
                                                            className={`p-2 rounded-lg transition-all transform ${updatingMod === mod.projectId ? 'bg-green-500/10 text-green-500 animate-pulse' : 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black'}`}
                                                            title={`Update to ${updates[mod.projectId].newVersionNumber}`}
                                                        >
                                                            {updatingMod === mod.projectId ? (
                                                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                                </svg>
                                                            ) : (
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                    <ToggleBox
                                                        checked={mod.enabled}
                                                        onChange={() => handleToggleMod(mod.name)}
                                                    />
                                                    <button onClick={() => handleDeleteMod(mod.name, 'mod')} className="text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-2">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>
                        ) : contentView === 'resourcepacks' ? (
                            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar transition-all rounded-xl relative">
                                {loadingResourcePacks ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                                        <p>{t('instance_details.content.listing_packs')}</p>
                                    </div>
                                ) : resourcePacks.filter(p => p.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || p.name?.toLowerCase().includes(localSearchQuery.toLowerCase())).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <div className="text-4xl mb-4 opacity-50">🎨</div>
                                        <p className="text-lg font-medium">{t('instance_details.content.no_packs')}</p>
                                        <p className="text-sm opacity-50 mb-4">{t('instance_details.content.check_folder_packs')}</p>
                                        <button onClick={() => { setContentView('search'); setSearchCategory('resourcepack'); }} className="mt-4 text-primary hover:underline font-bold">{t('instance_details.content.browse_packs')}</button>
                                    </div>
                                ) : (
                                    resourcePacks.filter(p => p.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || p.name?.toLowerCase().includes(localSearchQuery.toLowerCase()))
                                        .sort((a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || ""))
                                        .map(pack => (
                                            <div key={pack.name} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border hover:border-border hover:bg-accent transition-all group">
                                                <div className="flex items-center gap-4">
                                                    {pack.icon ? (
                                                        <img src={pack.icon} alt="" className="w-10 h-10 rounded-lg bg-background object-cover" />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-background rounded-lg flex items-center justify-center text-muted-foreground font-mono text-[10px] border border-border text-center leading-tight whitespace-pre-line">{t('instance.res_pack_label')}</div>
                                                    )}
                                                    <div>
                                                        <div className="font-bold text-foreground">{pack.title}</div>
                                                        <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                                                            {pack.version && <span className="bg-background px-1.5 rounded">{pack.version}</span>}
                                                            <span className="opacity-50">{pack.name}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-6">
                                                    {updates[pack.projectId] && (
                                                        <button
                                                            onClick={() => handleUpdateMod(updates[pack.projectId])}
                                                            disabled={updatingMod === pack.projectId}
                                                            className={`p-2 rounded-lg transition-all transform ${updatingMod === pack.projectId ? 'bg-green-500/10 text-green-500 animate-pulse' : 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black'}`}
                                                            title={`Update to ${updates[pack.projectId].newVersionNumber}`}
                                                        >
                                                            {updatingMod === pack.projectId ? (
                                                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                                </svg>
                                                            ) : (
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteMod(pack.name, 'resourcepack')} className="text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-2">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>
                        ) : contentView === 'shaders' ? (
                            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar transition-all rounded-xl relative">
                                {loadingShaders ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                                        <p>{t('instance_details.content.listing_shaders')}</p>
                                    </div>
                                ) : shaders.filter(s => s.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || s.name?.toLowerCase().includes(localSearchQuery.toLowerCase())).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <div className="text-4xl mb-4 opacity-50">✨</div>
                                        <p className="text-lg font-medium">{t('instance_details.content.no_shaders')}</p>
                                        <p className="text-sm opacity-50 mb-4">{t('instance_details.content.check_folder_shaders')}</p>
                                        <button onClick={() => { setContentView('search'); setSearchCategory('shader'); }} className="mt-4 text-primary hover:underline font-bold">{t('instance_details.content.browse_shaders')}</button>
                                    </div>
                                ) : (
                                    shaders.filter(s => s.title?.toLowerCase().includes(localSearchQuery.toLowerCase()) || s.name?.toLowerCase().includes(localSearchQuery.toLowerCase()))
                                        .sort((a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || ""))
                                        .map(shader => (
                                            <div key={shader.name} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border hover:border-border hover:bg-accent transition-all group">
                                                <div className="flex items-center gap-4">
                                                    {shader.icon ? (
                                                        <img src={shader.icon} alt="" className="w-10 h-10 rounded-lg bg-background object-cover" />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center text-primary font-mono text-[10px] border border-primary/20 text-center leading-tight whitespace-pre-line">{t('instance.shader_label')}</div>
                                                    )}
                                                    <div>
                                                        <div className="font-bold text-foreground">{shader.title}</div>
                                                        <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                                                            <span className="opacity-50">{shader.name}</span>
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handlePreview(shader); }}
                                                            className="text-[10px] bg-muted hover:bg-accent text-foreground px-2 py-0.5 rounded mt-1 border border-border flex items-center gap-1 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                            {t('instance_details.content.preview')}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-6">
                                                    {updates[shader.projectId] && (
                                                        <button
                                                            onClick={() => handleUpdateMod(updates[shader.projectId])}
                                                            disabled={updatingMod === shader.projectId}
                                                            className={`p-2 rounded-lg transition-all transform ${updatingMod === shader.projectId ? 'bg-green-500/10 text-green-500 animate-pulse' : 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black'}`}
                                                            title={`Update to ${updates[shader.projectId].newVersionNumber}`}
                                                        >
                                                            {updatingMod === shader.projectId ? (
                                                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                                </svg>
                                                            ) : (
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteMod(shader.name, 'shader')} className="text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-2">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 flex flex-col">
                                <form onSubmit={handleSearch} className="flex gap-3 mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="flex-1 relative group">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('instance_details.search.placeholder')}
                                            className="w-full bg-muted backdrop-blur-md border border-border rounded-xl p-3 pl-11 text-foreground focus:border-primary outline-none shadow-inner transition-all"
                                            autoFocus
                                        />
                                    </div>
                                    <button type="submit" className="bg-primary hover:bg-primary-hover text-black font-bold px-8 rounded-xl border border-transparent transition-all shadow-lg shadow-sm">{t('instance_details.search.search_btn')}</button>
                                </form>

                                <div className="flex justify-between items-center mb-4">
                                    <div className="text-sm text-muted-foreground">
                                        {t('instance_details.search.showing_results', { count: searchResults.length })}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex bg-muted p-1 rounded-xl border border-border">
                                            <button
                                                onClick={() => setProvider('modrinth')}
                                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${provider === 'modrinth' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                                            >
                                                Modrinth
                                            </button>
                                            <button
                                                onClick={() => setProvider('curseforge')}
                                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${provider === 'curseforge' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-accent-foreground'}`}
                                            >
                                                CurseForge
                                            </button>
                                        </div>
                                        <div className="w-48">
                                            <Dropdown
                                                options={[
                                                    { value: 'relevance', label: t('instance_details.search.relevance') },
                                                    { value: 'downloads', label: t('instance_details.search.downloads') },
                                                    { value: 'newest', label: t('instance_details.search.newest') },
                                                    { value: 'updated', label: t('instance_details.search.updated') }
                                                ]}
                                                value={sortMethod}
                                                onChange={setSortMethod}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                                    {searching ? (
                                        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
                                    ) : searchResults.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                            <div className="text-4xl mb-4">🔍</div>
                                            <p>{t('instance_details.search.no_results', { query: searchQuery })}</p>
                                        </div>
                                    ) : (
                                        searchResults.map(result => (
                                            <div key={result.project_id} className="bg-card p-4 rounded-xl flex items-center gap-4 border border-border hover:border-primary/50 transition-colors cursor-pointer" onClick={() => handleViewProject(result)}>
                                                <img src={result.icon_url || 'https://cdn.modrinth.com/placeholder.svg'} alt="" className="w-12 h-12 rounded-lg bg-background" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-bold text-lg text-foreground truncate">{result.title}</h3>
                                                        <span className="text-[10px] bg-background text-muted-foreground px-1.5 py-0.5 rounded border border-border">{result.project_type}</span>
                                                        {getSourceTags(result.source, result.sources).map((sourceTag) => (
                                                            <span key={`${result.project_id}-${sourceTag}`} className="text-[10px] bg-background text-muted-foreground px-1.5 py-0.5 rounded border border-border uppercase">{sourceTag}</span>
                                                        ))}
                                                    </div>
                                                    <p className="text-sm text-muted-foreground line-clamp-1">{result.description}</p>
                                                    {result.project_type === 'shader' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handlePreview(result); }}
                                                            className="text-xs bg-muted hover:bg-accent text-foreground px-3 py-1 rounded-lg mt-2 border border-border flex items-center gap-2 transition-colors w-fit"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                            Preview
                                                        </button>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleInstall(result); }}
                                                    disabled={installationStatus[result.project_id] === 'installing' || installationStatus[result.project_id] === 'success'}
                                                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all border border-border flex items-center gap-2 ${installationStatus[result.project_id] === 'success' ? 'bg-emerald-500 text-white shadow-sm' :
                                                        installationStatus[result.project_id] === 'failed' ? 'bg-red-500/20 text-red-500' :
                                                            installationStatus[result.project_id] === 'installing' ? 'bg-muted text-muted-foreground cursor-wait' :
                                                                'bg-muted hover:bg-primary hover:text-black text-foreground'
                                                        }`}
                                                    title="Install latest version"
                                                >
                                                    {installationStatus[result.project_id] === 'installing' ? (
                                                        <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                    ) : installationStatus[result.project_id] === 'success' ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                    ) : installationStatus[result.project_id] === 'failed' ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                    ) : (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                    )}
                                                    {installationStatus[result.project_id] === 'installing' ? t('instance_details.search.installing') :
                                                        installationStatus[result.project_id] === 'success' ? t('instance_details.search.installed') :
                                                            installationStatus[result.project_id] === 'failed' ? t('instance_details.search.failed') : t('instance_details.search.install')}
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>

                                { }
                                <div className="flex justify-between items-center bg-card p-2 rounded-xl border border-border shrink-0 mt-4">
                                    <button
                                        onClick={handlePrevPage}
                                        disabled={searchOffset === 0 || searching}
                                        className={`px-4 py-1.5 rounded-lg bg-muted hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold text-xs flex items-center gap-2 ${searchOffset === 0 ? 'invisible' : ''}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                                        {t('instance_details.search.previous')}
                                    </button>
                                    <div className="flex flex-col items-center">
                                        <span className="text-foreground font-bold text-sm">
                                            {Math.floor(searchOffset / limit) + 1}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                                            {t('instance_details.search.page_of', { count: Math.ceil(totalHits / limit) || 1 })}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleNextPage}
                                        disabled={searchOffset + limit >= totalHits || searching}
                                        className={`px-4 py-1.5 rounded-lg bg-muted hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold text-xs flex items-center gap-2 ${searchOffset + limit >= totalHits ? 'invisible' : ''}`}
                                    >
                                        {t('instance_details.search.next')}
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'worlds' && (
                    <div className="flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                        { }
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {t('instance_details.worlds.local_worlds')}
                                </h2>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {worlds.length === 0 ? (
                                <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted rounded-xl border border-dashed border-border">
                                    <div className="text-5xl mb-4 opacity-50">🌍</div>
                                    <p className="text-lg font-medium">{t('instance_details.worlds.no_worlds')}</p>
                                </div>
                            ) : (
                                worlds.map(world => (
                                    <div key={world.folderName} className="bg-card rounded-xl border border-border hover:border-border transition-all flex flex-col group overflow-hidden shadow-lg">
                                        { }
                                        <div className="relative h-32 bg-background overflow-hidden shrink-0">
                                            {world.hasIcon ? (
                                                <img src={world.iconData} alt="" className="w-full h-full object-cover transition-transform duration-500" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-green-900/20 to-blue-900/20 text-white/10 group-hover:text-white/20 transition-colors">
                                                    🌍
                                                </div>
                                            )}
                                            { }
                                            <div className="absolute top-3 left-3 flex gap-2">
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shadow-lg ${world.gameMode === 'Creative' ? 'bg-purple-500/80 text-white' :
                                                    world.gameMode === 'Survival' ? 'bg-green-500/80 text-white' :
                                                        world.gameMode === 'Adventure' ? 'bg-orange-500/80 text-white' :
                                                            world.gameMode === 'Spectator' ? 'bg-blue-500/80 text-white' :
                                                                'bg-gray-500/80 text-white'
                                                    }`}>
                                                    {world.gameMode || 'Unknown'}
                                                </span>
                                                {world.hardcore && (
                                                    <span className="bg-black/80 text-red-500 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shadow-lg border border-red-500/30">
                                                        {t('instance_details.worlds.hardcore')}
                                                    </span>
                                                )}
                                            </div>
                                            { }
                                            <div className="absolute bottom-3 right-3">
                                                <span className="bg-black/60 backdrop-blur-md text-white/70 px-2 py-0.5 rounded-md text-[10px] font-bold border border-white/5">
                                                    {world.version || 'Unknown'}
                                                </span>
                                            </div>
                                        </div>

                                        { }
                                        <div className="p-4 flex-1 flex flex-col">
                                            <h3 className="text-foreground font-bold text-lg truncate group-hover:text-primary transition-colors mb-1" title={world.name}>
                                                {world.name}
                                            </h3>

                                            <div className="grid grid-cols-2 gap-2 mt-auto pt-4 border-t border-border">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{t('instance_details.worlds.last_played')}</span>
                                                    <span className="text-xs text-foreground truncate" title={formatWorldDate(world.lastPlayed)}>
                                                        {formatWorldDate(world.lastPlayed)}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{t('instance_details.worlds.size')}</span>
                                                    <span className="text-xs text-foreground">
                                                        {formatSize(world.size)}
                                                    </span>
                                                </div>
                                            </div>

                                            { }
                                            <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-border">
                                                <button
                                                    onClick={() => handleOpenWorldFolder(world)}
                                                    className="p-2 bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground rounded-lg transition-all flex items-center justify-center group/btn"
                                                    title={t('common.open_folder')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => handleWorldBackupManager(world)}
                                                    className="p-2 bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground rounded-lg transition-all flex items-center justify-center group/btn"
                                                    title={t('instance_details.actions.backup_manager')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0l-4-4m4-4v12" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => handleExportWorld(world)}
                                                    className="p-2 bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground rounded-lg transition-all flex items-center justify-center group/btn"
                                                    title={t('instance_details.worlds.export_zip')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => setWorldToDelete(world)}
                                                    className="p-2 bg-red-500/5 hover:bg-red-500/20 text-red-500/70 hover:text-red-500 rounded-lg transition-all flex items-center justify-center group/btn"
                                                    title={t('instance_details.worlds.delete_world')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
                {activeTab === 'logs' && (
                    <div
                        className="flex flex-col h-full bg-background rounded-xl border border-border overflow-hidden shadow-inner"
                        style={{ backgroundColor: 'rgba(var(--background-dark-color-rgb, 17, 17, 17), var(--console-opacity, 0.8))' }}
                    >
                        { }
                        <div className="flex items-center justify-between p-2 bg-card border-b border-border">
                            <div className="relative w-48">
                                <Dropdown
                                    options={[
                                        { value: 'latest.log', label: 'latest.log' },
                                        ...logFiles.filter(f => f !== 'latest.log').map(f => ({ value: f, label: f }))
                                    ]}
                                    value={selectedLog}
                                    onChange={setSelectedLog}
                                    className=""
                                />
                            </div>

                            <div className="flex gap-4">
                                {['Info', 'Warn', 'Error', 'Debug'].map(level => (
                                    <label key={level} className="flex items-center gap-2 cursor-pointer select-none group">
                                        <div className={`w-3 h-3 rounded flex items-center justify-center border ${logFilters[level.toLowerCase()] ? 'bg-primary border-primary' : 'border-gray-600 bg-transparent'}`}>
                                            {logFilters[level.toLowerCase()] && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={logFilters[level.toLowerCase()]}
                                            onChange={() => setLogFilters(prev => ({ ...prev, [level.toLowerCase()]: !prev[level.toLowerCase()] }))}
                                            className="hidden"
                                        />
                                        <span className={`text-xs font-bold uppercase ${logFilters[level.toLowerCase()] ? 'text-foreground' : 'text-muted-foreground group-hover:text-accent-foreground'}`}>{level}</span>
                                    </label>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none group mr-2">
                                    <div className={`w-3 h-3 rounded flex items-center justify-center border ${autoScroll ? 'bg-primary border-primary' : 'border-gray-600 bg-transparent'}`}>
                                        {autoScroll && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={autoScroll}
                                        onChange={() => setAutoScroll(prev => !prev)}
                                        className="hidden"
                                    />
                                    <span className={`text-xs font-bold uppercase ${autoScroll ? 'text-foreground' : 'text-muted-foreground group-hover:text-accent-foreground'}`}>{t('instance_details.logs.auto_scroll')}</span>
                                </label>
                                <button onClick={() => { loadLogFiles(); loadLog(); }} className="px-3 py-1 bg-muted hover:bg-accent rounded-lg text-xs font-bold text-foreground uppercase tracking-wide border border-border transition-colors">{t('instance_details.logs.refresh')}</button>
                                <button
                                    onClick={handleUploadLog}
                                    disabled={isUploadingLog}
                                    className="px-3 py-1 bg-muted hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed rounded-lg text-xs font-bold text-foreground uppercase tracking-wide border border-border transition-colors"
                                >
                                    {isUploadingLog ? t('common.loading', 'Loading...') : t('instance_details.logs.upload', 'Upload')}
                                </button>
                                <button onClick={handleCopyLog} className="px-3 py-1 bg-muted hover:bg-accent rounded-lg text-xs font-bold text-foreground uppercase tracking-wide border border-border transition-colors">{t('instance_details.logs.copy')}</button>
                                <button onClick={() => setLog('')} className="px-3 py-1 bg-muted hover:bg-red-500/20 hover:text-red-400 rounded-lg text-xs font-bold text-foreground uppercase tracking-wide border border-border transition-colors">{t('instance_details.logs.clear')}</button>
                            </div>
                        </div>

                        { }
                        <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs text-foreground custom-scrollbar">
                            {getFilteredLog().length > 0 ? getFilteredLog().map((line, i) => (
                                <div key={i} className={`whitespace-pre-wrap leading-relaxed py-0.5 border-b border-transparent hover:bg-accent ${line.toLowerCase().includes('error') ? 'text-red-400 font-bold' : line.toLowerCase().includes('warn') ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                                    {line}
                                </div>
                            )) : (
                                <div className="text-muted-foreground italic py-10 text-center">
                                    {t('instance_details.logs.no_logs')}
                                </div>
                            )}
                        </div>
                    </div>
                )
                }
            </div >

            { }
            {
                showSettings && (
                    <InstanceSettingsModal
                        instance={instance}
                        onClose={() => setShowSettings(false)}
                        onSave={handleSettingsSave}
                        onDelete={onBack}
                    />
                )
            }

            { }
            {
                showCodeModal && (
                    <ModpackCodeModal
                        isOpen={showCodeModal}
                        onClose={() => setShowCodeModal(false)}
                        mode={codeModalMode}
                        instanceData={instance}
                        mods={mods}
                        resourcePacks={resourcePacks}
                        shaders={shaders}
                        onImportComplete={handleCodeImportComplete}
                    />
                )
            }

            { }
            {
                selectedProject && (
                    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 backdrop-blur-sm" onClick={() => setSelectedProject(null)}>
                        <div className="bg-popover w-full max-w-3xl max-h-[80vh] rounded-xl border border-border flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            { }
                            <div className="p-6 border-b border-border flex items-center gap-4">
                                <img src={selectedProject.icon_url || 'https://cdn.modrinth.com/placeholder.svg'} alt="" className="w-16 h-16 rounded-xl bg-card" />
                                <div className="flex-1">
                                    <h2 className="text-2xl font-bold">{selectedProject.title}</h2>
                                    <p className="text-muted-foreground text-sm">{selectedProject.description}</p>
                                </div>
                                <button onClick={() => setSelectedProject(null)} className="text-muted-foreground hover:text-accent-foreground p-2 hover:bg-accent rounded-lg transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            { }
                            <div className="flex-1 overflow-y-auto p-4">
                                {loadingVersions ? (
                                    <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
                                ) : projectVersions.length === 0 ? (
                                    <div className="text-center text-muted-foreground py-20">{t('search.no_versions')}</div>
                                ) : (
                                    <div className="space-y-2">
                                        {projectVersions.map(version => {
                                            const isCompatible = version.game_versions?.includes(instance.version) && version.loaders?.some(l => l.toLowerCase() === instance.loader?.toLowerCase());
                                            return (
                                                <div key={version.id} className={`p-4 rounded-xl border flex items-center gap-4 ${isCompatible ? 'bg-card border-primary/30' : 'bg-card border-border'}`}>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-foreground">{version.version_number}</span>
                                                            <span className={`text-xs px-2 py-0.5 rounded ${version.version_type === 'release' ? 'bg-green-500/20 text-green-400' : version.version_type === 'beta' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                                                                {version.version_type}
                                                            </span>
                                                            {isCompatible && <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">{t('instance_details.project.compatible')}</span>}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                                                            <span>MC: {version.game_versions?.slice(0, 5).join(', ')}{version.game_versions?.length > 5 ? '...' : ''}</span>
                                                            <span>|</span>
                                                            <span>{version.loaders?.join(', ')}</span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleInstallVersion(version)}
                                                        className="bg-muted hover:bg-primary hover:text-black text-foreground px-4 py-2 rounded-lg font-bold text-sm transition-all border border-border flex items-center gap-2 shrink-0"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                        {t('search.install')}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            { }
            {
                showPreviewModal && previewProject && (
                    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-card w-full max-w-5xl h-[85vh] rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden animate-scale-in">
                            { }
                            <div className="p-6 border-b border-border flex justify-between items-start bg-background">
                                <div className="flex gap-4">
                                    <img
                                        src={previewProject.icon_url || 'https://cdn.modrinth.com/placeholder.svg'}
                                        className="w-16 h-16 rounded-xl shadow-lg"
                                        alt=""
                                    />
                                    <div>
                                        <h2 className="text-2xl font-bold text-foreground mb-1">{previewProject.title}</h2>
                                        <p className="text-muted-foreground text-sm max-w-xl line-clamp-2">{previewProject.description}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowPreviewModal(false)}
                                    className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            { }
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-background/50">
                                {previewProject.gallery && previewProject.gallery.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {previewProject.gallery.map((img, idx) => (
                                            <div
                                                key={idx}
                                                className="relative group rounded-xl overflow-hidden border border-border bg-background aspect-video cursor-zoom-in"
                                                onClick={() => setLightboxIndex(idx)}
                                            >
                                                <img
                                                    src={img.url}
                                                    alt={img.title || 'Gallery Image'}
                                                    className="w-full h-full object-cover transition-transform duration-500"
                                                />
                                                {img.title && (
                                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/70 backdrop-blur-sm text-xs text-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {img.title}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        <p>{t('search.no_gallery')}</p>
                                    </div>
                                )}
                            </div>

                            { }
                            <div className="p-6 border-t border-border bg-card flex justify-end gap-4">
                                <button
                                    onClick={() => setShowPreviewModal(false)}
                                    className="px-6 py-3 rounded-xl hover:bg-accent text-foreground font-bold transition-colors"
                                >
                                    {t('instance_details.logs.clear').toLowerCase().includes('clear') ? 'Close' : 'Schließen'}
                                </button>
                                <button
                                    onClick={() => {
                                        handleInstall(previewProject);
                                    }}
                                    disabled={installationStatus[previewProject.project_id] === 'installing' || installationStatus[previewProject.project_id] === 'success'}
                                    className={`font-bold px-8 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 ${installationStatus[previewProject.project_id] === 'success'
                                        ? 'bg-emerald-500 text-white shadow-sm'
                                        : 'bg-primary text-black shadow-sm hover:bg-primary-hover'
                                        }`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                                    </svg>
                                    {installationStatus[previewProject.project_id] === 'success' ? 'Installed' : 'Install'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            { }
            {
                lightboxIndex !== -1 && previewProject && previewProject.gallery && (
                    <div
                        className="fixed inset-0 bg-black/95 z-[210] flex items-center justify-center animate-fade-in backdrop-blur-xl select-none"
                        onClick={() => setLightboxIndex(-1)}
                    >
                        { }
                        <button
                            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-50"
                            onClick={() => setLightboxIndex(-1)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        { }
                        <button
                            className="absolute left-6 top-1/2 -translate-y-1/2 p-4 bg-black/50 hover:bg-white/10 rounded-full text-white transition-colors z-50 backdrop-blur-sm group"
                            onClick={handlePrevImage}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            className="absolute right-6 top-1/2 -translate-y-1/2 p-4 bg-black/50 hover:bg-white/10 rounded-full text-white transition-colors z-50 backdrop-blur-sm group"
                            onClick={handleNextImage}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>

                        { }
                        <div className="absolute top-6 left-6 text-white font-bold bg-black/50 px-4 py-2 rounded-full backdrop-blur-sm">
                            {lightboxIndex + 1} / {previewProject.gallery.length}
                        </div>

                        { }
                        <div
                            className="w-full h-full flex items-center justify-center p-4 md:p-20"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <img
                                src={previewProject.gallery[lightboxIndex].url}
                                alt={previewProject.gallery[lightboxIndex].title || t('instance.lightbox_image')}
                                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-scale-in"
                            />
                            {previewProject.gallery[lightboxIndex].title && (
                                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-6 py-3 rounded-full text-white font-medium">
                                    {previewProject.gallery[lightboxIndex].title}
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            { }
            { }
            {
                worldToDelete && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
                            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center text-3xl mb-4 mx-auto">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-foreground text-center mb-2">{t('instance.delete_world_title')}</h3>
                            <p className="text-muted-foreground text-center mb-6">
                                {t('instance.delete_world_confirm', { name: worldToDelete.name })}
                                <br />
                                <span className="text-red-500/80 text-sm mt-2 block">{t('instance.undone_warning')}</span>
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setWorldToDelete(null)}
                                    className="flex-1 px-4 py-2 rounded-xl bg-muted hover:bg-accent text-foreground font-bold transition-all"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleDeleteWorld}
                                    className="flex-1 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold transition-all shadow-lg shadow-red-700/20"
                                >
                                    {t('instance.delete_world_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            { }
            {
                modToDelete && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
                            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center text-3xl mb-4 mx-auto">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-foreground text-center mb-2">
                                {modToDelete.type === 'mod' ? t('instance.delete_mod_title') :
                                    modToDelete.type === 'shader' ? t('instance.delete_shader_title') :
                                        t('instance.delete_pack_title')}
                            </h3>
                            <p className="text-muted-foreground text-center mb-6">
                                {t('instance.delete_mod_confirm', { name: modToDelete.name || modToDelete.filename })}
                                <br />
                                <span className="text-red-500/80 text-sm mt-2 block">{t('instance.undone_warning')}</span>
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setModToDelete(null)}
                                    className="flex-1 px-4 py-2 rounded-xl bg-muted hover:bg-accent text-foreground font-bold transition-all"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={confirmDeleteMod}
                                    className="flex-1 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold transition-all shadow-lg shadow-red-700/20"
                                >
                                    {modToDelete.type === 'mod' ? t('instance.delete_mod_btn') :
                                        modToDelete.type === 'shader' ? t('instance.delete_shader_btn') :
                                            t('instance.delete_pack_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            { }
            {
                showBackupManager && (
                    <BackupManagerModal
                        instance={instance}
                        worlds={worlds}
                        onClose={() => {
                            setShowBackupManager(false);
                            loadWorlds();
                        }}
                    />
                )
            }
        </div >
    );
}

export default InstanceDetails;
