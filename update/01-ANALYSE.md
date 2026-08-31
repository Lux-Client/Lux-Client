# 01 — Repo-Analyse (Ist-Zustand)

Stand: 2026-08-30. Basiert auf Client `65591d4` (branch `main`) und dem Website-Repo
im Arbeitsverzeichnis. **Diese Datei ersetzt eine erneute Repo-Analyse.**
Wenn du etwas hier korrigierst, notiere es in `STATUS.md` unter "Korrekturen".

---

## 1. Website — `MCLC-Website`

### Stack
| Was | Womit |
|---|---|
| Server | Express 4, ein Monolith: `server.js` (~1.700 Zeilen Routen, 75 KB) |
| DB | **PostgreSQL** über `pg`, gekapselt in `database.js` |
| Sessions | `express-session` + `connect-pg-simple`, Tabelle `user_sessions` (auto-created) |
| Auth | **Ausschließlich Passport Google OAuth 2.0** (`passport-setup.js`) |
| Realtime | `socket.io` 4, Session wird via `io.engine.use(sessionMiddleware)` geteilt |
| Uploads | `multer` **auf Disk**, `middleware/upload.js`, 5 MB Limit, Extension-Allowlist |
| Mail | `nodemailer` über Resend-SMTP, `email.js`, per `EMAIL_ENABLED` abschaltbar |
| Frontend | React SPA in `client/` (Vite), gebaut nach `client/dist` |
| Deploy | Docker (`Dockerfile`, `docker-compose.yml`), ein Container, Volume `lux_data` → `/app/data` |
| Schema | `db_init.js` — idempotentes `CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS` |

### ⚠️ Fallstricke in `database.js` (WICHTIG für neuen Code)
`database.js` ist ein MySQL→Postgres-Kompatibilitäts-Shim. Er tut Folgendes:

1. `normalizeSql()` ersetzt **alle Backticks durch doppelte Anführungszeichen** und
   danach **alle doppelt-gequoteten Strings durch einfach-gequotete**.
   → **In neuen Queries niemals `"` verwenden**, weder für Identifier noch für Literale.
2. `convertPlaceholders()` wandelt `?` → `$1, $2, …`.
   → **Neue Queries müssen `?` benutzen, nicht `$n`.**
3. `prepareSql()` hängt an **jedes** `INSERT` ohne `RETURNING` automatisch
   ` RETURNING id` an.
   → **Bei Tabellen ohne `id`-Spalte** (z. B. geplante `blob_refs`,
   `cloud_instance_playtime` mit Composite-PK) **schlägt jedes INSERT fehl.**
   Lösung: entweder explizites `RETURNING <spalte>` mitgeben oder solche Queries über
   `pool.raw.query(text, params)` (echter `pg`-Client, kein Shim) fahren.
4. `mapPgError` mappt `23505` → `ER_DUP_ENTRY`, `42701` → `ER_DUP_FIELDNAME`.
5. `pool.getConnection()` liefert ein Objekt mit `beginTransaction/commit/rollback/release`.
   Für Commits mit mehreren Tabellen benutzen.

### Datenmodell (bestehend, `db_init.js`)
```
users(id, google_id UNIQUE, username UNIQUE, email, avatar, bio,
      role IN('user','admin'), last_login, ip_address, banned, ban_reason,
      ban_expires, warn_count, is_private, created_at)
extensions(id, user_id→users, name, identifier UNIQUE, summary, description,
      type, visibility, file_path, banner_path, status, downloads,
      category, mc_version, created_at, updated_at)
extension_versions(id, extension_id→extensions, version, changelog, file_path,
      downloads, status, created_at)  UNIQUE(extension_id, version)
extension_metadata_drafts(...)
notifications(id, user_id→users, message, type IN('info','success','warning','error'),
      is_read, created_at)                       ← wiederverwenden für Sync-Hinweise
modpack_codes(id, code UNIQUE, owner_uuid, owner_ip, created_at)
extension_ratings / extension_comments / content_reports
admin_audit_log(id, admin_user_id, admin_label, action, target_type, target_id,
      details, created_at)                       ← wiederverwenden für Cloud-Admin-Aktionen
user_sessions(...)                               ← von connect-pg-simple
```
Alle FKs auf `users` haben `ON DELETE CASCADE`.

