import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyVisibilityFilters } from "../utils/instanceTypes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import {
  Zap,
  Plus,
  Trash2,
  Play,
  Square,
  Globe,
  FolderOpen,
  Settings2,
} from "lucide-react";

const ACTION_TYPES = [
  "external",
  "instance:start",
  "instance:stop",
  "server:start",
  "server:stop",
];

function ActionBar({ open, onOpenChange }) {
  const { t } = useTranslation();
  const [actions, setActions] = useState([]);
  const [instances, setInstances] = useState([]);
  const [servers, setServers] = useState([]);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [settings, setSettings] = useState({});

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("external");
  const [newPath, setNewPath] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newIcon, setNewIcon] = useState("");

  useEffect(() => {
    if (open) {
      loadInitialData();
    }
  }, [open]);

  useEffect(() => {
    const removeSettingsListener = window.electronAPI?.onSettingsUpdated?.(
      (newSettings) => {
        const nextActions = Array.isArray(newSettings?.actionBarActions)
          ? newSettings.actionBarActions
          : [];
        setActions(nextActions);
      },
    );

    return () => {
      if (removeSettingsListener) removeSettingsListener();
    };
  }, []);

  const loadInitialData = async () => {
    try {
      const [settingsRes, instancesRes, serversRes] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.getInstances(),
        window.electronAPI.getServers(),
      ]);

      if (settingsRes?.success) {
        const loadedActions = Array.isArray(
          settingsRes.settings?.actionBarActions,
        )
          ? settingsRes.settings.actionBarActions
          : [];
        setActions(loadedActions);
        setSettings(settingsRes.settings);
      }

      const filteredInstances = applyVisibilityFilters(
        Array.isArray(instancesRes) ? instancesRes : [],
        settingsRes?.settings || {},
      );
      setInstances(filteredInstances);

      if (serversRes?.success && Array.isArray(serversRes.servers)) {
        setServers(serversRes.servers);
      } else {
        setServers([]);
      }
    } catch (error) {
      console.error("[ActionBar] Failed to load initial data:", error);
    }
  };

  const persistActions = async (nextActions) => {
    setActions(nextActions);
    try {
      const settingsRes = await window.electronAPI.getSettings();
      if (!settingsRes?.success) return;
      await window.electronAPI.saveSettings({
        ...settingsRes.settings,
        actionBarActions: nextActions,
      });
    } catch (error) {
      console.error("[ActionBar] Failed to save actions:", error);
    }
  };

  const targetOptions = useMemo(() => {
    if (newType.startsWith("instance:"))
      return instances.map((item) => item.name);
    if (newType.startsWith("server:")) return servers.map((item) => item.name);
    return [];
  }, [newType, instances, servers]);

  useEffect(() => {
    if (
      (newType.startsWith("instance:") || newType.startsWith("server:")) &&
      targetOptions.length > 0 &&
      !targetOptions.includes(newTarget)
    ) {
      setNewTarget(targetOptions[0]);
    }
    if (newType === "external") {
      setNewTarget("");
    }
  }, [newType, targetOptions, newTarget]);

  const getActionIcon = (type) => {
    switch (type) {
      case "external":
        return Globe;
      case "instance:start":
        return Play;
      case "instance:stop":
        return Square;
      case "server:start":
        return Play;
      case "server:stop":
        return Square;
      default:
        return Zap;
    }
  };

  const getActionBadge = (type) => {
    if (type === "external") return t("action_bar.type_external");
    if (type.startsWith("instance:")) return t("common.instance", "Instance");
    if (type.startsWith("server:")) return t("common.server");
    return type;
  };

  const handlePickExternal = async () => {
    const result = await window.electronAPI.openFileDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("action_bar.programs"),
          extensions: ["exe", "bat", "cmd", "com", "ps1"],
        },
        { name: t("action_bar.all_files"), extensions: ["*"] },
      ],
    });
    if (!result?.canceled && result?.filePaths?.length > 0) {
      setNewPath(result.filePaths[0]);
    }
  };

  const handleIconUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setNewIcon(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddAction = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    if (newType === "external" && !newPath.trim()) return;
    if (newType !== "external" && !newTarget) return;

    const nextAction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      type: newType,
      icon: newIcon || "",
      path: newType === "external" ? newPath.trim() : "",
      target: newType !== "external" ? newTarget : "",
    };

    await persistActions([...actions, nextAction]);

    setNewName("");
    setNewPath("");
    setNewIcon("");
  };

  const handleDelete = async (id) => {
    const nextActions = actions.filter((action) => action.id !== id);
    await persistActions(nextActions);
  };

  const executeAction = async (action) => {
    try {
      if (action.type === "external") {
        await window.electronAPI.runExternalFile(action.path);
        return;
      }
      if (action.type === "instance:start") {
        await window.electronAPI.launchGame(action.target, false);
        return;
      }
      if (action.type === "instance:stop") {
        await window.electronAPI.killGame(action.target);
        return;
      }
      if (action.type === "server:start") {
        await window.electronAPI.startServer(action.target);
        return;
      }
      if (action.type === "server:stop") {
        await window.electronAPI.stopServer(action.target);
      }
    } catch (error) {
      console.error("[ActionBar] Failed to execute action:", error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[340px] sm:max-w-[340px] flex flex-col p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-0 pr-12">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              {t("action_bar.title")}
            </SheetTitle>
            <Button
              variant={isCustomizing ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setIsCustomizing((prev) => !prev)}
            >
              <Settings2 className="h-3 w-3" />
              {isCustomizing
                ? t("action_bar.exit_customize")
                : t("action_bar.customize")}
            </Button>
          </div>
          <SheetDescription className="text-xs">
            {t("action_bar.empty", "No quick actions configured")}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mt-4" />

        <ScrollArea className="flex-1 px-5">
          <div className="py-4 space-y-2">
            {actions.length === 0 && !isCustomizing && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("action_bar.empty")}
                </p>
                <button
                  onClick={() => setIsCustomizing(true)}
                  className="text-xs text-primary hover:text-primary/80 mt-1 cursor-pointer font-medium transition-colors"
                >
                  {t("action_bar.customize")}
                </button>
              </div>
            )}

            {actions.map((action) => {
              const Icon = getActionIcon(action.type);
              return (
                <div
                  key={action.id}
                  className="group rounded-lg border border-stroke bg-surface hover:bg-accent/50 transition-colors"
                >
                  <button
                    onClick={() => {
                      if (!isCustomizing) {
                        executeAction(action);
                      }
                    }}
                    className="w-full flex items-center gap-3 p-3 text-left"
                    disabled={isCustomizing}
                  >
                    <div className="w-8 h-8 rounded-md bg-muted border border-stroke overflow-hidden shrink-0 flex items-center justify-center">
                      {action.icon ? (
                        <img
                          src={action.icon}
                          alt={action.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">
                        {action.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] font-medium"
                        >
                          {getActionBadge(action.type)}
                        </Badge>
                        {action.target && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {action.target}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {isCustomizing && (
                    <div className="flex justify-end px-3 pb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(action.id)}
                        className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t("action_bar.remove", t("common.delete"))}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {isCustomizing && (
          <div className="border-t border-stroke px-5 py-4 space-y-3">
            <Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("action_bar.add_action")}
            </Label>

            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("action_bar.name_placeholder")}
              className="h-8 text-xs"
            />

            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map((typeKey) => (
                  <SelectItem key={typeKey} value={typeKey} className="text-xs">
                    {t(`action_bar.type_${typeKey.replace(":", "_")}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {newType === "external" ? (
              <div className="flex gap-2">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder={t("action_bar.path_placeholder")}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePickExternal}
                  className="h-8 text-xs shrink-0"
                >
                  <FolderOpen className="h-3 w-3" />
                  {t("action_bar.browse")}
                </Button>
              </div>
            ) : (
              <Select value={newTarget} onValueChange={setNewTarget}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      targetOptions.length === 0
                        ? t("action_bar.no_targets")
                        : undefined
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.length === 0 ? (
                    <SelectItem value="__none" disabled className="text-xs">
                      {t("action_bar.no_targets")}
                    </SelectItem>
                  ) : (
                    targetOptions.map((name) => (
                      <SelectItem key={name} value={name} className="text-xs">
                        {name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                {t("action_bar.image")}
              </Label>
              <input
                type="file"
                accept="image/*"
                onChange={handleIconUpload}
                className="text-[10px] text-muted-foreground file:mr-2 file:px-2 file:py-1 file:rounded-md file:border-0 file:bg-muted file:text-foreground file:text-[10px] file:cursor-pointer"
              />
            </div>

            <Button
              size="sm"
              onClick={handleAddAction}
              className="w-full h-8 text-xs"
            >
              <Plus className="h-3 w-3" />
              {t("action_bar.add")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ActionBar;
