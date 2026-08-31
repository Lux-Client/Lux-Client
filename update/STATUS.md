# STATUS — Lux Cloud Sync

> **Für die nächste KI-Session: lies diese Datei zuerst.**
> Sie sagt dir, wo wir stehen und was als Nächstes dran ist.
> Du musst die Repos **nicht** neu analysieren — das steht in `01-ANALYSE.md`.

**Zuletzt aktualisiert:** 2026-08-31
**Aktuelle Phase:** Phase 4 — **fertig**, Phase 5 als Nächstes
**Geschriebener Code:** Client `backend/luxcloud/` (17 Module), Manifest-Worker,
UI-Anbindung, `tests/` (80 Tests) · Website
`routes/{deviceAuth,cloud,cloudBlobs,adminCloud,manifestSchema}.js`,
`middleware/deviceAuth.js`, `storage/`, `jobs/cloudGc.js`, `cloudBlobs.js`,
`cloudConfig.js`, `db_init_cloud.js`, `tests/` (226 Tests), Zustimmungsseite

---

## Onboarding in 3 Minuten

1. `00-PROMPT.md` — was der Auftraggeber will (unveränderlich)
2. `01-ANALYSE.md` — wie die beiden Repos heute aussehen, inkl. **10 Fallstricke**
3. `02-ARCHITEKTUR.md` — Architektur, Datenmodell, API, Sync-Engine, Storage, Security, UI, Edge Cases
4. `03-ROADMAP.md` — Phasen 0–12 mit Aufgaben, Dateien, Risiken, Tests
5. diese Datei — Fortschritt

**Repos (Pfade auf diesem PC)**
- Client: `C:\Users\Max\Documents\GitHub\MCLC-Client` — Electron/React, „Lux" v1.10.0
- Website: `C:\Users\Max\Documents\GitHub\Lux-Website` — Express/Postgres, `lux.pluginhub.de`

> ⚠️ Die älteren Dokumente nennen die Pfade des ersten PCs
> (`C:\Users\beatv\…`) und das Website-Repo unter dem Namen **MCLC-Website**.
> Dasselbe Repo heißt hier **Lux-Website**. Inhaltlich identisch, nur der
> Ordnername ist ein anderer.

> ℹ️ Dieser Ordner heißt jetzt `update/` und wird **versioniert** (`git
> check-ignore` schlägt nicht mehr an). Das Problem mit `docs/*` in der
> `.gitignore`, das in der vorherigen Fassung dieser Datei stand, ist damit
> erledigt.

---

## Die fünf Dinge, die man wissen muss

1. **Referenzieren statt speichern.** Mods kommen vom Modrinth-CDN, nicht von uns —
   der Client kennt `projectId`/`versionId`/`sha1` bereits aus `mod_cache.json`.
   Ohne das kostet das Feature das ~500-fache. (`02-ARCHITEKTUR.md §A.2`, `§E.3`)
2. **`instance.json` enthält das Icon als base64** und ist dadurch bis zu **3 MB** groß.
   Muss vor jedem Sync ausgelagert werden. (`01-ANALYSE.md §2`)
3. **Jede Instanz bekommt eine UUID** — heute ist die Identität der Ordnername,
   das reicht für Multi-PC-Sync nicht. Vom Auftraggeber am 2026-08-31 ausdrücklich
   bestätigt. `instanceId` in `instance.json` ↔ `cloud_instances.instance_uuid`.
4. **`database.js` der Website ist ein MySQL-Shim**, der doppelte Anführungszeichen
   zerstört und an jedes INSERT `RETURNING id` hängt. Neue Queries: `?`-Platzhalter,
   keine `"`, und Tabellen ohne `id`-Spalte brauchen ein explizites `RETURNING`.
   (`01-ANALYSE.md §1`) — **in Phase 2 an `blobs`, `blob_refs` und
   `cloud_instance_playtime` verifiziert**; `pool.raw` ist dafür nicht nötig.
5. **`backend/handlers/cloudBackup.js` ist NICHT dieses Feature** — das sind
   BYO-Google-Drive/Dropbox-ZIP-Backups. Neuer Namespace: `luxcloud:*`.

---

## Fortschritt

| Phase | Status | Notizen |
|---|---|---|
| 0 Fundament | ✅ fertig | UUID, Icon-Auslagerung, Playtime-Härtung, syncPolicy, hashCache |
| 1 Account-Integration | ✅ fertig | PKCE-Geräte-Login, Bearer-JWT, Geräteliste, 37 grüne Tests |
| 2 Backend / DB | ✅ fertig | Alle Cloud-Tabellen, Instanz-CRUD, Papierkorb, Limit, 56 grüne Tests |
| 3 Storage Layer | ✅ fertig | fs- und s3-Treiber, Blob-Upload/Download, Refcounts, GC + Reconcile, 67 grüne Tests |
| 4 Instance Manifest | ✅ fertig | Manifest-Bau im Worker, FastCDC, Kompressionsheuristik, Server-Validator, 80 + 66 grüne Tests |
| 5 Upload / Download | ⬜ offen | **als Nächstes** — der erste Moment, in dem das Feature real wird |
| 6 Inkrementeller Sync | ⬜ offen | |
| 7 Konfliktauflösung | ⬜ offen | |
| 8 Playtime-Sync | ⬜ offen | unabhängig, kann vorgezogen werden |
| 9 UI / UX | ⬜ offen | |
| 10 Konto / Ablauf / Admin | ⬜ offen | |
| 11 Testing | ⬜ offen | |
| 12 Launch | ⬜ offen | |

Legende: ⬜ offen · 🟨 in Arbeit · ✅ fertig · ⚠️ blockiert

---

## Was in Phase 0 gebaut wurde

Verzeichnis `backend/luxcloud/` — kein Netzwerk, keine Cloud, läuft ohne Account:

| Modul | Zweck |
|---|---|
| `atomicJson.js` | JSON schreiben ohne Korruptionsrisiko (tmp + fsync + rename) |
| `paths.js` | alle lokalen Cloud-Pfade unter `userData/luxcloud/` |
| `instanceIdentity.js` | UUID-Vergabe, Kollisionsauflösung bei kopierten Ordnern |
| `instanceIcon.js` | data:-URI ↔ Datei, beide Richtungen |
| `playtimeSession.js` | Heartbeat-Sessions + Crash-Recovery |
| `syncPolicy.js` | die Tabelle aus `02-ARCHITEKTUR.md §B.3` als Code |
| `hashCache.js` | sha256/sha1 mit size+mtime-Invalidierung |
| `migrations.js` | Startup-Sweep, ruft die drei Migrationen auf |

