import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  LogIn,
  RefreshCw,
  Server,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Square,
  Users,
  WifiOff,
} from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { parseMotd } from "../utils/motd";

const MAX_SERVERS = 6;

type SavedServer = {
  name: string;
  address: string;
  icon: string | null;
  instanceName: string;
  instanceVersion?: string;
};

type ServerStatus = {
  online: boolean;
  latency?: number;
  version?: string | null;
  players?: { online: number; max: number; sample: string[] };
  motd?: unknown;
  favicon?: string | null;
};

type SavedServersSectionProps = {
  instances: any[];
  runningInstances: Record<string, string>;
  activeDownloads: Record<string, unknown>;
  pendingLaunches: Record<string, boolean>;
  onJoin: (instanceName: string, address: string) => void;
};

function LatencyIcon({ latency }: { latency?: number }) {
  if (latency === undefined) return <Signal className="w-3.5 h-3.5" />;
  if (latency < 80) return <SignalHigh className="w-3.5 h-3.5 text-green-500" />;
  if (latency < 180) return <SignalMedium className="w-3.5 h-3.5 text-yellow-500" />;
  return <SignalLow className="w-3.5 h-3.5 text-red-500" />;
}

function Motd({ motd }: { motd: unknown }) {
  const segments = useMemo(() => parseMotd(motd), [motd]);
  if (segments.length === 0) return null;

  // Rendered on a dark strip like in game, so server colors stay readable in every theme.
  return (
    <div className="rounded-md bg-black/85 px-2.5 py-1.5 text-[11px] leading-snug text-[#AAAAAA] whitespace-pre-line line-clamp-2 break-words">
      {segments.map((segment, idx) => (
        <span
          key={idx}
          style={{
            color: segment.color,
            fontWeight: segment.bold ? 700 : undefined,
            fontStyle: segment.italic ? "italic" : undefined,
            textDecoration:
              [segment.underlined && "underline", segment.strikethrough && "line-through"]
                .filter(Boolean)
                .join(" ") || undefined,
          }}
        >
          {segment.text}
        </span>
      ))}
    </div>
  );
}

function SavedServersSection({
  instances,
  runningInstances,
  activeDownloads,
  pendingLaunches,
  onJoin,
}: SavedServersSectionProps) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Most recently played instances first, so a server saved in several instances
  // is joined with the one the player actually uses.
  const orderedInstances = useMemo(
    () =>
      [...instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)),
    [instances],
  );
  const instanceKey = orderedInstances.map((i) => i.name).join("\u0000");

  const pingAll = useCallback(async (list: SavedServer[], force = false) => {
    await Promise.all(
      list.map(async (server) => {
        try {
          const res = await window.electronAPI.pingMinecraftServer(server.address, { force });
          setStatuses((prev) => ({
            ...prev,
            [server.address]: res?.status || { online: false },
          }));
        } catch {
          setStatuses((prev) => ({ ...prev, [server.address]: { online: false } }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const seen = new Set<string>();
      const collected: SavedServer[] = [];

      for (const inst of orderedInstances) {
        if (collected.length >= MAX_SERVERS) break;
        try {
          const res = await window.electronAPI.getSavedServers(inst.name);
          for (const server of res?.servers || []) {
            const key = server.address.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push({
              ...server,
              instanceName: inst.name,
              instanceVersion: inst.version,
            });
            if (collected.length >= MAX_SERVERS) break;
          }
        } catch {
          // An unreadable servers.dat should not hide the other instances' servers.
        }
      }

      if (cancelled) return;
      setServers(collected);
      setLoaded(true);
      pingAll(collected);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [instanceKey, pingAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setStatuses({});
    await pingAll(servers, true);
    setRefreshing(false);
  };

  if (!loaded || servers.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("home.saved_servers", "Your Servers")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1 text-muted-foreground"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          {t("home.refresh_servers", "Refresh")}
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {servers.map((server) => {
          const status = statuses[server.address];
          const isPinging = status === undefined;
          const isOnline = !!status?.online;
          const icon = status?.favicon || server.icon;

          const liveStatus = runningInstances[server.instanceName];
          const isRunning = liveStatus === "running";
          const isLaunching = liveStatus === "launching";
          const isInstalling = Object.keys(activeDownloads).some(
            (k) => k.toLowerCase() === server.instanceName.toLowerCase(),
          );
          const isPending = !!pendingLaunches[server.instanceName];
          const isBusy = isInstalling || isLaunching || isPending;

          return (
            <Card
              key={`${server.instanceName}-${server.address}`}
              className="border-border transition-colors hover:bg-accent/30"
            >
              <CardContent className="p-3 flex flex-col gap-2.5 h-full">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border">
                    {icon ? (
                      <img
                        src={icon}
                        alt=""
                        className="w-full h-full object-cover [image-rendering:pixelated]"
                      />
                    ) : (
                      <Server className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{server.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{server.address}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                    {isPinging ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isOnline ? (
                      <>
                        <LatencyIcon latency={status?.latency} />
                        {status?.latency !== undefined && <span>{status.latency} ms</span>}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1">
                        <WifiOff className="w-3 h-3" />
                        {t("home.server_offline", "Offline")}
                      </Badge>
                    )}
                  </div>
                </div>

                {isPinging ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : isOnline ? (
                  <Motd motd={status?.motd} />
                ) : null}

                <div className="flex items-center justify-between gap-2 mt-auto">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                    {isOnline && status?.players && (
                      <span
                        className="flex items-center gap-1 shrink-0"
                        title={status.players.sample.length > 0 ? status.players.sample.join("\n") : undefined}
                      >
                        <Users className="w-3 h-3" />
                        {status.players.online.toLocaleString()}/{status.players.max.toLocaleString()}
                      </span>
                    )}
                    {isOnline && status?.players && <span className="text-border">·</span>}
                    <span className="truncate" title={server.instanceName}>
                      {server.instanceName}
                    </span>
                  </div>
                  <Button
                    variant={isRunning ? "destructive" : "ghost"}
                    size="sm"
                    className="h-6 text-xs gap-1 px-2 shrink-0"
                    disabled={isBusy}
                    onClick={() => {
                      if (isRunning) {
                        window.electronAPI.killGame(server.instanceName);
                        return;
                      }
                      onJoin(server.instanceName, server.address);
                    }}
                  >
                    {isRunning ? (
                      <>
                        <Square className="w-3 h-3" /> {t("common.stop")}
                      </>
                    ) : isBusy ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" /> {t("common.starting")}
                      </>
                    ) : (
                      <>
                        <LogIn className="w-3 h-3" /> {t("home.join_server", "Join")}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default SavedServersSection;
