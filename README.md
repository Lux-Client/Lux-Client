<div align="center">

  <img src="resources/icon.png" alt="Lux Logo" width="128" />

  <h1><strong>Lux</strong></h1>
  
  <p>
    <em>
      <b>Lux</b> is a Minecraft launcher built with <b>Electron</b>, <b>React</b>, and <b>Tailwind CSS</b>.<br />
      Seamlessly manage all your Minecraft instances, skins, and modpacks in a clean, simple app.  
      Now with built-in support for both <b>Modrinth</b> and <b>CurseForge</b> modpacks.
    </em>
  </p>
  
  <div>
    <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-appimage.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lux-Client/LuxClient/build-appimage.yml?branch=main&label=AppImage&logo=linux&logoColor=white&style=for-the-badge" alt="AppImage Linux Build" />
    </a>
    <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-deb.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lux-Client/LuxClient/build-deb.yml?branch=main&label=DEB&logo=debian&logoColor=white&style=for-the-badge" alt="DEB Debian Build" />
    </a>
    <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-rpm.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lux-Client/LuxClient/build-rpm.yml?branch=main&label=RPM&logo=redhat&logoColor=white&style=for-the-badge" alt="RPM RedHat Build" />
    </a>
    <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/build-win.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lux-Client/LuxClient/build-win.yml?branch=main&label=Windows&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTAgMGgxMS40djExLjRIMHptMTIuNiAwaDExLjR2MTEuNEgxMi42ek0wIDEyLjZoMTEuNFYyNEgwem0xMi42IDBoMTEuNFYyNEgxMi42eiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=&logoColor=white&style=for-the-badge" alt="Windows Build" />
    </a>
    <a href="https://github.com/Lux-Client/LuxClient/actions/workflows/scan.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lux-Client/LuxClient/scan.yml?branch=main&label=VirusTotal&logo=virustotal&logoColor=white&style=for-the-badge" alt="VirusTotal Scan" />
    </a>
    <a href="https://github.com/Lux-Client/LuxClient/releases">
      <img src="https://img.shields.io/github/v/release/Lux-Client/LuxClient?include_prereleases&label=Release&style=for-the-badge" alt="Release" />
    </a>
  </div>

</div>

---

## Features

### Instance Management

- **Sorting & Grouping**: Sort your instances by name, version, or playtime. You can also group them by version or loader.
- **Modrinth & CurseForge Support**: Import modpacks and instances from <b>Modrinth</b> and <b>CurseForge</b> directly.
- **Multiloader Launch**: Start Vanilla, Fabric, Forge, NeoForge, or Quilt with one click.

### Skin & Cape Viewer

- **Live 3D Preview**: See your skin and cape in 3D inside the launcher.
- **2D Previews**: Check out head and body images with lighting.
- **Easy Skin Switching**: Use drag & drop or select files to change your skin.
- **Slim Model**: Works with both standard and slim arm models.

---

## Getting Started

### For Users

#### Quick Install (CLI)

Open a terminal and run the matching command for your system:

**Linux & macOS:**
```bash
curl -sSL https://lux.pluginhub.de/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://lux.pluginhub.de/install.ps1 | iex
```

#### Manual Installation

1. Download the installer for your OS from the [official website](https://lux.pluginhub.de).
2. Run the installer and follow the prompts.

---

### For Developers

#### Prerequisites

- [Node.js](https://nodejs.org/) (latest LTS)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

#### Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/LuxClient/LuxClient.git
   cd LuxClient
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Start the dev server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. Build for production:
   ```bash
   npm run dist
   # or
   yarn dist
   ```

5. Useful scripts:
   - Lint: `npm run lint`
   - Local test: `npm run dev`

6. Tips:
   - If you have errors with native dependencies, check that Node and Electron match versions.
   - The project uses [Vite](https://vitejs.dev/) for fast building and hot reload.

---

Found a bug or need help? [Create an issue](https://github.com/Lux-Client/LuxClient/issues) or join a [discussion](https://github.com/Lux-Client/LuxClient/discussions).

---

## Tech Stack

- **Electron** – The desktop platform ([electronjs.org](https://www.electronjs.org/))
- **React** – The UI framework ([reactjs.org](https://reactjs.org/))
- **Vite** – Tooling ([vitejs.dev](https://vitejs.dev/))
- **Tailwind CSS** – Styling ([tailwindcss.com](https://tailwindcss.com/))
- **skinview3d** – 3D Minecraft skin/model previews.
- **State Management**: React Context and Hooks.
- **Tooling**: JavaScript (ESNext), ESLint, and Prettier.

---

## Screenshots

<div align="center">
  <img src="resources/screenshots/Img1.png" alt="Screenshot 1" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/IMg2.png" alt="Screenshot 2" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/Img3.png" alt="Screenshot 3" style="border-radius: 8px; margin-bottom: 10px;" />
  <img src="resources/screenshots/Img4.png" alt="Screenshot 4" style="border-radius: 8px; margin-bottom: 10px;" />

</div>

---

## Contributors

- **Core Team:** Fernsehheft, Mobilestars, ItzzMateo
- **Recent:** Tamino112, Foxof7207, blaxk

Thanks to everyone who’s helped with Lux!