### Gemessen an den echten Instanzen der ersten Maschine
| | vorher | nachher |
|---|---|---|
| „PVP MISCHE (Real)", 17,8 GB auf Platte | — | **134 MB Sync (0,8 %)** |
| Dateien im Manifest | 6.738 | **338** |

---

## Was in Phase 1 gebaut wurde

**Ziel war ausdrücklich nur:** der Client kann sich mit dem bestehenden
Website-Account verbinden. Kein Sync, keine Instanzen, keine Dateien.

### Website (`Lux-Website`)

| Datei | Inhalt |
|---|---|
| `db_init_cloud.js` | `client_devices`, `user_cloud_settings`, `device_auth_codes` + Indizes + stündliches Aufräumen der Codes. Aufgerufen am Ende von `createTables()` in `db_init.js`. |
| `middleware/deviceAuth.js` | JWT signieren/prüfen, `ensureDeviceAuth` (nur Bearer), `ensureCloudUser` (Bearer **oder** Website-Session), `ensureCloudSettingsRow`, einheitliches Fehlerformat |
| `routes/deviceAuth.js` | `GET /auth/device`, `POST /auth/device/approve`, `POST /auth/device/deny`, `POST /api/auth/device/token`, `/refresh`, `/revoke` + Rate Limits |
| `routes/cloud.js` | `GET /api/cloud/me`, `PATCH /api/cloud/me/settings`, `GET /api/cloud/devices`, `DELETE /api/cloud/devices/:uuid` |
| `client/src/pages/AuthorizeDevice.jsx` | Zustimmungsseite, Route `/authorize-device` in `client/src/App.jsx` |
| `tests/deviceAuth.phase1.test.js` | 37 Integrationstests, `npm run test:cloud` |
| `server.js` | nur zwei `app.use()` vor der SPA-Catch-All-Route + Start des Aufräum-Jobs |
| `.env.example` | `LUXCLOUD_JWT_SECRET` und drei Laufzeit-Variablen |

Neue Abhängigkeiten: `jsonwebtoken`, `express-rate-limit`, `pg-mem` (nur dev).

### Client (`MCLC-Client`)

| Datei | Inhalt |
|---|---|
| `backend/luxcloud/config.js` | Basis-URL (per `LUXCLOUD_BASE_URL` überschreibbar), Timeouts |
| `backend/luxcloud/state.js` | `userData/luxcloud/state.json`, Tokens über `safeStorage` verschlüsselt, Geräte-ID |
| `backend/luxcloud/api.js` | `raw()` / `authed()`, Auto-Refresh, genau ein 401-Retry, Offline-Erkennung, `LuxCloudError` |
| `backend/luxcloud/auth.js` | PKCE, Systembrowser, Deep-Link-Rückkanal, Refresh mit Single-Flight, Logout |
| `backend/handlers/luxcloud.js` | die IPC-Kanäle `luxcloud:*` |
| `src/context/LuxAccountContext.tsx` | Account-Zustand im Renderer |
| `src/components/cloud/LuxAccountPanel.tsx` | Abschnitt „Lux Account" in den Einstellungen |

Verdrahtung: `electron/main.js` (Handler-Array + `hostname === 'auth'` im
Deep-Link-Parser) · `backend/preload.js` (`luxCloud*`-Methoden) ·
`backend/utils/secureProfileStore.js` (exportiert jetzt `encryptToken` /
`decryptToken`) · `src/main.tsx` (Provider) · `src/pages/Settings.tsx`
(neue Kategorie „Lux Account" vor „Cloud & Updates") ·
`src/types/electron-api.d.ts`.

### Was in Phase 1 geprüft wurde

`npm run test:cloud` im Website-Repo — 37 Tests, alle grün. Abgedeckt:

- Zustimmungsseite: anonym → Google-Login mit `returnTo`, kaputte Parameter → 400,
  `approve` von fremder Origin → 403
- Token-Tausch: falscher `code_verifier` → `invalid_grant`, derselbe Code zweimal
  → `invalid_grant`, gebannter User bekommt keinen Code
- Kontotrennung: User B sieht die Geräte, Einstellungen und Instanzen von User A
  nicht; ein fremdes Gerät abzumelden liefert 404, nicht 403
- Refresh: Rotation, 30-s-Gnadenfenster, Reuse nach dem Fenster → ganze Kette tot
  + Notification, alte Access-Tokens sofort wertlos
- Ablauf (`token_expired`), Abmelden (`device_revoked`), Neuanmeldung eines
  abgemeldeten Geräts, Refresh-Token liegt nur als sha256 in der Datenbank
- gebannte Konten: 403 bei API-Zugriff **und** beim Refresh

Zusätzlich: `npm run build` (Renderer) und `npx tsc --noEmit` im Client laufen
durch; ESLint ist auf allen neuen Dateien sauber.

**Noch nicht geprüft, weil dafür ein laufender Server und ein echter
Google-Login nötig sind:** der komplette Durchlauf Client → Browser →
`luxclient://auth` → Client. Das ist der erste Punkt für die nächste Session,
siehe „Offene Punkte aus Phase 1".

---

## Was in Phase 2 gebaut wurde

**Ziel war:** alle Cloud-Tabellen und die CRUD-Endpunkte für Instanzen — ohne
Dateien, ohne Manifeste, ohne Upload.

### Datenbank (`db_init_cloud.js`)

Die restlichen Tabellen aus `02-ARCHITEKTUR.md §B` sind angelegt:
`cloud_instances`, `cloud_revisions`, `blobs`, `blob_refs`, `blob_gc_queue`,
`cloud_instance_playtime`, `cloud_sessions` — inklusive der sechs Indizes,
darunter die beiden partiellen (`blobs(refcount) WHERE refcount = 0`,
`cloud_sessions(instance_id) WHERE ended_at IS NULL`).

Damit ist das Schema aus `§B` **vollständig**. Die Tabellen ab `blobs` werden
erst ab Phase 3 beschrieben, existieren aber schon — Phase 3 muss dafür keine
Migration mehr nachziehen.

### Neue Endpunkte (`routes/cloud.js`)

