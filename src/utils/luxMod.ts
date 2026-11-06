import { useEffect, useState } from 'react';

// The Lux Client mod is published as release jars on Lux-Client/Lux-Mod.
// The backend reads those releases; this list is only used until it answers
// or when GitHub cannot be reached.
export const LUX_MOD_FALLBACK_VERSIONS = ['1.21.11', '1.21.8', '26.2', '1.20.1'];
export const LUX_MOD_LOADERS = ['fabric'];
export const FABRIC_API_PROJECT_ID = 'P7dR8mSH';

const LUX_MOD_FILE_PATTERN = /^lux-?client-.*\.jar(\.disabled)?$/i;

export const isLuxModFileName = (fileName: unknown) => LUX_MOD_FILE_PATTERN.test(String(fileName || ''));

type LuxModInfo = { versions: string[]; released: boolean };

let infoPromise: Promise<LuxModInfo> | null = null;

// released is true once real jars exist on GitHub; before that (or offline) the
// fallback list is used and nothing is forced on anyone.
export const loadLuxModInfo = (force = false): Promise<LuxModInfo> => {
    if (!force && infoPromise) return infoPromise;

    infoPromise = (async () => {
        try {
            const res = await window.electronAPI.getLuxModInfo?.({ force });
            if (res?.success && Array.isArray(res.versions) && res.versions.length > 0) {
                return {
                    versions: res.versions.map((version: unknown) => String(version)),
                    released: res.source === 'github'
                };
            }
        } catch (error) {
            console.warn('[LuxMod] Could not load supported versions:', error);
        }
        return { versions: [...LUX_MOD_FALLBACK_VERSIONS], released: false };
    })();

    return infoPromise;
};

export const loadLuxModVersions = async (force = false): Promise<string[]> => (await loadLuxModInfo(force)).versions;

export const isLuxModSupported = (versions: string[], mcVersion: unknown, loader: unknown) => {
    const normalizedLoader = String(loader || '').trim().toLowerCase();
    return LUX_MOD_LOADERS.includes(normalizedLoader) && versions.includes(String(mcVersion || '').trim());
};

export const useLuxModVersions = () => {
    const [versions, setVersions] = useState<string[]>(LUX_MOD_FALLBACK_VERSIONS);

    useEffect(() => {
        let cancelled = false;
        loadLuxModVersions().then((next) => {
            if (!cancelled) setVersions(next);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return versions;
};

// Fabric mods almost always need Fabric API; make sure it is there so the
// Lux Client mod does not crash on start.
const ensureFabricApi = async (instanceName: string, mcVersion: string) => {
    try {
        const modsRes = await window.electronAPI.getMods(instanceName);
        const mods = Array.isArray(modsRes?.mods) ? modsRes.mods : [];
        const hasFabricApi = mods.some((mod: any) => mod?.projectId === FABRIC_API_PROJECT_ID
            || /^fabric-api[-_]/i.test(String(mod?.name || '')));
        if (hasFabricApi) return;

        const versionsRes = await window.electronAPI.getModVersions(FABRIC_API_PROJECT_ID, ['fabric'], [mcVersion]);
        const target = versionsRes?.success && Array.isArray(versionsRes.versions) ? versionsRes.versions[0] : null;
        const file = target?.files?.find((entry: any) => entry.primary) || target?.files?.[0];
        if (!file) return;

        await window.electronAPI.installMod({
            instanceName,
            projectId: FABRIC_API_PROJECT_ID,
            versionId: target.id,
            filename: file.filename,
            url: file.url,
            projectType: 'mod'
        });
    } catch (error) {
        console.warn('[LuxMod] Could not install Fabric API:', error);
    }
};

// lock: the instance was made "With Lux Client", so the mod stays for good.
export const installLuxClientMod = async (instanceName: string, mcVersion: string, options: { lock?: boolean } = {}) => {
    const res = await window.electronAPI.installLuxMod(instanceName, options);
    if (res?.success) {
        await ensureFabricApi(instanceName, mcVersion);
    }
    return res || { success: false, error: 'unknown error' };
};