### Auth-Fluss (bestehend)
- `GET /auth/google` → `GET /auth/google/callback` → `req.session.returnTo`-Redirect
- `GET /auth/logout`
- `GET /api/user` → `{loggedIn, user}` (nur Session-Cookie)
- Middleware `ensureAuthenticated` (401) und `ensureAdmin` (403, `req.user.role==='admin'`),
  beide in `server.js` definiert.
- Es gibt **keinerlei Token-/Bearer-Auth**. Alles Cookie-Session, `sameSite: 'lax'`,
  `secure` nur in production, 7 Tage.
- `logAdminAction(req, action, targetType, targetId, details)` schreibt ins Audit-Log.

### Relevante bestehende Endpunkte
- `DELETE /api/user/delete` — löscht Extension-Dateien von Disk, dann `DELETE FROM users`
  (CASCADE räumt den Rest), dann Logout + Session-Destroy.
  **→ Muss um Cloud-Aufräumung erweitert werden.**
- `GET /api/user/notifications`, `POST /api/notifications/read/:id`, `read-all`
- Admin: `/api/admin/users`, `/api/admin/audit-log`, `/api/admin/reports`, …

### Admin-Panel
`client/src/pages/AdminPanel.jsx`, Zeile ~205: Array `TABS` mit
`{id, label, icon, authLevel}` — `authLevel` ist `'any' | 'tools' | 'admin'`.
Aktuell: overview, news, analytics, codes, moderation, users, auditlog.
→ Ein neuer Tab `cloud` ist ein Ein-Zeilen-Eingriff plus Panel-Komponente.

### Was der Website **fehlt** für dieses Feature
- Keine Bearer-/JWT-Auth, kein Device-Konzept, kein Refresh-Token.
- Kein Objektspeicher. `multer` schreibt auf ein Docker-Volume — für Millionen Blobs
  und mehrere TB **nicht** geeignet.
- Kein Rate-Limiting-Paket installiert (das Client-Repo hat `express-rate-limit`,
  das Website-Repo nicht).
- Kein Hintergrund-Job-Runner (für GC, 15-Tage-Ablauf, Retention).

---

## 2. Client — `MCLC-Client` ("Lux", v1.10.0)

### Stack
Electron 40 · React 18 + TypeScript · Vite 7 · Tailwind + Radix UI · `minecraft-launcher-core` ·
`msmc` (Microsoft-Login) · `electron-store` · `axios` · `socket.io-client` · `i18next`.

### ⚠️ Zwei `main.js` — nur eines ist aktiv
- **`electron/main.js` (1048 Z.) ist der echte Entry Point** (`package.json` → `"main"`).
  Es registriert die Handler aus `../backend/handlers/*` über ein Array (Zeile ~613)
  und lädt `../backend/preload.js`.
- `backend/main.js` (166 Z.) ist eine **Altlast** und wird nicht ausgeführt. Sie
  registriert teils andere Handler (`texturepacks`, `remoteControl`), was verwirrt.
  → Neue Handler **in `electron/main.js`** ins Handler-Array eintragen.

### Sicherheitsbasis (gut!)
`webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }`
→ Alles läuft über `backend/preload.js` (`contextBridge.exposeInMainWorld`,
Objekt `electronAPI`, ~404 Zeilen). Neue Sync-Funktionen müssen dort ergänzt werden.

### Handler-Übersicht (`backend/handlers/`)
| Datei | Z. | Relevanz |
|---|---|---|
| `instances.js` | 6085 | **Kern.** Alles rund um Instanzen; ~60 IPC-Handler |
| `launcher.js` | 2595 | Start/Stop, **Playtime-Buchung** |
| `servers.js` | 2527 | Server-Verwaltung |
| `modrinth.js` | 2239 | Modrinth-Suche/Install |
| `cloudBackup.js` | 525 | **Fremdes Feature, nicht anfassen** — s. u. |
| `modpackCode.js` | 496 | Redet bereits mit `https://lux.pluginhub.de` |
| `auth.js` | 254 | Microsoft-Login via `msmc` |
| `settings.js` | 303 | `settings:get` / `settings:save` |

