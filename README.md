<div align="center">

  <img src="resources/icon.png" alt="Lux Logo" width="128" />

  <h1><strong>Lux</strong></h1>

  <p>
    <em>
      A modern Minecraft launcher built with <b>Electron</b>, <b>React</b>, and <b>Tailwind CSS</b>.<br />
      Manage instances, servers, skins, modpacks, and themes — all in one place.
    </em>
  </p>

  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
      <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-appimage.yml">
        <img src="https://shieldcn.dev/github/ci/Lux-Client/LuxClient.svg?workflow=build-appimage.yml&label=AppImage&logo=linux&variant=outline" alt="AppImage Build" />
      </a>
      <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-deb.yml">
        <img src="https://shieldcn.dev/github/ci/Lux-Client/LuxClient.svg?workflow=build-deb.yml&label=DEB&logo=debian&variant=outline" alt="DEB Build" />
      </a>
      <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-rpm.yml">
        <img src="https://shieldcn.dev/github/ci/Lux-Client/LuxClient.svg?workflow=build-rpm.yml&label=RPM&logo=redhat&variant=outline" alt="RPM Build" />
      </a>
      <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-win.yml">
        <img src="https://shieldcn.dev/github/ci/Lux-Client/LuxClient.svg?workflow=build-win.yml&label=Windows&logo=windows&variant=outline" alt="Windows Build" />
      </a>
      <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/scan.yml">
        <img src="https://shieldcn.dev/github/ci/Lux-Client/LuxClient.svg?workflow=scan.yml&label=VirusTotal&logo=virustotal&variant=outline" alt="VirusTotal Scan" />
      </a>
      <a href="https://github.com/Lux-Client/LuxClient/releases">
        <img src="https://shieldcn.dev/github/release/Lux-Client/LuxClient.svg?label=Release&variant=outline" alt="Release" />
      </a>
  </div>

</div>

---

> **Note:** Lux is **source-available**, not open source. It is licensed under the [PolyForm Perimeter License](LICENSE.md), which permits use, modification, and distribution, but prohibits providing any product that competes with the software. See [LICENSE.md](LICENSE.md) for full terms.

---

## Features

### Instance & Modpack Management
- **Multi-loader launch** — Vanilla, Fabric, Forge, NeoForge, Quilt
- **Modrinth & CurseForge** — Browse and import modpacks directly from both platforms
- **Sorting & Grouping** — Sort instances by name, version, or playtime; group by version or loader

### Server Management
- **Full server lifecycle** — Create, configure, start, and stop Minecraft servers from within the launcher
- **Server console** — Live console output with log analysis and crash detection
- **Server software** — Browse and install Paper, Purpur, Fabric, and more

### Tools & Client Mode
- **Client Mode** — Launch the vanilla client directly with custom configurations
- **Tools Dashboard** — Built-in utilities (log analyzer, resource pack tools, and more)

### Skin & Cape Viewer
- **Live 3D preview** — View your skin and cape in 3D using skinview3d
- **2D previews** — Head and body renders with lighting
- **Drag-and-drop** — Easily switch skins with file picker or drag-and-drop

### Customization
- **Theme system** — Full theme marketplace with community-created themes
- **Custom colors** — Per-component color picking with real-time preview
- **Command palette** — Quick actions with CMD+K palette

### Extensions
- **Extension support** — Load community extensions to extend launcher functionality
- **Extension marketplace** — Browse and install from within the app

### i18n
- **15 languages** — Fully localized UI with community-maintained translations

---

## Screenshots

<div align="center">
  <img src="resources/screenshots/Img1.png" alt="Screenshot 1" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/IMg2.png" alt="Screenshot 2" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/Img3.png" alt="Screenshot 3" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/Img4.png" alt="Screenshot 4" style="border-radius: 8px; margin-bottom: 10px;" />
</div>

---

## Getting Started

### For Users

#### Quick Install
```bash
# Linux & macOS
curl -sSL https://lux.pluginhub.de/install.sh | bash

# Windows (PowerShell)
iwr https://lux.pluginhub.de/install.ps1 | iex
```

Or download the latest installer from the [releases page](https://github.com/Lux-Client/LuxClient/releases).

#### Supported Platforms
- **Linux** — AppImage, DEB, RPM
- **Windows** — NSIS installer (x64)
- **macOS** — DMG (Apple Silicon & Intel)

### For Developers

#### Prerequisites
- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v11+)

#### Setup
```bash
git clone https://github.com/Lux-Client/LuxClient.git
cd LuxClient
pnpm install
pnpm dev
```

#### Scripts
| Command | Description |
|---|---|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build the frontend |
| `pnpm lint` | Lint all source files with Oxlint |
| `pnpm format` | Format all files with Oxfmt |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm check` | Run all checks via Ultracite |
| `pnpm fix` | Auto-fix lint and format issues |
| `pnpm dist` | Build for production (platform-specific) |

---

## Architecture

```
electron/main.ts     Electron main process (window, IPC, updates)
backend/handlers/    IPC handlers (auth, instances, servers, skins, ...)
src/                 React frontend
  pages/             Route components (Dashboard, Skins, Settings, ...)
  components/        Reusable UI components
  context/           React context providers
  locales/           15 translation files
  lib/               Utilities and helpers
```

Built with **Vite** for fast builds, **Framer Motion** for animations, and **Radix UI** primitives for accessibility.

---

## Built With

- **Electron** — Desktop runtime
- **React** — UI framework
- **Vite** — Build tooling
- **TypeScript** — Type safety
- **Tailwind CSS** — Utility-first styling
- **Framer Motion** — Animations
- **Radix UI** — Accessible component primitives
- **skinview3d** — 3D Minecraft skin previews
- **i18next** — Internationalization (15 locales)
- **minecraft-launcher-core** — Java process management
- **electron-updater** — Auto-updates
- **Ultracite** — Code quality toolchain (Oxlint + Oxfmt)
- **pnpm** — Fast, disk-efficient package manager

---

## License

Lux is **source-available** under the [PolyForm Perimeter License 1.0.1](LICENSE.md).

This is **not** an open-source license. You may use, modify, and distribute the software, but you may not provide any product that competes with Lux. See [LICENSE.md](LICENSE.md) for full terms.

---

<p align="center">
  Found a bug or need help?
  <a href="https://github.com/Lux-Client/LuxClient/issues/new">Open an issue</a>
  ·
  <a href="https://github.com/Lux-Client/LuxClient/discussions">Start a discussion</a>
</p>
