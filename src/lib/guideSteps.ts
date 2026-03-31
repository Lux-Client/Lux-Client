export type GuideMode = 'launcher' | 'server' | 'client' | 'tools';

export type GuideStep = {
    keyBase: string;
    selector?: string;
    mode?: GuideMode;
    view?: string;
    requiresSkinsAccess?: boolean;
};

const GUIDE_STEP_MAP: Record<GuideMode, GuideStep[]> = {
    launcher: [
        { keyBase: 'launcher_step1' },
        { keyBase: 'launcher_step2', selector: '[data-guide-id="mode-switcher"]' },
        { keyBase: 'launcher_step3', view: 'dashboard', selector: '[data-guide-id="sidebar-nav-dashboard"]' },
        { keyBase: 'launcher_step4', view: 'library', selector: '[data-guide-id="sidebar-nav-library"]' },
        { keyBase: 'launcher_step5', view: 'search', selector: '[data-guide-id="sidebar-nav-search"]' },
        { keyBase: 'launcher_step6', view: 'skins', selector: '[data-guide-id="sidebar-nav-skins"]', requiresSkinsAccess: true },
        { keyBase: 'launcher_step7', view: 'extensions', selector: '[data-guide-id="sidebar-nav-extensions"]' },
        { keyBase: 'launcher_step8', view: 'styling', selector: '[data-guide-id="sidebar-nav-styling"]' },
        { keyBase: 'launcher_step9', view: 'settings', selector: '[data-guide-id="sidebar-nav-settings"]' }
    ],
    server: [
        { keyBase: 'server_step1' },
        { keyBase: 'mode_switch', selector: '[data-guide-id="mode-switcher"]' },
        { keyBase: 'server_step2', view: 'server-dashboard', selector: '[data-guide-id="sidebar-nav-server-dashboard"]' },
        { keyBase: 'server_step3', view: 'search', selector: '[data-guide-id="sidebar-nav-search"]' },
        { keyBase: 'server_step4', view: 'server-library', selector: '[data-guide-id="sidebar-nav-server-library"]' },
        { keyBase: 'server_step5', view: 'styling', selector: '[data-guide-id="sidebar-nav-styling"]' },
        { keyBase: 'server_step6', view: 'server-settings', selector: '[data-guide-id="sidebar-nav-server-settings"]' }
    ],
    client: [
        { keyBase: 'client_step1' },
        { keyBase: 'mode_switch', selector: '[data-guide-id="mode-switcher"]' },
        { keyBase: 'client_step2', view: 'open-client', selector: '[data-guide-id="sidebar-nav-open-client"]' },
        { keyBase: 'client_step3', view: 'skins', selector: '[data-guide-id="sidebar-nav-skins"]', requiresSkinsAccess: true },
        { keyBase: 'client_step4', view: 'extensions', selector: '[data-guide-id="sidebar-nav-extensions"]' },
        { keyBase: 'client_step5', view: 'styling', selector: '[data-guide-id="sidebar-nav-styling"]' },
        { keyBase: 'client_step6', view: 'settings', selector: '[data-guide-id="sidebar-nav-settings"]' }
    ],
    tools: [
        { keyBase: 'tools_step1' },
        { keyBase: 'mode_switch', selector: '[data-guide-id="mode-switcher"]' },
        { keyBase: 'tools_step2', view: 'tools-dashboard', selector: '[data-guide-id="sidebar-nav-tools-dashboard"]' }
    ]
};

const DEFAULT_VIEW_BY_MODE: Record<GuideMode, string> = {
    launcher: 'dashboard',
    server: 'server-dashboard',
    client: 'open-client',
    tools: 'tools-dashboard'
};

export function isGuideMode(value: string): value is GuideMode {
    return value === 'launcher' || value === 'server' || value === 'client' || value === 'tools';
}

export function getGuideDefaultView(mode: GuideMode) {
    return DEFAULT_VIEW_BY_MODE[mode];
}

export function getGuideSteps(mode: GuideMode, options?: { canAccessSkins?: boolean }) {
    const canAccessSkins = options?.canAccessSkins ?? false;
    return GUIDE_STEP_MAP[mode]
        .filter((step) => !(step.requiresSkinsAccess && !canAccessSkins))
        .map((step) => ({
            ...step,
            mode: step.mode ?? mode,
            titleKey: `guide.${step.keyBase}_title`,
            descKey: `guide.${step.keyBase}_desc`
        }));
}
