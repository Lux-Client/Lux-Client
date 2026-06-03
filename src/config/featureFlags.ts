const isElectronDevMode = Boolean(window?.electronAPI?.isDeveloperMode);

export const isDeveloperMode = isElectronDevMode || import.meta.env.DEV;

export const featureFlags = Object.freeze({
    settingsDevelopmentTesting: isDeveloperMode,
    openClientPage: true
});

export function isFeatureEnabled(flagName) {
    return Boolean(featureFlags[flagName]);
}