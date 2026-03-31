import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../context/NotificationContext";
import SliderControl from "../components/SliderControl";
import ThemeCard from "../components/ThemeCard";
import MiniPreview from "../components/MiniPreview";
import Dropdown from "../components/Dropdown";
import ThemeExportModal from "../components/ThemeExportModal";
import { syncCustomFonts } from "../services/fontManager";
import { updateShadcnVars } from "../lib/utils";
import ThemeMarketplace from "./ThemeMarketplace";
import PageHeader from "../components/layout/PageHeader";
import PageContent from "../components/layout/PageContent";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Upload,
  Download,
  Trash2,
  Image as ImageIcon,
  RotateCcw,
  Save,
  Type,
} from "lucide-react";

const PRESETS = [
  {
    name: "Lux Forest (Default)",
    primary: "#e26602",
    bg: "#111111",
    surface: "#1c1c1c",
    textOnBackground: "#f5f5f5",
    textOnSurface: "#f5f5f5",
    textOnPrimary: "#1a1208",
  },
  {
    name: "Light Lux",
    primary: "#d24e01",
    bg: "#f9ddb1",
    surface: "#f5c77e",
    textOnBackground: "#2a1a0e",
    textOnSurface: "#2c1b0f",
    textOnPrimary: "#fff4ea",
  },
  {
    name: "Emerald",
    primary: "#1bd96a",
    bg: "#111111",
    surface: "#1c1c1c",
    textOnBackground: "#ecfff5",
    textOnSurface: "#e8fff3",
    textOnPrimary: "#062012",
  },
  {
    name: "Ruby",
    primary: "#ff5c6c",
    bg: "#140a0c",
    surface: "#1f1114",
    textOnBackground: "#ffecef",
    textOnSurface: "#ffe8ec",
    textOnPrimary: "#2a0b11",
  },
  {
    name: "Sapphire",
    primary: "#3da9fc",
    bg: "#0b1220",
    surface: "#121a2b",
    textOnBackground: "#eaf3ff",
    textOnSurface: "#e5f0ff",
    textOnPrimary: "#081a2b",
  },
  {
    name: "Amethyst",
    primary: "#b388ff",
    bg: "#14121c",
    surface: "#1c1826",
    textOnBackground: "#f2eaff",
    textOnSurface: "#eee4ff",
    textOnPrimary: "#1f1433",
  },
  {
    name: "Ocean",
    primary: "#00e0c6",
    bg: "#071418",
    surface: "#0f1f24",
    textOnBackground: "#dcfffa",
    textOnSurface: "#d7fff9",
    textOnPrimary: "#04221e",
  },
  {
    name: "Sunset",
    primary: "#ff8a5b",
    bg: "#1a0f0a",
    surface: "#241611",
    textOnBackground: "#fff0e9",
    textOnSurface: "#ffebe3",
    textOnPrimary: "#311204",
  },
  {
    name: "Cyberpunk",
    primary: "#f3e600",
    bg: "#1a0033",
    surface: "#2d004d",
    textOnBackground: "#f7eeff",
    textOnSurface: "#f3e7ff",
    textOnPrimary: "#1d1a00",
  },
  {
    name: "Frost",
    primary: "#a5f3fc",
    bg: "#0f172a",
    surface: "#1e293b",
    textOnBackground: "#e8f4ff",
    textOnSurface: "#e4f0ff",
    textOnPrimary: "#082027",
  },
  {
    name: "Autumn",
    primary: "#fb923c",
    bg: "#1c1917",
    surface: "#292524",
    textOnBackground: "#fff3eb",
    textOnSurface: "#ffefe7",
    textOnPrimary: "#2f1503",
  },
  {
    name: "Midnight",
    primary: "#3b82f6",
    bg: "#000000",
    surface: "#111111",
    textOnBackground: "#eaf2ff",
    textOnSurface: "#edf3ff",
    textOnPrimary: "#081a38",
  },
  {
    name: "Candy",
    primary: "#f472b6",
    bg: "#1e1b4b",
    surface: "#312e81",
    textOnBackground: "#f8f1ff",
    textOnSurface: "#f6eeff",
    textOnPrimary: "#2f0b23",
  },
  {
    name: "Gold",
    primary: "#fbbf24",
    bg: "#171717",
    surface: "#262626",
    textOnBackground: "#fff7e6",
    textOnSurface: "#fff4e0",
    textOnPrimary: "#2e2100",
  },
];

