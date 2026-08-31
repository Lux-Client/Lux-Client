# 02 — Architektur, Datenmodell, API, Sync-Engine, Storage

Voraussetzung: `01-ANALYSE.md` gelesen. Alle Entscheidungen hier sind begründet —
wenn du eine änderst, notiere die Begründung in `STATUS.md`.

---

# A. Architektur

## A.1 Systemüberblick

```
┌──────────────────────── PC 1 ─────────────────────────┐
│  Lux Client (Electron)                                │
│  ┌────────────┐   IPC (luxcloud:*)   ┌──────────────┐ │
│  │ React UI   │ ◄──────────────────► │ Sync Engine  │ │
│  └────────────┘                      │ (main proc)  │ │
│                                      └──────┬───────┘ │
│  %APPDATA%/lux/                             │         │
│    instances/<name>/…                       │         │
│    luxcloud/                                │         │
│      state.json      (Geräte-ID, Tokens)    │         │
│      queue.jsonl     (Offline-Queue)        │         │
│      hashes/<iid>.json (Hash-Cache)         │         │
│      blobs/<aa>/<hash> (lokaler CAS-Cache)  │         │
└─────────────────────────────────────────────┼─────────┘
                                              │ HTTPS, Bearer-JWT
                                              ▼
                    ┌─────────────────────────────────────────┐
                    │  lux.pluginhub.de  (Express, bestehend)  │
                    │  ┌────────────────────────────────────┐  │
                    │  │ bestehend: Passport/Google, Session│  │
                    │  │ NEU: /api/auth/device/*  (PKCE)    │  │
                    │  │ NEU: /api/cloud/*        (Bearer)  │  │
                    │  │ NEU: /api/admin/cloud/*  (Session) │  │
                    │  └───────┬───────────────────┬────────┘  │
                    │          │                   │           │
                    │   ┌──────▼──────┐   ┌────────▼────────┐  │
                    │   │ Job-Runner  │   │ Storage-Adapter │  │
                    │   │ GC/Retention│   │ (S3 | FS)       │  │
                    │   └──────┬──────┘   └────────┬────────┘  │
                    └──────────┼───────────────────┼───────────┘
                               ▼                   ▼
                     ┌──────────────────┐  ┌────────────────────┐
                     │ PostgreSQL       │  │ Object Storage     │
                     │ (Metadaten only) │  │ Cloudflare R2      │
                     │ Manifeste als    │  │ blobs/aa/bb/<sha>  │
                     │ Blob-Referenz    │  │ (kein Egress-Preis)│
                     └──────────────────┘  └────────────────────┘
                               ▲
┌──────────────── PC 2 ────────┘
│  identischer Client, andere device_uuid
└──────────────────────────────
```

## A.2 Die vier Kernentscheidungen

**1. Referenzieren statt speichern.**
Jede Datei, die aus einer öffentlichen Quelle reproduzierbar ist, wird **nicht**
hochgeladen — nur ihre Herkunft wird im Manifest vermerkt. Das betrifft die
Minecraft-Runtime (`versions/`, `libraries/`, `assets/`, `natives/`) *und* die
allermeisten Mods, weil der Client über `mod_cache.json` bereits Modrinth
`projectId`/`versionId`/`sha1` kennt (siehe `01-ANALYSE.md`).
Ohne diesen Schritt wäre alles Weitere Kosmetik.

**2. Content-Addressable Storage auf Datei-Ebene, Chunking nur wo es sich lohnt.**
Minecraft-Instanzen bestehen fast nur aus *unveränderlichen* Blobs (`.jar`, `.zip`,
`.png`), die zwischen Usern identisch sind. Datei-Level-Dedup holt dort praktisch die
gesamte Ersparnis. Content-Defined Chunking lohnt nur bei großen *mutierenden* Dateien
— in Minecraft sind das die Welt-Regionen (`saves/**/region/*.mca`, je 8 MB, ändern
sich ständig). Deshalb: Datei-CAS als Standard, FastCDC nur für Dateien > 4 MB in
`saves/`. Alles andere wäre unnötige Komplexität.

**3. Der Server sieht nie einen halbfertigen Zustand.**
Upload läuft in drei Schritten: `negotiate` (was fehlt?) → Blobs hochladen →
`commit` (Manifest + `parentRevision`). Erst der Commit macht eine Revision sichtbar,
und er ist eine einzige DB-Transaktion mit Optimistic Locking über `parentRevision`.
Ein abgebrochener Upload hinterlässt nur unreferenzierte Blobs, die der GC aufräumt.

**4. Playtime ist ein G-Counter, kein Feld.**
Jedes Gerät führt seinen **eigenen absoluten** Zähler; die Gesamtsumme ist
`SUM(total_ms)` über alle Geräte. Der Client sendet nie Deltas. Damit ist jeder
Retry, jede Doppelzustellung und jede Reihenfolge unschädlich — das ist die einzige
Konstruktion, die die Anforderung „keine Doppelzählung bei mehreren Clients"
tatsächlich garantiert statt nur wahrscheinlich zu machen.

## A.3 Was **nicht** gebaut wird (und warum)
- **Keine zweite Userdatenbank.** `users` der Website bleibt die einzige Quelle.
- **Kein eigener Login-Screen im Client.** Google verbietet OAuth in eingebetteten
  WebViews, und wir wollen niemals Google-Credentials im Client sehen.
  → Systembrowser + PKCE + `luxclient://` Rückkanal.
