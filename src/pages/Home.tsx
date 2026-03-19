import React, { useState, useEffect } from 'react';
import DashboardCustomizer from '../components/DashboardCustomizer';
import modOfTheDayData from '../data/modOfTheDay.json';
import ExtensionSlot from '../components/Extensions/ExtensionSlot';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import PageHeader from '../components/layout/PageHeader';
import PageContent from '../components/layout/PageContent';
import EmptyState from '../components/layout/EmptyState';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { filterInstancesForMode } from '../utils/instanceTypes';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '../components/ui/dialog';
import {
  Play,
  Square,
  Clock,
  GripVertical,
  Settings2,
  Loader2,
  Box,
  Globe,
  Sparkles,
  Download,
  Heart,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  Package,
  MoreVertical,
  Maximize2,
  Minimize2,
} from 'lucide-react';

function Home({ onInstanceClick, runningInstances = {}, activeDownloads = {}, onNavigateSearch, isGuest, userProfile }) {
  const { t } = useTranslation();
  const { addNotification } = useNotification();

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(diff / 604800000);

    if (minutes < 1) return t('common.time.just_now');
    if (minutes < 60) return t('common.time.minutes_ago', { count: minutes });
    if (hours < 24) return t('common.time.hours_ago', { count: hours });
    if (days === 1) return t('common.time.yesterday');
    if (days < 7) return t('common.time.days_ago', { count: days });
    if (weeks === 1) return t('common.time.last_week');
    return t('common.time.weeks_ago', { count: weeks });
  };

  const formatPlaytime = (ms) => {
    if (!ms || ms <= 0) return t('common.time.0h');
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return t('common.time.hours_minutes', { hours, minutes });
    return t('common.time.minutes', { minutes });
  };

  const [instances, setInstances] = useState([]);
  const [modpacks, setModpacks] = useState([]);
  const [loadingModpacks, setLoadingModpacks] = useState(false);
  const [pendingLaunches, setPendingLaunches] = useState({});
  const [selectedModpack, setSelectedModpack] = useState(null);
  const [recentWorlds, setRecentWorlds] = useState([]);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [modOfTheDay, setModOfTheDay] = useState(null);
  const [loadingModOfTheDay, setLoadingModOfTheDay] = useState(true);
  const [modIds, setModIds] = useState([]);
  const [currentModId, setCurrentModId] = useState(null);
  const [dashSettings, setDashSettings] = useState({
    welcomeMessage: t('home.welcome_back'),
    layout: [
      { id: 'recent-instances', visible: true, width: 12 },
      { id: 'recent-worlds', visible: true, width: 12 },
      { id: 'mod-of-the-day', visible: true, width: 12 },
      { id: 'modpacks', visible: true, width: 12 },
    ],
    animationsExaggerated: false,
    focusMode: false,
  });

  useEffect(() => {
    loadModIds();
    loadInstances();
    loadModpacks();
    loadDashSettings();

    const removeListener = window.electronAPI.onInstanceStatus(({ instanceName, status }) => {
      if (status === 'stopped' || status === 'ready' || status === 'error' || status === 'deleted') {
        loadInstances();
      }
    });

    return () => {
      if (removeListener) removeListener();
    };
  }, []);

  const loadDashSettings = async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res.success) {
        let settings = res.settings.dashboard || {};
        const animationsExaggerated = res.settings.animationsExaggerated || false;
        const focusMode = res.settings.focusMode || false;

        if (!settings.layout) {
          const newLayout = [];
          if (settings.showRecentInstances !== false) newLayout.push({ id: 'recent-instances', visible: true, width: 12 });
          if (settings.showRecentWorlds !== false) newLayout.push({ id: 'recent-worlds', visible: true, width: 12 });
          if (settings.showModOfTheDay !== false) newLayout.push({ id: 'mod-of-the-day', visible: true, width: 12 });
          if (settings.showModpacks !== false) newLayout.push({ id: 'modpacks', visible: true, width: 12 });
          const existingIds = newLayout.map(i => i.id);
          if (!existingIds.includes('recent-instances')) newLayout.push({ id: 'recent-instances', visible: false, width: 12 });
          if (!existingIds.includes('recent-worlds')) newLayout.push({ id: 'recent-worlds', visible: false, width: 12 });
          if (!existingIds.includes('mod-of-the-day')) newLayout.push({ id: 'mod-of-the-day', visible: false, width: 12 });
          if (!existingIds.includes('modpacks')) newLayout.push({ id: 'modpacks', visible: false, width: 12 });

          settings = { ...settings, layout: newLayout };
          delete settings.showRecentInstances;
          delete settings.showRecentWorlds;
          delete settings.showModOfTheDay;
          delete settings.showModpacks;
          await window.electronAPI.saveSettings({
            ...res.settings,
            dashboard: settings,
          });
        } else if (settings.layout && !settings.layout.find(l => l.id === 'mod-of-the-day')) {
          settings.layout.splice(2, 0, { id: 'mod-of-the-day', visible: true, width: 12 });
          await window.electronAPI.saveSettings({
            ...res.settings,
            dashboard: settings,
          });
        }
        setDashSettings({ ...settings, animationsExaggerated, focusMode });
      }
    } catch (e) {
      console.error('Failed to load dashboard settings:', e);
    }
  };

  const handleDashUpdate = async (newSettings) => {
    setDashSettings(newSettings);
    try {
      const res = await window.electronAPI.getSettings();
      if (res.success) {
        const updatedSettings = {
          ...res.settings,
          dashboard: newSettings,
        };
        await window.electronAPI.saveSettings(updatedSettings);
      }
    } catch (e) {
      console.error('Failed to save dashboard settings:', e);
    }
  };

  const loadModIds = () => {
    if (modOfTheDayData && modOfTheDayData.projectIds) {
      setModIds(modOfTheDayData.projectIds);
      selectTodaysModId(modOfTheDayData.projectIds);
    }
  };

  const getToday = () => {
    const date = new Date();
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  };

  const selectTodaysModId = (ids) => {
    if (!ids || ids.length === 0) return;

    const today = getToday();
    const savedData = localStorage.getItem('modOfTheDay');
    let data = savedData ? JSON.parse(savedData) : {};

    if (data.date !== today) {
      const randomIndex = Math.floor(Math.random() * ids.length);
      data = {
        date: today,
        id: ids[randomIndex],
      };
      localStorage.setItem('modOfTheDay', JSON.stringify(data));
    }

    setCurrentModId(data.id);
    loadModOfTheDay(data.id);
  };

  const selectRandomModId = (ids) => {
    if (!ids || ids.length === 0) return;
    const randomIndex = Math.floor(Math.random() * ids.length);
    const randomId = ids[randomIndex];
    setCurrentModId(randomId);
    return randomId;
  };

  useEffect(() => {
    if (currentModId && modIds.length > 0) {
      loadModOfTheDay(currentModId);
    }
  }, [currentModId]);

  const loadInstances = async () => {
    const list = await window.electronAPI.getInstances();
    const launcherInstances = filterInstancesForMode(list, 'launcher');
    setInstances(launcherInstances);
    if (launcherInstances.length > 0) {
      const recentInsts = [...launcherInstances]
        .filter(inst => inst.lastPlayed || inst.playtime > 0)
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
        .slice(0, 5);

      const allWorlds = [];
      for (const inst of recentInsts) {
        try {
          const res = await window.electronAPI.getWorlds(inst.name);
          if (res && res.success && res.worlds) {
            for (const world of res.worlds.slice(0, 2)) {
              allWorlds.push({
                ...world,
                instanceName: inst.name,
                instanceIcon: inst.icon,
                instanceVersion: inst.version,
                instanceLoader: inst.loader,
              });
            }
          }
        } catch (e) { }
      }

      allWorlds.sort((a: any, b: any) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime());
      setRecentWorlds(allWorlds.slice(0, 3));
    } else {
      setRecentWorlds([]);
    }
  };

  const loadModpacks = async () => {
    setLoadingModpacks(true);
    try {
      const res = await window.electronAPI.searchModrinth('', [], {
        offset: 0,
        limit: 6,
        index: 'relevance',
        projectType: 'modpack',
      });
      if (res && res.success && res.results) {
        setModpacks(res.results);
      }
    } catch (e) {
      console.error('Failed to load modpacks:', e);
    } finally {
      setLoadingModpacks(false);
    }
  };

  const loadModOfTheDay = async (projectId) => {
    setLoadingModOfTheDay(true);
    try {
      const res = await window.electronAPI.getModrinthProject(projectId);
      if (res && res.success) {
        setModOfTheDay(res.project);
      }
    } catch (e) {
      console.error('Failed to load Mod of the Day:', e);
    } finally {
      setLoadingModOfTheDay(false);
    }
  };

  const loadNewModOfTheDay = async () => {
    if (modIds.length === 0) return;

    const today = getToday();
    const randomIndex = Math.floor(Math.random() * modIds.length);
    const newId = modIds[randomIndex];
    const data = {
      date: today,
      id: newId,
    };
    localStorage.setItem('modOfTheDay', JSON.stringify(data));

    setCurrentModId(newId);
  };

  const recentInstances = [...instances]
    .filter(inst => inst.lastPlayed || inst.playtime > 0)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .slice(0, 5);

  const handleLaunch = async (e, instance) => {
    if (isGuest) {
      addNotification('To do that you have to be logged in', 'error');
      return;
    }

    const liveStatus = runningInstances[instance.name];
    const status = liveStatus;
    const isRunning = status === 'running';

    if (isRunning) {
      window.electronAPI.killGame(instance.name);
      return;
    }

    const installStateKey = Object.keys(activeDownloads).find(
      k => k.toLowerCase() === instance.name.toLowerCase()
    );
    const installState = installStateKey ? activeDownloads[installStateKey] : null;
    const isInstalling = !!installState;
    const isLaunching = status === 'launching';
    const isPending = pendingLaunches[instance.name];

    if (isInstalling || isLaunching || isPending) return;

    setPendingLaunches(prev => ({ ...prev, [instance.name]: true }));
    window.electronAPI
      .launchGame(instance.name)
      .then(r => {
        if (!r.success) console.error(r.error);
      })
      .catch(err => console.error(err))
      .finally(() => {
        setPendingLaunches(prev => {
          const n = { ...prev };
          delete n[instance.name];
          return n;
        });
      });
  };

  const handleDragStart = (e, index) => {
    if (!isEditing) return;
    e.dataTransfer.setData('sectionIndex', index);
    e.currentTarget.classList.add('opacity-40', 'scale-95');
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('opacity-40', 'scale-95');
  };

  const handleDragOver = (e) => {
    if (!isEditing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetIndex) => {
    if (!isEditing) return;
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('sectionIndex'));
    if (sourceIndex === targetIndex) return;

    const newLayout = [...dashSettings.layout];
    const [removed] = newLayout.splice(sourceIndex, 1);
    newLayout.splice(targetIndex, 0, removed);

    handleDashUpdate({ ...dashSettings, layout: newLayout });
  };

  const toggleWidth = (index) => {
    const newLayout = [...dashSettings.layout];
    newLayout[index].width = newLayout[index].width === 12 ? 6 : 12;
    handleDashUpdate({ ...dashSettings, layout: newLayout });
  };

  const formatDownloads = (num) => {
    if (!num) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
    return String(num);
  };

  const renderSection = (section) => {
    if (!section.visible && !isEditing) return null;

    const sectionIndex = dashSettings.layout.findIndex(s => s.id === section.id);

    const sectionClass = `transition-all duration-200 ${isEditing
        ? 'relative ring-1 ring-primary/20 bg-primary/5 rounded-lg p-3 cursor-move group/section'
        : ''
      } ${section.width === 6 ? 'col-span-6' : 'col-span-12'} ${!section.visible ? 'opacity-30' : ''
      }`;

    return (
      <div
        key={section.id}
        className={sectionClass}
        draggable={isEditing}
        onDragStart={(e) => handleDragStart(e, sectionIndex)}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, sectionIndex)}
      >
        {isEditing && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-medium px-2 py-0.5 rounded-full z-10">
            <GripVertical className="w-3 h-3" />
            {t('home.drag_to_reorder', 'Drag to reorder')}
          </div>
        )}

        {isEditing && (
          <div className="absolute top-1.5 right-1.5 z-20">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={() => toggleWidth(sectionIndex)}
            >
              {section.width === 12 ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              {section.width === 12 ? 'Full' : 'Half'}
            </Button>
          </div>
        )}

        {section.id === 'recent-instances' && recentInstances.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {t('home.jump_back_in')}
            </h2>
            <div className="space-y-1">
              {recentInstances.map((instance) => {
                const liveStatus = runningInstances[instance.name];
                const installStateKey = Object.keys(activeDownloads).find(
                  k => k.toLowerCase() === instance.name.toLowerCase()
                );
                const installState = installStateKey ? activeDownloads[installStateKey] : null;
                const isInstalling = !!installState;
                const status = isInstalling ? 'installing' : liveStatus;
                const isRunning = status === 'running';
                const isLaunching = status === 'launching';
                const isPending = pendingLaunches[instance.name];

                return (
                  <div
                    key={instance.name}
                    onClick={() => onInstanceClick(instance)}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 active:bg-accent"
                  >
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border">
                      {instance.icon &&
                        (instance.icon.startsWith('data:') || instance.icon.startsWith('app-media://')) ? (
                        <img src={instance.icon} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Box className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {instance.name}
                        </span>
                        {isRunning && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                            {t('common.running')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        {instance.lastPlayed && (
                          <span>{t('home.played_ago', { time: formatTimeAgo(instance.lastPlayed) })}</span>
                        )}
                        <span className="text-border">·</span>
                        <span className="capitalize">{instance.loader || 'Vanilla'}</span>
                        <span>{instance.version}</span>
                      </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground mr-2">
                      <Clock className="w-3 h-3" />
                      <span>{formatPlaytime(instance.playtime)}</span>
                    </div>
                    <Button
                      variant={isRunning ? 'destructive' : 'ghost'}
                      size="sm"
                      className="h-8 gap-1.5 shrink-0"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        handleLaunch(ev, instance);
                      }}
                      disabled={isInstalling || isLaunching || isPending}
                    >
                      {isRunning ? (
                        <>
                          <Square className="w-3.5 h-3.5" />
                          {t('common.stop')}
                        </>
                      ) : isInstalling || isLaunching || isPending ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {isInstalling ? t('common.installing') : t('common.starting')}
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          {t('common.play')}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstanceClick(instance);
                      }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {section.id === 'recent-worlds' && recentWorlds.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {t('home.recent_worlds')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {recentWorlds.map((world, idx) => {
                const inst = instances.find(i => i.name === world.instanceName);
                const status = inst ? runningInstances[inst.name] : null;
                const isRunning = status === 'running';
                const isLaunching = status === 'launching';
                const isInstalling = status === 'installing';
                const isPending = pendingLaunches[world.instanceName];

                return (
                  <Card
                    key={`${world.instanceName}-${world.name}-${idx}`}
                    className="group cursor-pointer transition-colors hover:bg-accent/50 active:bg-accent border-border"
                    onClick={() => {
                      if (inst) onInstanceClick(inst);
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border">
                          {world.instanceIcon &&
                            (world.instanceIcon.startsWith('data:') ||
                              world.instanceIcon.startsWith('app-media://')) ? (
                            <img src={world.instanceIcon} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Box className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{world.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{world.instanceName}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Globe className="w-3 h-3" />
                          <span>{formatTimeAgo(new Date(world.lastPlayed).getTime())}</span>
                        </div>
                        <Button
                          variant={isRunning ? 'destructive' : 'ghost'}
                          size="sm"
                          className="h-6 text-xs gap-1 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isRunning) {
                              window.electronAPI.killGame(world.instanceName);
                              return;
                            }
                            if (isInstalling || isLaunching || isPending) return;
                            setPendingLaunches(prev => ({ ...prev, [world.instanceName]: true }));
                            window.electronAPI
                              .launchGame(world.instanceName, { world: world.name })
                              .then(r => {
                                if (!r.success) console.error(r.error);
                              })
                              .catch(err => console.error(err))
                              .finally(() => {
                                setPendingLaunches(prev => {
                                  const n = { ...prev };
                                  delete n[world.instanceName];
                                  return n;
                                });
                              });
                          }}
                          disabled={isInstalling || isLaunching || isPending}
                        >
                          {isRunning
                            ? t('common.stop')
                            : isInstalling || isLaunching || isPending
                              ? t('common.starting')
                              : t('common.play')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {section.id === 'modpacks' && (
          <div className="mb-8">
            <button
              onClick={() => onNavigateSearch && onNavigateSearch('modpack')}
              className="flex items-center gap-1.5 mb-3 group/link cursor-pointer"
            >
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider group-hover/link:text-foreground transition-colors">
                {t('home.discover_modpack')}
              </h2>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover/link:text-foreground group-hover/link:translate-x-0.5 transition-all" />
            </button>
            {loadingModpacks ? (
              <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="border-border">
                    <Skeleton className="aspect-video w-full rounded-t-lg" />
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                        <div className="flex-1">
                          <Skeleton className="h-4 w-24 mb-1" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className={`grid gap-2 ${section.width === 6 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
                {modpacks.map((pack) => (
                  <Card
                    key={pack.project_id}
                    className="group cursor-pointer transition-colors hover:bg-accent/30 border-border overflow-hidden"
                    onClick={() => setSelectedModpack(pack)}
                  >
                    <div className="aspect-video w-full overflow-hidden bg-muted">
                      {pack.gallery?.[0] ? (
                        <img
                          src={pack.gallery[0]}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        {pack.icon_url && (
                          <img
                            src={pack.icon_url}
                            alt=""
                            className="w-7 h-7 rounded-md shrink-0 border border-border"
                          />
                        )}
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-foreground truncate">
                            {pack.title}
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t('home.by_author', { author: pack.author })}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {section.id === 'mod-of-the-day' && (
          <div className="mb-8">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {t('home.mod_of_the_day')}
            </h2>
            {loadingModOfTheDay ? (
              <Card className="border-border overflow-hidden">
                <Skeleton className="w-full h-36" />
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-32 mb-2" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : modOfTheDay ? (
              <Card className="border-border overflow-hidden group">
                <div className="relative w-full h-36 bg-gradient-to-br from-primary/10 to-muted overflow-hidden">
                  {modOfTheDay.featured_image ? (
                    <img src={modOfTheDay.featured_image} alt="" className="w-full h-full object-cover" />
                  ) : modOfTheDay.gallery && modOfTheDay.gallery.length > 0 ? (
                    <img
                      src={modOfTheDay.gallery[0].url}
                      alt={modOfTheDay.gallery[0].title || ''}
                      className="w-full h-full object-cover"
                    />
                  ) : modOfTheDay.icon_url ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <img src={modOfTheDay.icon_url} alt="" className="w-16 h-16 rounded-xl" />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Sparkles className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
                </div>

                <CardContent className="p-4">
                  <div className="flex gap-3 mb-3">
                    <div className="flex-shrink-0">
                      {modOfTheDay.icon_url && (
                        <img
                          src={modOfTheDay.icon_url}
                          alt=""
                          className="w-10 h-10 rounded-lg border border-border"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground truncate">
                          {modOfTheDay.title}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {t('home.by_author', { author: modOfTheDay.author })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <div className="flex items-center gap-1">
                          <Download className="w-3 h-3" />
                          <span>{formatDownloads(modOfTheDay.downloads)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Heart className="w-3 h-3" />
                          <span>{formatDownloads(modOfTheDay.followers)}</span>
                        </div>
                        {modOfTheDay.updated && (
                          <span>{formatTimeAgo(new Date(modOfTheDay.updated).getTime())}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {modOfTheDay.loaders?.map(loader => (
                      <Badge key={loader} variant="default" className="text-[10px] capitalize">
                        {loader}
                      </Badge>
                    ))}
                    {modOfTheDay.categories?.slice(0, 4).map(cat => (
                      <Badge key={cat} variant="secondary" className="text-[10px] capitalize">
                        {cat.replace(/-/g, ' ')}
                      </Badge>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                    {modOfTheDay.description || 'No description available'}
                  </p>

                  <div className="flex gap-2">
                    <Button variant="default" size="sm" className="flex-1 h-8 text-xs" asChild>
                      <a
                        href={`https://modrinth.com/mod/${modOfTheDay.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-3 h-3 mr-1.5" />
                        Modrinth
                      </a>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={loadNewModOfTheDay}
                    >
                      <RefreshCw className="w-3 h-3 mr-1.5" />
                      {t('home.other_mod')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t('home.failed_to_load_mod')}</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={
          userProfile?.name
            ? t('home.welcome_back_name', {
              name: userProfile.name,
              defaultValue: `Welcome back, ${userProfile.name}!`,
            })
            : t('home.welcome_back')
        }
        description={t('home.everything_place')}
      >
        <div className="flex items-center gap-2">
          {isEditing && (
            <Button size="sm" onClick={() => setIsEditing(false)} className="gap-1.5">
              <Settings2 className="w-3.5 h-3.5" />
              {t('home.save_layout')}
            </Button>
          )}
          <Button
            variant={isEditing ? 'default' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowCustomizer(true)}
            title="Customize Dashboard"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <PageContent>
        <ExtensionSlot name="home.top" className="mb-6" />

        {isEditing && (
          <div className="mb-4 p-3 bg-primary/10 border border-dashed border-primary/30 rounded-lg text-center">
            <p className="text-sm font-medium text-primary">Advanced Editor Mode</p>
            <p className="text-[11px] text-primary/70">
              Drag sections to reorder · Toggle "Half/Full" to resize grid
            </p>
          </div>
        )}

        <div className="grid grid-cols-12 gap-x-4 gap-y-1">
          {dashSettings.layout.map(section => renderSection(section))}
        </div>

        {dashSettings.layout.find(s => s.id === 'recent-instances')?.visible &&
          recentInstances.length === 0 &&
          !isEditing && (
            <EmptyState
              icon={Box}
              title="No recent activity"
              description="Play an instance to see it here"
            />
          )}
      </PageContent>

      <Dialog open={!!selectedModpack} onOpenChange={(open) => { if (!open) setSelectedModpack(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0">
          {selectedModpack && (
            <>
              <div className="relative">
                {selectedModpack.gallery && selectedModpack.gallery.length > 0 ? (
                  <img
                    src={selectedModpack.gallery[0]}
                    alt={selectedModpack.title}
                    className="w-full h-44 object-cover"
                  />
                ) : (
                  <div className="w-full h-44 bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
                    {selectedModpack.icon_url ? (
                      <img src={selectedModpack.icon_url} alt="" className="w-16 h-16 rounded-xl" />
                    ) : (
                      <Package className="w-12 h-12 text-muted-foreground" />
                    )}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-popover via-transparent to-transparent" />
              </div>

              <div className="px-5 pt-4 pb-5 overflow-y-auto flex-1">
                <DialogHeader className="mb-4">
                  <div className="flex items-start gap-3">
                    {selectedModpack.icon_url && (
                      <img
                        src={selectedModpack.icon_url}
                        alt=""
                        className="w-12 h-12 rounded-lg border border-border shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-xl">{selectedModpack.title}</DialogTitle>
                      <DialogDescription className="text-sm mt-0.5">
                        by {selectedModpack.author}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {selectedModpack.downloads
                        ? `${formatDownloads(selectedModpack.downloads)} downloads`
                        : '0 downloads'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5" />
                    <span>{selectedModpack.follows || 0} followers</span>
                  </div>
                </div>

                {selectedModpack.categories && selectedModpack.categories.length > 0 && (
                  <div className="flex items-center gap-1 mb-4">
                    {selectedModpack.categories.map(cat => (
                      <Badge key={cat} variant="secondary" className="text-[10px] capitalize">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                )}

                <Separator className="my-4" />

                <div className="mb-4">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Description
                  </h3>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {selectedModpack.description || 'No description available.'}
                  </p>
                </div>

                {selectedModpack.gallery && selectedModpack.gallery.length > 1 && (
                  <div className="mb-4">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Gallery
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedModpack.gallery.slice(0, 4).map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt=""
                          className="w-full rounded-md object-cover aspect-video border border-border"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {selectedModpack.versions && selectedModpack.versions.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Supported Versions
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {(selectedModpack.display_categories || selectedModpack.versions || [])
                        .slice(0, 10)
                        .map(v => (
                          <Badge key={v} variant="outline" className="text-xs">
                            {v}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="px-5 py-3 border-t border-border flex items-center justify-between">
                <Button variant="link" size="sm" className="text-muted-foreground gap-1.5 px-0" asChild>
                  <a
                    href={`https://modrinth.com/modpack/${selectedModpack.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View on Modrinth
                  </a>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSelectedModpack(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DashboardCustomizer
        open={showCustomizer}
        settings={dashSettings}
        onUpdate={handleDashUpdate}
        onClose={() => setShowCustomizer(false)}
        onEnterEditor={() => {
          setShowCustomizer(false);
          setIsEditing(true);
        }}
        isEditing={isEditing}
      />
    </div>
  );
}

export default Home;