### 🚨 Namenskollision: `cloudBackup.js` ist NICHT unser Feature
`backend/handlers/cloudBackup.js` implementiert **BYO-Cloud-Backups**: der User meldet
sich mit seinem **eigenen** Google-Drive- oder Dropbox-Konto an (OAuth + PKCE) und der
`BackupManager` lädt ZIP-Backups der `saves/` dorthin. IPC-Namespace `cloud:*`.
→ Das bleibt bestehen. Das neue Feature muss einen **anderen Namespace** benutzen:
**`luxcloud:*`** für IPC, `LuxCloud*` für Dateien. Sonst wird das UI unverständlich
("Cloud" bedeutet dann zwei verschiedene Dinge).

Wiederverwendbar von dort: der **PKCE-Helper** (`createPkcePair`, `base64Url`) und das
Muster "Token-Refresh mit Retry".

### Instanz-Modell auf Disk
Pfad: `resolvePrimaryInstancesDir()` in `backend/utils/instances-path.js`
→ `settings.instancesPath` oder Default `%APPDATA%/lux/instances/`.
Es gibt zusätzlich Legacy-Pfade (`mclc`, `Minecraft Launcher`, `LuxClient`, …) und
eine Migrationsfunktion `migrateLegacyInstancesToPrimarySync()`.