| Methode | Endpoint | Auth | Anmerkung |
|---|---|---|---|
| `GET` | `/api/cloud/instances` | bearer \| session | `?status=active\|trashed\|all`, Standard `active` |
| `GET` | `/api/cloud/instances/:uuid/head` | bearer | Pre-Launch-Check; `?touch=1` setzt den 15-Tage-Timer zurück |
| `POST` | `/api/cloud/instances` | bearer | idempotent; prüft das 10er-Limit |
| `PATCH` | `/api/cloud/instances/:uuid` | bearer \| session | Name, `crossPlatform`, `syncWorlds`, `syncScreenshots` |
| `DELETE` | `/api/cloud/instances/:uuid` | bearer \| session | Soft-Delete in den Papierkorb |
| `POST` | `/api/cloud/instances/:uuid/restore` | bearer \| session | prüft das Limit erneut |

Dazu neu: `cloudConfig.js` (Ablauffristen, Validierungsmuster, `expiresAt()` /
`purgesAt()`), der Helper `ownedInstance()` aus `§F.3` und
`countActiveInstances()`.

`GET /api/cloud/me` liefert jetzt die echte `instanceCount` statt der 0 aus
Phase 1.

### Was in Phase 2 geprüft wurde

`npm run test:cloud` — jetzt **zwei** Dateien, 93 Tests, alle grün:
`tests/deviceAuth.phase1.test.js` (37) und `tests/cloudInstances.phase2.test.js`
(56). Die gemeinsame Infrastruktur liegt in `tests/luxcloudHarness.js` —
neue Phasen bekommen eine eigene Testdatei daneben, keine Kopie der Harness.

Abgedeckt sind unter anderem:

- **Kontotrennung**: User B sieht die Instanzen von User A nicht und bekommt bei
  `head`, `PATCH` und `DELETE` ein 404 — nie ein 403, das die Existenz verraten würde
- **Instanzlimit**: die 11. Instanz scheitert mit `instance_limit_reached`;
  eine Instanz im Papierkorb zählt nicht mit; `restore` über das Limit hinaus
  scheitert ebenfalls
- **Papierkorb-Zyklus**: löschen → nicht mehr in der Standardliste, `head` 404,
  Anlegen derselben UUID → `instance_trashed` → `restore` → wieder aktiv
- **`head`**: alle Felder aus `§C.3`, unter 300 Bytes, Median 4,4 ms
  (In-Memory-DB, nur als Größenordnung), `touch=1` wirkt, ohne `touch` bleibt
  `last_touched_at` unverändert
- **Abgeleitete Felder**: `manifestHash` der aktuellen Revision, Playtime-Summe
  über alle Geräte, laufende Sitzung erscheint und verschwindet wieder
- **Die `database.js`-Fallstricke** (Phase-2-Aufgabe 5): ein INSERT in `blobs`
  ohne `RETURNING` scheitert nachweislich, mit `RETURNING hash` geht es;
  dasselbe für `blob_refs` (`RETURNING blob_hash`) und `cloud_instance_playtime`
  (`RETURNING instance_id`). **`pool.raw` war nicht nötig.**

---

## Was in Phase 3 gebaut wurde

**Ziel war:** Blobs speichern und ausliefern, mit Refcounting und GC. Noch kein
Manifest, kein Commit, kein Upload aus dem Client.

### Speicherabstraktion (`storage/`)

| Datei | Inhalt |
|---|---|
| `storage/index.js` | Treiberwahl über `LUXCLOUD_STORAGE_DRIVER`, `blobKey()` / `manifestKey()` nach `§E.2` |
| `storage/fs.js` | lokales Verzeichnis; Standard, für Entwicklung und Self-Hosting |
| `storage/s3.js` | `@aws-sdk/client-s3`, funktioniert gegen R2/B2/MinIO/S3, inklusive `presignGet()` |

Schnittstelle wie in `§E.1` vorgesehen: `put`, `get`, `head`, `remove`, `list`,
`presignGet`. `list()` ist eine Ergänzung — der Reconcile-Job braucht sie, um
verwaiste Objekte im Bucket zu finden.

### Endpunkte

| Methode | Endpoint | Auth | Anmerkung |
|---|---|---|---|
| `PUT` | `/api/cloud/blobs/:hash` | bearer | fortsetzbar über `Content-Range`, `X-Lux-Compression: none\|zstd` |
| `POST` | `/api/cloud/blobs/batch` | bearer | viele kleine Blobs, base64, Teilerfolge über 207 |
| `GET` | `/api/cloud/blobs/:hash` | bearer | Besitz-Check aus `§F.4`, optional 302 auf eine Presigned URL |
| `GET` | `/api/cloud/blobs/:hash/head` | bearer | Größe und Kompression ohne Download |
| `GET` | `/api/admin/cloud/gc` | admin | Queue, Blob-Statistik, letzte Läufe |
| `POST` | `/api/admin/cloud/gc/run` | admin | `{ mode: 'gc' \| 'reconcile', dryRun }`, geht ins Audit-Log |

`GET /api/cloud/me` liefert jetzt zusätzlich `capabilities`
(unterstützte Kompression, `maxBlobBytes`, `maxBatchBytes`, `maxBatchEntries`,
`storageDriver`). Phase 4 und 5 sollen das lesen, statt Grenzen zu raten.

### Buchhaltung und Jobs

`cloudBlobs.js` hält alles, was an der Datenbank hängt: `registerBlob`,
`claimUpload`, `userMayReadBlob`, `addRefs`, `removeRefsForRevision`,
`enqueueOrphans`, `pruneUploadClaims`. **Phase 5 ruft für den Commit genau
`addRefs()` auf — nicht selbst `INSERT INTO blob_refs`.**

`jobs/cloudGc.js` enthält `runGc()` (stündlich), `runReconcile()` (wöchentlich)
und `getGcStatus()`; `startCloudJobs()` hängt sie über `node-cron` in den
Serverstart. Die 24-Stunden-Karenz und die erneute refcount-Prüfung unmittelbar
vor dem Löschen sind beide umgesetzt und getestet.

`LUXCLOUD_GC_DRY_RUN` steht in `.env.example` auf **`true`**. Wie in der Roadmap
gefordert soll der GC erst eine Woche im Trockenlauf beobachtet werden, bevor er
scharf geschaltet wird.

### Was in Phase 3 geprüft wurde

`npm run test:cloud` — drei Dateien, **160 Tests**, alle grün (37 + 56 + 67).
Neu in `tests/cloudBlobs.phase3.test.js`:

- **Upload**: falscher Hash → 400 und **nichts** landet im Speicher; doppelter
  Upload → 409 `already_exists`; kaputter Hash, unbekannte Kompression → 400
- **Dedup über Konten**: zwei User laden dieselbe Datei → **ein** Objekt, eine
  `blobs`-Zeile, zwei Upload-Ansprüche
