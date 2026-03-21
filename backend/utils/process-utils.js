const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Track last CPU measurement per PID for delta-based CPU% on Windows
const cpuBaseline = new Map();

async function getProcessStats(pid) {
    try {
        if (!pid) return { cpu: 0, memory: 0 };

        if (process.platform === 'win32') {
            // Try pidusage first (may work on some Windows versions)
            try {
                const pidusage = require('pidusage');
                const pidtree = require('pidtree');
                let pids = [pid];
                try {
                    const children = await pidtree(pid, { root: true });
                    if (children && children.length > 0) pids = children;
                } catch (e) {}
                const statsObj = await pidusage(pids);
                let totalCpu = 0, totalMemory = 0;
                for (const key in statsObj) {
                    if (statsObj[key]) {
                        totalCpu += statsObj[key].cpu || 0;
                        totalMemory += statsObj[key].memory || 0;
                    }
                }
                if (totalMemory > 50 * 1024 * 1024) {
                    return {
                        cpu: Math.min(Math.round(totalCpu), 100),
                        memory: Math.round(totalMemory / (1024 * 1024))
                    };
                }
            } catch (e) {
                // pidusage failed, fall through to PowerShell
            }

            // PowerShell fallback — replaces deprecated WMIC, works on Windows 11
            try {
                const safePid = parseInt(pid);
                const { stdout } = await execAsync(
                    `powershell -NoProfile -NonInteractive -Command "$p=Get-Process -Id ${safePid} -ErrorAction SilentlyContinue; if($p){Write-Output ($p.TotalProcessorTime.TotalMilliseconds.ToString() + ',' + $p.WorkingSet64.ToString())}"`,
                    { windowsHide: true, timeout: 5000 }
                );
                if (stdout && stdout.trim()) {
                    const parts = stdout.trim().split(',');
                    const currentCpuMs = parseFloat(parts[0]) || 0;
                    const memoryBytes = parseInt(parts[1]) || 0;
                    const now = Date.now();
                    const last = cpuBaseline.get(safePid);
                    let cpuPercent = 0;
                    if (last && now > last.time) {
                        const timeDiff = now - last.time;
                        const cpuDiff = currentCpuMs - last.cpuMs;
                        const numCores = require('os').cpus().length;
                        cpuPercent = Math.min(Math.max(Math.round((cpuDiff / timeDiff) * 100 / numCores), 0), 100);
                    }
                    cpuBaseline.set(safePid, { cpuMs: currentCpuMs, time: now });
                    return {
                        cpu: cpuPercent,
                        memory: Math.round(memoryBytes / (1024 * 1024))
                    };
                }
            } catch (e) {}

            return { cpu: 0, memory: 0 };
        }

        // Non-Windows: use pidusage
        const pidusage = require('pidusage');
        const pidtree = require('pidtree');
        let pids = [pid];
        try {
            const children = await pidtree(pid, { root: true });
            if (children && children.length > 0) pids = children;
        } catch (e) {}
        const statsObj = await pidusage(pids);
        let totalCpu = 0, totalMemory = 0;
        for (const key in statsObj) {
            if (statsObj[key]) {
                totalCpu += statsObj[key].cpu || 0;
                totalMemory += statsObj[key].memory || 0;
            }
        }
        return {
            cpu: Math.min(Math.round(totalCpu), 100),
            memory: Math.round(totalMemory / (1024 * 1024)) || 0
        };
    } catch (error) {
        return { cpu: 0, memory: 0 };
    }
}

module.exports = {
    getProcessStats
};