const FONT_OPTIONS = [
  { value: "Poppins", label: "Poppins" },
  { value: "Inter", label: "Inter" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Roboto", label: "Roboto" },
  { value: "Geist", label: "Geist" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Nunito", label: "Nunito" },
  { value: "Ubuntu", label: "Ubuntu" },
  { value: "Outfit", label: "Outfit" },
];

const DEFAULT_THEME = {
  primaryColor: "#e26602",
  backgroundColor: "#111111",
  surfaceColor: "#1c1c1c",
  textOnBackground: "#fafafa",
  textOnSurface: "#fafafa",
  textOnPrimary: "#0d0d0d",
  sidebarColor: "",
  glassBlur: 10,
  glassOpacity: 0.8,
  consoleOpacity: 0.8,
  borderRadius: 12,
  bgMedia: { url: "", type: "none" },
  sidebarGlow: 0,
  globalGlow: 0,
  panelOpacity: 0.85,
  bgOverlay: 0.4,
  autoAdaptColor: false,
  fontFamily: "Poppins",
  customFonts: [],
};

const normalizePresetShape = (preset = {}) => ({
  ...preset,
  name: preset.name || preset.handle || 'Preset',
  primary: preset.primary || preset.primaryColor || DEFAULT_THEME.primaryColor,
  bg: preset.bg || preset.background || preset.backgroundColor || DEFAULT_THEME.backgroundColor,
  surface: preset.surface || preset.surfaceColor || DEFAULT_THEME.surfaceColor,
  textOnBackground: preset.textOnBackground || preset.foreground || DEFAULT_THEME.textOnBackground,
  textOnSurface: preset.textOnSurface || preset.text || DEFAULT_THEME.textOnSurface,
  textOnPrimary: preset.textOnPrimary || DEFAULT_THEME.textOnPrimary,
  sidebarColor: preset.sidebarColor || preset.sidebar || '',
  sidebarGlow: typeof preset.sidebarGlow === 'number' ? preset.sidebarGlow : DEFAULT_THEME.sidebarGlow,
  globalGlow: typeof preset.globalGlow === 'number' ? preset.globalGlow : DEFAULT_THEME.globalGlow,
  panelOpacity: typeof preset.panelOpacity === 'number' ? preset.panelOpacity : DEFAULT_THEME.panelOpacity,
  bgOverlay: typeof preset.bgOverlay === 'number' ? preset.bgOverlay : DEFAULT_THEME.bgOverlay,
  fontFamily: preset.fontFamily || DEFAULT_THEME.fontFamily,
});

const sanitizeTheme = (nextTheme) => {
  const availableFonts = new Set([
    ...FONT_OPTIONS.map((font) => font.value),
    ...((nextTheme.customFonts ?? []).map((font) => font.family)),
  ]);

  if (!availableFonts.has(nextTheme.fontFamily)) {
    return {
      ...nextTheme,
      fontFamily: "Poppins",
    };
  }

  return nextTheme;
};

function Styling() {
  const { t } = useTranslation();
  const { addNotification } = useNotification();
  const [theme, setTheme] = useState({
    ...DEFAULT_THEME
  });

  const [activeView, setActiveView] = useState("editor");
  const [customPresets, setCustomPresets] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const fontOptions = [
    ...(theme.customFonts ?? []).map((font) => ({
      value: font.family,
      label: font.name,
      style: { fontFamily: font.family },
      actionIcon: (
        <Trash2 className="h-4 w-4" />
      ),
      fontId: font.id,
    })),
    ...FONT_OPTIONS.map((font) => ({
      value: font.value,
      label: font.label,
      style: { fontFamily: font.value },
    })),
  ];

  useEffect(() => {
    loadTheme();
    loadCustomPresets();

    return () => {

      window.electronAPI.getSettings().then(res => {
        if (res.success && res.settings.theme) {
          const t = res.settings.theme;
          const root = document.documentElement;
          syncCustomFonts(t.customFonts ?? []);
          root.style.setProperty("--primary-color", t.primaryColor);
          root.style.setProperty("--background-color", t.backgroundColor);
          root.style.setProperty("--surface-color", t.surfaceColor);
          root.style.setProperty("--text-on-background", t.textOnBackground ?? "#fafafa");
          root.style.setProperty("--text-on-surface", t.textOnSurface ?? "#fafafa");
          root.style.setProperty("--text-on-primary", t.textOnPrimary ?? "#0d0d0d");
          root.style.setProperty("--glass-blur", `${t.glassBlur}px`);
          root.style.setProperty("--glass-opacity", t.glassOpacity);
          root.style.setProperty("--console-opacity", t.consoleOpacity ?? 0.8);
          root.style.setProperty("--border-radius", `${t.borderRadius ?? 12}px`);
          root.style.setProperty("--sidebar-glow-intensity", t.sidebarGlow ?? 0);
          root.style.setProperty("--global-glow-intensity", t.globalGlow ?? 0);
          root.style.setProperty("--panel-opacity", t.panelOpacity ?? 0.85);
          root.style.setProperty("--bg-overlay-opacity", t.bgOverlay ?? 0.4);
          root.style.setProperty("--launcher-font", `'${t.fontFamily ?? "Poppins"}'`);

          const adjustColor = (hex, pct) => {
            const n = parseInt(hex.replace("#", ""), 16);
            const a = Math.round(2.55 * pct);
            const R = (n >> 16) + a;
            const G = ((n >> 8) & 0x00ff) + a;
            const B = (n & 0x0000ff) + a;
            return (
              "#" +
              (
                0x1000000 +
                (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 +
                (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 +
                (B < 255 ? (B < 0 ? 0 : B) : 255)
              )
                .toString(16)
                .slice(1)
            );
          };

          root.style.setProperty(
            "--primary-hover-color",
            adjustColor(t.primaryColor, 15),
          );
          root.style.setProperty(
            "--background-dark-color",
            adjustColor(t.backgroundColor, -20),
          );

          const hexToRgb = (hex) => {
            if (!hex || typeof hex !== 'string') return '28, 28, 28';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `${r}, ${g}, ${b}`;
          };

          root.style.setProperty("--surface-color-rgb", hexToRgb(t.surfaceColor));
          root.style.setProperty("--primary-color-rgb", hexToRgb(t.primaryColor));
          root.style.setProperty(
            "--background-dark-color-rgb",
            hexToRgb(adjustColor(t.backgroundColor, -20)),
          );

          if (t.bgMedia && t.bgMedia.url) {
            root.style.setProperty("--bg-url", t.bgMedia.url);
            root.style.setProperty("--bg-type", t.bgMedia.type);
          } else {
            root.style.setProperty("--bg-url", "");
            root.style.setProperty("--bg-type", "none");
          }

          updateShadcnVars(t);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (activeView === 'editor') {
      loadCustomPresets();
    }
  }, [activeView]);

  const loadCustomPresets = async () => {
    const res = await window.electronAPI.getCustomPresets();
    if (res.success) setCustomPresets(res.presets);
  };

  const handleDeletePreset = async (handle) => {
    const res = await window.electronAPI.deleteCustomPreset(handle);
    if (res.success) {
      addNotification(t('styling.preset_deleted'), "success");
      loadCustomPresets();
    }
  };

  const handleExportTheme = async (themeName) => {
    const presetData = {
      handle: themeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
      name: themeName,
      primary: theme.primaryColor,
      bg: theme.backgroundColor,
      surface: theme.surfaceColor,
      sidebarColor: theme.sidebarColor || '',
      textOnBackground: theme.textOnBackground,
      textOnSurface: theme.textOnSurface,
      textOnPrimary: theme.textOnPrimary,
      sidebarGlow: theme.sidebarGlow,
      globalGlow: theme.globalGlow,
      panelOpacity: theme.panelOpacity,
      bgOverlay: theme.bgOverlay,
      fontFamily: theme.fontFamily,
    };

    const res = await window.electronAPI.exportCustomPreset(presetData);
    if (res.success) {
      addNotification(t('styling.exported_to', { path: res.path }), "success");
      setShowExportModal(false);
    } else if (res.error !== 'Cancelled') {
      addNotification(`${t('styling.export')} failed: ${res.error}`, "error");
    }
  };

  const handleImportTheme = async () => {
    const res = await window.electronAPI.importCustomPreset();
    if (res.success) {
      addNotification(t('styling.imported_success'), "success");
      loadCustomPresets();
    } else if (res.error !== 'Cancelled') {
      addNotification(`${t('styling.import')} failed: ${res.error}`, "error");
    }
  };

  const applyPreset = (p) => {
    const normalizedPreset = normalizePresetShape(p);
    const nt = sanitizeTheme({
      ...theme,
      primaryColor: normalizedPreset.primary,
      backgroundColor: normalizedPreset.bg,
      surfaceColor: normalizedPreset.surface,
      textOnBackground: normalizedPreset.textOnBackground,
      textOnSurface: normalizedPreset.textOnSurface,
      textOnPrimary: normalizedPreset.textOnPrimary,
      sidebarColor: normalizedPreset.sidebarColor,
      sidebarGlow: normalizedPreset.sidebarGlow,
      globalGlow: normalizedPreset.globalGlow,
      panelOpacity: normalizedPreset.panelOpacity,
      bgOverlay: normalizedPreset.bgOverlay,
      fontFamily: normalizedPreset.fontFamily,
    });
    setTheme(nt);
    applyTheme(nt, true);
  };

  const loadTheme = async () => {
    const res = await window.electronAPI.getSettings();
    if (res.success) {
      if (res.settings.theme) {
        const loadedTheme = sanitizeTheme({ ...DEFAULT_THEME, ...res.settings.theme });
        setTheme(loadedTheme);
        applyTheme(loadedTheme);
      }
    }
  };

  const handleSelectCustomFont = async () => {
    const res = await window.electronAPI.selectCustomFont();
    if (res.success && res.settings?.theme) {
      const nextTheme = sanitizeTheme({ ...DEFAULT_THEME, ...res.settings.theme });
      setTheme(nextTheme);
      applyTheme(nextTheme);
    }
  };

  const handleDeleteCustomFont = async (option) => {
    if (!option.fontId) {
      return;
    }

    const res = await window.electronAPI.deleteCustomFont(option.fontId);
    if (res.success && res.settings?.theme) {
      const nextTheme = sanitizeTheme({ ...DEFAULT_THEME, ...res.settings.theme });
      setTheme(nextTheme);
      applyTheme(nextTheme);
    }
  };

  const applyTheme = (t, isPreview = false) => {
    const root = document.documentElement;
    syncCustomFonts(t.customFonts ?? []);
    root.style.setProperty("--primary-color", t.primaryColor);
    root.style.setProperty("--background-color", t.backgroundColor);
    root.style.setProperty("--surface-color", t.surfaceColor);
    root.style.setProperty("--text-on-background", t.textOnBackground ?? "#fafafa");
    root.style.setProperty("--text-on-surface", t.textOnSurface ?? "#fafafa");
    root.style.setProperty("--text-on-primary", t.textOnPrimary ?? "#0d0d0d");
    root.style.setProperty("--glass-blur", `${t.glassBlur}px`);
    root.style.setProperty("--glass-opacity", t.glassOpacity);
    root.style.setProperty("--console-opacity", t.consoleOpacity ?? 0.8);
    root.style.setProperty("--border-radius", `${t.borderRadius ?? 12}px`);
    root.style.setProperty("--sidebar-glow-intensity", t.sidebarGlow ?? 0);
    root.style.setProperty("--global-glow-intensity", t.globalGlow ?? 0);
    root.style.setProperty("--panel-opacity", t.panelOpacity ?? 0.85);
    root.style.setProperty("--bg-overlay-opacity", t.bgOverlay ?? 0.4);
    root.style.setProperty("--launcher-font", `'${t.fontFamily ?? "Poppins"}'`);

    const adjustColor = (hex, pct) => {
      const n = parseInt(hex.replace("#", ""), 16);
      const a = Math.round(2.55 * pct);
      const R = (n >> 16) + a;
      const G = ((n >> 8) & 0x00ff) + a;
      const B = (n & 0x0000ff) + a;
      return (
        "#" +
        (
          0x1000000 +
          (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 +
          (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 +
          (B < 255 ? (B < 0 ? 0 : B) : 255)
        )
          .toString(16)
          .slice(1)
      );
    };

    root.style.setProperty(
      "--primary-hover-color",
      adjustColor(t.primaryColor, 15),
    );
    root.style.setProperty(
      "--background-dark-color",
      adjustColor(t.backgroundColor, -20),
    );

    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r}, ${g}, ${b}`;
    };

    root.style.setProperty("--surface-color-rgb", hexToRgb(t.surfaceColor));
    root.style.setProperty("--primary-color-rgb", hexToRgb(t.primaryColor));
    root.style.setProperty(
      "--background-dark-color-rgb",
      hexToRgb(adjustColor(t.backgroundColor, -20)),
    );

    if (!isPreview) {
      if (t.bgMedia && t.bgMedia.url) {
        root.style.setProperty("--bg-url", t.bgMedia.url);
        root.style.setProperty("--bg-type", t.bgMedia.type);
      } else {
        root.style.setProperty("--bg-url", "");
        root.style.setProperty("--bg-type", "none");
      }
    }

    updateShadcnVars(t);
  };

  const handleUpdate = (key, value) => {
    const newTheme = sanitizeTheme({ ...theme, [key]: value });
    setTheme(newTheme);
    const isBackgroundChange = key === "bgMedia" || key === "bgOverlay";
    applyTheme(newTheme, isBackgroundChange);
  };

  const extractColor = (url, type) => {
    return new Promise((resolve) => {
      if (type === 'video') {
        const video = document.createElement('video');
        video.crossOrigin = "Anonymous";
        video.onloadeddata = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, 100, 100);
          const data = ctx.getImageData(0, 0, 100, 100).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2];
          }
          const count = data.length / 4;
          const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
          resolve(rgbToHex(Math.round(r / count), Math.round(g / count), Math.round(b / count)));
        };
        video.src = `app-media:///${url.replace(/\\/g, "/")}`;
        video.load();
      } else {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 100, 100);
          const data = ctx.getImageData(0, 0, 100, 100).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2];
          }
          const count = data.length / 4;
          const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
          resolve(rgbToHex(Math.round(r / count), Math.round(g / count), Math.round(b / count)));
        };
        img.src = `app-media:///${url.replace(/\\/g, "/")}`;
      }
    });
  };

  const handleSelectBackground = async () => {
    const res = await window.electronAPI.selectBackgroundMedia();
    if (res.success && res.url) {
      if (theme.autoAdaptColor) {
        const color = await extractColor(res.url, res.type) as string;
        setTheme(prev => {
          const nt = { ...prev, bgMedia: { url: res.url, type: res.type }, primaryColor: color };
          applyTheme(nt, true);
          return nt;
        });
      } else {
        handleUpdate("bgMedia", { url: res.url, type: res.type });
      }
    }
  };

  const handleFactoryReset = () => {
    const nextTheme = {
      ...DEFAULT_THEME,
      customFonts: theme.customFonts ?? [],
    };
    setTheme(nextTheme);
    applyTheme(nextTheme, false);
    addNotification(t('styling.reset_factory_success'), "success");
  };

  const handleSave = async () => {
    const res = await window.electronAPI.getSettings();
    if (res.success) {
      const newSettings = { ...res.settings, theme };
      const saveRes = await window.electronAPI.saveSettings(newSettings);
      if (saveRes.success) {
        applyTheme(theme, false);
        addNotification(t('styling.saved_success'), "success");
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t('styling.title')}
        description={activeView === 'editor' ? undefined : t('extensions.theme_marketplace_desc', 'Discover and install custom themes built by the community.')}
      >
        <Tabs value={activeView} onValueChange={setActiveView}>
          <TabsList>
            <TabsTrigger value="editor">
              {t('styling.editor', 'Editor')}
            </TabsTrigger>
            <TabsTrigger value="marketplace">
              {t('extensions.theme_marketplace', 'Marketplace')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>

      <PageContent>
        {activeView === 'marketplace' ? (
          <ThemeMarketplace />
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-3 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t('styling.accent_base_text_color')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.color')}
                      </span>
                      <span className="w-10 justify-self-center text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.base')}
                      </span>
                      <span className="w-10 justify-self-center text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.text')}
                      </span>

                      {[
                        {
                          id: 'accent',
                          label: t('styling.accent_color'),
                          baseKey: 'primaryColor',
                          textKey: 'textOnPrimary',
                        },
                        {
                          id: 'background',
                          label: t('styling.background'),
                          baseKey: 'backgroundColor',
                          textKey: 'textOnBackground',
                        },
                        {
                          id: 'panels',
                          label: t('styling.panels'),
                          baseKey: 'surfaceColor',
                          textKey: 'textOnSurface',
                        },
                      ].map((row) => (
                        <React.Fragment key={row.id}>
                          <Label className="text-sm font-medium text-muted-foreground">
                            {row.label}
                          </Label>
                          <input
                            type="color"
                            value={theme[row.baseKey]}
                            onChange={(e) => handleUpdate(row.baseKey, e.target.value)}
                            className="w-10 h-10 rounded-lg cursor-pointer border border-border hover:border-primary/50 transition-all"
                            style={{
                              background: theme[row.baseKey],
                              WebkitAppearance: 'none',
                              MozAppearance: 'none',
                              appearance: 'none',
                            }}
                          />
                          <input
                            type="color"
                            value={theme[row.textKey]}
                            onChange={(e) => handleUpdate(row.textKey, e.target.value)}
                            className="w-10 h-10 rounded-lg cursor-pointer border border-border hover:border-primary/50 transition-all"
                            style={{
                              background: theme[row.textKey],
                              WebkitAppearance: 'none',
                              MozAppearance: 'none',
                              appearance: 'none',
                            }}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.quick_themes')}
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleImportTheme}
                        className="h-auto py-1 px-2 text-[10px] font-medium uppercase tracking-wider text-primary hover:text-foreground"
                      >
                        <Download className="h-3 w-3" />
                        {t('styling.import')}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[500px] pr-2">
                      <div className="space-y-4">
                        {customPresets.length > 0 && (
                          <div className="space-y-3">
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('styling.custom')}</span>
                            <div className="grid grid-cols-1 gap-2">
                              {customPresets.map((p) => (
                                <ThemeCard
                                  key={p.handle}
                                  theme={p}
                                  onApply={() => applyPreset(p)}
                                  onDelete={() => handleDeletePreset(p.handle)}
                                  isCustom={true}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {customPresets.length > 0 && <Separator />}

                        <div className="space-y-3">
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('styling.presets')}</span>
                          <div className="grid grid-cols-1 gap-2">
                            {PRESETS.map((p) => (
                              <ThemeCard
                                key={p.name}
                                theme={p}
                                onApply={() => applyPreset(p)}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-9 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t('styling.live_preview')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MiniPreview theme={theme} />
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.interactive_effects')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex-1">
                            {t('styling.launcher_font')}
                          </Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSelectCustomFont}
                            className="h-7 text-[10px] font-medium uppercase tracking-wider"
                          >
                            <Type className="h-3 w-3" />
                            {t('styling.add_font')}
                          </Button>
                        </div>
                        <Dropdown
                          options={fontOptions}
                          value={theme.fontFamily ?? "Poppins"}
                          onChange={(val) => handleUpdate("fontFamily", val)}
                          onOptionAction={handleDeleteCustomFont}
                        />
                      </div>
                      <SliderControl
                        label={t('styling.corner_roundness')}
                        value={theme.borderRadius ?? 12}
                        min={0}
                        max={32}
                        step={2}
                        unit="px"
                        onChange={(val) => handleUpdate("borderRadius", val)}
                      />
                      <SliderControl
                        label={t('styling.glass_blur')}
                        value={theme.glassBlur}
                        min={0}
                        max={40}
                        step={1}
                        unit="px"
                        onChange={(val) => handleUpdate("glassBlur", val)}
                      />
                      <SliderControl
                        label={t('styling.sidebar_glow')}
                        value={Math.round((theme.sidebarGlow ?? 0) * 100)}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(val) => handleUpdate("sidebarGlow", val / 100)}
                      />
                      <SliderControl
                        label={t('styling.global_glow')}
                        value={Math.round((theme.globalGlow ?? 0) * 100)}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(val) => handleUpdate("globalGlow", val / 100)}
                      />
                      <SliderControl
                        label={t('styling.panel_opacity')}
                        value={Math.round((theme.panelOpacity ?? 0.85) * 100)}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(val) => handleUpdate("panelOpacity", val / 100)}
                      />
                      <SliderControl
                        label={t('styling.console_opacity')}
                        value={Math.round((theme.consoleOpacity ?? 0.8) * 100)}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(val) => handleUpdate("consoleOpacity", val / 100)}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('styling.atmosphere')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {t('styling.auto_color')}
                        </Label>
                        <Switch
                          checked={theme.autoAdaptColor}
                          onCheckedChange={(checked) => handleUpdate("autoAdaptColor", checked)}
                        />
                      </div>

                      <div
                        onClick={handleSelectBackground}
                        className="aspect-video rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/50 hover:border-primary/50 transition-all group overflow-hidden relative"
                      >
                        {theme.bgMedia?.url ? (
                          <>
                            {theme.bgMedia.type === "video" ? (
                              <video
                                src={`app-media:///${theme.bgMedia.url.replace(/\\/g, "/")}`}
                                className="absolute inset-0 w-full h-full object-cover opacity-40"
                                autoPlay
                                loop
                                muted
                              />
                            ) : (
                              <img
                                key={theme.bgMedia.url}
                                src={`app-media:///${theme.bgMedia.url.replace(/\\/g, "/")}`}
                                className="absolute inset-0 w-full h-full object-cover opacity-40"
                                alt=""
                              />
                            )}
                            <div className="relative z-10 text-center">
                              <span className="text-[10px] font-medium uppercase tracking-wider text-foreground bg-background/60 px-3 py-1 rounded-full border border-border">
                                {t('styling.change_bg')}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <ImageIcon className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase text-center break-words px-4">
                              {t('styling.select_media')}
                            </span>
                          </>
                        )}
                      </div>

                      {theme.bgMedia?.url && (
                        <div className="space-y-4">
                          <SliderControl
                            label={t('styling.overlay_intensity')}
                            value={Math.round((theme.bgOverlay ?? 0.4) * 100)}
                            min={0}
                            max={100}
                            step={5}
                            unit="%"
                            onChange={(val) => handleUpdate("bgOverlay", val / 100)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (theme.bgMedia.url) {
                                await window.electronAPI.deleteBackgroundMedia(theme.bgMedia.url);
                              }
                              handleUpdate("bgMedia", { url: "", type: "none" });
                            }}
                            className="text-destructive hover:text-destructive w-full justify-center gap-2"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('styling.remove_bg')}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={loadTheme}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('styling.reset')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleFactoryReset} className="text-destructive hover:text-destructive">
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('styling.reset_factory')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowExportModal(true)}>
                    <Upload className="h-3.5 w-3.5" />
                    {t('styling.export')}
                  </Button>
                  <Button size="sm" onClick={handleSave}>
                    <Save className="h-3.5 w-3.5" />
                    {t('styling.save')}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </PageContent>

      {showExportModal && (
        <ThemeExportModal
          presetData={theme}
          onClose={() => setShowExportModal(false)}
          onExport={handleExportTheme}
        />
      )}
    </div>
  );
}

export default Styling;