- **Zugriffskontrolle** (`§F.4`): ein fremder, real existierender Blob-Hash
  liefert 404 — auch bei `head`; ein abgelaufener Upload-Anspruch reicht nicht mehr
- **Fortsetzbarkeit**: Abbruch bei 50 %, falscher Offset → 409 `range_mismatch`
  mit dem Offset, den der Server hält; danach fortsetzen → byte-genau identisch
- **Kompression**: zstd wird serverseitig entpackt und gegen den Hash des
  **Originals** geprüft; als zstd deklarierter Unsinn → `hash_mismatch`
- **Refcounts**: doppelte Hashes zählen einmal, `addRefs` ist idempotent, zwei
  Revisionen → refcount 2, Löschen einer Revision senkt nur den einen Zähler
- **GC**: Trockenlauf löscht nichts; der echte Lauf löscht genau den
  unreferenzierten Blob; ein Blob, der zwischen Einreihung und Lauf wieder
  referenziert wurde, wird **nicht** gelöscht
- **Reconcile**: ein manuell verfälschter refcount wird korrigiert, ein verwaistes
  Objekt im Speicher gelöscht, bekannte Objekte bleiben liegen
- **Admin**: normaler User → 403, Admin sieht den Status und kann Läufe anstoßen,
  jede Aktion landet im bestehenden `admin_audit_log`

Der S3-Treiber ist nicht gegen einen echten Bucket getestet — nur, dass er sich
gegen einen R2-Endpunkt aufbauen lässt und korrekte Presigned URLs erzeugt.
Die Tests laufen alle gegen `fs`.

---

## Was in Phase 4 gebaut wurde

**Ziel war:** der Client kann ein korrektes Manifest bauen. Noch kein Netzwerk,
kein Upload.

### Website

`routes/manifestSchema.js` — der Validator. Prüft Aufbau und Pfade nach
`02-ARCHITEKTUR.md §B.2` und `§F.5` und liefert neben `valid`/`issues` auch die
Statistik, die Phase 5 im Commit braucht: `entryCount`, `logicalBytes`,
`hasWorlds` und die Liste aller referenzierten `blobHashes`.

### Client

| Datei | Inhalt |
|---|---|
| `backend/luxcloud/pathRules.js` | Pfadvalidierung — **wortgleiche Kopie** der Regeln aus `routes/manifestSchema.js` |
| `backend/luxcloud/manifest.js` | Baum scannen, Policy anwenden, hashen, Quellen auflösen, `instance.json` normalisieren |
| `backend/luxcloud/chunker.js` | FastCDC (min 256 KB / avg 1 MB / max 4 MB), reines JS |
| `backend/luxcloud/compression.js` | die Tabelle aus `§D.5` als Code, inklusive 128-KB-Probelauf für unbekannte Endungen |
| `backend/luxcloud/manifestRunner.js` | startet den Worker, wandelt die Puffer zurück |
| `backend/workers/luxcloudManifestWorker.js` | `worker_threads`, damit eine 8-GB-Instanz die UI nicht blockiert |