Ordnerinhalt einer echten Instanz (Beispiel „PVP MISCHE (Real)"):
```
.fabric/  backups/  cache/  config/  crash-reports/  data/  debug/  downloads/
essential/  libraries/  logs/  mods/  natives/  resourcepacks/  saves/  schematics/
screenshots/  shaderpacks/  versions/  xaero/  XaeroWaypoints_BACKUP…/  meteor-client/
instance.json   options.txt   playtime.txt   servers.dat   servers.dat_old
servers.essential.dat   usercache.json   hotbar.nbt   install.log
command_history.txt   debug-profile.json   ui_utils_*.json
```

`instance.json` (Beispiel, gekürzt):
```json
{
  "name": "AFK",
  "version": "1.21.11",
  "loader": "fabric",
  "loaderVersion": "0.19.3",
  "versionId": "fabric-loader-0.19.3-1.21.11",
  "icon": "data:image/svg+xml,%3Csvg …",
  "created": 1234567890,
  "playtime": 0,
  "lastPlayed": null,
  "status": "installing",
  "instanceType": "…",
  "folderPath": "…"
}
```

### 🚨 Drei strukturelle Probleme, die vor dem Sync gelöst werden müssen
1. **`instance.json` enthält das Icon als base64-Data-URI.**
   Bei „PVP MISCHE (Real)" ist die Datei dadurch **3,15 MB** groß. Eine Datei, die
   sich bei jedem Playtime-Update ändert und 3 MB groß ist, ist für Delta-Sync Gift.
   → Icon muss in eine separate `icon.png`/`icon.svg` ausgelagert werden
   (rückwärtskompatibel: base64 weiterhin lesen, beim ersten Sync migrieren).
2. **Es gibt keine stabile Instanz-ID.** Identität ist der Ordnername
   (`resolveInstanceDirByName`). Umbenennen = neue Identität. Für Cloud-Sync über
   mehrere PCs ist das unbrauchbar.
   → Additives Feld `instanceId` (UUID v4) in `instance.json`, beim Start vergeben.
   → **Vom Auftraggeber am 2026-08-31 ausdrücklich bestätigt** („jede Cloud-Instanz
   hat dann eine UUID", `00-PROMPT.md §22`). Die UUID — nicht der Ordner- oder
   Anzeigename — ist die Identität einer Instanz über alle PCs hinweg.
3. **Playtime wird doppelt geführt**: `instance.json.playtime` (ms) **und**
   `playtime.txt`. Gebucht in `backend/handlers/launcher.js:2296` beim
   Prozess-Exit — d. h. **ein Absturz/Stromausfall verliert die ganze Session.**

### Mod-Metadaten — der große Hebel
`instance:get-mods` (`instances.js:4653`) berechnet SHA-1 jeder `.jar`, fragt
`https://api.modrinth.com/v2/version_file/<sha1>` und cached das Ergebnis in
`%APPDATA%/lux/mod_cache.json`, keyed by `` `${fileName}-${size}` ``:
```json
{ "title": …, "icon": …, "version": …, "hash": <sha1>,
  "projectId": …, "versionId": …, "source": "modrinth" }
```
→ **Damit wissen wir für die meisten Mods bereits, dass sie kostenlos vom
Modrinth-CDN nachladbar sind. Diese Dateien müssen wir nie hochladen.**
Das ist der wichtigste einzelne Kostenhebel des gesamten Features.

### Vorhandene Bausteine, die wiederverwendet werden
| Baustein | Ort | Verwendung |
|---|---|---|
| `safeStorage`-Verschlüsselung | `backend/utils/secureProfileStore.js` | Lux-Tokens ablegen |
| PKCE-Helper | `backend/handlers/cloudBackup.js` | OAuth-Flow |
| `luxclient://` Deep Link | `electron/main.js:889`, registriert in `package.json` `protocols` | OAuth-Redirect |
| `app.requestSingleInstanceLock` + `second-instance` | `electron/main.js:927` | Deep-Link-Zustellung |
| `resolveInstanceDirByName` | `backend/utils/instances-path.js` | Instanzpfade |
| SHA-1-Berechnung | `instances.js` (`calculateSha1`) | Basis für Hashing |
| `electron-store` | überall | Sync-State |
| Progress-IPC-Muster | `install:progress`, `instance:status` | Sync-Fortschritt |

### Client-UI-Struktur
`src/pages/`: Dashboard, InstanceDetails, Settings, Client, Login, Skins, Status, …
`src/components/`: AppSidebar, TopBar, ActionBar, InstanceSettingsModal,
BackupManagerModal, ConfirmationModal, ProjectContextMenu, `ui/` (Radix-Wrapper) …
`src/context/`: ExtensionContext, NotificationContext ← Muster für einen neuen
`LuxAccountContext`.

---

## 3. Schnittstelle Client ↔ Website heute
- `backend/handlers/modpackCode.js:9` → `const SERVER_URL = 'https://lux.pluginhub.de'`
- Extensions/Themes werden von dort geladen (`extensions.js`).
- `luxclient://install?identifier=…&type=…&url=…&name=…` ist der bestehende Deep Link
  von der Website in den Client.
- **Es gibt bisher keinerlei authentifizierte Client→Website-Kommunikation.**

---

## 4. Zusammenfassung: Breaking Changes & Risiken
| # | Thema | Schwere | Gegenmaßnahme |
|---|---|---|---|
| 1 | Keine stabile Instanz-ID | hoch | additives `instanceId`, Migration beim Start |
| 2 | Icon als 3-MB-base64 in `instance.json` | hoch | Auslagern, rückwärtskompatibel lesen |
| 3 | `database.js`-Shim (`"`-Ersetzung, Auto-`RETURNING id`) | hoch | Regeln in `01-ANALYSE.md §1` befolgen, ggf. `pool.raw` |
| 4 | Playtime nur beim sauberen Exit gebucht | mittel | Heartbeat-Datei, Crash-Recovery |
| 5 | Namenskollision „Cloud" mit `cloudBackup.js` | mittel | Namespace `luxcloud:` + UI-Wording |
| 6 | Zwei `main.js`, nur `electron/main.js` aktiv | mittel | Handler dort registrieren; `backend/main.js` ggf. löschen |
| 7 | Website hat keinen Objektspeicher | hoch | S3-kompatibles Backend (R2) einführen |
| 8 | Website hat kein Bearer-Auth | hoch | neue Token-Schicht, s. `02-ARCHITEKTUR.md §F` |
| 9 | Kein Job-Runner für GC/Retention/15-Tage-Regel | mittel | `node-cron` im Server oder separater Worker |
| 10 | `instances.js` ist 6085 Zeilen | mittel | Sync-Code in **neue** Dateien, nicht dort reinschreiben |
