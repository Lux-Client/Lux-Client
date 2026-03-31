import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Dropdown from '../components/Dropdown';
import { useNotification } from '../context/NotificationContext';
import LoadingOverlay from '../components/LoadingOverlay';
import ConfirmationModal from '../components/ConfirmationModal';
import { Analytics } from '../services/Analytics';
import ModpackCodeModal from '../components/ModpackCodeModal';
import OptimizedImage from '../components/OptimizedImage';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/layout/PageHeader';
import { PixelEditorModal } from '../components/PixelEditorModal';
import PageContent from '../components/layout/PageContent';
import EmptyState from '../components/layout/EmptyState';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import { filterInstancesForMode } from '../utils/instanceTypes';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import {
  Play,
  Square,
  Clock,
  Plus,
  Search,
  MoreVertical,
  Folder,
  Box,
  Eye,
  Copy,
  Download,
  FolderOpen,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileDown,
  Zap,
  ImageIcon,
} from 'lucide-react';

const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'%3E%3C/path%3E%3Cpolyline points='3.27 6.96 12 12.01 20.73 6.96'%3E%3C/polyline%3E%3Cline x1='12' y1='22.08' x2='12' y2='12'%3E%3C/line%3E%3C/svg%3E";

const InstanceCard = ({
  instance,
  runningInstances,
  activeDownloads,
  pendingLaunches,
  onInstanceClick,
  selectionMode,
  isSelected,
  isSelectable,
  onToggleSelect,
  onContextAction,
  actionMenu,
  addNotification,
  loadInstances,
  setPendingLaunches,
  t,
  isGuest,
}) => {
  const formatPlaytime = (ms) => {
    if (!ms || ms <= 0) return t('common.time.0h');
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return t('common.time.hours_minutes', { hours, minutes });
    return t('common.time.minutes', { minutes });
  };

  const liveStatus = runningInstances[instance.name];
  const persistedStatus = instance.status;
  const installStateKey = Object.keys(activeDownloads).find(
    k => k.toLowerCase() === instance.name.toLowerCase()
  );
  const installState = installStateKey ? activeDownloads[installStateKey] : null;
  const isInstalling = !!installState;
  const status = isInstalling
    ? 'installing'
    : liveStatus || (persistedStatus === 'installing' ? 'installing' : null);
  const isRunning = status === 'running';
  const isLaunching = status === 'launching';

  return (
    <div
      onClick={() => onInstanceClick(instance)}
      className={`group relative rounded-lg border p-3 transition-colors cursor-pointer ${isSelected
        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
        : isRunning
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:bg-accent/50 active:bg-accent'
        }`}
    >
      <div className="flex items-start gap-3 mb-2.5">
        {selectionMode && (
          <label
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSelectable ? 'cursor-pointer border-border' : 'cursor-not-allowed border-border/60 opacity-50'}`}
            onClick={(e) => e.stopPropagation()}
            title={isSelectable ? t('dashboard.selection.toggle', 'Select instance') : t('dashboard.selection.not_selectable', 'External profiles cannot be selected')}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer"
              checked={!!isSelected}
              disabled={!isSelectable}
              onChange={() => {
                if (isSelectable) onToggleSelect(instance.name);
              }}
            />
          </label>
        )}
        {instance.icon &&
          (instance.icon.startsWith('data:') ||
            instance.icon.startsWith('app-media://') ||
            instance.icon.startsWith('http')) ? (
          <OptimizedImage
            src={instance.icon}
            alt={instance.name}
            className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden border border-border shrink-0"
            fallback={<Box className="w-6 h-6 text-muted-foreground" />}
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center border border-border shrink-0">
            <span className="text-xl">{instance.icon || ''}</span>
            {!instance.icon && <Box className="w-6 h-6 text-muted-foreground" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">{instance.name}</h3>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
            <span className="capitalize">{String(instance.loader || 'Vanilla').trim() || 'Vanilla'}</span>
            <span className="text-border">·</span>
            <span>{String(instance.version || '').trim() || 'Unknown'}</span>
          </div>
          {status && status !== 'ready' && status !== 'stopped' && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Badge
                variant={isRunning ? 'default' : 'secondary'}
                className="text-[10px] px-1.5 py-0 h-4 gap-1"
              >
                {isRunning && <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                {isInstalling
                  ? installState
                    ? installState.type === 'duplicate'
                      ? `${t('common.duplicating', 'Duplicating...')} (${installState.progress}%)`
                      : `${t('common.installing')} (${installState.progress}%)`
                    : t('common.installing')
                  : isLaunching
                    ? t('common.starting')
                    : t('common.running')}
              </Badge>
            </div>
          )}
        </div>

        {actionMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            {actionMenu}
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onContextAction && onContextAction(e, instance);
            }}
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        )}
      </div>

      <Separator className="mb-2" />

      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatPlaytime(instance.playtime)}
        </span>
        <Button
          variant={isRunning ? 'destructive' : 'default'}
          size="sm"
          className={`h-7 gap-1 text-xs ${!isRunning && !isInstalling && !isLaunching && !pendingLaunches[instance.name]
            ? 'opacity-0 group-hover:opacity-100 transition-opacity'
            : ''
            }`}
          onClick={async (e) => {
            e.stopPropagation();
            if (isGuest) {
              addNotification('To do that you have to be logged in', 'error');
              return;
            }
            if (isRunning) {
              window.electronAPI.killGame(instance.name);
              addNotification(`Stopping ${instance.name}...`, 'info');
            } else if (!isInstalling && !isLaunching && !pendingLaunches[instance.name]) {
              setPendingLaunches(prev => ({ ...prev, [instance.name]: true }));
              try {
                const result = await window.electronAPI.launchGame(instance.name);
                if (!result.success) {
                  addNotification(`Launch failed: ${result.error}`, 'error');
                } else {
                  addNotification(`Launching ${instance.name}...`, 'info');
                }
              } catch (err) {
                addNotification(`Launch error: ${err.message}`, 'error');
              } finally {
                setPendingLaunches(prev => {
                  const next = { ...prev };
                  delete next[instance.name];
                  return next;
                });
              }
            }
          }}
          disabled={isInstalling || isLaunching || pendingLaunches[instance.name]}
          title={
            isRunning
              ? t('common.stop')
              : isInstalling
                ? installState
                  ? installState.status
                  : t('common.installing')
                : isLaunching
                  ? t('common.starting')
                  : pendingLaunches[instance.name]
                    ? t('common.starting')
                    : t('dashboard.launch_game', 'Launch Game')
          }
        >
          {isRunning ? (
            <>
              <Square className="w-3 h-3" />
              {t('common.stop')}
            </>
          ) : isInstalling || isLaunching || pendingLaunches[instance.name] ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              {isInstalling
                ? installState?.type === 'duplicate'
                  ? t('common.duplicating', 'Duplicating...')
                  : t('common.installing')
                : t('common.starting')}
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              {t('common.play')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

function Dashboard({
  onInstanceClick,
  runningInstances = {},
  activeDownloads = {},
  triggerCreate,
  onCreateHandled,
  isGuest,
}) {
  const { addNotification } = useNotification();
  const { t } = useTranslation();
  const [instances, setInstances] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPixelEditor, setShowPixelEditor] = useState(false);

  useEffect(() => {
    if (triggerCreate) {
      setShowCreateModal(true);
      if (onCreateHandled) onCreateHandled();
    }
  }, [triggerCreate]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [instanceToDelete, setInstanceToDelete] = useState(null);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceFolderPath, setNewInstanceFolderPath] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedLoader, setSelectedLoader] = useState('Vanilla');
  const [newInstanceIcon, setNewInstanceIcon] = useState(DEFAULT_ICON);
  const [availableVersions, setAvailableVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState('');
  const [availableLoaders, setAvailableLoaders] = useState({
    Vanilla: true,
    Fabric: true,
    Forge: true,
    NeoForge: true,
    Quilt: true,
  });
  const [checkingLoaders, setCheckingLoaders] = useState(false);
  const [pendingLaunches, setPendingLaunches] = useState({});
  const [installProgress, setInstallProgress] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const [sortMethod, setSortMethod] = useState('playtime');
  const [groupMethod, setGroupMethod] = useState('none');
  const [groupBySourceEnabled, setGroupBySourceEnabled] = useState(true);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [showExportChoiceModal, setShowExportChoiceModal] = useState(false);
  const [showExportCodeModal, setShowExportCodeModal] = useState(false);
  const [exportTargetInstance, setExportTargetInstance] = useState(null);
  const [exportCodeInstanceData, setExportCodeInstanceData] = useState(null);
  const [exportCodeMods, setExportCodeMods] = useState([]);
  const [exportCodeResourcePacks, setExportCodeResourcePacks] = useState([]);
  const [exportCodeShaders, setExportCodeShaders] = useState([]);
  const [isPreparingCodeExport, setIsPreparingCodeExport] = useState(false);
  const [showMoveFolderModal, setShowMoveFolderModal] = useState(false);
  const [folderTargetInstance, setFolderTargetInstance] = useState(null);
  const [folderInputPath, setFolderInputPath] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedInstanceNames, setSelectedInstanceNames] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [actionBarActions, setActionBarActions] = useState([]);
  const fileInputRef = useRef(null);
  const [showSnapshots, setShowSnapshots] = useState(false);

  const normalizeFolderPath = (value = '') => {
    const segments = String(value)
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== '.' && segment !== '..');
    return segments.join('/');
  };

  const splitFolderPath = (value = '') => {
    const normalized = normalizeFolderPath(value);
    return normalized ? normalized.split('/') : [];
  };

  const handleCodeImportComplete = async (modpackData) => {
    addNotification(t('dashboard.import_starting', { name: modpackData.name }), 'info');

    try {
      const createRes = await window.electronAPI.createInstance(
        modpackData.name,
        modpackData.instanceVersion || modpackData.version,
        modpackData.instanceLoader || modpackData.loader,
        null
      );

      if (createRes.success) {
        const instanceName = createRes.instanceName;
        setInstallProgress(prev => ({
          ...prev,
          [instanceName]: { progress: 0, status: 'Starting import...' },
        }));
        window.electronAPI.installSharedContent(instanceName, modpackData);
        addNotification(t('dashboard.instance_created', { name: instanceName }), 'success');
        loadInstances();
      } else {
        addNotification(t('dashboard.create_failed', { error: createRes.error }), 'error');
      }
    } catch (error) {
      console.error('Code import error:', error);
      addNotification(t('dashboard.import_failed', { error: error.message }), 'error');
    }
  };

  useEffect(() => {
    loadInstances();

    const removeListener = window.electronAPI.onInstanceStatus(({ instanceName, status }) => {
      if (status === 'stopped' || status === 'ready' || status === 'error' || status === 'deleted') {
        loadInstances();
      }
    });

    return () => {
      if (removeListener) removeListener();
    };
  }, []);

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

  const hasInstanceAction = (instanceName) => {
    return actionBarActions.some(
      (action) =>
        action?.target === instanceName &&
        (action?.type === 'instance:start' || action?.type === 'instance:stop')
    );
  };

  useEffect(() => {
    if (showCreateModal) {
      fetchVersions();
      setNewInstanceName('');
      setNewInstanceFolderPath('');
      setNewInstanceIcon(DEFAULT_ICON);
      setSelectedLoader('Vanilla');
      setIsCreating(false);
      setCreationStep(1);
      setLoaderVersions([]);
      setSelectedLoaderVersion('');
      setAvailableLoaders({
        Vanilla: true,
        Fabric: true,
        Forge: true,
        NeoForge: true,
        Quilt: true,
      });
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (!showCreateModal) return;

    const updateVersions = async () => {
      setLoadingVersions(true);
      try {
        if (selectedLoader === 'Vanilla') {
          const res = await window.electronAPI.getVanillaVersions();
          if (res.success) {
            const versions = res.versions.filter(v => (showSnapshots ? true : v.type === 'release'));
            setAvailableVersions(versions);
            if (
              versions.length > 0 &&
              (!selectedVersion || !versions.find(v => v.id === selectedVersion))
            ) {
              setSelectedVersion(versions[0].id);
            }
          }
        } else {
          const res = await window.electronAPI.getSupportedGameVersions(selectedLoader);
          if (res.success) {
            let versions = res.versions;
            if (!showSnapshots) {
              versions = versions.filter(v => /^\d+\.\d+(\.\d+)?$/.test(v));
            }
            const versionObjs = versions.map(v => ({ id: v, type: 'release' }));
            setAvailableVersions(versionObjs);
            if (
              versionObjs.length > 0 &&
              (!selectedVersion || !versionObjs.find(v => v.id === selectedVersion))
            ) {
              setSelectedVersion(versionObjs[0].id);
            } else if (versionObjs.length === 0) {
              setSelectedVersion('');
            }
          } else {
            setAvailableVersions([]);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingVersions(false);
      }
    };

    updateVersions();
  }, [showCreateModal, selectedLoader, showSnapshots]);

  const loadInstances = async () => {
    const list = await window.electronAPI.getInstances();
    setInstances(filterInstancesForMode(list, 'launcher'));
  };

  const fetchVersions = async () => {
    setLoadingVersions(true);
    const res = await window.electronAPI.getVanillaVersions();
    setLoadingVersions(false);
    if (res.success) {
      const versions = res.versions.filter(v => v.type === 'release');
      setAvailableVersions(versions);
      if (versions.length > 0) setSelectedVersion(versions[0].id);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isCreating) return;

    const loaderForApi = selectedLoader.toLowerCase();
    if (creationStep === 1 && loaderForApi !== 'vanilla') {
      if (!selectedVersion) {
        addNotification('Please select a Minecraft version', 'error');
        return;
      }

      setLoadingVersions(true);
      try {
        const res = await window.electronAPI.getLoaderVersions(loaderForApi, selectedVersion);
        setLoadingVersions(false);

        if (res.success && res.versions && res.versions.length > 0) {
          setLoaderVersions(res.versions);
          setSelectedLoaderVersion(res.versions[0].version);
          setCreationStep(2);
          return;
        } else {
          addNotification('No specific loader versions found, using latest.', 'info');
        }
      } catch (err) {
        setLoadingVersions(false);
        addNotification('Failed to fetch loader versions: ' + err.message, 'error');
        return;
      }
    }

    performCreation();
  };

  const performCreation = async () => {
    setIsCreating(true);
    const nameToUse = newInstanceName.trim() || 'New Instance';
    const loaderForApi = selectedLoader.toLowerCase();
    const folderPath = normalizeFolderPath(newInstanceFolderPath);

    try {
      const result = await window.electronAPI.createInstance(
        nameToUse,
        selectedVersion,
        loaderForApi,
        newInstanceIcon,
        creationStep === 2 ? selectedLoaderVersion : null,
        folderPath ? { folderPath } : undefined
      );

      if (result.success) {
        setShowCreateModal(false);
        await loadInstances();
        addNotification(`Started creating: ${result.instanceName || nameToUse}`, 'success');
        Analytics.trackInstanceCreation(loaderForApi, selectedVersion);
      } else {
        addNotification(`Failed to create instance: ${result.error}`, 'error');
      }
    } catch (err) {
      addNotification(`Error creating instance: ${err.message}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewInstanceIcon(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileExport = async (instance) => {
    try {
      const exportResult = await window.electronAPI.exportInstance(instance.name);
      if (exportResult.success) {
        addNotification(`Exported to ${exportResult.path}`, 'success');
      } else if (exportResult.error !== 'Cancelled') {
        addNotification(`Export failed: ${exportResult.error}`, 'error');
      }
    } catch (e) {
      addNotification(`Export failed: ${e.message}`, 'error');
    }
  };

  const resetCodeExportState = () => {
    setShowExportCodeModal(false);
    setExportCodeInstanceData(null);
    setExportCodeMods([]);
    setExportCodeResourcePacks([]);
    setExportCodeShaders([]);
  };

  const prepareCodeExport = async (instance) => {
    setIsPreparingCodeExport(true);
    try {
      const [modsResult, resourcePacksResult, shadersResult] = await Promise.all([
        window.electronAPI.getMods(instance.name),
        window.electronAPI.getResourcePacks(instance.name),
        window.electronAPI.getShaders(instance.name),
      ]);

      const mods = modsResult?.success && Array.isArray(modsResult.mods)
        ? modsResult.mods.map((entry) => ({ ...entry, type: 'mod' }))
        : [];
      const resourcePacks = resourcePacksResult?.success && Array.isArray(resourcePacksResult.packs)
        ? resourcePacksResult.packs.map((entry) => ({ ...entry, type: 'resourcepack' }))
        : [];
      const shaders = shadersResult?.success && Array.isArray(shadersResult.shaders)
        ? shadersResult.shaders.map((entry) => ({ ...entry, type: 'shader' }))
        : [];

      if (!modsResult?.success || !resourcePacksResult?.success || !shadersResult?.success) {
        addNotification(
          t('dashboard.export_choice.partial_load_warning', 'Some content could not be read and will be skipped.'),
          'error'
        );
      }

      setExportCodeInstanceData(instance);
      setExportCodeMods(mods);
      setExportCodeResourcePacks(resourcePacks);
      setExportCodeShaders(shaders);
      setShowExportChoiceModal(false);
      setShowExportCodeModal(true);
    } catch (e) {
      addNotification(`Failed to prepare code export: ${e.message}`, 'error');
    } finally {
      setIsPreparingCodeExport(false);
    }
  };

  const handleContextAction = async (action, instance) => {
    switch (action) {
      case 'add-to-actionbar':
        try {
          const settingsRes = await window.electronAPI.getSettings();
          if (!settingsRes?.success) {
            addNotification('Failed to load settings', 'error');
            break;
          }

          const existingActions = Array.isArray(settingsRes.settings?.actionBarActions)
            ? settingsRes.settings.actionBarActions
            : [];

          const liveStatus = runningInstances[instance.name];
          const isRunning = liveStatus === 'running';
          const nextAction = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: isRunning
              ? `${instance.name} (${t('common.stop')})`
              : `${instance.name} (${t('common.play')})`,
            type: isRunning ? 'instance:stop' : 'instance:start',
            icon: instance.icon && instance.icon.startsWith('data:') ? instance.icon : '',
            path: '',
            target: instance.name,
          };

          const saveRes = await window.electronAPI.saveSettings({
            ...settingsRes.settings,
            actionBarActions: [...existingActions, nextAction],
          });

          if (saveRes?.success) {
            addNotification(t('action_bar.added', 'Added to Actionbar'), 'success');
            setActionBarActions([...existingActions, nextAction]);
          } else {
            addNotification('Failed to save action', 'error');
          }
        } catch (e) {
          addNotification(`Failed to add action: ${e.message}`, 'error');
        }
        break;
      case 'remove-from-actionbar':
        try {
          const settingsRes2 = await window.electronAPI.getSettings();
          if (!settingsRes2?.success) {
            addNotification('Failed to load settings', 'error');
            break;
          }

          const existingActions2 = Array.isArray(settingsRes2.settings?.actionBarActions)
            ? settingsRes2.settings.actionBarActions
            : [];

          const filteredActions = existingActions2.filter(
            (entry) =>
              !(
                entry?.target === instance.name &&
                (entry?.type === 'instance:start' || entry?.type === 'instance:stop')
              )
          );

          const saveRes2 = await window.electronAPI.saveSettings({
            ...settingsRes2.settings,
            actionBarActions: filteredActions,
          });

          if (saveRes2?.success) {
            addNotification(t('action_bar.removed', 'Removed from Actionbar'), 'success');
            setActionBarActions(filteredActions);
          } else {
            addNotification('Failed to remove action', 'error');
          }
        } catch (e) {
          addNotification(`Failed to remove action: ${e.message}`, 'error');
        }
        break;
      case 'play':
        window.electronAPI.launchGame(instance.name);
        break;
      case 'view':
        onInstanceClick(instance);
        break;
      case 'duplicate':
        try {
          const result = await window.electronAPI.duplicateInstance(instance.name);
          if (result.success) {
            addNotification(`Duplicated instance: ${instance.name}`, 'success');
            await loadInstances();
          } else {
            addNotification(`Duplicate failed: ${result.error}`, 'error');
          }
        } catch (e) {
          addNotification(`Duplicate failed: ${e.message}`, 'error');
        }
        break;
      case 'export':
        setExportTargetInstance(instance);
        setShowExportChoiceModal(true);
        break;
      case 'folder':
        window.electronAPI.openInstanceFolder(instance.name);
        break;
      case 'move-to-folder':
        setFolderTargetInstance(instance);
        setFolderInputPath(String(instance.folderPath || ''));
        setShowMoveFolderModal(true);
        break;
      case 'remove-from-folder':
        try {
          const res = await window.electronAPI.setInstanceFolderPath(instance, '');
          if (res?.success) {
            addNotification(`Removed ${instance.name} from folder`, 'success');
            await loadInstances();
          } else {
            addNotification(`Failed to update folder: ${res?.error || 'Unknown error'}`, 'error');
          }
        } catch (e) {
          addNotification(`Failed to update folder: ${e.message}`, 'error');
        }
        break;
      case 'delete':
        setInstanceToDelete(instance);
        setShowDeleteModal(true);
        break;
    }
  };

  const handleSaveFolderPath = async () => {
    const nextPath = normalizeFolderPath(folderInputPath);

    if (!folderTargetInstance && selectedInstanceNames.length === 0) {
      addNotification('No instances selected.', 'error');
      return;
    }

    setIsLoading(true);
    try {
      if (folderTargetInstance) {
        const res = await window.electronAPI.setInstanceFolderPath(folderTargetInstance, nextPath);
        if (res?.success) {
          addNotification(
            nextPath
              ? `Moved ${folderTargetInstance.name} to ${nextPath}`
              : `Removed ${folderTargetInstance.name} from folder`,
            'success'
          );
        } else {
          addNotification(`Failed to update folder: ${res?.error || 'Unknown error'}`, 'error');
          return;
        }
      } else {
        const updates = await Promise.all(
          selectedInstanceNames.map((instanceName) => {
            const instanceRef = instances.find((instance) => instance.name === instanceName) || { name: instanceName };
            return window.electronAPI.setInstanceFolderPath(instanceRef, nextPath);
          }
          )
        );
        const failed = updates.filter((entry) => !entry?.success).length;
        const successCount = updates.length - failed;

        if (successCount > 0) {
          addNotification(
            nextPath
              ? `Moved ${successCount} instance(s) to ${nextPath}`
              : `Removed ${successCount} instance(s) from folders`,
            'success'
          );
        }
        if (failed > 0) {
          addNotification(`Failed to move ${failed} instance(s).`, 'error');
        }
      }

      await loadInstances();
      setShowMoveFolderModal(false);
      setFolderTargetInstance(null);
      setFolderInputPath('');
      if (!folderTargetInstance) {
        setSelectedInstanceNames([]);
        setSelectionMode(false);
      }
    } catch (e) {
      addNotification(`Failed to update folder: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!instanceToDelete) return;

    setIsLoading(true);
    try {
      const status = runningInstances[instanceToDelete.name];
      if (status) {
        await window.electronAPI.killGame(instanceToDelete.name);
        addNotification(`Stopped ${instanceToDelete.name}`, 'info');
      }
      await window.electronAPI.deleteInstance(instanceToDelete.name);
      addNotification(`Deleted instance: ${instanceToDelete.name}`, 'info');
      await loadInstances();
    } catch (e) {
      addNotification(`Failed to delete: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
      setShowDeleteModal(false);
      setInstanceToDelete(null);
    }
  };

  const versionOptions = availableVersions.map(v => ({
    value: v.id,
    label: v.id,
  }));

  const loaderOptions = [
    { value: 'Vanilla', label: 'Vanilla' },
    { value: 'Fabric', label: 'Fabric' },
    { value: 'Forge', label: 'Forge' },
    { value: 'NeoForge', label: 'NeoForge' },
    { value: 'Quilt', label: 'Quilt' },
  ];

  const sortOptions = [
    { value: 'name', label: t('dashboard.sort.name') },
    { value: 'version', label: t('dashboard.sort.version') },
    { value: 'playtime', label: t('dashboard.sort.playtime') },
  ];

  const groupOptions = [
    { value: 'none', label: t('dashboard.group.none') },
    { value: 'version', label: t('dashboard.group.version') },
    { value: 'loader', label: t('dashboard.group.loader') },
  ];

  const getSourceGroupLabel = (inst) => {
    if (String(inst?.instanceType || '').toLowerCase() === 'external') {
      const source = String(inst?.externalSource || '').toLowerCase();
      if (source === 'modrinth') return 'Modrinth';
      if (source === 'curseforge') return 'CurseForge';
      return 'External';
    }
    return 'LuxClient';
  };

  const filteredInstances = instances.filter(
    inst =>
      inst.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
      inst.version.toLowerCase().includes(deferredSearchQuery.toLowerCase())
  );

  const sortedInstances = [...filteredInstances].sort((a, b) => {
    if (sortMethod === 'name') return a.name.localeCompare(b.name);
    if (sortMethod === 'playtime') return (b.playtime || 0) - (a.playtime || 0);
    if (sortMethod === 'version') {
      return b.version.localeCompare(a.version, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    }
    return 0;
  });

  const isSelectableInstance = (_instance = null) => true;

  const selectableVisibleInstanceNames = sortedInstances
    .filter(isSelectableInstance)
    .map((instance) => instance.name);

  useEffect(() => {
    const availableNames = new Set(instances.map((instance) => instance.name));
    setSelectedInstanceNames((prev) => prev.filter((name) => availableNames.has(name)));
  }, [instances]);

  const toggleInstanceSelection = (instanceName) => {
    setSelectedInstanceNames((prev) => {
      if (prev.includes(instanceName)) {
        return prev.filter((name) => name !== instanceName);
      }
      return [...prev, instanceName];
    });
  };

  const enableSelectionMode = () => {
    setSelectionMode(true);
  };

  const disableSelectionMode = () => {
    setSelectionMode(false);
    setSelectedInstanceNames([]);
  };

  const selectAllVisible = () => {
    setSelectedInstanceNames(selectableVisibleInstanceNames);
  };

  const clearSelection = () => {
    setSelectedInstanceNames([]);
  };

  const openBulkMoveDialog = () => {
    if (selectedInstanceNames.length === 0) {
      addNotification('Please select at least one instance first.', 'error');
      return;
    }
    setFolderTargetInstance(null);
    setFolderInputPath('');
    setShowMoveFolderModal(true);
  };

  const buildFolderTree = (items) => {
    const root = {
      path: '',
      name: '',
      instances: [],
      children: new Map(),
    };

    items.forEach((instance) => {
      const segments = splitFolderPath(instance.folderPath);
      if (segments.length === 0) {
        root.instances.push(instance);
        return;
      }

      let current = root;
      const pathParts = [];
      segments.forEach((segment) => {
        pathParts.push(segment);
        const segmentPath = pathParts.join('/');
        if (!current.children.has(segment)) {
          current.children.set(segment, {
            path: segmentPath,
            name: segment,
            instances: [],
            children: new Map(),
          });
        }
        current = current.children.get(segment);
      });
      current.instances.push(instance);
    });

    const finalizeNode = (node) => ({
      ...node,
      children: Array.from(node.children.values())
        .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map(finalizeNode),
    });

    return finalizeNode(root);
  };

  const countFolderInstances = (node) =>
    node.instances.length + node.children.reduce((sum, child) => sum + countFolderInstances(child), 0);

  const toggleFolder = (folderKey) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderKey]: !(prev[folderKey] ?? true),
    }));
  };

  const isFolderExpanded = (folderKey) => expandedFolders[folderKey] ?? true;

  const groupedData = [];
  const buildGroupedSections = (items, sectionPrefix = null) => {
    if (groupMethod === 'none') {
      groupedData.push({ title: sectionPrefix, tree: buildFolderTree(items) });
      return;
    }

    const groups = {};
    items.forEach(inst => {
      const key = groupMethod === 'version'
        ? (inst.version || 'Unknown')
        : (inst.loader || 'Vanilla');
      if (!groups[key]) groups[key] = [];
      groups[key].push(inst);
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (groupMethod === 'version') {
        return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
      }
      return a.localeCompare(b);
    });

    sortedKeys.forEach(key => {
      groupedData.push({
        title: sectionPrefix ? `${sectionPrefix} - ${key}` : key,
        tree: buildFolderTree(groups[key]),
      });
    });
  };

  if (groupBySourceEnabled) {
    const sourceGroups = {
      LuxClient: [],
      Modrinth: [],
      CurseForge: [],
      External: [],
    };

    sortedInstances.forEach((inst) => {
      const sourceLabel = getSourceGroupLabel(inst);
      if (!sourceGroups[sourceLabel]) sourceGroups[sourceLabel] = [];
      sourceGroups[sourceLabel].push(inst);
    });

    ['LuxClient', 'Modrinth', 'CurseForge', 'External'].forEach((sourceLabel) => {
      const sourceItems = sourceGroups[sourceLabel] || [];
      if (sourceItems.length === 0) return;
      buildGroupedSections(sourceItems, sourceLabel);
    });
  } else {
    buildGroupedSections(sortedInstances, null);
  }

  const isEmpty = sortedInstances.length === 0;

  const instanceMenuItems = (instance) => (
    <>
      <ContextMenuItem onClick={() => handleContextAction('play', instance)}>
        <Play className="w-4 h-4 mr-2" />
        {t('dashboard.context.play')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => handleContextAction('view', instance)}>
        <Eye className="w-4 h-4 mr-2" />
        {t('dashboard.context.view')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => handleContextAction('duplicate', instance)}>
        <Copy className="w-4 h-4 mr-2" />
        {t('dashboard.context.duplicate')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => handleContextAction('export', instance)}>
        <Download className="w-4 h-4 mr-2" />
        {t('dashboard.context.export')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => handleContextAction('folder', instance)}>
        <FolderOpen className="w-4 h-4 mr-2" />
        {t('dashboard.context.folder')}
      </ContextMenuItem>
      {String(instance?.instanceType || '').toLowerCase() !== 'external' && (
        <>
          <ContextMenuItem onClick={() => handleContextAction('move-to-folder', instance)}>
            <Folder className="w-4 h-4 mr-2" />
            {t('dashboard.context.move_to_folder', 'Move to folder')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('remove-from-folder', instance)}>
            <Folder className="w-4 h-4 mr-2" />
            {t('dashboard.context.remove_from_folder', 'Remove from folder')}
          </ContextMenuItem>
        </>
      )}
      {hasInstanceAction(instance.name) ? (
        <ContextMenuItem onClick={() => handleContextAction('remove-from-actionbar', instance)}>
          <Zap className="w-4 h-4 mr-2" />
          {t('action_bar.remove_from_actionbar', 'Remove from Actionbar')}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={() => handleContextAction('add-to-actionbar', instance)}>
          <Zap className="w-4 h-4 mr-2" />
          {t('action_bar.add_to_actionbar', 'Add to Actionbar')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onClick={() => handleContextAction('delete', instance)}
      >
        <Trash2 className="w-4 h-4 mr-2" />
        {t('dashboard.context.delete')}
      </ContextMenuItem>
    </>
  );

  const renderInstanceCard = (instance) => (
    <ContextMenu key={instance.name}>
      <ContextMenuTrigger>
        <InstanceCard
          instance={instance}
          runningInstances={runningInstances}
          activeDownloads={activeDownloads}
          pendingLaunches={pendingLaunches}
          onInstanceClick={(selectedInstance) => {
            if (selectionMode) {
              toggleInstanceSelection(selectedInstance.name);
              return;
            }
            onInstanceClick(selectedInstance);
          }}
          selectionMode={selectionMode}
          isSelected={selectedInstanceNames.includes(instance.name)}
          isSelectable={isSelectableInstance(instance)}
          onToggleSelect={toggleInstanceSelection}
          onContextAction={(e, inst) => {
            e.stopPropagation();
          }}
          actionMenu={
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('play', instance); }}>
                <Play className="w-4 h-4 mr-2" />
                {t('dashboard.context.play')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('view', instance); }}>
                <Eye className="w-4 h-4 mr-2" />
                {t('dashboard.context.view')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('duplicate', instance); }}>
                <Copy className="w-4 h-4 mr-2" />
                {t('dashboard.context.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('export', instance); }}>
                <Download className="w-4 h-4 mr-2" />
                {t('dashboard.context.export')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('folder', instance); }}>
                <FolderOpen className="w-4 h-4 mr-2" />
                {t('dashboard.context.folder')}
              </DropdownMenuItem>
              {String(instance?.instanceType || '').toLowerCase() !== 'external' && (
                <>
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('move-to-folder', instance); }}>
                    <Folder className="w-4 h-4 mr-2" />
                    {t('dashboard.context.move_to_folder', 'Move to folder')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('remove-from-folder', instance); }}>
                    <Folder className="w-4 h-4 mr-2" />
                    {t('dashboard.context.remove_from_folder', 'Remove from folder')}
                  </DropdownMenuItem>
                </>
              )}
              {hasInstanceAction(instance.name) ? (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('remove-from-actionbar', instance); }}>
                  <Zap className="w-4 h-4 mr-2" />
                  {t('action_bar.remove_from_actionbar', 'Remove from Actionbar')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleContextAction('add-to-actionbar', instance); }}>
                  <Zap className="w-4 h-4 mr-2" />
                  {t('action_bar.add_to_actionbar', 'Add to Actionbar')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => { e.stopPropagation(); handleContextAction('delete', instance); }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('dashboard.context.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          }
          addNotification={addNotification}
          loadInstances={loadInstances}
          setPendingLaunches={setPendingLaunches}
          t={t}
          isGuest={isGuest}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {instanceMenuItems(instance)}
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <div className="flex flex-col h-full relative">
      {isLoading && <LoadingOverlay message="Processing..." />}

      <PageHeader title={t('dashboard.title')} description={t('dashboard.desc')}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('dashboard.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 h-8 pl-8 text-xs"
            />
          </div>
          <div className="w-36">
            <Dropdown options={sortOptions} value={sortMethod} onChange={setSortMethod} />
          </div>
          <div className="w-36">
            <Dropdown options={groupOptions} value={groupMethod} onChange={setGroupMethod} />
          </div>
          <div className="flex items-center gap-2 px-2 h-8 border border-border rounded-md bg-card">
            <Switch
              checked={groupBySourceEnabled}
              onCheckedChange={setGroupBySourceEnabled}
              className="h-3.5 w-7 [&>span]:h-2.5 [&>span]:w-2.5"
            />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {t('dashboard.group.launcher_toggle', 'Group by Launcher')}
            </span>
          </div>

          {!selectionMode ? (
            <Button type="button" size="sm" variant="outline" onClick={enableSelectionMode}>
              {t('dashboard.selection.enable', 'Select')}
            </Button>
          ) : (
            <>
              <div className="flex items-center gap-2 px-2 h-8 border border-primary/30 rounded-md bg-primary/10">
                <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
                  {t('dashboard.selection.count', { count: selectedInstanceNames.length, defaultValue: `${selectedInstanceNames.length} selected` })}
                </span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={selectAllVisible}>
                {t('dashboard.selection.select_all', 'Select all visible')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={clearSelection}>
                {t('dashboard.selection.clear', 'Clear')}
              </Button>
              <Button type="button" size="sm" onClick={openBulkMoveDialog}>
                {t('dashboard.selection.move_to_folder', 'Move selected to folder')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={disableSelectionMode}>
                {t('dashboard.selection.done', 'Done')}
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                {t('dashboard.new_instance')}
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('dashboard.manual_creation')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    if (!window.electronAPI.importFile) {
                      throw new Error(
                        'electronAPI.importFile is not defined. Please restart the application.'
                      );
                    }
                    const result = await window.electronAPI.importFile();
                    if (result.success) {
                      addNotification(`Importing Modpack: ${result.instanceName}...`, 'info');
                      loadInstances();
                    } else if (result.error !== 'Cancelled') {
                      addNotification(`Import failed: ${result.error}`, 'error');
                    }
                  } catch (err) {
                    console.error('[Dashboard] Import error:', err);
                    addNotification(`Import error: ${err.message}`, 'error');
                  }
                }}
              >
                <FileDown className="w-4 h-4 mr-2" />
                {t('dashboard.import_file')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowCodeModal(true)}>
                <FileCode className="w-4 h-4 mr-2" />
                {t('dashboard.import_code')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>

      <PageContent>
        {isEmpty ? (
          <EmptyState
            icon={Box}
            title={t('dashboard.no_instances')}
            description={t('dashboard.create_to_start')}
            action={
              <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                {t('dashboard.new_instance')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {groupedData.map((group) => (
              <div key={group.title || 'all'}>
                {group.title && (
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {group.title}
                    </span>
                    <Separator className="flex-1" />
                  </div>
                )}
                <div className="space-y-3">
                  {group.tree.instances.length > 0 && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                      {group.tree.instances.map((instance) => renderInstanceCard(instance))}
                    </div>
                  )}

                  {group.tree.children.map((folderNode) => {
                    const folderKey = `${group.title || 'all'}::${folderNode.path}`;
                    const expanded = isFolderExpanded(folderKey);
                    const count = countFolderInstances(folderNode);

                    const renderNestedFolder = (node, depth = 0) => {
                      const nestedKey = `${group.title || 'all'}::${node.path}`;
                      const nestedExpanded = isFolderExpanded(nestedKey);
                      const nestedCount = countFolderInstances(node);

                      return (
                        <div key={nestedKey} className="space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleFolder(nestedKey)}
                            className="w-full flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/50"
                            style={{ marginLeft: `${depth * 10}px` }}
                          >
                            {nestedExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <Folder className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-foreground truncate">{node.name}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{nestedCount}</span>
                          </button>

                          {nestedExpanded && (
                            <div className="space-y-2">
                              {node.instances.length > 0 && (
                                <div
                                  className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2"
                                  style={{ marginLeft: `${(depth + 1) * 10}px` }}
                                >
                                  {node.instances.map((instance) => renderInstanceCard(instance))}
                                </div>
                              )}
                              {node.children.map((childNode) => renderNestedFolder(childNode, depth + 1))}
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div key={folderKey} className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleFolder(folderKey)}
                          className="w-full flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/50"
                        >
                          {expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <Folder className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-foreground truncate">{folderNode.name}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
                        </button>

                        {expanded && (
                          <div className="space-y-2">
                            {folderNode.instances.length > 0 && (
                              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 pl-2.5">
                                {folderNode.instances.map((instance) => renderInstanceCard(instance))}
                              </div>
                            )}
                            {folderNode.children.map((childNode) => renderNestedFolder(childNode, 1))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageContent>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Instance</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">
            {creationStep === 1 && (
              <>
                <div className="flex flex-col items-center gap-3">
                  <div
                    className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted transition-colors hover:border-primary/50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <img src={newInstanceIcon} alt="Icon" className="object-cover w-full h-full" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <ImageIcon className="h-6 w-6 text-white" />
                    </div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{t('dashboard.click_to_upload_icon', 'Click to upload icon')}</span>
                    <span className="text-[11px] text-muted-foreground">or</span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[11px] font-medium"
                      onClick={() => setShowPixelEditor(true)}
                    >
                      {t('dashboard.pixel_editor_btn', 'Pixel Editor')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    type="text"
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    placeholder="New Instance"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Folder (optional)</Label>
                  <Input
                    type="text"
                    value={newInstanceFolderPath}
                    onChange={(e) => setNewInstanceFolderPath(e.target.value)}
                    placeholder="e.g. PvP/1.20 or Modpacks/Fabric"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Use / to create nested folders.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between h-5">
                      <Label className="text-xs">{t('dashboard.version')}</Label>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={showSnapshots}
                          onCheckedChange={setShowSnapshots}
                          className="h-3.5 w-7 [&>span]:h-2.5 [&>span]:w-2.5"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {t('dashboard.dev_builds')}
                        </span>
                      </div>
                    </div>
                    {loadingVersions ? (
                      <div className="flex items-center justify-center rounded-md border border-border bg-muted p-2.5 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        {t('common.loading')}
                      </div>
                    ) : (
                      <Dropdown
                        options={versionOptions}
                        value={selectedVersion}
                        onChange={setSelectedVersion}
                        placeholder={t('dashboard.select_version')}
                        className="w-full"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center h-5">
                      <Label className="text-xs">{t('dashboard.loader')}</Label>
                    </div>
                    <Dropdown
                      options={loaderOptions}
                      value={selectedLoader}
                      onChange={setSelectedLoader}
                      className="w-full"
                    />
                  </div>
                </div>
              </>
            )}

            {creationStep === 2 && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('dashboard.select_loader_version', { loader: selectedLoader })}
                </Label>
                <Dropdown
                  options={loaderVersions.map(v => ({ value: v.version, label: v.version }))}
                  value={selectedLoaderVersion}
                  onChange={setSelectedLoaderVersion}
                  placeholder={t('dashboard.select_loader_version_placeholder')}
                />
                <p className="text-xs text-muted-foreground mt-1">Minecraft {selectedVersion}</p>
              </div>
            )}

            <DialogFooter className="gap-2">
              {creationStep === 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 mr-auto">
                      <Download className="w-3.5 h-3.5" />
                      {t('dashboard.import_options')}
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          if (!window.electronAPI.importFile) {
                            throw new Error(
                              'electronAPI.importFile is not defined. Please restart the application.'
                            );
                          }
                          const result = await window.electronAPI.importFile();
                          if (result.success) {
                            addNotification(`Importing Modpack: ${result.instanceName}...`, 'info');
                            setShowCreateModal(false);
                            loadInstances();
                          } else if (result.error !== 'Cancelled') {
                            addNotification(`Import failed: ${result.error}`, 'error');
                          }
                        } catch (err) {
                          console.error('[Dashboard] Import error:', err);
                          addNotification(`Import error: ${err.message}`, 'error');
                        }
                      }}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      {t('dashboard.import_file')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setShowCreateModal(false);
                        setShowCodeModal(true);
                      }}
                    >
                      <FileCode className="w-4 h-4 mr-2" />
                      {t('dashboard.import_code')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreationStep(1)}
                  className="mr-auto"
                >
                  {t('common.back')}
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isCreating}
                onClick={() => setShowCreateModal(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isCreating || (creationStep === 1 && loadingVersions)}
                className="gap-1.5"
              >
                {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isCreating
                  ? t('common.creating')
                  : creationStep === 1 && selectedLoader.toLowerCase() !== 'vanilla'
                    ? t('common.next')
                    : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PixelEditorModal
        isOpen={showPixelEditor}
        onClose={() => setShowPixelEditor(false)}
        onSave={(dataUrl) => setNewInstanceIcon(dataUrl)}
        initialIcon={newInstanceIcon}
      />

      {showCodeModal && (
        <ModpackCodeModal
          isOpen={showCodeModal}
          mode="import"
          instance={null}
          onClose={() => setShowCodeModal(false)}
          onImportComplete={handleCodeImportComplete}
        />
      )}

      {showExportCodeModal && exportCodeInstanceData && (
        <ModpackCodeModal
          isOpen={showExportCodeModal}
          mode="export"
          instance={exportCodeInstanceData}
          instanceData={exportCodeInstanceData}
          mods={exportCodeMods}
          resourcePacks={exportCodeResourcePacks}
          shaders={exportCodeShaders}
          onClose={resetCodeExportState}
        />
      )}

      {showDeleteModal && (
        <ConfirmationModal
          title={t('dashboard.delete_title')}
          message={t('dashboard.delete_message', { name: instanceToDelete?.name })}
          confirmText={t('common.delete')}
          isDangerous={true}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setShowDeleteModal(false);
            setInstanceToDelete(null);
          }}
        />
      )}

      <Dialog open={showMoveFolderModal} onOpenChange={setShowMoveFolderModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {folderTargetInstance
                ? t('dashboard.folder_modal.title', 'Move instance to folder')
                : t('dashboard.folder_modal.title_multi', 'Move selected instances to folder')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">
              {t('dashboard.folder_modal.path', 'Folder path')}
            </Label>
            <Input
              value={folderInputPath}
              onChange={(e) => setFolderInputPath(e.target.value)}
              placeholder="e.g. Modpacks/Survival"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('dashboard.folder_modal.help', 'Use / to create subfolders. Leave empty to remove folder assignment.')}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowMoveFolderModal(false);
                setFolderTargetInstance(null);
                setFolderInputPath('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleSaveFolderPath}>
              {t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showExportChoiceModal}
        onOpenChange={(open) => {
          setShowExportChoiceModal(open);
          if (!open) setExportTargetInstance(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dashboard.export_choice.title', 'Export instance')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('dashboard.export_choice.description', 'Choose how you want to export this instance.')}
            </p>
            {exportTargetInstance && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {`${t('dashboard.export_choice.target_prefix', 'Instance:')} ${exportTargetInstance.name}`}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                onClick={() => exportTargetInstance && prepareCodeExport(exportTargetInstance)}
                disabled={!exportTargetInstance || isPreparingCodeExport}
                className="justify-start gap-2"
              >
                {isPreparingCodeExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
                {t('dashboard.export_choice.code', 'Export as Code')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!exportTargetInstance) return;
                  setShowExportChoiceModal(false);
                  await handleFileExport(exportTargetInstance);
                  setExportTargetInstance(null);
                }}
                disabled={!exportTargetInstance || isPreparingCodeExport}
                className="justify-start gap-2"
              >
                <FileDown className="w-4 h-4" />
                {t('dashboard.export_choice.file', 'Export as .mcpack file')}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowExportChoiceModal(false);
                setExportTargetInstance(null);
              }}
            >
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Dashboard;
