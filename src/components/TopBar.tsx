import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isFeatureEnabled } from '../config/featureFlags';
import ExtensionSlot from './Extensions/ExtensionSlot';
import PlayerHead from './PlayerHead';
import WindowControls from './WindowControls';
import ActionBar from './ActionBar';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './ui/tooltip';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup
} from './ui/dropdown-menu';
import {
  Search, ChevronDown, ChevronLeft, ChevronRight, Newspaper, Rocket,
  Download, Gamepad2, Server, UserPlus, Trash2, LogOut, Zap, Wrench
} from 'lucide-react';

type TopBarProps = {
  currentMode: any;
  onModeSelect: any;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  userProfile: any;
  onProfileUpdate: any;
  isGuest: any;
  isMaximized: any;
  onOpenCommandPalette: any;
  onNavigate: any;
  runningInstances: any;
  activeDownloads: any;
  appSettings: any;
  isCommandPaletteAvailable: boolean;
};

function TopBar({
  currentMode,
  onModeSelect,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
  userProfile,
  onProfileUpdate,
  isGuest,
  isMaximized,
  onOpenCommandPalette,
  onNavigate,
  runningInstances,
  activeDownloads,
  appSettings,
  isCommandPaletteAvailable
}: TopBarProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [liveSkin, setLiveSkin] = useState(null);
  const [actionBarOpen, setActionBarOpen] = useState(false);

  useEffect(() => {
    if (userProfile?.access_token) {
      if (userProfile.skinUrl) {
        setLiveSkin(userProfile.skinUrl);
      } else {
        loadLiveSkin();
      }
    } else {
      setLiveSkin(null);
    }
  }, [userProfile]);

  const loadLiveSkin = async () => {
    if (!userProfile?.access_token) return;
    try {
      const res = await window.electronAPI.getCurrentSkin(userProfile.access_token);
      if (res.success && res.url) {
        setLiveSkin(res.url);
        if (onProfileUpdate) {
          onProfileUpdate({ ...userProfile, skinUrl: res.url });
        }
      }
    } catch (e) { }
  };

  const loadAccounts = async () => {
    const accs = await window.electronAPI.getAccounts();
    setAccounts(accs || []);
  };

  const handleSwitch = async (uuid) => {
    const res = await window.electronAPI.switchAccount(uuid);
    if (res.success) {
      if (window.electronAPI.validateSession) {
        const val = await window.electronAPI.validateSession();
        if (val.success) {
          const profile = await window.electronAPI.getProfile();
          onProfileUpdate(profile);
        } else {
          onProfileUpdate(null);
        }
      } else {
        onProfileUpdate(res.profile);
      }
    }
  };

  const handleAddAccount = async () => {
    const res = await window.electronAPI.login();
    if (res.success) {
      onProfileUpdate(res.profile);
    }
  };

  const handleRemove = async (uuid) => {
    const res = await window.electronAPI.removeAccount(uuid);
    if (res.success) {
      if (res.loggedOut) {
        onProfileUpdate(null);
      } else {
        loadAccounts();
      }
    }
  };

  const runningCount = Object.keys(runningInstances).filter(k => runningInstances[k] === 'running').length;
  const activeDownloadEntries = Object.entries(activeDownloads);
  const activeDownloadCount = activeDownloadEntries.length;
  const isClientPageEnabled = isFeatureEnabled('openClientPage');
  const modeButtons = [
    {
      value: 'launcher',
      label: t('common.launcher', 'Launcher'),
      icon: Rocket
    },
    {
      value: 'server',
      label: t('common.server', 'Server'),
      icon: Server
    },
    ...(isClientPageEnabled ? [{
      value: 'client',
      label: t('common.client', 'Client'),
      icon: Gamepad2
    }] : []),
    {
      value: 'tools',
      label: t('common.useful_tools', 'Useful Tools'),
      icon: Wrench
    }
  ];

  return (
    <div className="h-16 w-full titlebar flex items-center justify-between px-3 lg:px-5 border-b border-border bg-background/80 backdrop-blur-md flex-none relative z-[60]">
      <div className="flex items-center gap-1.5 lg:gap-2.5 no-drag shrink-0">
        <div className="w-10 h-10 bg-primary/15 rounded-xl flex items-center justify-center text-primary font-bold text-base border border-primary/20">
          L
        </div>

        <>
          <TooltipProvider>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    aria-label={t('common.back', 'Back')}
                    onClick={onNavigateBack}
                    disabled={!canNavigateBack}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t('common.back', 'Back')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    aria-label={t('common.forward', 'Forward')}
                    onClick={onNavigateForward}
                    disabled={!canNavigateForward}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t('common.forward', 'Forward')}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          <TooltipProvider>
            <div data-guide-id="mode-switcher">
              <ToggleGroup
                type="single"
                value={currentMode}
                onValueChange={(value) => value && onModeSelect(value)}
                className="gap-1"
              >
                {modeButtons.map(({ value, label, icon: Icon }) => (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem
                        value={value}
                        aria-label={label}
                        data-guide-id={`mode-switch-${value}`}
                        className={cn(
                          "h-8 w-8 rounded-lg px-0",
                          currentMode === value
                            ? "bg-muted text-foreground shadow-sm hover:bg-muted hover:text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{label}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </ToggleGroup>
            </div>
          </TooltipProvider>

          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-2.5 rounded-xl px-2 lg:px-3.5 text-sm font-semibold text-muted-foreground hidden sm:flex"
            onClick={() => onNavigate('news')}
          >
            <Newspaper className="h-4 w-4" />
            <span className="hidden lg:inline">{t('common.news', 'News')}</span>
          </Button>
        </>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 no-drag pointer-events-none" style={{ maxWidth: 'calc(100% - 480px)' }}>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 w-full max-w-[280px] gap-2 rounded-xl border-border/50 bg-background/50 px-2 lg:px-4 text-sm text-muted-foreground justify-start"
            onClick={onOpenCommandPalette}
            disabled={!isCommandPaletteAvailable}
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline truncate">{t('dashboard.search_placeholder', 'Search...')}</span>
            <kbd className="hidden lg:inline-flex ml-auto pointer-events-none h-6 select-none items-center gap-1 rounded-md border border-border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground">
              Ctrl+K
            </kbd>
          </Button>
          <ExtensionSlot name="header.center" className="flex items-center gap-2" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 lg:gap-2 no-drag shrink-0">
        <ExtensionSlot name="header.right" className="hidden sm:flex items-center gap-2" />

        {activeDownloadCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-10 gap-2 rounded-xl px-3 text-sm">
                <Download className="h-4 w-4 text-primary animate-pulse" />
                <span className="tabular-nums">
                  {Math.round(activeDownloadEntries.reduce((t, [, d]) => t + ((d as any)?.progress || 0), 0) / activeDownloadCount)}%
                </span>
                {activeDownloadCount > 1 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{activeDownloadCount}</Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">{t('common.downloads')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {activeDownloadEntries.map(([name, data]: [string, any]) => (
                <div key={name} className="px-2 py-1.5 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium truncate pr-2">{name}</span>
                    <span className="text-primary font-mono text-[10px]">{data.progress}%</span>
                  </div>
                  <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${data.progress}%` }} />
                  </div>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-10 gap-2 rounded-xl px-2 lg:px-3 text-sm hidden sm:flex"
        >
          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', runningCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/50')} />
          <span className="text-muted-foreground hidden lg:inline">
            {runningCount === 0 ? t('common.idle') : `${runningCount} ${t('common.running')}`}
          </span>
        </Button>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 rounded-xl p-0"
                onClick={() => setActionBarOpen(true)}
              >
                <Zap className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('action_bar.title')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Separator orientation="vertical" className="h-6" />

        <DropdownMenu onOpenChange={(open) => open && loadAccounts()}>
          <DropdownMenuTrigger asChild>
            <button className="flex h-10 items-center gap-1.5 lg:gap-2 rounded-xl px-1.5 lg:px-2.5 py-1.5 hover:bg-accent transition-colors">
              {userProfile ? (
                <>
                  <PlayerHead
                    src={liveSkin}
                    uuid={userProfile?.uuid}
                    name={userProfile?.name}
                    size={28}
                    className="rounded-md shrink-0"
                  />
                  <span className="hidden max-w-[96px] truncate text-sm font-medium text-foreground lg:inline">
                    {userProfile?.name}
                  </span>
                </>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {userProfile && (
              <>
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <PlayerHead
                      src={liveSkin}
                      uuid={userProfile?.uuid}
                      name={userProfile?.name}
                      size={32}
                      className="rounded-md"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold truncate text-sm">{userProfile?.name}</div>
                      <div className="text-[10px] text-muted-foreground">{userProfile?.type || 'Online'}</div>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {t('common.accounts', 'Accounts')}
              </DropdownMenuLabel>
              {accounts.filter(a => a.uuid !== userProfile?.uuid).map(acc => (
                <DropdownMenuItem key={acc.uuid} className="flex items-center justify-between group/acc">
                  <div className="flex items-center gap-2 min-w-0 flex-1" onClick={() => handleSwitch(acc.uuid)}>
                    <PlayerHead uuid={acc.uuid} name={acc.name} size={20} className="rounded-sm" />
                    <span className="truncate text-xs">{acc.name}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(acc.uuid); }}
                    className="opacity-0 group-hover/acc:opacity-100 p-0.5 hover:text-destructive transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={handleAddAccount} className="text-primary">
                <UserPlus className="h-4 w-4 mr-2" />
                {t('common.add_account', 'Add Account')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5" />
        <WindowControls isMaximized={isMaximized} />
      </div>

      <ActionBar open={actionBarOpen} onOpenChange={setActionBarOpen} />
    </div>
  );
}

export default TopBar;
