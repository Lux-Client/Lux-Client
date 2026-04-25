import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../context/NotificationContext";
import { resolveClientAutoInstallModIds } from "../config/clientDefaults";
import {
  filterInstancesForMode,
  getOpenClientCreateOptions,
  applyVisibilityFilters,
} from "../utils/instanceTypes";

function Client() {
  const { t } = useTranslation();
  const { addNotification } = useNotification();

  const [availableVersions, setAvailableVersions] = useState([]);
  const [instances, setInstances] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [configuredModIds, setConfiguredModIds] = useState([]);
  const [updates, setUpdates] = useState({});
  const [isUpdating, setIsUpdating] = useState(false);
  const [installState, setInstallState] = useState({
    active: false,
    instanceName: "",
    progress: 0,
  });
  const [settings, setSettings] = useState({});

  const resolveConfiguredModIds = (settings) => {
    if (Array.isArray(settings?.openClientAutoInstallMods)) {
      return resolveClientAutoInstallModIds(settings.openClientAutoInstallMods);
    }
    return resolveClientAutoInstallModIds();
  };

  const loadVersions = async () => {
    setIsLoadingVersions(true);
    try {
      const supportedRes =
        await window.electronAPI.getSupportedGameVersions("Fabric");

      if (
        supportedRes?.success &&
        Array.isArray(supportedRes.versions) &&
        supportedRes.versions.length > 0
      ) {
        const fabricVersions = supportedRes.versions
          .filter((version) => /^\d+\.\d+(\.\d+)?$/.test(version))
          .map((version) => String(version));

        setAvailableVersions(fabricVersions);
        setSelectedVersion((prev) => {
          if (prev && fabricVersions.includes(prev)) return prev;
          return fabricVersions[0] || "";
        });
        return;
      }

      const vanillaRes = await window.electronAPI.getVanillaVersions();
      if (vanillaRes?.success && Array.isArray(vanillaRes.versions)) {
        const releaseVersions = vanillaRes.versions
          .filter((version) => version.type === "release")
          .map((version) => version.id);

        setAvailableVersions(releaseVersions);
        setSelectedVersion((prev) => {
          if (prev && releaseVersions.includes(prev)) return prev;
          return releaseVersions[0] || "";
        });
      } else {
        setAvailableVersions([]);
        setSelectedVersion("");
      }
    } catch (error) {
      console.error("[Client] Failed to load versions:", error);
      addNotification(
        t("client_page.errors.load_versions", "Could not load versions."),
        "error",
      );
      setAvailableVersions([]);
      setSelectedVersion("");
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const loadInstances = async () => {
    try {
      const list = await window.electronAPI.getInstances();
      const filteredList = applyVisibilityFilters(list, settings);
      setInstances(filterInstancesForMode(filteredList, "client"));
    } catch (error) {
      console.error("[Client] Failed to load instances:", error);
    }
  };

  const loadClientSettings = async () => {
    try {
      const settingsRes = await window.electronAPI.getSettings();
      if (settingsRes?.success) {
        setSettings(settingsRes.settings);
        setConfiguredModIds(resolveConfiguredModIds(settingsRes.settings));
      }
    } catch (error) {
      console.error("[Client] Failed to load settings:", error);
    }
  };

  const checkForUpdates = async (instanceName) => {
    try {
      const modsRes = await window.electronAPI.getMods(instanceName);
      if (!modsRes?.success || !Array.isArray(modsRes.mods)) {
        setUpdates({});
        return;
      }

      const contentToCheck = modsRes.mods
        .filter((mod) => mod.projectId)
        .map((mod) => ({
          projectId: mod.projectId,
          versionId: mod.versionId,
          source: mod.source,
          type: "mod",
          name: mod.name,
        }));

      if (contentToCheck.length === 0) {
        setUpdates({});
        return;
      }

      const res = await window.electronAPI.checkUpdates(
        instanceName,
        contentToCheck,
      );
      if (!res?.success || !Array.isArray(res.updates)) {
        setUpdates({});
        return;
      }

      const nextUpdates = {};
      res.updates.forEach((item) => {
        nextUpdates[item.projectId] = item;
      });
      setUpdates(nextUpdates);
    } catch (error) {
      console.error("[Client] Failed to check updates:", error);
      setUpdates({});
    }
  };

  const installConfiguredMods = async (instanceName, mcVersion) => {
    if (!configuredModIds.length) return;

    let installedCount = 0;
    for (const projectId of configuredModIds) {
      try {
        const versionsRes = await window.electronAPI.getModVersions(
          projectId,
          ["fabric"],
          [mcVersion],
        );
        if (
          !versionsRes?.success ||
          !Array.isArray(versionsRes.versions) ||
          versionsRes.versions.length === 0
        ) {
          continue;
        }

        const targetVersion = versionsRes.versions[0];
        const file =
          targetVersion.files?.find((entry) => entry.primary) ||
          targetVersion.files?.[0];
        if (!file) continue;

        const installRes = await window.electronAPI.installMod({
          instanceName,
          projectId,
          versionId: targetVersion.id,
          filename: file.filename,
          url: file.url,
          projectType: "mod",
        });

        if (installRes?.success) {
          installedCount += 1;
        }
      } catch (error) {
        console.error(
          `[Client] Failed to auto-install mod ${projectId}:`,
          error,
        );
      }
    }

    if (installedCount > 0) {
      addNotification(
        t(
          "client_page.auto_mods_installed",
          "{{count}} configured mods installed.",
          { count: installedCount },
        ),
        "success",
      );
    }
  };

  useEffect(() => {
    loadVersions();
    loadInstances();
    loadClientSettings();

    const removeStatusListener = window.electronAPI?.onInstanceStatus?.(
      ({ status }) => {
        if (
          status === "ready" ||
          status === "stopped" ||
          status === "deleted" ||
          status === "error"
        ) {
          loadInstances();
        }
      },
    );

    const removeInstallListener = window.electronAPI?.onInstallProgress?.(
      ({ instanceName, progress }) => {
        setInstallState((prev) => {
          if (!prev.instanceName || prev.instanceName !== instanceName) {
            return prev;
          }

          const nextProgress =
            typeof progress === "number" ? progress : prev.progress;
          if (nextProgress >= 100) {
            return { active: false, instanceName: "", progress: 100 };
          }

          return {
            ...prev,
            active: true,
            progress: nextProgress,
          };
        });
      },
    );

    return () => {
      if (removeStatusListener) removeStatusListener();
      if (removeInstallListener) removeInstallListener();
    };
  }, []);

  const installedInstance = useMemo(() => {
    if (!selectedVersion) return null;

    return (
      instances.find((instance) => {
        const loader = String(instance?.loader || "").toLowerCase();
        return loader === "fabric" && instance?.version === selectedVersion;
      }) || null
    );
  }, [instances, selectedVersion]);

  const ensureUniqueName = (baseName) => {
    const knownNames = new Set(instances.map((instance) => instance.name));
    if (!knownNames.has(baseName)) return baseName;

    let suffix = 2;
    let nextName = `${baseName} (${suffix})`;
    while (knownNames.has(nextName)) {
      suffix += 1;
      nextName = `${baseName} (${suffix})`;
    }
    return nextName;
  };

  useEffect(() => {
    if (!installedInstance?.name) {
      setUpdates({});
      return;
    }
    checkForUpdates(installedInstance.name);
  }, [installedInstance?.name]);

  const handleInstall = async () => {
    if (!selectedVersion || isBusy) return;

    setIsBusy(true);
    try {
      let loaderVersion = null;
      try {
        const loaderRes = await window.electronAPI.getLoaderVersions(
          "fabric",
          selectedVersion,
        );
        if (
          loaderRes?.success &&
          Array.isArray(loaderRes.versions) &&
          loaderRes.versions.length > 0
        ) {
          loaderVersion = loaderRes.versions[0].version;
        }
      } catch (error) {
        console.warn(
          "[Client] Failed to resolve loader version, fallback to latest:",
          error,
        );
      }

      const baseName = `Client ${selectedVersion}`;
      const name = ensureUniqueName(baseName);
      const result = await window.electronAPI.createInstance(
        name,
        selectedVersion,
        "fabric",
        null,
        loaderVersion,
        getOpenClientCreateOptions(),
      );

      if (result?.success) {
        const instanceName = result.instanceName || name;
        setInstallState({
          active: true,
          instanceName,
          progress: 0,
        });
        addNotification(t("common.installing", "Installing..."), "info");
        await installConfiguredMods(instanceName, selectedVersion);
        await loadInstances();
        await checkForUpdates(instanceName);
      } else {
        addNotification(
          t("client_page.errors.install", "Installation failed: {{error}}", {
            error: result?.error || "unknown error",
          }),
          "error",
        );
      }
    } catch (error) {
      addNotification(
        t("client_page.errors.install", "Installation failed: {{error}}", {
          error: error.message,
        }),
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handlePlay = async () => {
    if (!installedInstance || isBusy || isUpdating) return;

    setIsBusy(true);
    try {
      const result = await window.electronAPI.launchGame(
        installedInstance.name,
      );
      if (result?.success) {
        addNotification(
          t("client_page.launching", "Starting client..."),
          "info",
        );
      } else {
        addNotification(
          t("client_page.errors.play", "Could not start client: {{error}}", {
            error: result?.error || "unknown error",
          }),
          "error",
        );
      }
    } catch (error) {
      addNotification(
        t("client_page.errors.play", "Could not start client: {{error}}", {
          error: error.message,
        }),
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpdateAll = async () => {
    if (!installedInstance || isUpdating) return;
    const updateList: any[] = Object.values(updates);
    if (updateList.length === 0) return;

    setIsUpdating(true);
    try {
      for (const updateData of updateList) {
        await window.electronAPI.updateFile({
          instanceName: installedInstance.name,
          projectType: updateData.type,
          oldFileName: updateData.name,
          newFileName: updateData.filename,
          url: updateData.downloadUrl,
        });
      }
      await checkForUpdates(installedInstance.name);
      addNotification(
        t("client_page.updated", "Updates installed."),
        "success",
      );
    } catch (error) {
      addNotification(
        t("client_page.errors.update", "Update failed: {{error}}", {
          error: error.message,
        }),
        "error",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const isInstalled = Boolean(installedInstance);
  const isInstalling = installState.active;
  const hasUpdates = Object.keys(updates).length > 0;

  return (
    <div className="p-8 h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-xl mx-auto bg-card border border-border rounded-xl p-6 md:p-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">
          {t("client_page.title", "Open Client")}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t("client_page.description", "Select a version and start playing.")}
        </p>

        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
          {t("client_page.version", "Version")}
        </label>

        <select
          value={selectedVersion}
          onChange={(event) => setSelectedVersion(event.target.value)}
          disabled={
            isLoadingVersions || isBusy || availableVersions.length === 0
          }
          className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/60"
        >
          {availableVersions.map((version) => (
            <option key={version} value={version} className="bg-background">
              {version}
            </option>
          ))}
        </select>

        <div className="mt-5 text-xs text-muted-foreground min-h-[18px]">
          {isLoadingVersions
            ? t("client_page.loading_versions", "Loading versions...")
            : isInstalling
              ? `${t("common.installing", "Installing...")} (${Math.round(installState.progress)}%)`
              : isInstalled
                ? t("client_page.installed_state", "Installed")
                : t("client_page.not_installed_state", "Not installed")}
        </div>

        <div className="mt-4">
          {isInstalled && hasUpdates ? (
            <div className="w-full grid grid-cols-2 gap-2">
              <button
                onClick={handleUpdateAll}
                disabled={isBusy || isInstalling || isUpdating}
                className="px-4 py-3 bg-muted hover:bg-accent text-foreground rounded-xl text-sm font-bold border border-border disabled:opacity-60 transition"
              >
                {isUpdating
                  ? t("common.loading", "Loading...")
                  : t("client_page.update", "Update")}
              </button>
              <button
                onClick={handlePlay}
                disabled={isBusy || isInstalling || isUpdating}
                className="px-4 py-3 bg-primary text-black rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-60 transition"
              >
                {isBusy
                  ? t("common.loading", "Loading...")
                  : t("common.play", "Play")}
              </button>
            </div>
          ) : isInstalled ? (
            <button
              onClick={handlePlay}
              disabled={isBusy || isInstalling || isUpdating}
              className="w-full px-4 py-3 bg-primary text-black rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-60 transition"
            >
              {isBusy
                ? t("common.loading", "Loading...")
                : t("common.play", "Play")}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={
                isBusy ||
                isInstalling ||
                isUpdating ||
                !selectedVersion ||
                isLoadingVersions
              }
              className="w-full px-4 py-3 bg-muted hover:bg-accent text-foreground rounded-xl text-sm font-bold border border-border disabled:opacity-60 transition"
            >
              {isBusy || isInstalling
                ? t("common.installing", "Installing...")
                : t("client_page.install", "Install")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Client;
