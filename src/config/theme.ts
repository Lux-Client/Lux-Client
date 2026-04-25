export interface Theme {
    id: string;
    name: string;
    primaryColor: string;
    backgroundColor: string;
    surfaceColor: string;
    textOnBackground: string;
    textOnSurface: string;
    textOnPrimary: string;
    borderRadius: number;
    glassBlur: number;
    panelOpacity: number;
    bgOverlay: number;
}

export const THEMES: Theme[] = [
    {
        id: 'lux-dark',
        name: 'Lux Dark',
        primaryColor: '#22e07a',
        backgroundColor: '#0a0a0a',
        surfaceColor: '#161616',
        textOnBackground: '#fafafa',
        textOnSurface: '#fafafa',
        textOnPrimary: '#0a0a0a',
        borderRadius: 12,
        glassBlur: 10,
        panelOpacity: 0.85,
        bgOverlay: 0.4,
    },
    {
        id: 'lux-light',
        name: 'Lux Light',
        primaryColor: '#16a34a',
        backgroundColor: '#f5f5f5',
        surfaceColor: '#ffffff',
        textOnBackground: '#171717',
        textOnSurface: '#171717',
        textOnPrimary: '#ffffff',
        borderRadius: 12,
        glassBlur: 10,
        panelOpacity: 0.9,
        bgOverlay: 0.3,
    },
    {
        id: 'custom',
        name: 'Custom',
        primaryColor: '#e26602',
        backgroundColor: '#111111',
        surfaceColor: '#1c1c1c',
        textOnBackground: '#fafafa',
        textOnSurface: '#fafafa',
        textOnPrimary: '#0d0d0d',
        borderRadius: 12,
        glassBlur: 10,
        panelOpacity: 0.85,
        bgOverlay: 0.4,
    },
];

export const DEFAULT_THEME = THEMES[0];

export function getThemeById(id: string): Theme | undefined {
    return THEMES.find(t => t.id === id);
}