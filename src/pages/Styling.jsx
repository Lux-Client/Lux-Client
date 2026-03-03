import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../context/NotificationContext";
import ColorPicker from "../components/ColorPicker";
import SliderControl from "../components/SliderControl";
import ThemeCard from "../components/ThemeCard";
import MiniPreview from "../components/MiniPreview";
import Dropdown from "../components/Dropdown";
import { syncCustomFonts } from "../services/fontManager";

const PRESETS = [
  {
    name: "Emerald (Default)",
    primary: "#22e07a",
    bg: "#0d1117",
    surface: "#161b22",
  },
  {
    name: "Ruby",
    primary: "#ff5c6c",
    bg: "#140a0c",
    surface: "#1f1114",
  },
  {
    name: "Sapphire",
    primary: "#3da9fc",
    bg: "#0b1220",
    surface: "#121a2b",
  },
  {
    name: "Amethyst",
    primary: "#b388ff",
    bg: "#14121c",
    surface: "#1c1826",
  },
  {
    name: "Ocean",
    primary: "#00e0c6",
    bg: "#071418",
    surface: "#0f1f24",
  },
  {
    name: "Sunset",
    primary: "#ff8a5b",
    bg: "#1a0f0a",
    surface: "#241611",
  },
  {
    name: "Cyberpunk",
    primary: "#f3e600",
    bg: "#1a0033",
    surface: "#2d004d",
  },
  {
    name: "Frost",
    primary: "#a5f3fc",
    bg: "#0f172a",
    surface: "#1e293b",
  },
  {
    name: "Autumn",
    primary: "#fb923c",
    bg: "#1c1917",
    surface: "#292524",
  },
  {
    name: "Midnight",
    primary: "#3b82f6",
    bg: "#000000",
    surface: "#111111",
  },
  {
    name: "Candy",
    primary: "#f472b6",
    bg: "#1e1b4b",
    surface: "#312e81",
  },
  {
    name: "Gold",
    primary: "#fbbf24",
    bg: "#171717",
    surface: "#262626",
  },
];

