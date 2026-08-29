import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../context/NotificationContext";
import Skeleton from "../components/ui/skeleton";
import { Box, ChevronDown, ArrowDownToLine } from "@gravity-ui/icons";
import { fetchSupportedPlatforms, fetchVersionsFor, fetchDetailsFor } from "../services/serverJars";

function ServerLibrary() {
  const { t } = useTranslation();
  const { addNotification } = useNotification();
  const [platforms, setPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [installedSoftware, setInstalledSoftware] = useState({});

  const platformDetails = {
    vanilla: {
      logo: "./assets/server-software/vanilla.png",
      name: "Vanilla",
      description: "Official Minecraft server",
      color: "from-green-500/20",
    },
    bukkit: {
      logo: "./assets/server-software/bukkit.png",
      name: "Bukkit",
      description: "Original plugin API",
      color: "from-orange-500/20",
    },
    spigot: {
      logo: "./assets/server-software/spigot.png",
      name: "Spigot",
      description: "Most popular server software",
      color: "from-yellow-500/20",
    },
    paper: {
      logo: "./assets/server-software/paper.svg",
      name: "Paper",
      description: "High-performance fork of Spigot",
      color: "from-blue-500/20",
    },
    purpur: {
      logo: "./assets/server-software/purpur.svg",
      name: "Purpur",
      description: "Fork of Paper with many features",
      color: "from-purple-500/20",
    },
    folia: {
      logo: "./assets/server-software/folia.png",
      name: "Folia",
      description: "Regionized multithreaded server",
      color: "from-emerald-500/20",
    },
    forge: {
      logo: "./assets/server-software/forge.jpeg",
      name: "Forge",
      description: "Modded server for Forge mods",
      color: "from-red-500/20",
    },
    fabric: {
      logo: "./assets/server-software/fabric.png",
      name: "Fabric",
      description: "Lightweight modding platform",
      color: "from-cyan-500/20",
    },
    neoforge: {
      logo: "./assets/server-software/neoforge.ico",
      name: "NeoForge",
      description: "Modern fork of Forge",
      color: "from-indigo-500/20",
    },
    quilt: {
      logo: "./assets/server-software/quilt.svg",
      name: "Quilt",
      description: "Community-driven modding platform",
      color: "from-pink-500/20",
    },
    bungeecord: {
      logo: "./assets/server-software/bungeecord.png",
      name: "BungeeCord",
      description: "Powerful proxy server",
      color: "from-blue-600/20",
    },
    velocity: {
      logo: "./assets/server-software/velocity.png",
      name: "Velocity",
      description: "Modern, high-performance proxy",
      color: "from-cyan-600/20",
    },
  };

  useEffect(() => {
    loadPlatforms();
    loadInstalledSoftware();
  }, []);

    async function loadPlatforms() {
    setIsLoading(true);
    try {
      const data = fetchSupportedPlatforms();
      const supportedPlatforms = [
        "vanilla",
        "bukkit",
        "spigot",
        "paper",
        "purpur",
        "folia",
        "forge",
        "fabric",
        "neoforge",
        "quilt",
        "bungeecord",
        "velocity",
      ];
      const filteredPlatforms = data
        .filter((platform) => supportedPlatforms.includes(platform.key))
        .map((platform) => {
          if (platform.key === "craftbukkit") return { ...platform, key: "bukkit" };
          if (platform.key === "waterfall")
            return { ...platform, key: "bungeecord", name: "BungeeCord" };
          return platform;
        });
      const sortedPlatforms = filteredPlatforms.sort(
        (a, b) => supportedPlatforms.indexOf(a.key) - supportedPlatforms.indexOf(b.key),
      );

      setPlatforms(sortedPlatforms);
    } catch (error) {
      console.error("Failed to load platforms:", error);
      addNotification(t("server_library.load_platforms_failed"), "error");
      setPlatforms([
        { key: "vanilla", name: "Vanilla" },
        { key: "bukkit", name: "Bukkit" },
        { key: "spigot", name: "Spigot" },
        { key: "paper", name: "Paper" },
        { key: "purpur", name: "Purpur" },
        { key: "folia", name: "Folia" },
        { key: "forge", name: "Forge" },
        { key: "fabric", name: "Fabric" },
        { key: "neoforge", name: "NeoForge" },
        { key: "quilt", name: "Quilt" },
        { key: "bungeecord", name: "BungeeCord" },
        { key: "velocity", name: "Velocity" },
      ]);
        } finally {
            setIsLoading(false);
        }
    }

  const loadVersions = async (platform) => {
    setIsLoadingVersions(true);
    setSelectedPlatform(platform);
    try {
      const data = await fetchVersionsFor(platform.key);
      setVersions((data || []).map((version) => ({ version })));
    } catch (error) {
      console.error("Failed to load versions:", error);
      addNotification(t("server_library.load_versions_failed", { name: platform.name }), "error");
    } finally {
      setIsLoadingVersions(false);
    }
  };

    async function loadInstalledSoftware() {
    try {
      const servers = await window.electronAPI.getServers();
      const counts = {};
      servers.forEach((server) => {
        if (server.software) {
          counts[server.software] = (counts[server.software] || 0) + 1;
        }
      });
      setInstalledSoftware(counts);
        } catch (error) {
            console.error('Failed to load installed software:', error);
        }
    }

  const handleDownload = async (platform, version) => {
    try {
      setDownloading(`${platform.key}-${version.version}`);
      const data = await fetchDetailsFor(platform.key, version.version);
      const result = await window.electronAPI.downloadServerSoftware({
        platform: platform.key,
        version: version.version,
        downloadUrl: data.downloadUrl,
        name: platform.name,
      });

      if (result.success) {
        addNotification(
          t("server_library.download_success", { name: platform.name, version: version.version }),
          "success",
        );
        await loadInstalledSoftware();
      } else {
        addNotification(t("server_library.download_failed", { error: result.error }), "error");
      }
    } catch (err) {
      console.error(err);
      addNotification(t("server_library.download_failed", { error: err.message }), "error");
    } finally {
      setDownloading(null);
    }
  };

  const handleSelectPlatform = (platform) => {
    if (selectedPlatform?.key === platform.key) {
      setSelectedPlatform(null);
      setVersions([]);
    } else {
      loadVersions(platform);
    }
  };

  const getInstallCount = (platformKey) => {
    return installedSoftware[platformKey] || 0;
  };

  return (
    <div className="p-8 h-full overflow-y-auto custom-scrollbar">
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card/60 overflow-hidden">
              <div className="p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-14 h-14 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32 rounded-md" />
                    <Skeleton className="h-4 w-44 rounded-md" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground mb-1">{t("server_library.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("server_library.desc")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {platforms.map((platform) => {
          const details = platformDetails[platform.key] || {
            icon: Box,
            name: platform.name,
            description: "Minecraft server software",
            color: "from-gray-500/20",
          };
          const installCount = getInstallCount(platform.key);
          const isSelected = selectedPlatform?.key === platform.key;

          return (
            <div
              key={platform.key}
              className={`rounded-xl border overflow-hidden transition-colors ${isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-card/60"}`}
            >
              <button
                type="button"
                onClick={() => handleSelectPlatform(platform)}
                className="w-full text-left p-5 flex items-center gap-4 hover:bg-accent/30 transition-colors"
              >
                <div
                  className={`w-14 h-14 bg-gradient-to-br ${details.color} to-transparent rounded-xl flex items-center justify-center border border-border overflow-hidden p-2.5 shrink-0`}
                >
                  {details.logo ? (
                    <img
                      src={details.logo}
                      alt={details.name}
                      className="w-full h-full object-contain"
                    />
                  ) : typeof details.icon === "function" ? (
                    <details.icon className="h-7 w-7 text-foreground" />
                  ) : (
                    <span className="text-3xl">{details.icon}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-bold text-foreground text-lg truncate">{details.name}</h3>
                    {installCount > 0 && (
                      <span className="bg-primary/20 text-primary text-[10px] font-medium px-2 py-0.5 rounded-full border border-primary/30 shrink-0">
                        {t("server_library.installed_count", { count: installCount })}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm truncate">{details.description}</p>
                </div>
                <ChevronDown
                  className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${isSelected ? "rotate-180" : ""}`}
                />
              </button>

              {isSelected && (
                <div className="px-5 pb-5 pt-1 space-y-2 border-t border-border/60 animate-in slide-in-from-top-2 duration-200">
                  {isLoadingVersions ? (
                    <div className="space-y-2 py-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-xl" />
                      ))}
                    </div>
                  ) : (
                    versions.map((version) => {
                      const isDownloading = downloading === `${platform.key}-${version.version}`;
                      return (
                        <div
                          key={version.version}
                          className="rounded-xl border border-border bg-card/30 p-3 flex items-center justify-between gap-3 hover:border-primary/50 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-mono text-foreground truncate">
                              {version.version}
                            </span>
                            {version.release && (
                              <span className="text-xs text-muted-foreground capitalize shrink-0">
                                {version.release}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(platform, version);
                            }}
                            disabled={isDownloading}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 ${
                              isDownloading
                                ? "bg-primary/20 text-primary cursor-wait"
                                : "bg-primary/20 text-primary hover:bg-primary/30"
                            }`}
                          >
                            {isDownloading ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                {t("server_library.downloading_dots")}
                              </>
                            ) : (
                              <>
                                <ArrowDownToLine className="w-3.5 h-3.5" />
                                {t("server_library.download_btn")}
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ServerLibrary;
