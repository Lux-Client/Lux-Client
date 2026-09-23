# Lux Client - TODO / Ideas

Open ideas and improvements for Lux, organized by category. Finished items are listed at the bottom.

*Priorities can be set by adding labels: `high`, `medium`, `low`*

---

## Planned

- [ ] **Play with friends (no port forwarding)** - Host a local server and reach it through a claimed `*.lux` subdomain
  - Requires a Lux account, max. 5 subdomains per account, availability checked via Cloudflare
  - Deleting a server keeps the subdomain claimed (pointing nowhere); it can be reassigned to another server
  - Subdomains can be viewed and released in the Lux account panel
  - Tunnel must not rely on a separate helper executable (Windows Defender kept deleting it)
- [ ] **Crash fixes with one click** - Turn `logAnalyzer` findings into actions in the crash modal (raise RAM, install matching Java, disable duplicate mod)
- [ ] **Modpack updates with changelog** - Detect new Modrinth/CurseForge pack versions on launch, show the changelog, keep configs and worlds

---

## Performance

- [ ] **Background task queue** - Queue non-critical downloads/tasks to prevent UI jank
- [ ] **IPC debouncing** - Batch rapid IPC calls to reduce main/renderer overhead
- [ ] **Smaller startup bundle** - The shell chunk is still ~1.5 MB (mostly framer-motion); consider `LazyMotion` / `m` components
- [ ] **Memory profiling hooks** - Add memory usage stats to dev tools for leak detection

---

## Instances & Mods

- [ ] **Instance templates** - Save and reuse instance configurations
- [ ] **Mod version pinning** - Lock specific mod versions so update checks skip them
- [ ] **Mod changelog viewer** - Show release notes from Modrinth/CurseForge before updating a mod
- [ ] **Update snapshots** - Back up `mods/` and `config/` before mod/pack updates and offer an undo
- [ ] **Performance preset** - One switch that installs Sodium/Lithium/FerriteCore etc. matching the loader and version
- [ ] **Screenshot gallery** - Per-instance gallery for `screenshots/` (preview, copy, open folder, delete)
- [ ] **RAM suggestion on create** - Recommend a memory value from system RAM and mod count

---

## Servers

- [ ] **Server instance linking** - Connect a Lux instance to a dedicated server (matching version/mods, one-click join)
- [ ] **Scheduled server backups** - The setting exists in server settings; wire it to an actual scheduler

---

## UI/UX

- [ ] **Custom CSS injection** - Allow users to inject custom stylesheets
- [ ] **Configurable keyboard shortcuts** - Hotkeys for common actions, plus a global "launch last instance" hotkey
- [ ] **Favorite instances** - Pin instances to the top of the dashboard and the tray menu
- [ ] **Playtime statistics** - Weekly charts, most played instances and streaks as a dashboard widget
- [ ] **Launcher badges** - Taskbar/dock badge for available updates

---

## Accounts

- [ ] **Profile switching** - Separate skins/settings per Minecraft profile

---

## Storage

- [ ] **Portable mode** - Store all data next to the executable when a `portable.txt` is present
- [ ] **Settings profiles** - Named configurations that can be imported/exported
- [ ] **Self-hosted sync (S3 / WebDAV)** - Alternative to Lux Cloud for MinIO, Nextcloud, Synology, etc.

---

## Integrations

- [ ] **Import from other launchers** - Wizard that detects Prism/MultiMC, CurseForge app, GDLauncher, ATLauncher and the official launcher
- [ ] **Discord presence details** - Show loader, version and server/world instead of only the instance name

---

## Platform-Specific

- [ ] **macOS polish** - Native menu bar and proper app switching
- [ ] **ARM64 builds** - Native builds for Apple Silicon and ARM Linux

---

## Technical Debt

- [ ] **Test coverage** - Unit tests for download, launch and auth (tests exist for Lux Cloud, sandbox, settings search and server ping)
- [ ] **TypeScript migration for backend** - Convert JavaScript handlers to TypeScript
- [ ] **Remove unused code** - e.g. `src/pages/Modpacks.tsx` is not referenced anywhere
- [ ] **API client abstraction** - Separate API logic from UI components

---

## Done

- [x] Lazy-loaded pages (plus idle prefetch of the most used ones and lazy first-run dialogs)
- [x] Virtualized instance list
- [x] LRU image cache for thumbnails
- [x] Instance cloning (duplicate)
- [x] Instance export/import (`.mrpack`, CurseForge zip)
- [x] Mod compatibility scan and incompatible mod detection in the log analyzer
- [x] Search for installed content inside an instance
- [x] Server console with live output, log analysis and crash detection
- [x] Server player list
- [x] Saved servers on the dashboard with players, MOTD, ping and direct join (QuickPlay)
- [x] Theme system with custom colors, presets and marketplace
- [x] Notification center (cloud notification bell)
- [x] Multi-account quick switch and Microsoft account logout
- [x] Log analyzer with automatic crash cause detection
- [x] World backup manager
- [x] Resource pack tools (report, cleanup, PNG compression)
- [x] RAM increase capped by system memory
- [x] JVM argument settings
- [x] Recent activity on the dashboard (jump back in, recent worlds, playtime)
- [x] Linux system tray
- [x] Flatpak, AppImage, DEB and RPM builds
- [x] Discord Rich Presence
- [x] Error boundaries
