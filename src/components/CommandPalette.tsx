import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isFeatureEnabled } from '../config/featureFlags';
import { filterInstancesForMode } from '../utils/instanceTypes';
import {
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut
} from './ui/command';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import {
  Home, LayoutGrid, Search, User, Puzzle, Palette,
  Settings, Newspaper, Play, Server, Rocket, Gamepad2, List, Wrench
} from 'lucide-react';

function CommandPalette({ open, onOpenChange, onNavigate, onModeSelect, currentMode, isAvailable, canAccessSkins }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState([]);
  const isClientPageEnabled = isFeatureEnabled('openClientPage');

  useEffect(() => {
    if (open && isAvailable) fetchInstances();
  }, [open, isAvailable, currentMode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isAvailable) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange, isAvailable]);

  useEffect(() => {
    if (!isAvailable && open) {
      onOpenChange(false);
    }
  }, [isAvailable, open, onOpenChange]);

  const fetchInstances = async () => {
    if (currentMode === 'tools') {
      setInstances([]);
      return;
    }
    try {
      const list = await window.electronAPI.getInstances();
      const instanceMode = currentMode === 'client' || currentMode === 'launcher' ? currentMode : undefined;
      setInstances(filterInstancesForMode(list, instanceMode));
    } catch (e) { }
  };

  const handleSelect = useCallback((action) => {
    onOpenChange(false);
    if (typeof action === 'function') action();
  }, [onOpenChange]);

  const navItems = currentMode === 'tools'
    ? [
      { id: 'tools-dashboard', label: t('common.dashboard', 'Dashboard'), icon: LayoutGrid, shortcut: 'D' },
      { id: 'settings', label: t('common.settings', 'Settings'), icon: Settings, shortcut: ',' },
      { id: 'news', label: t('common.news', 'News'), icon: Newspaper },
    ]
    : [
      { id: 'dashboard', label: t('common.dashboard'), icon: Home, shortcut: 'D' },
      { id: 'library', label: t('common.library'), icon: LayoutGrid, shortcut: 'L' },
      { id: 'search', label: t('common.search'), icon: Search, shortcut: 'S' },
      { id: 'skins', label: t('common.skins'), icon: User, disabled: !canAccessSkins },
      { id: 'extensions', label: t('common.extensions'), icon: Puzzle },
      { id: 'styling', label: t('common.styling'), icon: Palette },
      { id: 'settings', label: t('common.settings'), icon: Settings, shortcut: ',' },
      { id: 'news', label: t('common.news', 'News'), icon: Newspaper },
    ];

  if (!isAvailable) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-xl rounded-xl border-border/50 shadow-2xl duration-300 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-top-[50%] data-[state=open]:slide-in-from-top-[50%] [&>button]:hidden">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">Search and quick navigation commands.</DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder={t('dashboard.search_placeholder', 'Type a command or search...')} className="h-12" />
          <CommandList className="max-h-[400px]">
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
              {t('dashboard.no_instances', 'No results found.')}
            </CommandEmpty>

            <CommandGroup heading={t('common.navigation', 'Navigation')}>
              {navItems.map(item => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    onSelect={() => !item.disabled && handleSelect(() => onNavigate(item.id))}
                    disabled={item.disabled}
                    className="gap-3 py-2.5 px-3 rounded-lg cursor-pointer data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                  >
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{item.label}</span>
                    </div>
                    {item.shortcut && (
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {instances.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('common.instances', 'Instances')}>
                  {instances.map(inst => (
                    <CommandItem
                      key={inst.name}
                      value={inst.name}
                      onSelect={() => handleSelect(() => {
                        try { window.electronAPI.launchGame(inst.name); } catch (e) { }
                      })}
                      className="gap-3 py-2.5 px-3 rounded-lg cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0 overflow-hidden">
                        {inst.icon && inst.icon.startsWith('data:') ? (
                          <img src={inst.icon} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{inst.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {inst.loader || 'Vanilla'} {inst.version}
                        </div>
                      </div>
                      <Play className="h-3.5 w-3.5 text-muted-foreground" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {currentMode === 'client' && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('common.client', 'Client')}>
                  <CommandItem
                    value="open-client"
                    onSelect={() => handleSelect(() => onNavigate('open-client'))}
                    className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <Gamepad2 className="h-4 w-4" />
                    </div>
                    <span className="font-medium">{t('common.client', 'Client')}</span>
                  </CommandItem>
                  <CommandItem
                    value="client-mods"
                    onSelect={() => handleSelect(() => onNavigate('mods'))}
                    className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <List className="h-4 w-4" />
                    </div>
                    <span className="font-medium">{t('instance_details.content.mods', 'Mods')}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading={t('common.mode', 'Mode')}>
              <CommandItem
                value="switch-launcher"
                onSelect={() => handleSelect(() => onModeSelect('launcher'))}
                className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
              >
                <Rocket className="h-4 w-4" />
                <span>{t('common.launcher')}</span>
                {currentMode === 'launcher' && <CommandShortcut>Active</CommandShortcut>}
              </CommandItem>
              <CommandItem
                value="switch-server"
                onSelect={() => handleSelect(() => onModeSelect('server'))}
                className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
              >
                <Server className="h-4 w-4" />
                <span>{t('common.server')}</span>
                {currentMode === 'server' && <CommandShortcut>Active</CommandShortcut>}
              </CommandItem>
              {isClientPageEnabled && (
                <CommandItem
                  value="switch-client"
                  onSelect={() => handleSelect(() => onModeSelect('client'))}
                  className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
                >
                  <Gamepad2 className="h-4 w-4" />
                  <span>{t('common.client', 'Client')}</span>
                  {currentMode === 'client' && <CommandShortcut>Active</CommandShortcut>}
                </CommandItem>
              )}
              <CommandItem
                value="switch-tools"
                onSelect={() => handleSelect(() => onModeSelect('tools'))}
                className="gap-3 py-2 px-3 rounded-lg cursor-pointer"
              >
                <Wrench className="h-4 w-4" />
                <span>{t('common.useful_tools', 'Useful Tools')}</span>
                {currentMode === 'tools' && <CommandShortcut>Active</CommandShortcut>}
              </CommandItem>
            </CommandGroup>
          </CommandList>

          <div className="border-t border-border px-3 py-2 flex items-center justify-between text-[10px] text-muted-foreground font-medium">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px]">↑↓</kbd>
                {t('common.navigate')}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px]">↵</kbd>
                {t('common.select')}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px]">Esc</kbd>
                {t('common.close', 'Close')}
              </span>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;
