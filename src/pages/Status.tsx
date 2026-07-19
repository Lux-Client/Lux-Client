import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'checking';

interface Service {
    id: string;
    name: string;
    description: string;
    url: string;
    status: ServiceStatus;
    latency?: number;
    statusCode?: number | null;
}

const PLACEHOLDER_SERVICES: Service[] = [
    { id: 'session', name: 'Minecraft Session', description: 'Game session authentication', url: '', status: 'checking' },
    { id: 'luxserver', name: 'Lux Server', description: 'Lux Extensions/Themes/Instance Codes', url: '', status: 'checking' },
    { id: 'api', name: 'Mojang API', description: 'Profile and player data', url: '', status: 'checking' },
    { id: 'textures', name: 'Texture Server', description: 'Minecraft skins and capes', url: '', status: 'checking' },
    { id: 'services', name: 'Minecraft Services', description: 'Xbox Live / Microsoft auth', url: '', status: 'checking' },
    { id: 'sessionserver', name: 'Session Server', description: 'Multiplayer join verification', url: '', status: 'checking' },
    { id: 'launchermeta', name: 'Launcher Meta', description: 'Version manifests and metadata', url: '', status: 'checking' },
    { id: 'libraries', name: 'Libraries', description: 'Game library downloads', url: '', status: 'checking' },
];

function StatusDot({ status }: { status: ServiceStatus }) {
    if (status === 'checking') {
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted-foreground/30 animate-pulse" />;
    }
    if (status === 'operational') {
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.4)]" />;
    }
    if (status === 'degraded') {
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_2px_rgba(245,158,11,0.4)]" />;
    }
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_2px_rgba(239,68,68,0.4)]" />;
}

function StatusBadge({ status }: { status: ServiceStatus }) {
    // These states reflect network reachability only — a reachable server can still have a
    // broken auth/login backend, which this check cannot see. Labels say so honestly.
    if (status === 'checking') return <span className="text-xs text-muted-foreground">Checking…</span>;
    if (status === 'operational') return <span className="text-xs font-medium text-emerald-500">Reachable</span>;
    if (status === 'degraded') return <span className="text-xs font-medium text-amber-500">Server errors</span>;
    return <span className="text-xs font-medium text-red-500">Unreachable</span>;
}

function ServiceCard({ service }: { service: Service }) {
    return (
        <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <StatusDot status={service.status} />
                    <span className="font-semibold text-sm text-foreground truncate">{service.name}</span>
                </div>
                {service.latency !== undefined && service.status !== 'checking' && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3" />
                        <span>{service.latency}ms</span>
                    </div>
                )}
            </div>
            <p className="text-xs text-muted-foreground pl-5">{service.description}</p>
            <div className="pl-5">
                <StatusBadge status={service.status} />
            </div>
        </div>
    );
}

function Status() {
    const [services, setServices] = useState<Service[]>(PLACEHOLDER_SERVICES);
    const [isChecking, setIsChecking] = useState(false);
    const [checkedAt, setCheckedAt] = useState<number | null>(null);
    const checkingRef = React.useRef(false);

    const checkStatus = useCallback(async () => {
        if (checkingRef.current) return;
        checkingRef.current = true;
        setIsChecking(true);
        setServices(prev => prev.map(s => ({ ...s, status: 'checking' as ServiceStatus })));

        try {
            const result = await window.electronAPI.checkServiceStatus();
            if (result.success) {
                setServices(result.services);
                setCheckedAt(result.checkedAt);
            }
        } catch (e) {
            console.error('[Status] Failed to check services:', e);
        } finally {
            checkingRef.current = false;
            setIsChecking(false);
        }
    }, []);

    useEffect(() => {
        checkStatus();
        const interval = setInterval(checkStatus, 60000);
        return () => clearInterval(interval);
    }, [checkStatus]);

    const operational = services.filter(s => s.status === 'operational').length;
    const allOk = services.length > 0 && operational === services.length && !isChecking;
    const hasDown = services.some(s => s.status === 'down');
    const hasDegraded = services.some(s => s.status === 'degraded');

    const overallLabel = isChecking
        ? 'Checking…'
        : allOk
        ? 'All Systems Reachable'
        : hasDown
        ? 'Servers Unreachable'
        : hasDegraded
        ? 'Server Errors'
        : 'Checking…';

    const overallColor = allOk
        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
        : hasDown
        ? 'bg-red-500/10 text-red-500 border-red-500/20'
        : hasDegraded
        ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
        : 'bg-muted text-muted-foreground border-border';

    const OverallIcon = allOk ? CheckCircle2 : hasDown ? XCircle : AlertTriangle;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-6">
            <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground tracking-tight">Service Status</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Minecraft and Mojang server reachability
                    </p>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${overallColor}`}>
                        <OverallIcon className="h-4 w-4" />
                        {overallLabel}
                    </div>
                    <button
                        onClick={checkStatus}
                        disabled={isChecking}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {checkedAt && (
                <p className="text-xs text-muted-foreground mb-4">
                    Last checked: {new Date(checkedAt).toLocaleTimeString()}
                    {' · '}
                    {operational}/{services.length} services reachable
                </p>
            )}

            <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                    This only checks whether each server responds. A reachable server can still have a
                    broken login or auth backend, so “Reachable” does not guarantee that sign-in works.
                </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {services.map(service => (
                    <ServiceCard key={service.id} service={service} />
                ))}
            </div>
        </div>
    );
}

export default Status;
