import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeLog, getExitCodeDescription } from '../utils/logAnalyzer';

const CrashModal = ({ isOpen, onClose, crashData, onFixApplied }) => {
    const { t } = useTranslation();
    const [issues, setIssues] = useState([]);
    const [isApplyingFix, setIsApplyingFix] = useState(false);
    const [fixStatus, setFixStatus] = useState(null);

    useEffect(() => {
        if (!isOpen || !crashData) return;

        let cancelled = false;

        const resolveCrashLogContent = async () => {
            const directLog = typeof crashData?.logContent === 'string' ? crashData.logContent : '';
            if (directLog.trim()) return directLog;

            const inlineFallback = typeof crashData?.logFile === 'string' ? crashData.logFile : '';
            if (inlineFallback.trim()) return inlineFallback;

            const instanceName = String(crashData?.instanceName || '').trim();
            if (!instanceName) return '';

            try {
                const logResponse = await window.electronAPI.getLog(instanceName, 'latest.log');
                if (logResponse?.success && typeof logResponse.content === 'string') {
                    return logResponse.content;
                }
            } catch (_) {
            }

            try {
                const liveLog = await window.electronAPI.getLiveLogs(instanceName);
                if (Array.isArray(liveLog) && liveLog.length > 0) {
                    return liveLog.join('\n');
                }
            } catch (_) {
            }

            return '';
        };

        const runAnalysis = async () => {
            const logContent = await resolveCrashLogContent();
            if (cancelled) return;

            const identifiedIssues = analyzeLog(logContent, {
                compatibilityIssues: Array.isArray(crashData?.compatibilityIssues)
                    ? crashData.compatibilityIssues
                    : []
            });
            setIssues(identifiedIssues);
        };

        runAnalysis();

        return () => {
            cancelled = true;
        };
    }, [isOpen, crashData]);

    if (!isOpen || !crashData) return null;

    const hasCompatibilityIssues = issues.some((issue) => issue.fixAction === 'install_compatible_mod');

    const normalizeToken = (value) => String(value || '').trim().toLowerCase();

    const scoreProjectMatch = (project, targetName) => {
        const normalizedTarget = normalizeToken(targetName).replace(/[^a-z0-9]+/g, '');
        if (!normalizedTarget) return 0;

        const title = normalizeToken(project?.title || '').replace(/[^a-z0-9]+/g, '');
        const slug = normalizeToken(project?.slug || '').replace(/[^a-z0-9]+/g, '');
        const projectId = normalizeToken(project?.project_id || '').replace(/[^a-z0-9]+/g, '');

        if (title === normalizedTarget || slug === normalizedTarget || projectId === normalizedTarget) {
            return 100;
        }

        let score = 0;
        if (title.includes(normalizedTarget)) score += 45;
        if (slug.includes(normalizedTarget)) score += 35;
        if (projectId.includes(normalizedTarget)) score += 25;

        const downloads = Number(project?.downloads || 0);
        if (Number.isFinite(downloads)) {
            score += Math.min(20, Math.floor(Math.log10(downloads + 1) * 4));
        }

        return score;
    };

    const autoInstallCompatibleMod = async (issue) => {
        const compatibility = issue?.compatibility || {};
        const requestedModName = compatibility.targetMod || compatibility.dependencyName || compatibility.modName;
        const instanceName = String(crashData?.instanceName || '').trim();

        if (!instanceName) {
            return { success: false, error: 'Missing instance name in crash context.' };
        }

        if (!requestedModName) {
            return { success: false, error: 'No mod name found in crash analysis.' };
        }

        const instances = await window.electronAPI.getInstances();
        const instance = Array.isArray(instances)
            ? instances.find((entry) => normalizeToken(entry?.name) === normalizeToken(instanceName))
            : null;

        if (!instance) {
            return { success: false, error: `Instance "${instanceName}" was not found.` };
        }

        const loader = normalizeToken(instance.loader || 'fabric') || 'fabric';
        const gameVersion = String(instance.version || '').trim();

        const facets = [];
        if (loader && loader !== 'vanilla') {
            facets.push([`categories:${loader}`]);
        }
        if (gameVersion) {
            facets.push([`versions:${gameVersion}`]);
        }

        const searchRes = await window.electronAPI.searchModrinth(
            requestedModName,
            facets,
            {
                limit: 10,
                index: 'downloads',
                projectType: 'mod',
                includeCurseforge: true
            }
        );

        if (!searchRes?.success || !Array.isArray(searchRes.results) || searchRes.results.length === 0) {
            return { success: false, error: `No matching mod found for "${requestedModName}".` };
        }

        const sortedCandidates = [...searchRes.results].sort(
            (a, b) => scoreProjectMatch(b, requestedModName) - scoreProjectMatch(a, requestedModName)
        );
        const selectedProject = sortedCandidates[0];
        if (!selectedProject?.project_id) {
            return { success: false, error: 'No valid project ID returned by search.' };
        }

        const versionsRes = await window.electronAPI.getModVersions(
            selectedProject.project_id,
            loader && loader !== 'vanilla' ? [loader] : [],
            gameVersion ? [gameVersion] : [],
            selectedProject.curseforge_project_id || null
        );

        if (!versionsRes?.success || !Array.isArray(versionsRes.versions) || versionsRes.versions.length === 0) {
            return {
                success: false,
                error: `No compatible version found for "${selectedProject.title || requestedModName}" (${loader} ${gameVersion}).`
            };
        }

        const selectedVersion = versionsRes.versions[0];
        const file = selectedVersion.files?.find((entry) => entry.primary) || selectedVersion.files?.[0];
        if (!file?.url || !file?.filename) {
            return { success: false, error: 'Compatible version was found but no downloadable file is available.' };
        }

        const installRes = await window.electronAPI.installMod({
            instanceName,
            projectId: selectedVersion.project_id || selectedProject.project_id,
            versionId: selectedVersion.id,
            filename: file.filename,
            url: file.url,
            projectType: 'mod',
            fallbackCurseForgeProjectId: selectedProject.curseforge_project_id || null
        });

        if (!installRes?.success) {
            return { success: false, error: installRes?.error || 'Install failed.' };
        }

        return {
            success: true,
            projectTitle: selectedProject.title || requestedModName,
            fileName: file.filename
        };
    };

    const handleApplyFix = async (issue) => {
        setIsApplyingFix(true);
        setFixStatus({ type: 'info', message: `Applying fix: ${issue.fixText}...` });

        try {
            let res;
            switch (issue.fixAction) {
                case 'increase_memory':
                    res = await window.electronAPI.updateInstanceConfig(crashData.instanceName, { maxMemory: 4096 });
                    break;
                case 'fix_java_version':
                    res = await window.electronAPI.reinstallInstance(crashData.instanceName, 'java');
                    break;
                case 'reinstall_instance':
                    res = await window.electronAPI.reinstallInstance(crashData.instanceName, 'full');
                    break;
                case 'install_compatible_mod':
                    res = await autoInstallCompatibleMod(issue);
                    break;
                default:
                    setFixStatus({ type: 'error', message: 'Unknown fix action.' });
                    setIsApplyingFix(false);
                    return;
            }

            if (res.success) {
                setFixStatus({ type: 'success', message: 'Fix applied successfully! Try launching again.' });
                if (onFixApplied) onFixApplied();
            } else {
                setFixStatus({ type: 'error', message: `Failed to apply fix: ${res.error}` });
            }
        } catch (err) {
            setFixStatus({ type: 'error', message: `Error applying fix: ${err.message}` });
        } finally {
            setIsApplyingFix(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-card w-full max-w-2xl rounded-xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">

                <div className="p-8 border-b border-border bg-gradient-to-r from-red-500/10 to-transparent">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center text-red-500">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-foreground">
                                {hasCompatibilityIssues
                                    ? t('crash.incompatible_mods_found', 'Incompatible mods found')
                                    : t('crash.title')}
                            </h2>
                            <p className="text-muted-foreground text-sm">{crashData.instanceName} • {getExitCodeDescription(crashData.exitCode)}</p>
                        </div>
                    </div>
                </div>

                <div className="p-8 max-h-[60vh] overflow-y-auto">
                    {issues.length > 0 ? (
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('crash.analysis')}</h3>
                            {issues.map((issue) => (
                                <div key={issue.id} className="bg-muted rounded-xl p-6 border border-border hover:border-primary/30 transition-colors group">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="space-y-2">
                                            <h4 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">{issue.title}</h4>
                                            <p className="text-muted-foreground text-sm leading-relaxed">{issue.description}</p>
                                            {issue?.compatibility?.targetMod && (
                                                <p className="text-xs text-muted-foreground">
                                                    Target mod: <span className="font-semibold text-foreground">{issue.compatibility.targetMod}</span>
                                                    {issue?.compatibility?.requiredVersion ? (
                                                        <span> • required: {issue.compatibility.requiredVersion}</span>
                                                    ) : null}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleApplyFix(issue)}
                                            disabled={isApplyingFix}
                                            className="px-6 py-2.5 bg-primary text-black rounded-xl font-bold text-sm transition-all disabled:opacity-50 whitespace-nowrap shadow-md"
                                        >
                                            {isApplyingFix ? t('common.applying', 'Applying...') : issue.fixText}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-muted-foreground mb-6">
                                {hasCompatibilityIssues
                                    ? t('crash.mod_issues_detected', 'Incompatible mods were detected. Use Auto Fix to install compatible versions.')
                                    : t('crash.no_issues')}
                            </p>
                            {crashData.logUrl ? (
                                <a
                                    href={crashData.logUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block px-6 py-3 bg-muted hover:bg-accent rounded-xl text-foreground font-bold transition-colors"
                                >
                                    {t('crash.view_log')}
                                </a>
                            ) : (
                                <p className="text-xs text-muted-foreground italic">{t('crash.check_manually')}</p>
                            )}
                        </div>
                    )}

                    {fixStatus && (
                        <div className={`mt-6 p-4 rounded-xl text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${fixStatus.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                            fixStatus.type === 'error' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                'bg-primary/10 text-primary border border-primary/20'
                            }`}>
                            {fixStatus.message}
                        </div>
                    )}
                </div>

                <div className="p-8 border-t border-border flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 px-6 py-3 bg-muted hover:bg-accent rounded-xl text-foreground font-bold transition-colors"
                    >
                        {t('common.close', 'Close')}
                    </button>
                    <button
                        onClick={() => window.electronAPI.openInstanceFolder(crashData.instanceName)}
                        className="px-6 py-3 border border-border hover:border-border rounded-xl text-muted-foreground font-bold transition-all"
                    >
                        {t('instance.open_folder', 'Open Folder')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CrashModal;