- **Keine Ende-zu-Ende-Verschlüsselung.** Sie macht serverseitige Dedup unmöglich
  (und „convergent encryption" öffnet Confirmation-of-a-File-Angriffe). Bewusste,
  dokumentierte Abwägung: TLS in transit, SSE at rest.
- **Kein Ersatz für `cloudBackup.js`.** Das BYO-Drive/Dropbox-Backup bleibt separat.

---

# B. Datenmodell

Neue Tabellen, Stil und Konventionen exakt wie `db_init.js`.
Neue Datei: **`MCLC-Website/db_init_cloud.js`**, aufgerufen aus `db_init.js`.

> Beachte die `database.js`-Fallstricke aus `01-ANALYSE.md §1`:
> `?`-Platzhalter, keine doppelten Anführungszeichen, und Composite-PK-Inserts
> über `pool.raw.query` oder mit explizitem `RETURNING`.

```sql
-- Ein registriertes Gerät (PC) eines Users
CREATE TABLE IF NOT EXISTS client_devices (
    id                 INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid        VARCHAR(64) UNIQUE NOT NULL,
    name               VARCHAR(100),           -- z.B. 'DESKTOP-ABC (Windows)'
    platform           VARCHAR(20) NOT NULL,   -- win32 | darwin | linux
    app_version        VARCHAR(20),
    refresh_token_hash CHAR(64),               -- sha256 des aktuellen Refresh-Tokens
    token_generation   INTEGER NOT NULL DEFAULT 1,
    last_seen_at       TIMESTAMPTZ,
    last_ip            VARCHAR(45),
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pro User globale Cloud-Einstellungen und Kontingente
CREATE TABLE IF NOT EXISTS user_cloud_settings (
    user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cloud_sync_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync                BOOLEAN NOT NULL DEFAULT TRUE,
    cross_platform_default   BOOLEAN NOT NULL DEFAULT TRUE,
    sync_worlds_default      BOOLEAN NOT NULL DEFAULT FALSE,
    sync_screenshots_default BOOLEAN NOT NULL DEFAULT FALSE,
    quota_bytes              BIGINT  NOT NULL DEFAULT 5368709120,  -- 5 GiB
    max_instances            INTEGER NOT NULL DEFAULT 10,
    used_bytes               BIGINT  NOT NULL DEFAULT 0,           -- denormalisiert
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Eine Instanz in der Cloud (logische Identität über alle PCs hinweg)
CREATE TABLE IF NOT EXISTS cloud_instances (
    id                 INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_uuid      VARCHAR(64) NOT NULL,
    name               VARCHAR(120) NOT NULL,
    icon_blob          CHAR(64),
    mc_version         VARCHAR(32),
    loader             VARCHAR(32),
    loader_version     VARCHAR(48),
    current_revision   INTEGER NOT NULL DEFAULT 0,
    origin_platform    VARCHAR(20),
    cross_platform     BOOLEAN NOT NULL DEFAULT TRUE,
    sync_worlds        BOOLEAN NOT NULL DEFAULT FALSE,
    sync_screenshots   BOOLEAN NOT NULL DEFAULT FALSE,
    logical_bytes      BIGINT  NOT NULL DEFAULT 0,
    status             VARCHAR(16) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','trashed')),
    last_touched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Commit ODER Pull ODER Session
    last_pulled_at     TIMESTAMPTZ,
    expiry_warned_at   TIMESTAMPTZ,
    trashed_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, instance_uuid)
);

-- Eine unveränderliche Momentaufnahme einer Instanz
CREATE TABLE IF NOT EXISTS cloud_revisions (
    id              INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    instance_id     INTEGER NOT NULL REFERENCES cloud_instances(id) ON DELETE CASCADE,
    revision        INTEGER NOT NULL,
    parent_revision INTEGER,
    manifest_blob   CHAR(64) NOT NULL,     -- das Manifest liegt selbst im CAS
    device_id       INTEGER REFERENCES client_devices(id) ON DELETE SET NULL,
    entry_count     INTEGER NOT NULL DEFAULT 0,
    logical_bytes   BIGINT  NOT NULL DEFAULT 0,
    has_worlds      BOOLEAN NOT NULL DEFAULT FALSE,
    label           VARCHAR(120),          -- optional, vom User benannt
    keep_until      TIMESTAMPTZ,           -- NULL = Retention-Policy entscheidet
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (instance_id, revision)
);

-- Globaler, deduplizierter Blob-Speicher
CREATE TABLE IF NOT EXISTS blobs (
    hash                CHAR(64) PRIMARY KEY,   -- sha256, hex lowercase
    size                BIGINT NOT NULL,        -- Originalgröße
    stored_size         BIGINT NOT NULL,        -- nach Kompression
    compression         VARCHAR(8) NOT NULL DEFAULT 'none', -- none | zstd
    storage_key         VARCHAR(160) NOT NULL,
    is_chunk_list       BOOLEAN NOT NULL DEFAULT FALSE,
    refcount            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_referenced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Welche Revision referenziert welchen Blob (Quelle der Wahrheit für refcount)
CREATE TABLE IF NOT EXISTS blob_refs (
    revision_id INTEGER NOT NULL REFERENCES cloud_revisions(id) ON DELETE CASCADE,
    blob_hash   CHAR(64) NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
    PRIMARY KEY (revision_id, blob_hash)
);
-- ACHTUNG: INSERT hier braucht 'RETURNING blob_hash' oder pool.raw (kein id-Feld)

-- Blobs ohne Referenz, kandidieren zur Löschung
CREATE TABLE IF NOT EXISTS blob_gc_queue (
    blob_hash   CHAR(64) PRIMARY KEY,
    eligible_at TIMESTAMPTZ NOT NULL,        -- frühestens jetzt+24h löschen
    attempts    INTEGER NOT NULL DEFAULT 0
);

-- Playtime als G-Counter: ein absoluter Zähler pro Gerät
CREATE TABLE IF NOT EXISTS cloud_instance_playtime (
    instance_id     INTEGER NOT NULL REFERENCES cloud_instances(id) ON DELETE CASCADE,
    device_id       INTEGER NOT NULL REFERENCES client_devices(id) ON DELETE CASCADE,
    total_ms        BIGINT NOT NULL DEFAULT 0,
    last_session_id VARCHAR(32),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (instance_id, device_id)
);
-- ACHTUNG: kein id-Feld -> INSERT über pool.raw oder mit explizitem RETURNING

-- Laufende Spielsitzungen (Advisory Lock + Crash-Recovery)
CREATE TABLE IF NOT EXISTS cloud_sessions (
    id                INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    instance_id       INTEGER NOT NULL REFERENCES cloud_instances(id) ON DELETE CASCADE,
    device_id         INTEGER NOT NULL REFERENCES client_devices(id) ON DELETE CASCADE,
    session_uuid      VARCHAR(32) UNIQUE NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cloud_instances_user       ON cloud_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_instances_expiry     ON cloud_instances(status, last_touched_at);
CREATE INDEX IF NOT EXISTS idx_cloud_revisions_instance   ON cloud_revisions(instance_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_blob_refs_hash             ON blob_refs(blob_hash);
CREATE INDEX IF NOT EXISTS idx_blobs_refcount             ON blobs(refcount) WHERE refcount = 0;
CREATE INDEX IF NOT EXISTS idx_client_devices_user        ON client_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sessions_active      ON cloud_sessions(instance_id) WHERE ended_at IS NULL;
```

## B.2 Das Manifest (Kern-Datenstruktur)

Ein Manifest beschreibt **eine Revision einer Instanz vollständig**. Es liegt selbst
als Blob im CAS (typisch 20–200 KB, zstd-komprimiert wenige KB).

```jsonc
{
  "manifestVersion": 1,
  "instanceId": "8f14e45f-ea8f-4a1b-9c3d-1234567890ab",
  "name": "Skyblock",
  "revision": 12,
  "parentRevision": 11,
  "createdAt": 1756582980000,
  "device": { "uuid": "…", "platform": "win32", "appVersion": "1.11.0" },

  "runtime": {
    "mcVersion": "1.21.11",
    "loader": "fabric",
    "loaderVersion": "0.19.3",
    "versionId": "fabric-loader-0.19.3-1.21.11"
  },

  "settings": {                       // aus instance.json, plattformneutrale Teilmenge
    "memory": 4096,
    "jvmArgs": "-XX:+UseG1GC",
    "syncWorlds": false,
    "syncScreenshots": false,
    "crossPlatform": true
  },

  "icon": { "blob": "3b7f…" },        // ausgelagert, NICHT mehr base64 inline

  "playtime": { "totalMs": 151200000 }, // nur informativ; Wahrheit liegt in der DB

  "entries": [
    // 1) Referenz — wird NIE hochgeladen, Ziel-PC lädt vom Modrinth-CDN
    { "path": "mods/sodium-fabric-0.6.13.jar", "size": 1048576, "mtime": 1756500000000,
      "sha256": "9ab3…",
      "source": { "type": "modrinth", "projectId": "AANobbMI",
                  "versionId": "abcd1234", "sha1": "aa11…" } },

    // 2) Eigener Blob — kleine Datei, zstd-komprimiert
    { "path": "config/sodium-options.json", "size": 4096, "mtime": 1756582000000,
      "sha256": "1c2d…", "blob": "1c2d…" },

    // 3) Gechunkte große Datei (nur in saves/, nur bei syncWorlds)
    { "path": "saves/Skyblock/region/r.0.0.mca", "size": 8388608, "mtime": 1756582900000,
      "sha256": "77ee…",
      "chunks": { "algo": "fastcdc-1M", "list": "f0a1…" } }  // Blob mit der Chunk-Liste
  ],

  "excluded": { "reason:size": 2, "reason:policy": 4831 }  // nur für UI/Diagnose
}
```

Regeln:
- `path` ist **immer** POSIX (`/`), relativ zum Instanzstamm, ohne führenden Slash,
  ohne `..`. Server **und** Client validieren unabhängig voneinander.
- `sha256` ist die Identität der *Datei*. `blob` ist der Schlüssel im CAS. Bei
  unkomprimierten Dateien sind beide gleich; bei gechunkten Dateien gibt es kein `blob`.
- Jeder Eintrag hat **entweder** `source` (Referenz) **oder** `blob` **oder** `chunks`.
- Ein Manifest ist unveränderlich. Änderungen erzeugen eine neue Revision.

## B.3 Sync-Policy — was wird synchronisiert

Diese Tabelle ist die einzige Wahrheit. Implementierung als geordnete Regelliste
in **`MCLC-Client/backend/luxcloud/syncPolicy.js`** (gleiche Datei später auch
serverseitig zur Validierung spiegeln).

| Kategorie | Muster | Default | Begründung |
|---|---|---|---|
| Instanz-Metadaten | `instance.json` (normalisiert, ohne Icon), `icon.*` | **immer** | winzig, identitätsbildend |
| Mods | `mods/**` (`.jar`, `.jar.disabled`, `.litemod`) | ✅ Referenz bevorzugt | Kern der Instanz |
| Configs | `config/**`, `options.txt`, `optionsof.txt`, `*.properties`, root-`*.json` | ✅ | klein, hoher Nutzwert |
| Resourcepacks | `resourcepacks/**` | ✅ Referenz bevorzugt | |
| Shaderpacks | `shaderpacks/**` | ✅ Referenz bevorzugt | |
| Serverliste | `servers.dat` | ✅ | ~180 KB, hoher Nutzwert |
| Mod-Userdaten | `schematics/**`, `xaero/**`, `XaeroWaypoints*/**`, `essential/**`, `meteor-client/**`, `data/**` | ✅ | klein, sonst schmerzhafter Verlust |
| Welten | `saves/**` | ⬜ **Opt-in** | GB-groß; bei An → Chunking |
| Screenshots | `screenshots/**` | ⬜ Opt-in | |
| **Nie** | `versions/**`, `libraries/**`, `natives/**`, `assets/**`, `.fabric/**`, `cache/**`, `downloads/**`, `logs/**`, `crash-reports/**`, `debug/**`, `backups/**`, `*.log`, `usercache.json`, `*_old`, `session.lock`, `*.tmp`, `.lux-sync/**`, `.DS_Store`, `Thumbs.db` | ❌ | reproduzierbar, gerätelokal oder Müll |

Zusätzliche Hardlimits:
- Einzeldatei > **200 MB** → übersprungen, im UI als Warnung gelistet.
- Instanz-Manifest > 50.000 Einträge → abgelehnt (Schutz vor pathologischen Ordnern).
- Datei ändert sich während des Hashens (mtime/size weicht ab) → einmal neu hashen,
  dann überspringen.

---

# C. API

Basis: `https://lux.pluginhub.de`.
Neue Express-Router in **`MCLC-Website/routes/cloud.js`**, `routes/deviceAuth.js`,
`routes/adminCloud.js` — nicht in die 1700-Zeilen-`server.js` schreiben, dort nur
`app.use()` ergänzen.

Auth-Modi:
- **`bearer`** — neuer Middleware `ensureDeviceAuth` (JWT im `Authorization`-Header).
- **`session`** — bestehendes `ensureAuthenticated` (Cookie, Website).
- **`admin`** — bestehendes `ensureAdmin`.

## C.1 Geräte-Authentifizierung (PKCE)

| # | Methode | Endpoint | Auth | Zweck |
|---|---|---|---|---|
| 1 | `GET` | `/auth/device` | session (erzwingt Google-Login) | Zustimmungsseite „Lux Client autorisieren?" |
| 2 | `POST` | `/auth/device/approve` | session | Erzeugt einmaligen `code`, redirect auf `luxclient://auth` |
| 3 | `POST` | `/api/auth/device/token` | keine | `code` + `code_verifier` → Tokenpaar |
| 4 | `POST` | `/api/auth/device/refresh` | keine | rotierender Refresh |
| 5 | `POST` | `/api/auth/device/revoke` | bearer | Dieses Gerät abmelden |
| 6 | `GET` | `/api/cloud/devices` | bearer \| session | Geräteliste |
| 7 | `DELETE` | `/api/cloud/devices/:uuid` | bearer \| session | Anderes Gerät abmelden |

**(1)/(2) Ablauf.** Der Client öffnet im **Systembrowser**:
```
GET /auth/device?code_challenge=<S256>&state=<rand>&device_name=DESKTOP-ABC&platform=win32
```
Ist der User nicht eingeloggt, greift der bestehende `returnTo`-Mechanismus und leitet
nach dem Google-Login zurück. Die Seite zeigt Gerätename + Rechte und einen Bestätigen-
Button. `POST /auth/device/approve` legt einen `authorization_code` an
(30 s gültig, einmalig, in-memory/Redis oder Tabelle) und antwortet mit einem Redirect
auf `luxclient://auth?code=…&state=…`.

**(3) Token-Tausch** — `POST /api/auth/device/token`
```jsonc
// Request
{ "code": "…", "code_verifier": "…", "device_uuid": "…",
  "device_name": "DESKTOP-ABC", "platform": "win32", "app_version": "1.11.0" }
// 200
{ "accessToken": "<JWT, 1h>", "refreshToken": "<opak, 90d>", "expiresIn": 3600,
  "user": { "id": 42, "username": "beatv", "avatar": "https://…" } }
// 400 invalid_grant | 429 rate limited
```
Access-Token = JWT, `HS256`, Secret aus `LUXCLOUD_JWT_SECRET`,
Claims `{ sub: user_id, dev: device_uuid, gen: token_generation, iat, exp }`.
Refresh-Token = 32 Zufallsbytes base64url; gespeichert wird nur `sha256` in
`client_devices.refresh_token_hash`.

**(4) Refresh** — rotiert **immer**. Kommt ein bereits verbrauchter Refresh-Token an
(Hash passt nicht mehr, `gen` ist kleiner), gilt das als Diebstahl:
`token_generation++`, alle Tokens dieses Geräts sterben, `notifications`-Eintrag
für den User. Das ist die Standard-Reuse-Detection und der Grund, warum
`token_generation` existiert.

## C.2 Konto und Kontingent

| Methode | Endpoint | Auth | Zweck |
|---|---|---|---|
| `GET` | `/api/cloud/me` | bearer | User + Settings + Quota + Gerätezahl |
| `PATCH` | `/api/cloud/me/settings` | bearer \| session | globale Toggles |
| `DELETE` | `/api/cloud/me` | bearer | Cloud-Daten löschen (Account bleibt) |

```jsonc
// GET /api/cloud/me → 200
{ "user": { "id": 42, "username": "beatv", "avatar": "…" },
  "settings": { "cloudSyncEnabled": true, "autoSync": true,
                "crossPlatformDefault": true, "syncWorldsDefault": false,
                "syncScreenshotsDefault": false },
  "quota": { "usedBytes": 2576980377, "quotaBytes": 5368709120,
             "instanceCount": 4, "maxInstances": 10 },
  "serverTime": 1756582980000 }
```

## C.3 Instanzen

| Methode | Endpoint | Auth | Zweck |
|---|---|---|---|
| `GET` | `/api/cloud/instances` | bearer | Alle Cloud-Instanzen des Users |
| `GET` | `/api/cloud/instances/:uuid/head` | bearer | **Der Pre-Launch-Check.** Ultraleicht. |
| `GET` | `/api/cloud/instances/:uuid/manifest?revision=latest` | bearer | Manifest holen |
| `POST` | `/api/cloud/instances` | bearer | Cloud-Instanz anlegen (prüft 10er-Limit) |
| `PATCH` | `/api/cloud/instances/:uuid` | bearer | Name / crossPlatform / syncWorlds / syncScreenshots |
| `DELETE` | `/api/cloud/instances/:uuid` | bearer | Soft-Delete (Papierkorb, 30 Tage) |
| `POST` | `/api/cloud/instances/:uuid/restore` | bearer | Aus Papierkorb holen |
| `GET` | `/api/cloud/instances/:uuid/revisions` | bearer | Versionsliste |
| `POST` | `/api/cloud/instances/:uuid/revisions/:rev/rollback` | bearer | Alte Revision als neue Revision setzen |

```jsonc
// GET /api/cloud/instances/:uuid/head → 200   (Ziel: < 20 ms, < 300 Bytes)
{ "revision": 12,
  "manifestHash": "5d41…",
  "updatedAt": 1756582980000,
  "playtimeTotalMs": 151200000,
  "activeSession": { "deviceUuid": "…", "deviceName": "LAPTOP-XY",
                     "startedAt": 1756582000000 },   // oder null
  "expiresAt": 1757878980000 }
```
Dieser eine Endpunkt trägt die vom Auftraggeber gewünschte Pre-Launch-Prüfung
(`00-PROMPT.md §7`). Er darf **niemals** teuer werden — nur ein Index-Lookup.

## C.4 Sync

| Methode | Endpoint | Auth | Zweck |
|---|---|---|---|
| `POST` | `/api/cloud/instances/:uuid/negotiate` | bearer | Welche Blobs fehlen? |
| `PUT` | `/api/cloud/blobs/:hash` | bearer | Einen Blob hochladen (resumable) |
| `POST` | `/api/cloud/blobs/batch` | bearer | Viele kleine Blobs in einem Request |
| `POST` | `/api/cloud/instances/:uuid/commit` | bearer | Neue Revision atomar veröffentlichen |
| `GET` | `/api/cloud/blobs/:hash` | bearer | Blob herunterladen |

```jsonc
// POST /negotiate — Request
{ "blobs": [ { "hash": "1c2d…", "size": 4096 },
             { "hash": "77ee…", "size": 8388608 } ],
  "projectedBytes": 41943040 }
// 200
{ "missing": [ "77ee…" ],            // nur diese hochladen
  "known":   [ "1c2d…" ],            // global schon vorhanden -> 0 Bytes Traffic
  "quota":   { "usedBytes": …, "quotaBytes": …, "wouldExceed": false },
  "uploadToken": "<kurzlebig, bindet die Uploads an diese Instanz>" }
// 413 quota_exceeded  { "neededBytes": …, "availableBytes": … }
```

```
PUT /api/cloud/blobs/<sha256>
Headers: Authorization: Bearer …
         X-Lux-Upload-Token: …
         X-Lux-Compression: zstd | none
         Content-Range: bytes 0-1048575/8388608     (optional, resumable)
Body:    Rohbytes
→ 201 { "hash": …, "size": …, "storedSize": … }
→ 202 { "receivedBytes": … }        (Teil-Upload akzeptiert, weiter senden)
→ 400 hash_mismatch                 (Server rechnet den Hash IMMER selbst nach)
→ 409 already_exists                (harmlos, Client fährt fort)
```

```jsonc
// POST /commit — Request
{ "manifest": { … },          // vollständiges Manifest, B.2
  "parentRevision": 11,
  "sessionId": "…"            // optional
}
// 201
{ "revision": 12, "manifestHash": "5d41…",
  "quota": { "usedBytes": …, "quotaBytes": … } }
// 409 revision_conflict
{ "error": "revision_conflict", "currentRevision": 13,
  "currentManifestHash": "aa77…" }   // Client löst auf, siehe D.7
// 422 invalid_manifest  { "issues": [ { "path": "…", "reason": "…" } ] }
```
Der Commit ist **eine** DB-Transaktion:
`SELECT … FOR UPDATE` auf `cloud_instances` → `parentRevision` prüfen →
`cloud_revisions` einfügen → `blob_refs` einfügen → `blobs.refcount` erhöhen →
`current_revision`, `logical_bytes`, `last_touched_at` setzen →
`user_cloud_settings.used_bytes` neu berechnen → COMMIT.

## C.5 Playtime und Sessions

| Methode | Endpoint | Auth | Zweck |
|---|---|---|---|
| `POST` | `/api/cloud/instances/:uuid/session` | bearer | Session starten, Advisory Lock setzen |
| `POST` | `/api/cloud/sessions/:sid/heartbeat` | bearer | alle 60 s |
| `POST` | `/api/cloud/sessions/:sid/end` | bearer | Session beenden + Playtime melden |
| `PUT` | `/api/cloud/instances/:uuid/playtime` | bearer | Absoluten Gerätezähler setzen (idempotent) |

```jsonc
// PUT /playtime — Request
{ "deviceTotalMs": 75600000, "lastSessionId": "V1StGXR8_Z5jdHi6B" }
// 200
{ "deviceTotalMs": 75600000, "instanceTotalMs": 151200000,
  "byDevice": [ { "deviceName": "PC-1", "totalMs": 75600000 },
                { "deviceName": "PC-2", "totalMs": 75600000 } ] }
// 409 non_monotonic  { "storedTotalMs": 80000000 }
//     -> Server hat einen höheren Wert; Client übernimmt den Serverwert.
```
`deviceTotalMs` ist **absolut, nicht delta**. Der Server akzeptiert nur Werte
`>= gespeichert`. Damit ist jeder Retry folgenlos.

## C.6 Admin (neuer Tab im bestehenden Panel)

| Methode | Endpoint | Auth | Zweck |
|---|---|---|---|
| `GET` | `/api/admin/cloud/stats` | admin | Blobs gesamt, logische vs. physische Bytes, Dedup-Faktor, Top-User |
| `GET` | `/api/admin/cloud/users?sort=bytes` | admin | Pro User: Instanzen, Bytes, letzte Aktivität |
| `PATCH` | `/api/admin/cloud/users/:id/quota` | admin | Quota / max_instances anpassen (→ `logAdminAction`) |
| `GET` | `/api/admin/cloud/instances?userId=` | admin | Instanzen inspizieren (Metadaten, **nie Dateiinhalte**) |
| `DELETE` | `/api/admin/cloud/instances/:id` | admin | Zwangslöschung (→ `logAdminAction`) |
| `GET` | `/api/admin/cloud/gc` | admin | GC-Status, Queue-Länge, letzte Läufe |
| `POST` | `/api/admin/cloud/gc/run` | admin | GC manuell anstoßen |
| `GET` | `/api/admin/cloud/devices?userId=` | admin | Geräte eines Users, einzeln revozierbar |

Admins sehen **Metadaten**, niemals Dateiinhalte. Jede schreibende Admin-Aktion geht
durch das bestehende `logAdminAction()`.

## C.7 Fehlerformat (einheitlich)
```jsonc
{ "error": "quota_exceeded",         // maschinenlesbarer Code
  "message": "Nicht genug Speicher", // menschenlesbar, i18n-Key clientseitig
  "details": { … },
  "retryAfter": 30 }                 // optional, Sekunden
```
Codes: `unauthorized`, `device_revoked`, `token_expired`, `forbidden`, `not_found`,
`revision_conflict`, `quota_exceeded`, `instance_limit_reached`, `hash_mismatch`,
`invalid_manifest`, `invalid_path`, `blob_too_large`, `rate_limited`,
`maintenance`, `non_monotonic`.

---

# D. Sync Engine

Neues Verzeichnis **`MCLC-Client/backend/luxcloud/`** (nichts davon in `instances.js`):

```
backend/luxcloud/
  index.js          Handler-Registrierung, IPC 'luxcloud:*'
  auth.js           PKCE, Deep-Link-Empfang, Token-Speicher (safeStorage)
  api.js            axios-Instanz mit Auto-Refresh + Retry + Offline-Erkennung
  hashCache.js      persistenter sha256-Cache pro Instanz
  manifest.js       Manifest bauen / vergleichen / validieren
  syncPolicy.js     die Tabelle aus B.3, als Code
  blobStore.js      lokaler CAS-Cache unter %APPDATA%/lux/luxcloud/blobs
  chunker.js        FastCDC für Dateien > 4 MB
  uploader.js       negotiate -> PUT/batch -> commit
  downloader.js     Restore: lokal? Cache? Modrinth? Server?
  conflict.js       3-Wege-Diff und Auflösungsstrategien
  playtime.js       G-Counter, Session-Heartbeat, Crash-Recovery
  queue.js          Offline-Queue (JSONL, idempotent)
  state.js          Geräte-ID, lastKnownRevision, lastSyncedAt je Instanz
```

## D.1 Hashing
- Algorithmus: **SHA-256**, hex lowercase. (Der Client benutzt heute SHA-1 für den
  Modrinth-Lookup — das bleibt, weil Modrinth SHA-1 erwartet. Beides parallel führen:
  SHA-1 für die Quellenauflösung, SHA-256 für die Identität im CAS.)
- Streaming über `crypto.createHash('sha256')`, nie ganze Dateien in den RAM.
- **Hash-Cache** `luxcloud/hashes/<instanceId>.json`:
  ```json
  { "mods/sodium.jar": { "size": 1048576, "mtimeMs": 1756500000000,
                         "sha256": "9ab3…", "sha1": "aa11…" } }
  ```
  Neu gehasht wird nur, wenn `size` oder `mtimeMs` abweichen. Ein voller Scan einer
  8-GB-Instanz dauert damit beim zweiten Mal Sekundenbruchteile statt Minuten.
- Das Hashen läuft in einem **`worker_threads`-Worker** (Muster existiert schon:
  `backend/workers/minecraftLaunchWorker.js`), damit der Main-Prozess nicht blockiert.

## D.2 Manifest-Erzeugung
1. `syncPolicy.js` läuft über den Instanzbaum und liefert die Kandidatenliste
   (mit Ausschlussgründen für die UI).
2. Für jede Datei: Hash aus Cache oder berechnen.
3. **Quellenauflösung** (der Kostenhebel):
   - `mods/**`, `resourcepacks/**`, `shaderpacks/**` → SHA-1 in `mod_cache.json`
     nachschlagen. Treffer mit `projectId`+`versionId` → `source: {type:"modrinth"}`,
     Datei wird **nicht** hochgeladen.
   - Kein Cache-Treffer, aber online → einmal `api.modrinth.com/v2/version_file/<sha1>`
     fragen, Ergebnis in `mod_cache.json` schreiben (nutzt dem bestehenden Feature mit).
   - Sonst → eigener Blob.
4. `instance.json` wird **normalisiert**: Icon raus (→ `icon.*` als eigener Eintrag),
   `playtime`/`lastPlayed` raus (leben in der DB), gerätelokale Felder raus
   (`folderPath`, `externalPath`, `javaPath`, `status`). Sonst erzeugt jede Spielsession
   eine Manifest-Änderung an einer 3-MB-Datei.
5. Manifest-JSON → zstd → SHA-256 → ist selbst ein Blob.

## D.3 Chunking (nur wo es sich lohnt)
Bedingung: Datei liegt unter `saves/**` **und** ist > 4 MB **und** `syncWorlds` ist an.
- **FastCDC**, Gear-Rolling-Hash, min 256 KB / avg 1 MB / max 4 MB.
- Jeder Chunk ist ein normaler Blob (sha256) → profitiert von globaler Dedup.
- Die Chunk-Liste (`["hash1","hash2",…]`, JSON) ist selbst ein Blob und wird im
  Manifest unter `chunks.list` referenziert.
- Wirkung: in einer 500-MB-Welt ändern sich pro Spielsession typisch 5–30 MB
  (die besuchten Regionen). Ohne Chunking wären es 500 MB.
- Implementierung in reinem JS (`chunker.js`), keine native Dependency — Electron-
  Rebuilds für drei Plattformen sind es nicht wert.

## D.4 Deduplizierung
Drei Ebenen, alle über denselben SHA-256:
1. **Global serverseitig** — `negotiate` fragt nur nach Existenz in `blobs`. Laden 100
   User dieselbe 200-MB-Mod hoch, wird sie **einmal** gespeichert; die 99 weiteren
   Uploads werden zu einem HTTP-Roundtrip.
2. **Lokal geräteseitig** — `luxcloud/blobs/<aa>/<hash>` ist ein Cache über *alle*
   Instanzen dieses PCs. Beim Restore von Instanz B wird eine Datei, die Instanz A
   schon hat, per Copy-on-Write/Hardlink gelegt statt geladen.
3. **Referenz-Ebene** — Modrinth-Dateien werden nirgends bei uns gespeichert.

Refcounting: Wahrheit ist die Tabelle `blob_refs`. `blobs.refcount` ist ein
denormalisierter Cache, im selben Transaktionsblock gepflegt. Ein wöchentlicher
Reconcile-Job vergleicht beide und korrigiert Abweichungen.

## D.5 Kompression
| Dateityp | Verfahren |
|---|---|
| `.json .txt .cfg .toml .properties .snbt .yaml .yml .lang .mcmeta .dat` | **zstd -3** (typisch 70–85 % Ersparnis) |
| `.jar .zip .png .jpg .ogg .mp3 .webp .mca .nbt .gz` | **keine** — bereits komprimiert, zstd kostet nur CPU |
| unbekannt | probeweise zstd auf die ersten 128 KB; < 10 % Gewinn → unkomprimiert |
| Manifeste | immer zstd |

Bibliothek: `@mongodb-js/zstd` oder `fzstd` (WASM, keine native Kompilierung — für
Electron-Builds über drei Plattformen ist das den kleinen Geschwindigkeitsverlust wert).
`compression` steht in `blobs`; der Client erfährt es über den `X-Lux-Compression`-Header.

## D.6 Upload / Download

**Upload (`uploader.js`)**
```
1. Manifest bauen                                (D.2)
2. POST /negotiate  { alle Blob-Hashes }
3. quota.wouldExceed? -> Abbruch, UI zeigt was zu groß ist
4. Fehlende Blobs hochladen:
     < 1 MB  -> gesammelt via POST /blobs/batch (max 8 MB oder 200 Stück je Request)
     >= 1 MB -> PUT /blobs/:hash mit Content-Range, 4 parallel
     Fortschritt -> IPC 'luxcloud:progress'
     Abbruch/Netzfehler -> Position merken, Queue-Op bleibt bestehen
5. POST /commit { manifest, parentRevision }
6a. 201 -> state.lastKnownRevision = revision; lokalen Blob-Cache füllen
6b. 409 -> conflict.js (D.7)
```

**Download / Restore (`downloader.js`)** — Auflösungsreihenfolge je Eintrag:
```
1. Zieldatei existiert lokal und sha256 passt      -> nichts tun         (0 Bytes)
2. Datei liegt im lokalen Blob-Cache               -> kopieren/hardlink  (0 Bytes)
3. entry.source.type == 'modrinth'                 -> Modrinth-CDN, sha1 prüfen
                                                      (0 Bytes bei uns)
4. entry.chunks                                    -> Chunk-Liste holen, nur
                                                      fehlende Chunks laden
5. sonst                                           -> GET /blobs/:hash
6. Runtime (versions/libraries/assets/natives)     -> bestehender Installer
                                                      (startBackgroundInstall)
```
Schlägt Schritt 3 fehl (Mod von Modrinth entfernt), fällt der Client auf Schritt 5
zurück — sofern wir den Blob haben. Haben wir ihn nicht (weil wir ihn nie hochgeladen
haben), wird der Eintrag als *fehlend* markiert und die UI bietet an, die Mod zu suchen
oder die Instanz ohne sie zu starten. Deshalb gilt: **Referenz-Einträge behalten
zusätzlich Größe und sha256**, damit ein späterer Upload nachrüstbar ist.

Alle Downloads gehen in `<instance>/.lux-sync/staging/` und werden erst nach
Hash-Prüfung per `rename` an ihren Platz gelegt. Ein Absturz mittendrin hinterlässt
nur Staging-Müll.

## D.7 Delta-Sync und Konfliktauflösung

**Der Pre-Launch-Gate** (die vom Auftraggeber gewünschte Mechanik, `00-PROMPT.md §7`):

```
Klick auf "Play"
  |
  +-- Instanz nicht cloud-verknüpft ---------------------> sofort starten
  +-- offline ----------------------------------> starten, Queue-Flag setzen
  |
  GET /instances/:uuid/head       (Timeout 2,5 s -> wie offline behandeln)
  |
  +-- remote.revision == local.lastKnownRevision
  |     +-- lokal sauber ------------------------------> sofort starten
  |     +-- lokal geändert -----------> im Hintergrund pushen, sofort starten
  |
  +-- remote.revision > local.lastKnownRevision
        +-- lokal sauber -------> Pull mit Fortschrittsanzeige, dann starten
        +-- lokal geändert -----> KONFLIKT -> SyncConflictModal
```
„lokal sauber" = schneller Vergleich Manifest ↔ `size`/`mtime` aller Policy-Dateien
gegen den Hash-Cache. Auf einer 8-GB-Instanz sind das ein paar tausend `stat()`-Aufrufe,
also < 200 ms — nicht das volle Hashing.

**Drei-Wege-Diff.** Basis ist das Manifest von `local.lastKnownRevision` (liegt im
lokalen Blob-Cache). Verglichen werden Basis ↔ lokal und Basis ↔ remote.

| Fall | Auflösung |
|---|---|
| Nur lokal geändert | lokal gewinnt, automatisch |
| Nur remote geändert | remote gewinnt, automatisch |
| Beide, identischer Hash | kein Konflikt |
| Beide, Config/Options (`config/**`, `options.txt`, …) | **Last-Writer-Wins pro Datei**, Verliererversion nach `.lux-sync/conflicts/rev<N>/<pfad>` — nichts geht verloren |
| Beide, Mod hinzugefügt (verschiedene Dateien) | **Union** — beide Mods bleiben |
| Eine Seite löscht, andere ändert | **Änderung gewinnt** (Löschen ist die schwächere Absicht) |
| Beide, `saves/<welt>/**` | **Nie automatisch.** Konflikteinheit ist die ganze Welt. Dialog: „Diese Version behalten" / „Cloud-Version" / „Beide behalten" (zweite wird zu `<welt> (PC-2)`) |
| Playtime | **nie ein Konflikt** — additiver G-Counter (D.9) |

Alles, was der Automatismus nicht abdeckt, landet in **einem** Dialog mit Zahlen
(„17 Dateien hier geändert, 3 in der Cloud") und drei Optionen:
**Dieses Gerät behalten** · **Cloud behalten** · **Details ansehen**.
Egal welche Option: die Verliererseite wird vorher lokal gesichert.

**Advisory Lock.** `POST /instances/:uuid/session` beim Start; Heartbeat alle 60 s;
Session gilt nach 5 min ohne Heartbeat als tot. Ein zweiter PC bekommt beim Start
„Wird gerade auf LAPTOP-XY gespielt — trotzdem starten?". Kein harter Lock, weil
das offline nicht funktionieren würde und einen abgestürzten PC sonst dauerhaft
aussperren könnte.

## D.8 Offline-Queue
`%APPDATA%/lux/luxcloud/queue.jsonl` — append-only, eine JSON-Zeile je Operation,
atomar geschrieben (tmp + `rename`).
```jsonc
{ "opId": "V1StGXR8", "type": "sync-instance", "instanceId": "8f14…",
  "createdAt": 1756582980000, "attempts": 0, "nextAttemptAt": 0 }
{ "opId": "kL9m2Xq1", "type": "playtime", "instanceId": "8f14…",
  "deviceTotalMs": 75600000, "sessionId": "…" }
```
- Jede Op hat eine `opId` und ist **idempotent** (Playtime: absoluter Wert;
  Sync: der Zustand wird beim Ausführen ohnehin neu ermittelt).
- Mehrere `sync-instance`-Ops derselben Instanz kollabieren zu einer.
- Backoff: 5 s, 15 s, 1 min, 5 min, 15 min, 1 h (gedeckelt).
- Trigger zum Abarbeiten: App-Start, `online`-Event, alle 5 min, nach Spielende,
  manuell über „Jetzt synchronisieren".
- Kompaktierung: Datei wird neu geschrieben, sobald > 500 erledigte Zeilen.
- Kein SQLite — eine JSONL-Datei plus atomarem Rename ist für dieses Volumen robust
  genug und spart eine native Dependency.

## D.9 Playtime im Detail
```
Session-Start:
  sessionId = nanoid()
  luxcloud/sessions/<sessionId>.json = { instanceId, startedAt, lastHeartbeat }
  POST /instances/:uuid/session       (nur wenn online)

alle 60 s (solange der MC-Prozess lebt):
  lastHeartbeat = Date.now(); Datei schreiben
  POST /sessions/:sid/heartbeat       (nur wenn online)

Session-Ende (regulär, in launcher.js beim Prozess-Exit):
  dauer = Date.now() - startedAt
  deviceTotalMs += dauer            (in state.json, pro Instanz)
  instance.json.playtime += dauer   (bestehendes Verhalten bleibt!)
  PUT /instances/:uuid/playtime { deviceTotalMs, lastSessionId }
  Sessiondatei löschen

Session-Ende (Absturz/Stromausfall — beim nächsten App-Start erkannt):
  verwaiste Sessiondatei gefunden
  dauer = lastHeartbeat - startedAt   <-- nicht Date.now(), sonst zählt die
                                          Ausschaltzeit als Spielzeit
  weiter wie oben
```
Das behebt gleichzeitig einen **bestehenden Bug**: heute (`launcher.js:2296`) geht bei
einem Absturz die gesamte Session verloren, weil Playtime nur im `close`-Handler
gebucht wird.

Warum das nicht doppelt zählen kann: der Server speichert pro `(instance, device)`
einen absoluten Wert und akzeptiert nur monoton wachsende Werte. Zwei parallel
laufende Clients sind zwangsläufig zwei verschiedene `device_uuid`s und schreiben
in verschiedene Zeilen. Ein Retry schreibt denselben Wert nochmal — folgenlos.

## D.10 Zustand auf dem Client
`%APPDATA%/lux/luxcloud/state.json`
```jsonc
{ "deviceUuid": "…", "deviceName": "DESKTOP-ABC",
  "user": { "id": 42, "username": "beatv" },
  "instances": {
    "8f14e45f-…": { "cloudLinked": true, "lastKnownRevision": 12,
                    "lastManifestHash": "5d41…", "lastSyncedAt": 1756582980000,
                    "deviceTotalMs": 75600000, "dirty": false,
                    "syncWorlds": false, "crossPlatform": true }
  } }
```
Tokens liegen **nicht** hier, sondern in `electron-store` unter
`luxcloud.tokens`, verschlüsselt über die bestehende `secureProfileStore`-Mechanik
(`safeStorage`).

---

# E. Storage

## E.1 Backend-Wahl
**Cloudflare R2** (S3-kompatibel). Begründung: Dieses Feature ist download-lastig
(jeder neue PC lädt eine ganze Instanz), und R2 berechnet **keinen Egress**. Bei S3
oder Hetzner Object Storage wäre der Egress der dominante Kostenblock, nicht der
Speicher.
Zweitwahl: Backblaze B2 (Egress frei via Bandwidth Alliance/Cloudflare).

Abstraktion in **`MCLC-Website/storage/index.js`** mit zwei Treibern:
- `s3.js` (`@aws-sdk/client-s3`, funktioniert gegen R2/B2/MinIO/S3)
- `fs.js` (lokales Verzeichnis unter `DATA_DIR/blobs`) — für Entwicklung und
  Self-Hosting ohne Cloud-Account

Interface: `put(key, stream, meta)`, `get(key, range?)`, `head(key)`, `delete(keys[])`,
`presignGet(key, ttl)`.

## E.2 Schlüssel-Layout
```
blobs/<hash[0:2]>/<hash[2:4]>/<hash>          # 65 536 Präfixe, gleichmäßig verteilt
manifests/<hash[0:2]>/<hash[2:4]>/<hash>      # nur logische Trennung, gleiche Regeln
```
Kein User-Präfix — Blobs sind global geteilt. Die Zugriffskontrolle sitzt
ausschließlich in der Datenbank (siehe F.4). Der Bucket ist **privat**, niemals
öffentlich lesbar.

## E.3 Kostenrechnung
Grobkalkulation für 100.000 aktive User, je 3 Cloud-Instanzen:

| Schritt | Nominal | Effekt |
|---|---|---|
| Naiv „Instanz = ZIP", ⌀ 4 GB | 1.200 TB | — |
| Runtime ausgeschlossen (`versions`, `libraries`, `assets`) | ~150 TB | −87 % |
| Welten standardmäßig aus | ~45 TB | −70 % |
| Mods/Packs als Modrinth-Referenz (⌀ ~85 % auflösbar) | ~9 TB | −80 % |
| Globale Datei-Dedup über alle User | ~3 TB | −65 % |
| zstd auf Text/Config | ~2,4 TB | −20 % |

**~2–4 TB physisch** statt 1.200 TB. Bei R2 (~$0,015/GB/Monat) sind das
**$30–60/Monat** statt ~$18.000. Das ist der Unterschied zwischen „geht" und
„geht nicht" — und der Grund, warum die Referenz-Strategie aus A.2 nicht optional ist.

Die Quota von 5 GB/User ist **logisch** gerechnet (Summe der Dateigrößen, die dem
User zugerechnet werden), nicht physisch. Ein User, dessen Dateien alle schon
existieren, verbraucht real 0 Bytes, sieht im UI aber trotzdem seinen Verbrauch.
Das ist verständlich für den User und für uns günstig — die richtige Richtung, um
sich zu irren.

## E.4 Garbage Collection
```
commit:            blob_refs einfügen, refcount++
Revision gelöscht: blob_refs löschen (CASCADE), refcount--
refcount == 0:     -> blob_gc_queue (eligible_at = now + 24 h)

GC-Job (stündlich):
  SELECT blob_hash FROM blob_gc_queue WHERE eligible_at < NOW() LIMIT 1000
  für jeden: refcount ERNEUT prüfen (könnte zwischenzeitlich neu referenziert sein)
     > 0  -> aus der Queue entfernen
     == 0 -> aus dem Objektspeicher löschen, Zeile in blobs löschen
```
Die 24-Stunden-Karenz verhindert die Race Condition „Blob wird gelöscht, während
gerade ein anderer Upload ihn per `negotiate` als vorhanden gemeldet bekommen hat".

Wöchentlicher **Reconcile-Job**: `blobs.refcount` gegen `COUNT(*) FROM blob_refs`
prüfen und korrigieren; Objekte im Bucket ohne DB-Zeile älter als 7 Tage löschen
(Reste abgebrochener Uploads).

## E.5 Retention / Versionierung
Manifeste sind billig (KB), die Blobs sind teuer. Deshalb zwei getrennte Policies:

**Manifeste / Revisionen**
- alle Revisionen der letzten **7 Tage**
- danach eine pro Tag für **30 Tage**
- danach eine pro Monat für **3 Monate**
- Obergrenze **20 behaltene Revisionen** pro Instanz
- vom User als „behalten" markierte Revisionen (`keep_until`) sind ausgenommen (max 3)

**Welt-Daten (`saves/**`)**
Nur die **letzten 3 Revisionen** behalten ihre Welt-Blobs. Ältere Revisionen werden
zu „Metadaten-Snapshots" degradiert (`has_worlds = false`), ihre Welt-`blob_refs`
werden gelöscht. Ohne diese Regel frisst ein einziger User mit einer 2-GB-Welt und
täglichem Spielen die gesamte Ersparnis wieder auf.

**Papierkorb**
`DELETE /instances/:uuid` setzt `status='trashed'`, `trashed_at=NOW()`.
Nach 30 Tagen Hard-Delete. Im Papierkorb zählt die Instanz **nicht** gegen das
10-Instanzen-Limit, aber weiterhin gegen die Speicher-Quota (sonst wäre der
Papierkorb ein Gratis-Speicher).

## E.6 Die 15-Tage-Regel
Vorgabe aus `00-PROMPT.md §21`.

`cloud_instances.last_touched_at` wird aktualisiert bei: Commit, Manifest-Pull,
Session-Start, `head`-Abfrage im Rahmen eines Starts, manuellem Sync.

Täglicher Job:
| Tag | Aktion |
|---|---|
| 8 | Notification im Client + Website: „Skyblock wird in 7 Tagen aus der Cloud gelöscht" |
| 12 | Zweite Notification **+ E-Mail** (`email.js` erweitern) |
| 15 | Soft-Delete → Papierkorb (30 Tage wiederherstellbar), Notification „gelöscht, 30 Tage wiederherstellbar" |
| 45 | Hard-Delete, Blobs → GC |

> **Empfehlung, bitte bestätigen:** Der Auftrag sagt „wenn sie für 15 Tage nicht
> angefasst wird **von einem anderen PC** der sie runterzieht". Wörtlich umgesetzt
> würde das einem User mit nur einem PC nach 15 Tagen seine Instanz löschen, obwohl
> er sie täglich spielt — das wäre Datenverlust ohne Nutzen. Geplant ist deshalb:
> **jede** Aktivität (auch vom selben PC) setzt den Timer zurück. Die
> Speicherersparnis ist praktisch identisch, weil wirklich verwaiste Instanzen
> ohnehin von keinem PC mehr berührt werden. Der Schwellwert liegt als
> `LUXCLOUD_EXPIRY_DAYS` in der Konfiguration.

---

# F. Security

## F.1 Bedrohungsmodell
| # | Bedrohung | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| T1 | Fremde Instanzdaten lesen | schwer | Jede Query filtert `user_id`; Blob-Zugriff nur nach DB-Nachweis (F.4) |
| T2 | Gestohlener Refresh-Token | schwer | Rotation + Reuse-Detection + `token_generation`; Gerät einzeln revozierbar |
| T3 | Path Traversal über Manifest-Pfade (`../../.ssh/…`) | schwer | Doppelte Validierung Server **und** Client (F.5) |
| T4 | Bösartiges Manifest referenziert fremden Blob-Hash | mittel | Hash muss dem User gehören oder von ihm hochgeladen worden sein (F.4) |
| T5 | Speicher-Flooding / Quota-Umgehung | mittel | Quota vor **und** im Commit geprüft; Upload-Token bindet an Instanz |
| T6 | Malware-`.jar` in der Cloud | mittel | Nie öffentlich, nie ausgeführt, `Content-Disposition: attachment`, `nosniff`; optionaler ClamAV-Scan |
| T7 | Hash-Kollision untergeschoben | gering | SHA-256; Server rechnet jeden Upload-Hash nach |
| T8 | Playtime-Manipulation | gering | Monotonie-Prüfung; Plausibilitätsgrenze 24 h/Tag/Gerät |
| T9 | Kompromittierter Server liefert bösartige Pfade | mittel | Client validiert Pfade nochmal und schreibt nur unterhalb des Instanzordners |
| T10 | DoS über teure Endpunkte | mittel | Rate Limits (F.6), `head` ist O(1) |
| T11 | Deep-Link-Hijacking (`luxclient://auth?code=…`) | mittel | PKCE — der Code ist ohne den lokalen `code_verifier` wertlos; `state`-Prüfung |
| T12 | Confirmation-of-a-File über Dedup | gering | `negotiate` nur mit gültigem Token, rate-limited; akzeptierte Restrisiko-Abwägung |

## F.2 Authentifizierung
- Systembrowser + OAuth-Zustimmungsseite + **PKCE S256**. Nie ein eingebettetes
  WebView für Google (verstößt gegen Googles Richtlinien und ist phishing-anfällig).
- Access-Token: JWT, 1 h, `HS256`, Secret `LUXCLOUD_JWT_SECRET` (min. 32 Bytes).
- Refresh-Token: 32 Zufallsbytes, 90 Tage, **rotierend**; gespeichert wird nur
  `sha256`. Wiederverwendung eines alten Tokens ⇒ ganze Gerätekette invalidieren
  + Notification an den User.
- Speicherung im Client über `safeStorage` (bestehende `secureProfileStore`-Mechanik) —
  auf Windows DPAPI-gebunden an den Windows-User, nicht im Klartext auf der Platte.
- **Kein Cookie für die Cloud-API** ⇒ CSRF ist strukturell ausgeschlossen.
- Gebannte User (`users.banned`) werden bei jeder Token-Ausgabe und jedem Refresh
  geprüft, nicht nur beim Login.

## F.3 Autorisierung
Ein Helper, konsequent benutzt:
```js
// routes/cloud.js
async function ownedInstance(userId, instanceUuid) {
  const [rows] = await pool.query(
    'SELECT * FROM cloud_instances WHERE user_id = ? AND instance_uuid = ? AND status = ?',
    [userId, instanceUuid, 'active']
  );
  if (!rows.length) throw httpError(404, 'not_found'); // 404, nicht 403 — verrät nichts
  return rows[0];
}
```
Existenz fremder Ressourcen wird nie durch unterschiedliche Statuscodes verraten.

## F.4 Blob-Zugriff
Der kritischste Punkt, weil Blobs global geteilt sind.
```
GET /api/cloud/blobs/:hash
  1. Bearer-Token gültig?
  2. Ist :hash in blob_refs einer Revision einer Instanz DIESES Users?
       SELECT 1 FROM blob_refs br
         JOIN cloud_revisions r ON r.id = br.revision_id
         JOIN cloud_instances i ON i.id = r.instance_id
        WHERE br.blob_hash = ? AND i.user_id = ? LIMIT 1
     Nein -> 404
  3. Presigned URL (TTL 5 min) oder Proxy-Stream
```
Ohne Schritt 2 wäre der Blob-Hash eine Capability — „wer den Hash kennt, liest die
Datei". Bei SHA-256 praktisch nicht erratbar, aber Hashes können durchaus bekannt
werden (öffentliche Mods!), und dann würde man erfahren, *dass* jemand sie hat.
Der Check kostet einen Index-Lookup. Er wird gemacht.

Dasselbe gilt für den Commit: jeder im Manifest referenzierte `blob`-Hash muss
entweder in diesem `negotiate`/Upload-Zyklus vom User gesendet worden sein oder
bereits in einer seiner eigenen Revisionen vorkommen. Sonst könnte man sich durch
Raten fremde Dateien in die eigene Instanz „legen" und herunterladen.

## F.5 Pfad-Validierung
Serverseitig beim Commit **und** clientseitig beim Restore, unabhängig:
```js
const SEGMENT_OK = /^[^\x00-\x1f<>:"|?*\\/]{1,120}$/;
const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

function validRelPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 400) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;                 // C:\…
  const segs = p.split('/');
  if (segs.length > 24) return false;
  return segs.every(s =>
    s !== '' && s !== '.' && s !== '..' &&
    SEGMENT_OK.test(s) && !WIN_RESERVED.test(s) &&
    !s.endsWith('.') && !s.endsWith(' ')                  // Windows-Fallen
  );
}
```
Clientseitig zusätzlich nach dem Zusammensetzen:
`path.resolve(instanceDir, rel).startsWith(instanceDir + path.sep)` — der einzige
Check, der auch Symlink-Tricks und Unicode-Normalisierung überlebt. Und: beim
Entpacken niemals in bestehende Symlinks schreiben.

## F.6 Rate Limits
`express-rate-limit` (im Client-Repo bereits vorhanden, im Website-Repo neu):

| Endpunkt | Limit |
|---|---|
| `POST /api/auth/device/token` | 10 / 15 min / IP |
| `POST /api/auth/device/refresh` | 60 / h / Gerät |
| `POST /…/negotiate` | 60 / h / Gerät |
| `PUT /api/cloud/blobs/:hash` | 2.000 / h / Gerät |
| `POST /…/commit` | 120 / h / Gerät |
| `GET /…/head` | 600 / h / Gerät (bewusst großzügig, wird bei jedem Start gerufen) |
| `PUT /…/playtime` | 120 / h / Gerät |

Zusätzlich: max. 20 registrierte Geräte pro User; max. 4 parallele Uploads je Gerät.

## F.7 Upload-Validierung
- Server rechnet den SHA-256 **immer** nach. Abweichung → 400, Daten verworfen.
- Einzelblob max. 200 MB, Batch max. 8 MB.
- `Content-Length` erforderlich; Streams mit Hard-Limit abgeschnitten.
- Manifest: JSON-Schema-Validierung, `entries` max. 50.000, Pfade eindeutig,
  jeder Eintrag genau eine Quelle (`blob` XOR `source` XOR `chunks`).

## F.8 Löschung
**Cloud-Daten löschen** (`DELETE /api/cloud/me`): alle `cloud_instances` des Users
hart löschen, `blob_refs` cascaded, refcounts dekrementiert, verwaiste Blobs in die
GC-Queue, `used_bytes = 0`.

**Account löschen** — das bestehende `DELETE /api/user/delete` in `server.js:1088`
wird erweitert: **vor** dem `DELETE FROM users` die Cloud-Aufräumung ausführen
(sonst räumt CASCADE die `blob_refs` weg, ohne die refcounts zu korrigieren, und
die Blobs bleiben für immer liegen). Ablauf in einer Transaktion:
```
1. cloud_revisions des Users sammeln
2. refcount-- für alle blob_refs dieser Revisionen
3. cloud_instances löschen (CASCADE räumt revisions, blob_refs, playtime, sessions)
4. client_devices löschen (alle Tokens tot)
5. blobs mit refcount 0 -> blob_gc_queue
6. dann erst: bestehendes DELETE FROM users
```
Die Blobs selbst verschwinden mit dem nächsten GC-Lauf (spätestens 24 h). Das ist für
DSGVO-Zwecke ausreichend und muss in der Datenschutzerklärung stehen.

## F.9 Verschlüsselung und Backups
- Transit: TLS 1.2+, HSTS (die Website läuft bereits hinter einem Proxy,
  `trust proxy` ist gesetzt).
- At rest: bucket-seitige Verschlüsselung (SSE), Postgres-Verschlüsselung nach
  Hoster-Möglichkeit.
- **Keine E2E-Verschlüsselung** — siehe A.3.
- Backups: Postgres täglich (Metadaten sind klein, aber ohne sie sind die Blobs
  wertlos → die DB ist das kritischere Backup-Ziel). Objektspeicher mit
  Versionierung + Lifecycle statt Vollbackup.
- Die 24-h-GC-Karenz ist implizit ein Schutz gegen fehlerhafte Löschungen.

---

# G. UI / UX

## G.1 Zustände (die fünf aus `00-PROMPT.md §14`)
| Zustand | Anzeige | Bedeutung |
|---|---|---|
| `local` | grau, Wolke durchgestrichen | nicht mit der Cloud verknüpft |
| `synced` | grün ✓ | lokal = Cloud |
| `syncing` | blau, Spinner + % | Übertragung läuft |
| `pending` | gelb ↑ | lokale Änderungen warten (offline oder Auto-Sync aus) |
| `conflict` | rot ⚠ | Eingriff nötig |
| `offline` | grau ⚠ | keine Verbindung, letzter Stand vom … |
| `cloud-only` | Karte in Outline | in der Cloud, hier nicht installiert |

Eine gemeinsame Komponente `CloudStatusBadge.tsx` — damit Dashboard, Sidebar und
Detailseite nie auseinanderlaufen.

## G.2 Neue Client-Screens

**`src/pages/Settings.tsx` → neuer Abschnitt „Lux Account"**
```
Lux Account
  [nicht angemeldet]  ->  [ Mit Lux Account anmelden ]
                          "Optional. Ohne Account funktioniert Lux vollständig."
  [angemeldet]
     Avatar  beatv                            [ Abmelden ]
     ─────────────────────────────────────────────────────
     Cloud Sync           [ON ]   Instanzen mit der Cloud abgleichen
     Auto Sync            [ON ]   nach dem Spielen automatisch hochladen
     Cross-Platform       [ON ]   Standard für neue Instanzen
     Welten synchronisieren  [OFF]  kann sehr groß werden
     Screenshots             [OFF]
     ─────────────────────────────────────────────────────
     Speicher   ▓▓▓▓▓▓▓░░░░░░  2,4 GB / 5 GB      4 / 10 Instanzen
     ─────────────────────────────────────────────────────
     Angemeldete Geräte
       • DESKTOP-ABC (Windows) — dieses Gerät
       • LAPTOP-XY  (Windows) — zuletzt vor 2 Tagen     [ Abmelden ]
     ─────────────────────────────────────────────────────
     [ Cloud-Daten löschen ]        [ Lux Account löschen ]
```

**`src/pages/Dashboard.tsx`** — Instanzkarten bekommen das Badge oben rechts.
Cloud-only-Instanzen erscheinen als Outline-Karten mit ↓-Button. Neuer Filter
„Alle / Lokal / Cloud / Nur Cloud".

**`src/pages/InstanceDetails.tsx` → neues Cloud-Panel**
```
Skyblock
  Cloud        ✓ Synchronisiert           [ Jetzt synchronisieren ]
  Letzter Sync Heute, 21:43
  Spielzeit    42 h 17 m gesamt   (dieses Gerät: 21 h 03 m)
  Version      v12  ·  4 ältere Versionen           [ Verlauf ]
  Größe        340 MB in der Cloud (davon 12 MB eigene Dateien)
  ─────────────────────────────────────────────────────────
  Cloud Sync              [ON ]
  Cross-Platform          [ON ]   auf Windows/macOS/Linux verfügbar
  Welten synchronisieren  [OFF]   ~1,8 GB
  Screenshots             [OFF]
  ─────────────────────────────────────────────────────────
  [ Aus der Cloud entfernen ]
```

**Neue Komponenten**
| Datei | Zweck |
|---|---|
| `components/cloud/CloudStatusBadge.tsx` | die 7 Zustände |
| `components/cloud/LuxAccountPanel.tsx` | Settings-Abschnitt |
| `components/cloud/CloudOnboardingModal.tsx` | Erstlogin-Auswahl (`00-PROMPT.md §4/§15`) |
| `components/cloud/SyncConflictModal.tsx` | Konfliktauflösung |
| `components/cloud/PreLaunchSyncOverlay.tsx` | „Prüfe Cloud… / Lade 12 Dateien…" vor dem Start |
| `components/cloud/CloudTransferPanel.tsx` | globaler Fortschritt, aus der TopBar aufklappbar |
| `components/cloud/RevisionHistoryModal.tsx` | Versionsliste + Wiederherstellen |
| `components/cloud/InstanceSyncScopeEditor.tsx` | Was-wird-synchronisiert je Instanz, mit Größen |
| `context/LuxAccountContext.tsx` | Account-/Sync-Zustand (Muster: `ExtensionContext`) |

**Onboarding-Ablauf (Erstlogin)**
```
Schritt 1  "Willkommen, beatv"
Schritt 2  "5 lokale Instanzen gefunden — welche in die Cloud?"
             [x] Skyblock          340 MB   (12 MB Upload)
             [x] Vanilla Survival   80 MB   ( 3 MB Upload)
             [ ] Test              1,2 GB
             [x] PvP               210 MB   ( 8 MB Upload)
             [ ] Development        45 MB
             Speicher nach Upload: 0,6 GB / 5 GB
Schritt 3  "3 Instanzen in deiner Cloud, hier nicht vorhanden — herunterladen?"
             [x] Creative Build    120 MB
             [ ] Modded 1.20       2,1 GB
Schritt 4  Fortschritt, im Hintergrund weiterlaufend
```
Wichtig: es wird die **Upload-Größe** angezeigt, nicht die Instanzgröße — sonst
erschrickt der User grundlos vor „1,2 GB", von denen 20 MB übertragen werden.

## G.3 Website
- **Dashboard** (`client/src/pages/Dashboard.jsx`): Abschnitt „Cloud" —
  Instanzliste (Name, Größe, letzter Sync, Ablaufdatum), Speicherbalken,
  Geräteliste mit Abmelden, „Cloud-Daten löschen".
- **Admin-Panel**: neuer Tab `{ id:'cloud', label:'Cloud', icon: CloudIcon, authLevel:'admin' }`
  in `TABS` (`AdminPanel.jsx:205`) + `components/admin/CloudPanel.jsx`:
  Gesamtspeicher physisch/logisch, Dedup-Faktor, Blob-Anzahl, GC-Queue,
  Top-20-User nach Verbrauch, Quota-Editor, Zwangslöschung, GC-Trigger.

## G.4 Grundregeln
- **Sync blockiert nie das Spielen.** Der Pre-Launch-Check hat 2,5 s Timeout und
  fällt bei Zweifel auf „starten" zurück.
- **Jeder Konflikt ist verlustfrei.** Vor jeder Auflösung wird die Verliererseite
  lokal gesichert.
- **Nichts läuft ungefragt.** Der erste Upload einer Instanz braucht immer eine
  ausdrückliche Zustimmung.
- **Ohne Account keine Cloud-UI.** Wer sich nicht anmeldet, sieht kein einziges
  Cloud-Element außer dem Login-Angebot in den Einstellungen.

---

# H. Migration

## H.1 Client-seitig (einmalig, beim Update auf die neue Version)
1. **Instanz-IDs vergeben** — beim App-Start für jede `instance.json` ohne
   `instanceId` eine UUID v4 schreiben. Rein additiv, ältere Client-Versionen
   ignorieren das Feld.
2. **Icons auslagern** — ist `icon` ein `data:`-URI, wird er nach `icon.png`/`icon.svg`
   geschrieben und `instance.json.icon` auf `"icon.png"` gesetzt. Lesecode muss
   **beide** Formen unterstützen (es gibt Instanzen mit 3-MB-Icons, siehe
   `01-ANALYSE.md`). Wird lazily beim ersten Sync gemacht, nicht beim Start —
   sonst dauert der Start bei 20 Instanzen unnötig lange.
3. **Playtime-Herkunft** — beim ersten Cloud-Upload einer Instanz wird der
   vorhandene `instance.json.playtime` dem **Origin-Gerät** als `deviceTotalMs`
   gutgeschrieben. So bleiben 42 h auch nach dem ersten Sync 42 h.
4. Keine Änderung an Ordnernamen, Pfaden oder bestehenden IPC-Kanälen.

## H.2 Server-seitig
1. `db_init_cloud.js` wird von `db_init.js` aufgerufen — alles `IF NOT EXISTS`,
   keine Änderung an bestehenden Tabellen außer:
   - `user_cloud_settings`-Zeile wird lazily beim ersten `/api/cloud/me` angelegt.
2. `DELETE /api/user/delete` wird erweitert (F.8).
3. Neue Env-Variablen (`.env.example` ergänzen):
   ```
   LUXCLOUD_ENABLED=true
   LUXCLOUD_JWT_SECRET=
   LUXCLOUD_STORAGE_DRIVER=s3        # s3 | fs
   LUXCLOUD_S3_ENDPOINT=
   LUXCLOUD_S3_BUCKET=lux-blobs
   LUXCLOUD_S3_ACCESS_KEY=
   LUXCLOUD_S3_SECRET_KEY=
   LUXCLOUD_S3_REGION=auto
   LUXCLOUD_DEFAULT_QUOTA_BYTES=5368709120
   LUXCLOUD_DEFAULT_MAX_INSTANCES=10
   LUXCLOUD_EXPIRY_DAYS=15
   LUXCLOUD_TRASH_DAYS=30
   LUXCLOUD_MAX_BLOB_BYTES=209715200
   ```
4. `LUXCLOUD_ENABLED=false` schaltet alle neuen Router ab → das Feature ist bis
   zum Launch dunkel schaltbar und kann bei Problemen sofort deaktiviert werden.

## H.3 Rückwärtskompatibilität
- Alte Clients (< 1.11) kennen die Cloud nicht und stören nicht.
- Neue Clients ohne Login verhalten sich exakt wie alte Clients.
- Manifest hat `manifestVersion` — ein Client, der eine höhere Version sieht,
  verweigert den Sync mit „Bitte Lux aktualisieren", statt Daten zu beschädigen.

---

# I. Edge Cases

| # | Fall | Verhalten |
|---|---|---|
| 1 | **User offline** | Alles lokal, Ops in die Queue, Badge `offline`. Spielen uneingeschränkt möglich. |
| 2 | **PC während des Uploads aus** | Hochgeladene Blobs bleiben serverseitig liegen (refcount 0). Kein Commit ⇒ keine sichtbare Revision. Beim nächsten Start meldet `negotiate` sie als vorhanden ⇒ der Upload setzt effektiv dort fort, wo er war. Nicht committete Blobs verfallen nach 24 h. |
| 3 | **Upload bricht ab** | Wie 2. Große Blobs zusätzlich per `Content-Range` byte-genau fortsetzbar. |
| 4 | **Download bricht ab** | Alles liegt in `.lux-sync/staging/`. Fertige, hash-geprüfte Dateien sind bereits am Platz und werden beim Neuversuch übersprungen. Die Instanz bleibt bis zum vollständigen Restore als `incomplete` markiert und nicht startbar. |
| 5 | **Zwei PCs ändern dieselbe Instanz** | Optimistic Locking über `parentRevision` ⇒ der zweite Commit bekommt 409. Danach 3-Wege-Merge nach D.7. |
| 6 | **Instanz lokal gelöscht** | Cloud bleibt. Die Instanz erscheint als `cloud-only`-Karte. Der Dialog beim Löschen fragt ausdrücklich: „Auch aus der Cloud entfernen?" (Standard: nein). |
| 7 | **Instanz in der Cloud gelöscht** | Anderer PC bemerkt es beim nächsten `head` (404). Lokale Dateien bleiben **unangetastet**, die Instanz wird auf `local` zurückgestuft, Hinweis im UI. Niemals lokale Daten wegen einer Server-Aussage löschen. |
| 8 | **Account gelöscht** | F.8. Client bemerkt 401 `device_revoked`, verwirft Tokens, alle Instanzen werden `local`. **Keine lokale Datei wird gelöscht.** |
| 9 | **Speicherlimit erreicht** | `negotiate` antwortet 413 mit Zahlen. UI zeigt, welche Instanzen wie viel belegen, und bietet an, Welten-Sync abzuschalten oder eine Instanz zu entfernen. Bereits synchronisierte Instanzen bleiben lesbar. |
| 10 | **Beschädigte Dateien** | Hash-Mismatch beim Download ⇒ bis zu 3 Neuversuche, dann Blob als korrupt melden (Admin-Alarm) und Eintrag überspringen. Lokal: Mismatch beim Hashen ⇒ Datei gilt als geändert und wird neu hochgeladen. |
| 11 | **Inkompatible Mods** | Sync ist inhaltsblind. Aber: der Restore ruft den bestehenden `tools:compatibility-scan` auf und warnt vor dem ersten Start. Kein Sync-Fehler. |
| 12 | **Unterschiedliche Betriebssysteme** | Siehe I.b unten. |
| 13 | **Unterschiedliche MC-Versionen** | Das Manifest bestimmt die Version. Beim Restore wird die Runtime über den bestehenden Installer geholt. Fehlt sie (z. B. Fabric für 1.21.11 nicht verfügbar), bricht der Restore **vor** dem Dateikopieren ab. |
| 14 | **Cross-Platform deaktiviert** | Instanz erscheint auf anderen Plattformen als gesperrt („nur auf Windows verfügbar"), mit der Option „trotzdem herunterladen (kann Probleme machen)". |
| 15 | **Gleichzeitig eingeloggte PCs** | Erlaubt. Advisory Lock warnt beim Start, blockiert nicht. Playtime ist durch den G-Counter immun. Der zweite Commit bekommt 409 und merged. |
| 16 | **Uhrzeit falsch gestellt** | Alle Reihenfolgen laufen über `revision` (monoton, serverseitig), nie über Zeitstempel. Zeitstempel sind nur Anzeige. |
| 17 | **Instanz lokal umbenannt** | `instanceId` bleibt ⇒ Cloud-Verknüpfung überlebt. Der Name wird als normale Änderung mitsynchronisiert. |
| 18 | **Zwei lokale Instanzen mit derselben `instanceId`** (Ordner kopiert) | Beim Scan erkannt: die jüngere bekommt eine neue UUID und gilt als neue Instanz. Sonst würden zwei Ordner um dieselbe Cloud-Instanz kämpfen. |
| 19 | **Instanz > 5 GB** | Upload verweigert mit klarer Aussage, welche Ordner den Platz fressen, plus Ein-Klick „Welten nicht synchronisieren". |
| 20 | **Modrinth nicht erreichbar / Mod entfernt** | Fallback auf unseren Blob, falls vorhanden; sonst Eintrag als fehlend markieren, Instanz startbar lassen, Hinweis anzeigen. |
| 21 | **Uhr des Servers vs. Token-Ablauf** | 60 s Clock-Skew-Toleranz beim JWT. |
| 22 | **Client stürzt mitten im Restore ab** | Instanz bleibt `incomplete`; beim nächsten Start wird der Restore fortgesetzt (idempotent, hash-basiert). |
| 23 | **Nutzer spielt während eines Syncs** | Sync wird bei laufendem MC-Prozess für diese Instanz pausiert (Dateien in Benutzung, `saves` wird geschrieben). Fortsetzung nach Spielende. |

**I.b Cross-Platform — technische Definition**

„Cross-Platform" heißt: *diese Instanz darf auf ein Gerät mit anderer OS-Familie
wiederhergestellt werden.* Konkret behandelt der Restore dann:
- Aus `instance.json` werden gerätelokale Felder **nicht** übernommen: `javaPath`,
  `folderPath`, `externalPath`, `status`, absolute Pfade in JVM-Argumenten.
- Pfadtrenner im Manifest sind immer `/`; beim Schreiben plattformkonform gewandelt.
- Dateinamen, die auf Windows unzulässig wären (`:`, `?`, `*`, Trailing-Dot, reservierte
  Namen), werden beim Upload von einem Unix-System erkannt und die Instanz als
  „nicht Windows-kompatibel" markiert, statt beim Restore zu scheitern.
- Ausführbarkeitsbit (`exec`) wird im Manifest gehalten und auf Unix wiederhergestellt.
- Native Mods (Ordner `natives/`, `.dll`/`.so`/`.dylib` in `mods/`) werden erkannt
  und lösen eine Warnung aus, blockieren aber nicht.
- Bei `crossPlatform: false` zeigt der Zielrechner die Instanz nur an, lädt sie
  aber nicht ohne ausdrückliche Bestätigung.
