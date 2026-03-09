<div align="center">

  <img src="resources/icon.png" alt="Lux Logo" width="128" />

  <h1><strong>Lux</strong></h1>
  
  <p>
    <em>
      A modern Minecraft launcher, built with <b>Electron</b>, <b>React</b>, and <b>Tailwind CSS</b>.<br />
      Manage instances, skins, and modpacks with style.
    </em>
  </p>
  
  <div>
    <a href="https://github.com/LuxClient/LuxClient/actions/workflows/build-appimage.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/LuxClient/LuxClient/build-appimage.yml?branch=main&label=AppImage&logo=linux&logoColor=white&style=for-the-badge" alt="AppImage Linux Build" />
    </a>
    <a href="https://github.com/LuxClient/LuxClient/actions/workflows/build-deb.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/LuxClient/LuxClient/build-deb.yml?branch=main&label=DEB&logo=debian&logoColor=white&style=for-the-badge" alt="DEB Debian Build" />
    </a>
    <a href="https://github.com/LuxClient/LuxClient/actions/workflows/build-rpm.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/LuxClient/LuxClient/build-rpm.yml?branch=main&label=RPM&logo=redhat&logoColor=white&style=for-the-badge" alt="RPM RedHat Build" />
    </a>
    <a href="https://github.com/LuxClient/LuxClient/actions/workflows/build-win.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/LuxClient/LuxClient/build-win.yml?branch=main&label=Windows&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTAgMGgxMS40djExLjRIMHptMTIuNiAwaDExLjR2MTEuNEgxMi42ek0wIDEyLjZoMTEuNFYyNEgwem0xMi42IDBoMTEuNFYyNEgxMi42eiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=&logoColor=white&style=for-the-badge" alt="Windows Build" />
    </a>
    <a href="https://github.com/LuxClient/LuxClient/actions/workflows/scan.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/LuxClient/LuxClient/scan.yml?branch=main&label=VirusTotal&logo=virustotal&logoColor=white&style=for-the-badge" alt="VirusTotal Scan" />
    </a>
    <a href="https://github.com/LuxClient/LuxClient/releases">
      <img src="https://img.shields.io/github/v/release/LuxClient/LuxClient?include_prereleases&label=Release&style=for-the-badge" alt="Release" />
    </a>
  </div>

</div>

## Features

### Instance Management

- **Advanced Sorting & Grouping**: Organize your library by name, version, or playtime. Group instances by game version or loader for a cleaner look.
- **Modrinth Integration**: Import modpacks and instances directly from Modrinth.
- **One-Click Launch**: Launch Vanilla, Fabric, Forge, NeoForge, and Quilt instances.

### Skin & Cape Viewer

- **3D Previewing**: Real-time 3D rendering of your Minecraft skin and cape.
- **2D Previews**: Head and body previews with depth shading.
- **Direct Integration**: Equip default skins (Steve/Alex) or custom textures directly within the launcher.
- **Slim Support**: Full support for slim (Alex) arm models.

---

## Getting Started

### For Users

#### Quick Install (CLI)

Open your terminal and run the following command:

**Linux & macOS:**
```bash
curl -sSL https://lux.pluginhub.de/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://lux.pluginhub.de/install.ps1 | iex
```

#### Manual Installation

1. **Download** the latest installer for your operating system from the [official website](https://lux.pluginhub.de). Choose between:

### For Developers

#### Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS version is recommended)
- Package manager: [npm](https://www.npmjs.com/) (comes with Node.js) or [yarn](https://yarnpkg.com/)

#### Getting Started

1. **Clone the Repository**

   ```bash
   git clone https://github.com/LuxClient/LuxClient.git
   cd LuxClient
   ```

2. **Install Dependencies**

   Using npm:

   ```bash
   npm install
   ```

   Or, if you prefer yarn:

   ```bash
   yarn install
   ```

3. **Start the Development Server**

   Run the app in development mode for live reloading:

   Using npm:

   ```bash
   npm run dev
   ```

   Using yarn:

   ```bash
   yarn dev
   ```

4. **Build for Production**

   Create optimized builds for production release:

   Using npm:

   ```bash
   npm run dist
   ```

   Using yarn:

   ```bash
   yarn dist
   ```

5. **Additional Scripts**

   - **Lint the codebase**  

     ```bash
     npm run lint
     ```

   - **Test locally**  

     ```bash
     npm run dev
     ```

6. **Useful Tips**

   - If you encounter issues with native modules (e.g., `node-gyp`), ensure your Node version matches the Electron version used.
   - The project uses [Vite](https://vitejs.dev/) for fast refresh and build times.

---

Feel free to open an issue or discussion if you run into setup problems!

---

## Tech Stack

- **Electron** – Cross-platform desktop application runtime ([electronjs.org](https://www.electronjs.org/))
- **React** – Modern component-based UI library ([reactjs.org](https://reactjs.org/))
- **Vite** – Lightning-fast development/build tooling ([vitejs.dev](https://vitejs.dev/))
- **Tailwind CSS** – Utility-first CSS framework for rapid UI development ([tailwindcss.com](https://tailwindcss.com/))
- **Minecraft Integration**:
  - [skinview3d](https://github.com/bs-community/skinview3d) (real-time 3D skin/model previews)
- **State Management**: React Context API & Hooks (efficient and scalable local state handling)
- **Other**:
  - JavaScript
  - ESLint & Prettier (code quality and formatting)

*The stack is designed for performance, extensibility, and visually rich Minecraft integrations.*

---

## Screenshots

Below are example screenshots showcasing Lux's interface and features.

> Screenshots will be posted soon! Stay updated for a visual walkthrough of the latest version.

---

## Contributors

- Core team: **Fernsehheft, Mobilestars, ItzzMateo**
- Contributors to the latest version: **Tamino112, Foxof7207, blaxk**
