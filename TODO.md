# Lux Client - TODO / Ideas

A collection of potential improvements for Lux, organized by category.

---

## Performance

- [ ] **Lazy loading for instance list** - Virtualize large instance collections to reduce initial render time
- [ ] **Image caching improvements** - Implement LRU cache for modpack/instance thumbnails
- [ ] **WebContents visibility optimization** - Only render off-screen content when scrolled into view
- [ ] **IPC debouncing** - Batch rapid IPC calls to reduce main/renderer overhead
- [ ] **Lazy-load pages** - Split pages into separate chunks, load only when navigated to
- [ ] **Memory profiling hooks** - Add memory usage stats to dev tools for leak detection
- [ ] **Background task queue** - Queue non-critical downloads/tasks to prevent UI jank

---

## New Features

### Instance Management

- [ ] **Instance profiles/templates** - Save and reuse instance configurations
- [ ] **Instance cloning** - Duplicate instances with version/game options
- [ ] **Instance export/import** - Share instance configurations as portable JSON/YAML

### Mod Management

- [ ] **Mod conflict detection** - Visual indicator for incompatible mods
- [ ] **Mod version pinning** - Lock specific mod versions to prevent auto-updates
- [ ] **Mod changelog viewer** - View mod update notes from Modrinth/CurseForge
- [ ] **Mod search within instance** - Search installed mods without leaving instance view

### Server Features

- [ ] **Server instance linking** - Connect Lux instances to dedicated servers
- [ ] **Server console tab** - Live console output for server management
- [ ] **Server player list** - View connected players in real-time
- [ ] **Server backup scheduling** - Automated world/config backups

### UI/UX

- [ ] **Theme customization** - Custom accent colors, dark/light modes beyond current
- [ ] **Custom CSS injection** - Allow users to inject custom stylesheets
- [ ] **Keyboard shortcuts** - Configurable hotkeys for common actions
- [ ] **Floating widget** - Compact overlay mode for quick access while gaming
- [ ] **Notifications center** - Consolidated notification history

### Account & Social

- [ ] **Multi-account quick switch** - Seamless switching between Microsoft accounts
- [ ] **Profile switching** - Separate skins/settings per Minecraft profile
- [ ] **Launcher badges** - Show notification badges for updates/new mods

### Tools & Utilities

- [ ] **Log analyzer improvements** - Auto-detect common crash causes and suggest fixes
- [ ] **World backup manager** - Dedicated UI for backing up Minecraft worlds
- [ ] **Resource pack converter** - Basic format conversion tools
- [ ] **Server status widget** - Ping favorite servers for uptime status

---

## Storage Methods

- [ ] **Cloud sync via self-hosted S3** - Sync settings/instances to MinIO/S3 bucket
- [ ] **WebDAV support** - Integration with Nextcloud, Synology, etc.
- [ ] **Git-based config versioning** - Track settings changes with git history
- [ ] **SQLite storage option** - Alternative to electron-store for larger datasets
- [ ] **Portable mode** - Store all data relative to executable for USB drives
- [ ] **Settings profiles** - Named configurations that can be imported/exported
- [ ] **Incremental backup storage** - Delta-based backups to save disk space

---

## Quality of Life

- [ ] **Game launcher arguments UI** - Visual editor for JVM/game arguments
- [ ] **RAM auto-detection** - Suggest optimal RAM allocation based on system
- [ ] **Quick launch bar** - Favorite instances pinned to top
- [ ] **Auto-updater for instances** - Option to auto-update modpacks on launch
- [ ] **Recent activity feed** - Dashboard showing playtime, recent launches, etc.
- [ ] **Offline mode indicator** - Clear visual state when network is unavailable
- [ ] **Migration wizard** - Import data from other launchers (PrismLauncher, GDLauncher's format)

---

## Progress Tracking

### Feature: Cross-Platform Support [DONE]

- Implement cross-platform packaging for Linux (.deb, .rpm, .AppImage) and macOS (.dmg).
- Integrated `electron-builder` into the existing build pipeline.
- Configured necessary build settings for these platforms.
- Linux-specific protocol registration.

### Bug: Broken Dev Cycle [FIXED]

- Resolved recursive `beforeDevCommand` loop in `tauri.conf.json`.
- Decoupled `package.json` scripts: `frontend:dev` (vite) vs `dev` (tauri).

### UI: Modernized Error Screen [DONE]

- Implemented high-fidelity glassmorphic Error Fallback component.
- Added Framer Motion animations and dark-glow aesthetics.

### Feature: Global Modrinth Visibility [DONE]

- Centralized visibility logic in `applyVisibilityFilters`.
- Integrated across all views (Home, Dashboard, Sidebar, Command Palette, etc.).
- "Remove from everywhere" requirement met.

---

## Critical Paths

- [ ] Microsoft OAuth token exchange flow (`auth.rs`).
- [ ] Technical issue reporting mechanism in Error Screen.

## Style Guide Conformance

- Maintain premium design standards (Inter/Outfit fonts, glassmorphism).
- Zero-defect engineering principles.

---

## Rust Migration (v1.7+) [ACTIVE]

- [x] **Core Backend Transition** - Migrate from Electron to Tauri/Rust for performance.
- [x] **High-Performance Launcher** - Implement parallel library/asset processing.
- [x] **Java Management** - Port Java detection/installation to Rust with caching.
- [ ] **Microsoft OAuth** - Complete token exchange logic in Rust.
- [ ] **Store Integration** - Migrate `electron-store` to `tauri-plugin-store`.

## Technical Debt

- [x] **Rust Migration** - Initial backend port complete.
- [ ] **Centralized error handling** - Consistent error boundaries and logging.
- [ ] **Test coverage** - Add unit tests for critical paths (download, launch, auth).
- [ ] **API client abstraction** - Separate API logic from UI components.

---

## Integrations

- [ ] **Modrinth API v2** - Update to latest API with new features
- [ ] **CurseForge API improvements** - Better search, more metadata
- [ ] **Plaza modpack support** - Add third modpack source
- [ ] **Discord presence** - Enhanced Rich Presence with instance details
- [ ] **Minecraft Marketplace** - Browse marketplace content (if API available)

---

*Priorities can be set by adding labels: `high`, `medium`, `low`*
