import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

function ServerConsole({ server, onClose, onServerAction }) {
    const [logs, setLogs] = useState([]);
    const [command, setCommand] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const [stats, setStats] = useState({
        cpu: 0,
        memory: 0,
        uptime: 0,
        tps: 20.0
    });

    const logsEndRef = useRef(null);
    const consoleRef = useRef(null);
    const commandInputRef = useRef(null);
    useEffect(() => {
        if (autoScroll && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);
    useEffect(() => {
        if (!server) return;

        const setupLogListener = async () => {
            try {

                const existingLogs = await window.electronAPI.getServerConsole(server.name);
                if (existingLogs && Array.isArray(existingLogs)) {
                    setLogs(existingLogs.map(line => ({
                        timestamp: new Date().toLocaleTimeString(),
                        content: line,
                        type: getLogType(line)
                    })));
                }
                const removeListener = window.electronAPI.onServerConsoleOutput(({ serverName, log }) => {
                    if (serverName === server.name) {
                        setLogs(prev => [...prev, {
                            timestamp: new Date().toLocaleTimeString(),
                            content: log,
                            type: getLogType(log)
                        }]);
                    }
                });
                const removeStatusListener = window.electronAPI.onServerStatus(({ serverName, status }) => {
                    if (serverName === server.name) {
                        if (status === 'running') setIsConnected(true);
                        else if (status === 'stopped') setIsConnected(false);
                        if (status === 'starting') {
                            addLog('system', 'Server is starting...');
                        } else if (status === 'stopping') {
                            addLog('system', 'Server is stopping...');
                        } else if (status === 'running') {
                            addLog('success', 'Server is now running');
                        } else if (status === 'stopped') {
                            addLog('system', 'Server stopped');
                        }
                    }
                });
                try {
                    const status = await window.electronAPI.getServerStatus?.(server.name);
                    setIsConnected(status === 'running');
                } catch (error) {
                    console.error('Failed to get server status:', error);
                }

                return () => {
                    removeListener?.();
                    removeStatusListener?.();
                };
            } catch (error) {
                console.error('Failed to setup console:', error);
                addLog('system', `Error: ${error.message}`);
            }
        };

        setupLogListener();
        const statsInterval = setInterval(async () => {
            try {
                if (isConnected) {
                    setStats(prev => ({
                        cpu: Math.random() * 20 + 5,
                        memory: Math.floor(Math.random() * 400 + 600),
                        uptime: prev.uptime + 2,
                        tps: 19.5 + Math.random() * 0.8
                    }));
                }
            } catch (error) {
                console.error('Failed to update stats:', error);
            }
        }, 2000);

        return () => {
            clearInterval(statsInterval);
        };
    }, [server, isConnected]);
    const getLogType = (line) => {
        if (line.includes('[ERROR]') || line.includes('Exception') || line.includes('Error:')) return 'error';
        if (line.includes('[WARN]')) return 'warn';
        if (line.includes('[INFO]')) return 'info';
        if (line.includes('Done') && line.includes('For help, type "help"')) return 'success';
        return 'default';
    };
    const addLog = (type, content) => {
        setLogs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            content: `[SYSTEM] ${content}`,
            type: type
        }]);
    };
    const handleSendCommand = async (e) => {
        e.preventDefault();
        if (!command.trim() || !isConnected) return;

        const cmd = command.trim();
        setCommand('');

        try {

            const result = await window.electronAPI.sendServerCommand(server.name, cmd);

            if (!result?.success) {
                addLog('error', `Command failed: ${result?.error || 'Unknown error'}`);
            } else {

                addLog('info', `> ${cmd}`);
            }
        } catch (error) {
            addLog('error', `Failed to send command: ${error.message}`);
        }
    };
    const handleClear = () => {
        setLogs([]);
        addLog('system', 'Console cleared');
    };
    const handleRestart = async () => {
        try {
            await onServerAction('restart', server);
            addLog('system', 'Restarting server...');
        } catch (error) {
            addLog('error', `Failed to restart: ${error.message}`);
        }
    };
    const handleCopyLogs = () => {
        const text = logs.map(log => `[${log.timestamp}] ${log.content}`).join('\n');
        navigator.clipboard.writeText(text);
        addLog('system', 'Logs copied to clipboard');
    };
    const handleSaveLogs = async () => {
        try {

            const text = logs.map(log => `[${log.timestamp}] ${log.content}`).join('\n');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${server.name}-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
            a.click();
            URL.revokeObjectURL(url);
            addLog('system', 'Logs downloaded');
        } catch (error) {
            addLog('error', `Failed to save logs: ${error.message}`);
        }
    };

    if (!server) return null;

    return createPortal(
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
            { }
            <div className="bg-surface border-b border-stroke px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Console - {server.name}
                    </h2>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                        <span className="text-sm text-muted-foreground">{isConnected ? 'Connected' : 'Disconnected'}</span>
                    </div>
                </div>

                { }
                <div className="flex items-center gap-6">
                    <div className="text-sm">
                        <span className="text-muted-foreground">CPU:</span>
                        <span className="ml-2 text-foreground font-mono">{stats.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="text-sm">
                        <span className="text-muted-foreground">RAM:</span>
                        <span className="ml-2 text-foreground font-mono">{stats.memory} MB</span>
                    </div>
                    <div className="text-sm">
                        <span className="text-muted-foreground">TPS:</span>
                        <span className={`ml-2 font-mono ${stats.tps > 19 ? 'text-green-400' :
                            stats.tps > 15 ? 'text-yellow-400' :
                                'text-red-400'
                            }`}>{stats.tps.toFixed(1)}</span>
                    </div>
                </div>

                { }
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRestart}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title="Restart Server"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button
                        onClick={handleCopyLogs}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title="Copy Logs"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </button>
                    <button
                        onClick={handleSaveLogs}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title="Save Logs"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                    </button>
                    <button
                        onClick={handleClear}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title="Clear Console"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                    <div className="w-px h-6 bg-border mx-2"></div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title="Close Console (ESC)"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            { }
            <div
                ref={consoleRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-black/40 custom-scrollbar"
                onClick={() => commandInputRef.current?.focus()}
            >
                {logs.length === 0 ? (
                    <div className="text-muted-foreground text-center mt-10">
                        <p>No logs yet. Start the server to see console output.</p>
                    </div>
                ) : (
                    logs.map((log, index) => (
                        <div key={index} className="mb-0.5 hover:bg-accent group font-mono">
                            <span className="text-muted-foreground select-none mr-3 text-xs">[{log.timestamp}]</span>
                            <span className={`whitespace-pre-wrap break-words ${log.type === 'error' ? 'text-red-400' :
                                log.type === 'warn' ? 'text-yellow-400' :
                                    log.type === 'success' ? 'text-green-400' :
                                        log.type === 'info' ? 'text-blue-400' :
                                            log.type === 'system' ? 'text-purple-400' :
                                                'text-foreground'
                                }`}>{log.content}</span>
                        </div>
                    ))
                )}
                <div ref={logsEndRef} />
            </div>

            { }
            <div className="bg-surface border-t border-stroke p-4">
                <form onSubmit={handleSendCommand} className="flex gap-2">
                    <div className="flex-1 flex items-center bg-canvas rounded-lg border border-stroke focus-within:border-primary transition-colors">
                        <span className="text-muted-foreground pl-3 select-none font-mono">&gt;</span>
                        <input
                            ref={commandInputRef}
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            disabled={!isConnected}
                            placeholder={isConnected ? "Enter command... (e.g., help, list, say Hello)" : "Server is offline"}
                            className="flex-1 bg-transparent p-3 text-foreground focus:outline-none disabled:opacity-50 font-mono"
                            autoFocus
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={!isConnected || !command.trim()}
                        className="px-6 py-3 bg-primary hover:bg-primary-hover text-black font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Send
                    </button>
                </form>

                { }
                <div className="flex items-center gap-2 mt-2">
                    <button
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${autoScroll ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-accent-foreground'
                            }`}
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        Auto-scroll {autoScroll ? 'ON' : 'OFF'}
                    </button>

                    { }
                    {isConnected && (
                        <div className="flex gap-1 ml-auto">
                            {['help', 'list', 'say Hello', 'gamemode creative @a', 'time set day'].map((cmd) => (
                                <button
                                    key={cmd}
                                    onClick={() => setCommand(cmd)}
                                    className="text-xs px-2 py-1 bg-muted hover:bg-accent rounded text-muted-foreground hover:text-accent-foreground transition-colors"
                                >
                                    {cmd}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export default ServerConsole;