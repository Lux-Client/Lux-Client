export type StartupModeId = 'launcher' | 'server' | 'client' | 'tools';

export type StartupPageDefinition = {
    mode: StartupModeId;
    view: string;
    value: string;
    labelKey: string;
    labelFallback: string;
    featureFlag?: 'openClientPage';
    requiresSkinsAccess?: boolean;
};

export type StartupModeDefinition = {
    id: StartupModeId;
    titleKey: string;
    titleFallback: string;
    descriptionKey: string;
    descriptionFallback: string;
    featureFlag?: 'openClientPage';
    pages: StartupPageDefinition[];
};

export type StartupPageOptions = {
    openClientEnabled?: boolean;
    canAccessSkins?: boolean;
};

type StartupDestination = {
    mode: StartupModeId;
    view: string;
};

const STARTUP_MODE_DEFINITIONS: StartupModeDefinition[] = [
    {
        id: 'launcher',
        titleKey: 'common.launcher',
        titleFallback: 'Launcher',
        descriptionKey: 'setup.startupLauncherDesc',
        descriptionFallback: 'Open the Launcher section directly.',
        pages: [
            { mode: 'launcher', view: 'dashboard', value: 'launcher:dashboard', labelKey: 'common.dashboard', labelFallback: 'Dashboard' },
            { mode: 'launcher', view: 'library', value: 'launcher:library', labelKey: 'common.library', labelFallback: 'Library' },
            { mode: 'launcher', view: 'search', value: 'launcher:search', labelKey: 'common.search', labelFallback: 'Browse Content' },
            { mode: 'launcher', view: 'skins', value: 'launcher:skins', labelKey: 'common.skins', labelFallback: 'Skins', requiresSkinsAccess: true },
            { mode: 'launcher', view: 'extensions', value: 'launcher:extensions', labelKey: 'common.extensions', labelFallback: 'Extensions' },
            { mode: 'launcher', view: 'styling', value: 'launcher:styling', labelKey: 'common.styling', labelFallback: 'Styling' },
            { mode: 'launcher', view: 'settings', value: 'launcher:settings', labelKey: 'common.settings', labelFallback: 'Settings' }
        ]
    },
    {
        id: 'client',
        titleKey: 'common.client',
        titleFallback: 'Client',
        descriptionKey: 'setup.startupClientDesc',
        descriptionFallback: 'Open the Client section directly.',
        featureFlag: 'openClientPage',
        pages: [
            { mode: 'client', view: 'open-client', value: 'client:open-client', labelKey: 'common.client', labelFallback: 'Client', featureFlag: 'openClientPage' },
            { mode: 'client', view: 'skins', value: 'client:skins', labelKey: 'common.skins', labelFallback: 'Skins', featureFlag: 'openClientPage', requiresSkinsAccess: true },
            { mode: 'client', view: 'extensions', value: 'client:extensions', labelKey: 'common.extensions', labelFallback: 'Extensions', featureFlag: 'openClientPage' },
            { mode: 'client', view: 'styling', value: 'client:styling', labelKey: 'common.styling', labelFallback: 'Styling', featureFlag: 'openClientPage' },
            { mode: 'client', view: 'mods', value: 'client:mods', labelKey: 'instance_details.content.mods', labelFallback: 'Mods', featureFlag: 'openClientPage' },
            { mode: 'client', view: 'settings', value: 'client:settings', labelKey: 'common.settings', labelFallback: 'Settings', featureFlag: 'openClientPage' }
        ]
    },
    {
        id: 'server',
        titleKey: 'common.server',
        titleFallback: 'Server',
        descriptionKey: 'setup.startupServerDesc',
        descriptionFallback: 'Open the Server section directly.',
        pages: [
            { mode: 'server', view: 'server-dashboard', value: 'server:server-dashboard', labelKey: 'common.dashboard', labelFallback: 'Dashboard' },
            { mode: 'server', view: 'search', value: 'server:search', labelKey: 'common.search', labelFallback: 'Browse Content' },
            { mode: 'server', view: 'server-library', value: 'server:server-library', labelKey: 'common.library', labelFallback: 'Library' },
            { mode: 'server', view: 'styling', value: 'server:styling', labelKey: 'common.styling', labelFallback: 'Styling' },
            { mode: 'server', view: 'server-settings', value: 'server:server-settings', labelKey: 'common.settings', labelFallback: 'Settings' }
        ]
    },
    {
        id: 'tools',
        titleKey: 'common.useful_tools',
        titleFallback: 'Useful Tools',
        descriptionKey: 'setup.startupToolsDesc',
        descriptionFallback: 'Open Useful Tools when Lux starts.',
        pages: [
            { mode: 'tools', view: 'tools-dashboard', value: 'tools:tools-dashboard', labelKey: 'common.dashboard', labelFallback: 'Dashboard' },
            { mode: 'tools', view: 'settings', value: 'tools:settings', labelKey: 'common.settings', labelFallback: 'Settings' }
        ]
    }
];

