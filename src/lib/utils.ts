import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function hexToHsl(hex) {
  if (!hex || typeof hex !== 'string') return '0 0% 0%';
  hex = hex.replace('#', '');
  if (hex.length !== 6) return '0 0% 0%';
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function adjustHex(hex, pct) {
  if (!hex || typeof hex !== 'string') return '#000000';
  const n = parseInt(hex.replace('#', ''), 16);
  const a = Math.round(2.55 * pct);
  const R = (n >> 16) + a;
  const G = ((n >> 8) & 0x00ff) + a;
  const B = (n & 0x0000ff) + a;
  return '#' + (0x1000000 + (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 + (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 + (B < 255 ? (B < 0 ? 0 : B) : 255)).toString(16).slice(1);
}

export function updateShadcnVars(theme) {
  const root = document.documentElement;
  const primary = theme.primaryColor || '#e26602';
  const bg = theme.backgroundColor || '#0d1117';
  const sidebarBase = theme.sidebarColor || bg;
  const surface = theme.surfaceColor || '#161b22';
  const textOnBackground = theme.textOnBackground || '#fafafa';
  const textOnSurface = theme.textOnSurface || '#fafafa';
  const textOnPrimary = theme.textOnPrimary || '#0d0d0d';

  const isLightHex = (hex) => {
    if (!hex || typeof hex !== 'string' || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 160;
  };

  const bgHsl = hexToHsl(bg);
  const sidebarHsl = hexToHsl(sidebarBase);
  const surfaceHsl = hexToHsl(surface);
  const primaryHsl = hexToHsl(primary);

  const isBgLight = isLightHex(bg);
  const dir = isBgLight ? -1 : 1;
  const popBgDir = isBgLight ? 1 : -1;

  const darkerBg = hexToHsl(adjustHex(bg, 10 * popBgDir));
  const lighterBg = hexToHsl(adjustHex(bg, 12 * dir));
  const mutedBg = hexToHsl(adjustHex(bg, 18 * dir));
  const borderColor = hexToHsl(adjustHex(bg, 16 * dir));
  const mutedFg = hexToHsl(adjustHex(textOnSurface, isLightHex(textOnSurface) ? -26 : 26));
  const accentBg = hexToHsl(adjustHex(bg, 22 * dir));
  const textOnBackgroundHsl = hexToHsl(textOnBackground);
  const textOnSurfaceHsl = hexToHsl(textOnSurface);
  const textOnPrimaryHsl = hexToHsl(textOnPrimary);

  root.style.setProperty('--background', bgHsl);
  root.style.setProperty('--foreground', textOnBackgroundHsl);
  root.style.setProperty('--card', surfaceHsl);
  root.style.setProperty('--card-foreground', textOnSurfaceHsl);
  root.style.setProperty('--popover', darkerBg);
  root.style.setProperty('--popover-foreground', textOnSurfaceHsl);
  root.style.setProperty('--primary', primaryHsl);
  root.style.setProperty('--primary-foreground', textOnPrimaryHsl);
  root.style.setProperty('--secondary', lighterBg);
  root.style.setProperty('--secondary-foreground', textOnBackgroundHsl);
  root.style.setProperty('--muted', mutedBg);
  root.style.setProperty('--muted-foreground', mutedFg);
  root.style.setProperty('--accent', accentBg);
  root.style.setProperty('--accent-foreground', textOnBackgroundHsl);
  root.style.setProperty('--border', borderColor);
  root.style.setProperty('--input', borderColor);
  root.style.setProperty('--ring', primaryHsl);
  root.style.setProperty('--sidebar', sidebarHsl);
  root.style.setProperty('--sidebar-foreground', mutedFg);
  root.style.setProperty('--sidebar-accent', lighterBg);
  root.style.setProperty('--sidebar-accent-foreground', textOnBackgroundHsl);
  root.style.setProperty('--sidebar-border', borderColor);
  root.style.setProperty('--chart-1', primaryHsl);
}