IPC: `luxcloud:preview-manifest` (der Debug-Befehl „Manifest anzeigen") liefert
Einträge, Referenz- gegen Upload-Bytes, Ausschlussgründe, übersprungene
Riesendateien und die Upload-Bytes je Ordner. Fortschritt kommt über
`luxcloud:manifest-progress`.

`buildManifest()` gibt drei Dinge zurück, die Phase 5 direkt benutzen kann:
das `manifest`, den `manifestBlob` (JSON + sha256) und eine `uploads`-Liste, in
der jeder Eintrag schon weiß, ob er als Datei, als Chunk, als Chunk-Liste oder
als erzeugter Puffer hochgeht — und mit welcher Kompression.

### Was in Phase 4 geprüft wurde

Zwei neue Testdateien, beide grün:

- Website: `npm run test:cloud` → jetzt **226 Tests** (37 + 56 + 67 + 66).
  Neu ist `tests/manifestSchema.phase4.test.js` mit 66 Fällen, davon 25
  Angriffsvektoren auf die Pfadprüfung: `../`, `C:\`, Backslash, UNC, NUL-Byte,
  Steuerzeichen, `CON`/`AUX`/`COM1`, abschließender Punkt, abschließendes
  Leerzeichen, leeres Segment, zu tief, zu lang, nicht normalisiertes Unicode.
- Client: `npm run test:luxcloud` → **80 Tests** in `tests/luxcloud.phase4.test.js`.

Bemerkenswert daran:

- **Client und Server werden gegeneinander geprüft.** Liegt das Website-Repo
  neben dem Client, lädt der Client-Test `routes/manifestSchema.js` und prüft,
  dass beide Seiten **jeden** der 25 Pfadvektoren gleich beurteilen. Liegt es
  nicht daneben, wird der Vergleich übersprungen statt zu scheitern.
- **Das erzeugte Manifest wird durch den echten Server-Validator geschickt** —
  einmal normal, einmal mit Welten und Chunking.
- **FastCDC**: ein einziges geändertes Byte in der Mitte einer 6-MB-Datei ändert
  höchstens zwei Chunks. Genau dafür gibt es das Chunking.
- **Der Hash-Cache greift**: der zweite Lauf hasht keine einzige Datei neu.
- **Der Worker liefert dasselbe Manifest wie der Direktaufruf.**

---

## Nächster Schritt

**Phase 5 — Upload / Download** (siehe `03-ROADMAP.md`).
Das ist der erste Moment, in dem das Feature real wird: eine Instanz vollständig
hochladen und auf einem zweiten PC wiederherstellen.

Vieles liegt bereit:

- `buildManifest()` liefert die `uploads`-Liste schon in der Form, die der
  Uploader braucht (Datei / Chunk / Chunk-Liste / erzeugter Puffer, je mit
  Kompression).
- Der Server nimmt Blobs an (`PUT`, `batch`), liefert sie aus und zählt
  Referenzen. **Der Commit muss `addRefs()` aus `cloudBlobs.js` benutzen**, nicht
  selbst in `blob_refs` schreiben.
- `routes/manifestSchema.js` liefert im Commit die Blob-Hash-Liste, gegen die
  `§F.4` geprüft werden muss: jeder Hash muss dem User gehören oder von ihm in
  den letzten 24 h hochgeladen worden sein (`blob_upload_claims`).
- `GET /api/cloud/me` nennt `capabilities` — Kompression und Größengrenzen
  kommen vom Server, nicht aus einer Konstante im Client.

Was fehlt: `POST /negotiate`, `POST /commit` (die heikelste Transaktion des
Projekts, mit `SELECT … FOR UPDATE` auf `cloud_instances` und Optimistic Locking
über `parentRevision`), `GET /manifest`, clientseitig `uploader.js`,
`downloader.js`, `blobStore.js` und das Fortschritts-Panel.

---

## Offene Punkte

| # | Punkt | Warum offen |
|---|---|---|
| 1 | **Deep Link auf einem gebauten Installer testen.** | Braucht `npm run dist` und eine Installation |
| 2 | **Ende-zu-Ende-Login gegen einen laufenden Server.** Lokal: Website mit Postgres starten, im Client `LUXCLOUD_BASE_URL=http://localhost:3001` setzen. | Braucht eine erreichbare Datenbank |
| 3 | **`Dockerfile` steht auf `node:20-alpine`, `.node-version` auf `25`.** Für zstd braucht die Website **Node ≥ 23.8**. Unter Node 20 meldet `/me` nur `compression: ['none']`; nichts bricht, aber die ~20 % Ersparnis aus `§E.3` fallen weg. | Das Basisimage zu wechseln betrifft das ganze Deployment |
| 4 | **S3-Treiber ist nicht gegen einen echten Bucket getestet.** | Braucht Entscheidung Nr. 3 und einen Account |
| 5 | **Die Online-Auflösung fehlt.** `§D.2` Schritt 3 sieht vor: kein Treffer in `mod_cache.json`, aber online → einmal `api.modrinth.com/v2/version_file/<sha1>` fragen und das Ergebnis zurückschreiben. `manifest.js` liest bisher **nur** den Cache. Folge: Instanzen, deren Mod-Liste im Client nie geöffnet wurde, sehen künstlich schlecht aus (gemessen: 11 % statt vermutlich >90 %). | Macht aus dem Manifest-Bau eine netzabhängige Operation; gehört sauber als optionaler Schritt in Phase 5 |
| 6 | `DELETE /api/cloud/me` aus `§C.2` fehlt | Gehört zu Phase 10 |
| 7 | `devserver.js` kennt die Cloud-Routen nicht | Er hat keine Datenbank |
| 8 | Website-Dashboard und Admin-Tab aus `§G.3` fehlen | Phase 9/10; die GC-Endpunkte dafür stehen bereits |
| 9 | Kein Job wendet die 15-Tage-Regel an oder räumt den Papierkorb | Phase 10; `jobs/` und der Runner existieren |

### Gemessen an den echten Instanzen des zweiten PCs (2026-08-31)

`npm run luxcloud:preview -- --all` über fünf echte Instanzen:

| Instanz | Auf der Platte | Upload | Anteil | Modrinth-Treffer |
|---|---|---|---|---|
| AFK | 313 MB | 6,5 KB | 0,0 % | 3 / 3 |
| PVP MISCHE | 988 MB | 7,2 MB | 0,7 % | 34 / 41 (83 %) |
| PVP MISCHE (1.21.11) | 1,4 GB | 820 KB | 0,1 % | 45 / 45 |
| PVP MISCHE (1.21.11) (Copy) | — | 27,4 MB | — | 30 / 36 (83 %) |
| PVP MISCHE (26.2) | — | 115 MB | — | 4 / 35 (11 %) |
| **Summe** | **5,6 GB** | **151 MB** | **2,6 %** | |

Das 5-GB-Kontingent wäre damit zu **2,9 %** belegt.

Die 11 % bei „PVP MISCHE (26.2)" sind **kein** Modrinth-Problem: keine einzige
der 29 Mods hat einen Eintrag in `mod_cache.json`, weil die Mod-Liste dieser
Instanz im Client nie geöffnet wurde. Es sind gewöhnliche Modrinth-Mods
(`fabric-api`, `cloth-config`, `appleskin`, …). Zwei Wege dahin:
Mod-Liste einmal im Client öffnen, oder die Online-Auflösung aus `§D.2`
nachrüsten (siehe „Offene Punkte" Nr. 5). Ohne sie bleibt die gemessene
Trefferquote systematisch zu niedrig — und damit auch die Kostenschätzung
aus `§E.3` zu pessimistisch.

Die Zahl aus `§E.3` (⌀ 85 % auflösbar) wird von den vier Instanzen mit
gefülltem Cache bestätigt: 83 %, 100 %, 100 %, 83 %.

---

## Offene Entscheidungen (brauchen den Auftraggeber)

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| 1 | **15-Tage-Regel:** Der Auftrag sagt „nicht angefasst von *einem anderen PC*". Wörtlich genommen verliert ein User mit nur einem PC seine Instanz, obwohl er täglich spielt. | Timer bei **jeder** Aktivität zurücksetzen, auch vom selben PC. Ersparnis praktisch identisch, Datenverlustrisiko weg. | ❓ offen |
| 2 | **Quota-Zahlen:** Der Auftrag nennt 5 GB / 10 Instanzen, das UI-Beispiel in §14 zeigt „2.4 GB / 10 GB". | 5 GB (die ausdrückliche Vorgabe gewinnt), UI-Beispiel war illustrativ. | ✅ so umgesetzt (`user_cloud_settings`-Defaults), rückgängig zu machen durch ein `ALTER TABLE`-Default |
| 3 | **Storage-Anbieter:** Cloudflare R2 (kein Egress-Preis) vs. Backblaze B2 vs. Hetzner. | R2 — dieses Feature ist download-lastig, Egress wäre sonst der Hauptkostenblock. | ❓ offen, aber **nicht mehr blockierend**: Phase 3 läuft auf dem `fs`-Treiber, der `s3`-Treiber ist fertig und funktioniert gegen jedes S3-kompatible Ziel. Es fehlen nur Bucket und Schlüssel in der `.env`. |
| 4 | **Welten-Sync standardmäßig aus?** | Ja, aus. Kostet sonst das 20-fache und ist der häufigste Konfliktfall. | ✅ so umgesetzt (`sync_worlds_default = FALSE`) |
| 5 | **Wording:** Das bestehende Drive/Dropbox-Feature heißt heute „Cloud Backup". | In „Externe Backups" umbenennen, damit „Cloud" eindeutig die Lux Cloud meint. | ❓ offen — Phase 1 hat die Trennung vorerst über die Kategorienamen gelöst („Lux Account" vs. „Cloud & Updates") |
| 6 | **CurseForge-Auflösung** zusätzlich zu Modrinth? | Erst nach der Messung in Phase 11. Wenn die Modrinth-Trefferquote < 70 % liegt, nachrüsten. | ⏸ später |

---

## Korrekturen an der Analyse

*(Hier eintragen, wenn sich etwas aus `01-ANALYSE.md` als falsch herausstellt —
mit Datum und Fundstelle.)*

- **2026-08-31 — pg-mem kann drittens auch `ON CONFLICT DO NOTHING RETURNING`
  nicht richtig.** Es liefert die Zeile auch dann zurück, wenn nichts eingefügt
  wurde; in Postgres kommt in dem Fall nichts. Das ist genau die Semantik, an
  der zuerst die refcount-Buchhaltung hing — und der Fehler wäre in Produktion
  gefährlich (Zähler zu hoch heißt: Speicher wird nie freigegeben; zu niedrig
  heißt: der GC löscht Daten, die noch gebraucht werden). `addRefs()` fragt
  deshalb jetzt erst, welche Referenzen fehlen, und zählt nur die hoch —
  ohne sich auf `RETURNING` zu verlassen. Siehe Entscheidungslog.

- **2026-08-31 — der `Dockerfile` der Website steht auf `node:20-alpine`,
  `.node-version` auf `25`.** Für zstd (`zlib.createZstdDecompress`, ab Node
  23.8) ist das zu alt. Der Code fällt sauber auf `compression: ['none']`
  zurück, aber die ~20 % Ersparnis aus `§E.3` gibt es erst mit einem neueren
  Basisimage. Siehe „Offene Punkte" Nr. 3.

- **2026-08-31 — der `database.js`-Shim ist in Phase 2 vollständig verifiziert.**
  `01-ANALYSE.md §1` warnt, dass Tabellen ohne `id`-Spalte über `pool.raw`
  laufen müssen. Das stimmt so nicht: ein explizites `RETURNING <spalte>`
  reicht. Nachgewiesen für `blobs`, `blob_refs` und `cloud_instance_playtime`
  in `tests/cloudInstances.phase2.test.js §7`, inklusive des Gegenbeweises
  (INSERT ohne `RETURNING` scheitert). **`pool.raw` wird nirgends gebraucht.**

- **2026-08-31 — pg-mem (die Test-Datenbank) kann zwei Dinge nicht.**
  Erstens **kein ROLLBACK** — ein zurückgerolltes INSERT bleibt sichtbar.
  Zweitens **keine korrelierten Subqueries**: `(SELECT … WHERE p.x = i.id)`
  mit einem Alias aus der äußeren Abfrage scheitert mit
  `column "i.id" does not exist`. Beides sind Grenzen des Testwerkzeugs, nicht
  von Postgres — aber beide haben den Code verbessert (siehe Entscheidungslog).
  `FOR UPDATE` und `INSERT … ON CONFLICT DO NOTHING RETURNING` versteht pg-mem.

- **2026-08-31 — Sync-Policy `§B.3` war zu großzügig.** Gemessen an echten Instanzen:
  `xaero/world-map` (178 MB gerenderte Kartenkacheln) und `essential/` (257 MB
  nachgeladene Mod-JARs + `screenshot-cache`) wären mitsynchronisiert worden. Beide
  sind groß, ändern sich ständig und entstehen beim Weiterspielen neu — also genau
  das, was nicht in die Cloud gehört. Ebenso `replay_recordings` (Videodateien) und
  die Kartenkacheln von journeymap/voxelmap.
  Korrigiert in `syncPolicy.js`; `MOD_DATA_DIRS` enthält jetzt nur noch Ordner, die
  an echten Instanzen als klein **und** nicht regenerierbar verifiziert sind.
  Ausnahme: Pfade mit einem `waypoints`-Segment gehen trotzdem mit — Wegpunkte sind
  winzig und nicht wiederherstellbar, ihr Verlust wäre beim PC-Wechsel der
  ärgerlichste Teil. Wirkung: 488 MB → 134 MB, 6.738 → 338 Dateien.

- **2026-08-31 — Website-Repo heißt hier `Lux-Website`.** `01-ANALYSE.md §1` und
  `00-PROMPT.md` sprechen von `MCLC-Website`. Es ist dasselbe Repo; alle
  Aussagen der Analyse dazu haben sich als korrekt bestätigt.

- **2026-08-31 — `routes/api.js`, `routes/auth.js` und `routes/extensions.js`
  der Website sind nirgends eingehängt.** `server.js` enthält alle Routen selbst;
  die Dateien unter `routes/` sind Altlasten. Wer dort etwas sucht, sucht falsch.
  Für neue Router gilt trotzdem weiter: eigene Datei unter `routes/`, in
  `server.js` nur `app.use()` — so ist Phase 1 gebaut.

- **2026-08-31 — die `database.js`-Fallstricke sind real, aber beherrschbar.**
  In Phase 1 mit echtem SQL gegen `device_auth_codes` (kein `id`-Feld) und
  `user_cloud_settings` (Primary Key ist `user_id`) getestet:
  ein explizites `RETURNING <spalte>` im INSERT reicht — `pool.raw` war nicht
  nötig. `INSERT … ON CONFLICT DO NOTHING RETURNING user_id` funktioniert
  ebenfalls. Für Phase 2 heißt das: `blob_refs` und `cloud_instance_playtime`
  brauchen dasselbe Muster, nicht mehr.

---

## Entscheidungslog

*(Hier eintragen, wenn von `02-ARCHITEKTUR.md` abgewichen wird — mit Begründung.)*

| Datum | Entscheidung | Begründung |
|---|---|---|
| 2026-08-30 | Datei-CAS statt durchgängigem Chunking | MC-Instanzen bestehen fast nur aus unveränderlichen Blobs; Chunking lohnt nur bei `saves/**` |
| 2026-08-30 | Keine E2E-Verschlüsselung | macht serverseitige Dedup unmöglich; convergent encryption öffnet Confirmation-of-a-File |
| 2026-08-30 | Bearer-JWT statt Session-Cookie für die Cloud-API | Client hat keine Cookies; schließt CSRF strukturell aus |
| 2026-08-30 | Playtime als G-Counter pro Gerät | einzige Konstruktion, die Doppelzählung *garantiert* statt sie unwahrscheinlich zu machen |
| 2026-08-30 | Offline-Queue als JSONL statt SQLite | spart eine native Dependency in einem Electron-Build für 3 Plattformen |
| 2026-08-31 | **`POST /auth/device/approve` antwortet mit JSON `{ redirectUrl }` statt mit einem 302** | `§C.1` sah einen Redirect vor. Ein Redirect wäre auch per klassischem Formular-POST von einer fremden Seite auslösbar (Cookies gehen mit, CORS greift dort nicht). Ein JSON-Aufruf verlangt einen Preflight, den `cors()` mit `*` nicht mit Credentials beantwortet; zusätzlich prüft `ensureSameOrigin` den `Origin`-Header. Die SPA navigiert selbst auf `redirectUrl`. |
| 2026-08-31 | **Autorisierungscode gilt 120 s statt 30 s** | Die Zustellung des Deep Links an eine laufende Instanz (`second-instance` unter Windows) kann spürbar dauern. Der Code bleibt einmalig und an den `code_verifier` gebunden — die Verlängerung kostet keine Sicherheit, ein abgelaufener Code aber einen kompletten neuen Durchlauf. |
| 2026-08-31 | **Autorisierungscodes in der Tabelle `device_auth_codes`, nicht im Prozessspeicher** | `§C.1` ließ beides offen. Ein Container-Neustart oder ein zweiter Worker würde einen In-Memory-Code verlieren, ohne dass der wartende Client das merkt. Gespeichert wird nur `sha256(code)`. |
| 2026-08-31 | **`client_devices` bekommt `refresh_expires_at`, `prev_refresh_token_hash`, `prev_refresh_valid_until`** | Ergänzung zum Schema in `§B`. Ohne Gnadenfenster sperrt die Rotation den User aus, sobald zwei Anfragen parallel laufen oder eine Antwort verloren geht. Die Roadmap fordert das 30-s-Fenster ausdrücklich — diese drei Spalten sind seine Umsetzung. |
| 2026-08-31 | **Die Geräte-ID gehört zum Konto, nicht zum PC** | Meldet sich auf derselben Installation ein anderes Konto an, antwortet der Server mit `device_conflict` und der Client zieht eine neue ID. Die Zeile zu übertragen wäre falsch: an ihr hängen ab Phase 8 die Playtime-Zähler. Beim Abmelden wird die ID lokal mitgelöscht. |
| 2026-08-31 | **Der Token-Tausch liest den Code erst und entwertet ihn danach** | Ursprünglich in einem `UPDATE … RETURNING` zusammengefasst, mit `rollback()` im Konfliktfall. Damit hing die Wiederholbarkeit nach `device_conflict` an der Transaktionssemantik. Jetzt wird alles, was nicht am Code liegt, vor dem Entwerten geprüft — der Code bleibt nachweislich unangetastet. Die Einmaligkeit sichert weiterhin `WHERE consumed_at IS NULL`. |
| 2026-08-31 | **`ensureDeviceAuth` fragt bei jeder Anfrage die Datenbank** | Ein reiner JWT-Check wäre billiger, aber ein auf der Website abgemeldetes Gerät bliebe bis zu einer Stunde gültig. Der Check ist ein Index-Lookup; `last_seen_at` wird höchstens alle 5 Minuten je Gerät geschrieben. |
| 2026-08-31 | **Kein Kommentar im neuen Code** | Ausdrücklicher Wunsch des Auftraggebers. Gilt für alles Neue in beiden Repos. Was erklärt werden muss, gehört in diese Datei — nicht in den Code. |
| 2026-08-31 | **Playtime und `manifestHash` kommen über zwei zusätzliche Abfragen statt über korrelierte Subqueries** | Die naheliegende Variante (`(SELECT SUM(…) WHERE p.instance_id = i.id)`) ist in pg-mem nicht testbar. Die Alternative — ein LEFT JOIN auf eine aggregierende Unterabfrage — wäre in Postgres ein Aggregat über die **gesamte** `cloud_instance_playtime`, weil der Planer den `user_id`-Filter nicht hineinschieben kann. Jetzt sind es zwei kleine Abfragen, deren `IN`-Liste durch `max_instances` (10) begrenzt ist. |
| 2026-08-31 | **`POST /api/cloud/instances` ist idempotent** | Eine bereits vorhandene aktive Instanz liefert 200 mit `created: false` statt eines Fehlers. Der Client wiederholt Aufrufe nach Netzabbrüchen; ein Fehler wäre hier ein Fehlalarm. Liegt die UUID im Papierkorb, gibt es 409 `instance_trashed` mit dem Hinweis auf `restore` — sonst würde ein Neuanlegen die alten Revisionen verwaisen lassen. |
| 2026-08-31 | **`head` setzt den 15-Tage-Timer nur mit `?touch=1` zurück** | `§E.6` nennt „head-Abfrage im Rahmen eines Starts". Der Launcher fragt `head` aber auch beim Blättern im Dashboard. Ein Parameter trennt beides und hält den Endpunkt ansonsten schreibfrei. |
| 2026-08-31 | **Der Papierkorb zählt nicht gegen das Instanzlimit, `restore` prüft es erneut** | Direkt aus `§E.5`. Ohne die zweite Prüfung könnte man über den Papierkorb auf 11 aktive Instanzen kommen. |
| 2026-08-31 | **Gemeinsame Test-Harness `tests/luxcloudHarness.js`** | Der Phase-1-Test hatte seine Infrastruktur inline. Bei zwei Testdateien wäre das eine Kopie gewesen, die auseinanderläuft. Die Harness stellt pg-mem, das Mini-Schema, den Express-App-Aufbau, eine gefälschte Session und `authorizeDevice()` bereit. |
| 2026-08-31 | **Neue Tabelle `blob_upload_claims`** (Ergänzung zu `§B`) | `§F.4` verlangt, dass ein Blob-Hash im Commit „in diesem Upload-Zyklus vom User gesendet" worden sein darf. Ohne eine Spur davon wäre das nicht prüfbar: frisch hochgeladene Blobs haben noch keine `blob_refs`. Ein Anspruch hält 24 h (`LUXCLOUD_UPLOAD_CLAIM_HOURS`) und wird vom GC mit aufgeräumt. Phase 5 prüft damit die Hashes im Commit. |
| 2026-08-31 | **`addRefs()` verlässt sich nicht auf `RETURNING` bei `ON CONFLICT`** | Erst fragen, welche Referenzen fehlen, dann genau die einfügen und hochzählen. Zwei Abfragen statt einer, dafür in jeder Engine dasselbe Ergebnis. Bei der wichtigsten Zahl des Systems ist das den Aufwand wert. |
| 2026-08-31 | **Fortsetzbare Uploads laufen über eine Datei auf der Serverplatte, nicht über S3-Multipart** | Ein Zwischenspeicher unter `LUXCLOUD_STAGING_DIR` funktioniert für **beide** Treiber gleich, macht die Hash-Prüfung trivial (die Datei liegt vollständig vor, bevor irgendetwas in den Bucket geht) und hinterlässt bei einem Abbruch nichts im Objektspeicher. S3-Multipart wäre schneller, aber nur für einen der beiden Treiber und deutlich fehleranfälliger. |
| 2026-08-31 | **Batch-Grenze 4 MB Nutzdaten statt 8 MB** | `§F.7` nennt 8 MB. Der globale `bodyParser.json`-Limit in `server.js` steht aber auf 8 MB, und base64 bläht um ein Drittel auf. 4 MB Nutzdaten (≈5,5 MB JSON) passen sicher darunter, ohne an einer bestehenden Einstellung zu drehen. Über `LUXCLOUD_MAX_BATCH_BYTES` änderbar. |
| 2026-08-31 | **`GET /api/cloud/me` liefert `capabilities`** | Kompression, Blob- und Batch-Grenzen kommen vom Server, statt im Client hartkodiert zu werden. Ohne das müsste der Client raten, ob die Serverumgebung zstd kann — und genau das ist je nach Node-Version unterschiedlich. |
| 2026-08-31 | **`routes/adminCloud.js` hat eine eigene Kopie von `ensureAdmin` und `logAdminAction`** | Beide stecken in `server.js` und sind nicht exportiert. `routes/api.js` hält es seit jeher genauso. Ein Export aus der 1800-Zeilen-Datei wäre der größere Eingriff gewesen. Die Audit-Zeilen landen in derselben Tabelle. |
| 2026-08-31 | **`LUXCLOUD_GC_DRY_RUN` steht in `.env.example` auf `true`** | Die Roadmap verlangt das ausdrücklich: erst eine Woche Logs beobachten, dann scharf schalten. Der GC ist die einzige Stelle im ganzen Feature, die dauerhaft Daten löscht. |
| 2026-08-31 | **Die Pfadprüfung arbeitet mit Zeichencodes statt mit einer Regex** | `§F.5` zeigt eine Regex mit `\\x00-\\x1f`. Funktional identisch, aber die Zeichencode-Variante liest sich klarer und übersteht jedes Werkzeug, das Backslash-Escapes verändert. Zusätzlich abgelehnt wird nicht normalisiertes Unicode (`NFC`), damit zwei Pfade nicht gleich aussehen und trotzdem verschieden sein können. |
| 2026-08-31 | **Der Chunk-Algorithmus ist eine Allowlist, kein Muster** | Der Server muss den Algorithmus kennen, um die Chunks später wieder zusammenzusetzen. Ein neuer Algorithmus soll den Server bewusst mit ändern, nicht stillschweigend durchrutschen. Aktuell nur `fastcdc-1M`. |
| 2026-08-31 | **Der `instance.json`-Eintrag im Manifest trägt die mtime der Datei auf der Platte, nicht `Date.now()`** | Zuerst stand dort die aktuelle Zeit — damit war das Manifest bei jedem Lauf ein anderes. Für Phase 6 wäre das fatal gewesen: jeder Sync hätte eine neue Revision erzeugt, obwohl sich nichts geändert hat. Der Test „beide Läufe erzeugen dasselbe Manifest" hält das jetzt fest. |
| 2026-08-31 | **Der Manifest-Bau läuft in `worker_threads`, nicht als `child_process.fork`** | `§D.1` verlangt einen Worker. Der bestehende `minecraftLaunchWorker.js` ist ein `fork` — für einen langlebigen Java-Prozess richtig, für reines Hashen unnötig teuer. `worker_threads` teilt sich den Speicher und startet schneller. |
| 2026-08-31 | **`uploads` ist Teil des Manifest-Ergebnisses** | Das Manifest allein sagt nicht, *woher* die Bytes kommen: eine Datei auf der Platte, ein Chunk mit Offset, eine erzeugte Chunk-Liste oder die normalisierte `instance.json`, die es auf der Platte gar nicht gibt. Ohne diese Liste müsste der Uploader das alles ein zweites Mal herleiten. |

---

## Arbeitsanweisung für die nächste Session

1. Diese Datei lesen, dann `01-ANALYSE.md`, dann den Abschnitt in
   `02-ARCHITEKTUR.md`, der zur aktuellen Phase gehört.
2. **Nicht** die Repos neu durchsuchen, außer die Analyse widerspricht dem Code.
   Wenn ja → unter „Korrekturen" eintragen.
3. Am Ende jeder Session **hier** aktualisieren: Fortschrittstabelle, „Nächster
   Schritt", Entscheidungslog.
4. Neuen Sync-Code **nicht** in `backend/handlers/instances.js` schreiben (6085 Zeilen)
   — alles nach `backend/luxcloud/`.
5. Neue Website-Routen **nicht** in `server.js` schreiben (1700 Zeilen Routen)
   — eigene Dateien unter `routes/`, in `server.js` nur `app.use()`.
   Wichtig: **vor** der Catch-All-Route `app.get('*')`, sonst fängt `index.html` ab.
6. Neue IPC-Kanäle heißen `luxcloud:*`, niemals `cloud:*` (belegt).
7. **Keine Kommentare im Code.** Ausdrücklicher Wunsch des Auftraggebers.
   Begründungen, Abwägungen und Fallstricke gehören in diese Datei.
8. Neue Website-Endpunkte bekommen eine eigene Testdatei unter `tests/`, die
   `luxcloudHarness.js` benutzt, plus einen Eintrag im Skript `test:cloud`.
   `npm run test:cloud` braucht keine Datenbank und kein Docker.
9. Neuer Client-Code bekommt Tests in `MCLC-Client/tests/`, aufrufbar über
   `npm run test:luxcloud`. Läuft ohne Electron.
11. `npm run luxcloud:preview -- --all` zeigt für die echten Instanzen dieses
   PCs, was ein Sync kosten würde. Reines Node, kein Electron, schreibt nichts.
10. **Die Pfadregeln stehen doppelt** — `Lux-Website/routes/manifestSchema.js`
   und `MCLC-Client/backend/luxcloud/pathRules.js`. Das ist Absicht (`§F.5`
   verlangt zwei unabhängige Prüfungen), aber die beiden Funktionen müssen
   **wortgleich** bleiben. Der Client-Test vergleicht sie automatisch, wenn
   beide Repos nebeneinander liegen. Wer eine ändert, ändert beide.