const FONT_OPTIONS = [
  { value: "Poppins", label: "Poppins" },
  { value: "Inter", label: "Inter" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Roboto", label: "Roboto" },
  { value: "Geist", label: "Geist" },
];

const DEFAULT_THEME = {
  primaryColor: "#22e07a",
  backgroundColor: "#0d1117",
  surfaceColor: "#161b22",
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

function Styling() {
  const { t } = useTranslation();
  const { addNotification } = useNotification();
  const [theme, setTheme] = useState({
    ...DEFAULT_THEME
  });

  const [customPresets, setCustomPresets] = useState([]);
  const fontOptions = [
    ...FONT_OPTIONS.map((font) => ({
      value: font.value,
      label: font.label,
      style: { fontFamily: font.value },
    })),
    ...(theme.customFonts ?? []).map((font) => ({
      value: font.family,
      label: font.name,
      style: { fontFamily: font.family },
      actionIcon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      ),
      fontId: font.id,
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
        }
      });
    };
  }, []);

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

  const handleExportTheme = async () => {
    const presetData = {
      handle: theme.name ? theme.name.toLowerCase().replace(/[^a-z0-9_-]/g, '') : 'custom_theme',
      name: theme.name || "Custom Theme",
      primary: theme.primaryColor,
      bg: theme.backgroundColor,
      surface: theme.surfaceColor,
      sidebarGlow: theme.sidebarGlow,
      globalGlow: theme.globalGlow,
      panelOpacity: theme.panelOpacity,
      bgOverlay: theme.bgOverlay,
      fontFamily: theme.fontFamily,
    };

    const res = await window.electronAPI.exportCustomPreset(presetData);
    if (res.success) {
      addNotification(t('styling.exported_to', { path: res.path }), "success");
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
    const nt = {
      ...theme,
      primaryColor: p.primary,
      backgroundColor: p.bg,
      surfaceColor: p.surface,
      sidebarGlow: p.sidebarGlow ?? theme.sidebarGlow,
      globalGlow: p.globalGlow ?? theme.globalGlow,
      panelOpacity: p.panelOpacity ?? theme.panelOpacity,
      bgOverlay: p.bgOverlay ?? theme.bgOverlay,
      fontFamily: p.fontFamily ?? theme.fontFamily,
    };
    setTheme(nt);
    applyTheme(nt, true);
  };

  const loadTheme = async () => {
    const res = await window.electronAPI.getSettings();
    if (res.success) {
      if (res.settings.theme) {
        const loadedTheme = { ...DEFAULT_THEME, ...res.settings.theme };
        setTheme(loadedTheme);
        applyTheme(loadedTheme);
      }
    }
  };

  const handleSelectCustomFont = async () => {
    const res = await window.electronAPI.selectCustomFont();
    if (res.success && res.settings?.theme) {
      const nextTheme = { ...DEFAULT_THEME, ...res.settings.theme };
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
      const nextTheme = { ...DEFAULT_THEME, ...res.settings.theme };
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

    // Only apply global background if NOT in preview mode
    if (!isPreview) {
      if (t.bgMedia && t.bgMedia.url) {
        root.style.setProperty("--bg-url", t.bgMedia.url);
        root.style.setProperty("--bg-type", t.bgMedia.type);
      } else {
        root.style.setProperty("--bg-url", "");
        root.style.setProperty("--bg-type", "none");
      }
    }
  };

  const handleUpdate = (key, value) => {
    const newTheme = { ...theme, [key]: value };
    setTheme(newTheme);
    // Background changes are preview-only until saved
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
        const color = await extractColor(res.url, res.type);
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
        // Apply fully, including background, once saved
        applyTheme(theme, false);
        addNotification(t('styling.saved_success'), "success");
      }
    }
  };

  return (
    <div className="p-10 text-white h-full overflow-y-auto custom-scrollbar">
      { }
      <header className="mb-10">
        <h1 className="text-4xl font-black text-white tracking-tight mb-2">
          {t('styling.title')}
        </h1>
        <p className="text-gray-400">
          {t('styling.desc')}
        </p>
      </header>

      { }
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl">

        { }
        <div className="lg:col-span-3 space-y-6">
          { }
          <section className="bg-surface/50 backdrop-blur-md p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
            <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-6">
              {t('styling.accent_base')}
            </h2>
            <div className="space-y-5">
              <ColorPicker
                label={t('styling.accent_color')}
                value={theme.primaryColor}
                onChange={(val) => handleUpdate("primaryColor", val)}
              />
              <ColorPicker
                label={t('styling.background')}
                value={theme.backgroundColor}
                onChange={(val) => handleUpdate("backgroundColor", val)}
              />
              <ColorPicker
                label={t('styling.panels')}
                value={theme.surfaceColor}
                onChange={(val) => handleUpdate("surfaceColor", val)}
              />
            </div>
          </section>

          { }
          <section className="bg-surface/50 backdrop-blur-md p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em]">
                {t('styling.quick_themes')}
              </h2>
              <button
                onClick={handleImportTheme}
                className="text-[10px] font-bold text-primary uppercase tracking-widest hover:text-white transition-colors flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('styling.import')}
              </button>
            </div>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              { }
              {customPresets.length > 0 && (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-gray-600 uppercase">{t('styling.custom')}</span>
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

              { }
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-gray-600 uppercase">{t('styling.presets')}</span>
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
          </section>
        </div>

        { }
        <div className="lg:col-span-9 space-y-6">
          { }
          <section className="bg-surface/50 backdrop-blur-md p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
            <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-6">
              {t('styling.live_preview')}
            </h2>
            <MiniPreview theme={theme} />
          </section>

          { }
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            { }
            <section className="bg-surface/50 backdrop-blur-md p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-6">
                {t('styling.interactive_effects')}
              </h2>
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-1">
                      {t('styling.launcher_font')}
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectCustomFont}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-colors border border-white/10"
                    >
                      {t('styling.add_font')}
                    </button>
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
              </div>
            </section>

            { }
            <section className="bg-surface/50 backdrop-blur-md p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
              <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-6">
                {t('styling.atmosphere')}
              </h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('styling.auto_color')}</span>
                  <button
                    onClick={() => handleUpdate("autoAdaptColor", !theme.autoAdaptColor)}
                    className={`w-10 h-5 rounded-full transition-all relative ${theme.autoAdaptColor ? 'bg-primary' : 'bg-white/10'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${theme.autoAdaptColor ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div
                  onClick={handleSelectBackground}
                  className="aspect-video rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/5 hover:border-primary/50 transition-all group overflow-hidden relative"
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
                        <div className="text-[10px] font-black uppercase text-white tracking-widest bg-black/50 px-3 py-1 rounded-full border border-white/20">
                          {t('styling.change_bg')}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-8 w-8 text-gray-600 group-hover:text-primary transition-colors"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <div className="text-[10px] font-black text-gray-500 uppercase text-center break-words px-4">
                        {t('styling.select_media')}
                      </div>
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
                    <button
                      onClick={async () => {
                        if (theme.bgMedia.url) {
                          await window.electronAPI.deleteBackgroundMedia(theme.bgMedia.url);
                        }
                        handleUpdate("bgMedia", { url: "", type: "none" });
                      }}
                      className="text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-2 mx-auto transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {t('styling.remove_bg')}
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          { }
          <div className="flex justify-end gap-3">
            <button
              onClick={loadTheme}
              className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-6 py-3 rounded-xl font-bold transition-all text-sm border border-white/5 hover:border-white/10"
            >
              {t('styling.reset')}
            </button>
            <button
              onClick={handleFactoryReset}
              className="bg-white/5 hover:bg-white/10 text-red-400/70 hover:text-red-400 px-6 py-3 rounded-xl font-bold transition-all text-sm border border-white/5 hover:border-white/10"
            >
              {t('styling.reset_factory')}
            </button>
            <button
              onClick={handleExportTheme}
              className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-6 py-3 rounded-xl font-bold transition-all text-sm border border-white/5 hover:border-white/10 flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {t('styling.export')}
            </button>
            <button
              onClick={handleSave}
              className="bg-primary hover:bg-primary-hover text-black px-8 py-3 rounded-xl font-black shadow-lg shadow-primary/30 transition-all text-sm hover:scale-[1.02] active:scale-95"
            >
              {t('styling.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Styling;