const LEGACY_STARTUP_PAGE_TO_VALUE: Record<string, string> = {
    dashboard: 'launcher:dashboard',
    library: 'launcher:library',
    search: 'launcher:search',
    skins: 'launcher:skins',
    extensions: 'launcher:extensions',
    styling: 'launcher:styling',
    settings: 'launcher:settings',
    'open-client': 'client:open-client',
    mods: 'client:mods',
    'server-dashboard': 'server:server-dashboard',
    'server-library': 'server:server-library',
    'server-settings': 'server:server-settings',
    'tools-dashboard': 'tools:tools-dashboard'
};

function isFeatureVisible(featureFlag: StartupPageDefinition['featureFlag'] | StartupModeDefinition['featureFlag'], options: StartupPageOptions) {
    if (!featureFlag) {
        return true;
    }

    if (featureFlag === 'openClientPage') {
        return options.openClientEnabled === true;
    }

    return true;
}

function isPageVisible(page: StartupPageDefinition, options: StartupPageOptions) {
    if (!isFeatureVisible(page.featureFlag, options)) {
        return false;
    }

    if (page.requiresSkinsAccess && options.canAccessSkins === false) {
        return false;
    }

    return true;
}

export function getStartupModes(options: StartupPageOptions = {}) {
    return STARTUP_MODE_DEFINITIONS
        .filter((mode) => isFeatureVisible(mode.featureFlag, options))
        .map((mode) => ({
            ...mode,
            pages: mode.pages.filter((page) => isPageVisible(page, options))
        }))
        .filter((mode) => mode.pages.length > 0);
}

export function getStartupPages(options: StartupPageOptions = {}) {
    return getStartupModes(options).flatMap((mode) => mode.pages.map((page) => ({
        ...page,
        modeTitleKey: mode.titleKey,
        modeTitleFallback: mode.titleFallback
    })));
}

export function getDefaultStartupValueForMode(mode: StartupModeId, options: StartupPageOptions = {}) {
    const startupMode = getStartupModes(options).find((item) => item.id === mode);
    return startupMode?.pages[0]?.value ?? 'launcher:dashboard';
}

export function normalizeStartupPageValue(startPageSetting: unknown, options: StartupPageOptions = {}) {
    if (typeof startPageSetting !== 'string' || startPageSetting.length === 0) {
        return getDefaultStartupValueForMode('launcher', options);
    }

    const normalizedValue = LEGACY_STARTUP_PAGE_TO_VALUE[startPageSetting] ?? startPageSetting;
    const validValues = new Set(getStartupPages(options).map((page) => page.value));

    if (validValues.has(normalizedValue)) {
        return normalizedValue;
    }

    return getDefaultStartupValueForMode('launcher', options);
}

export function getValidStartupPageValues(options: StartupPageOptions = {}) {
    return getStartupPages(options).map((page) => page.value);
}

export function resolveStartupDestination(startPageSetting: unknown, options: StartupPageOptions = {}): StartupDestination {
    const normalizedValue = normalizeStartupPageValue(startPageSetting, options);
    const [mode, view] = normalizedValue.split(':');

    if (mode === 'launcher' || mode === 'server' || mode === 'client' || mode === 'tools') {
        return { mode, view };
    }

    return { mode: 'launcher', view: 'dashboard' };
}

export function resolveModeView(mode: StartupModeId, requestedView: string, options: StartupPageOptions = {}) {
    const startupMode = getStartupModes(options).find((item) => item.id === mode);

    if (!startupMode) {
        return requestedView || 'dashboard';
    }

    const allowedViews = new Set(startupMode.pages.map((page) => page.view));
    return allowedViews.has(requestedView) ? requestedView : startupMode.pages[0].view;
}