# STATUS — Lux Cloud Sync

> **Für die nächste KI-Session: lies diese Datei zuerst.**
> Sie sagt dir, wo wir stehen und was als Nächstes dran ist.
> Du musst die Repos **nicht** neu analysieren — das steht in `01-ANALYSE.md`.

**Zuletzt aktualisiert:** 2026-08-31
**Aktuelle Phase:** Phase 1 — **fertig**, Phase 2 als Nächstes
**Geschriebener Code:** Client `backend/luxcloud/` (12 Module) + UI-Anbindung ·
Website `routes/deviceAuth.js`, `routes/cloud.js`, `middleware/deviceAuth.js`,
`db_init_cloud.js`, `tests/deviceAuth.phase1.test.js`, Zustimmungsseite

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
   (`01-ANALYSE.md §1`) — **in Phase 1 bestätigt und getestet**, siehe unten.
5. **`backend/handlers/cloudBackup.js` ist NICHT dieses Feature** — das sind
   BYO-Google-Drive/Dropbox-ZIP-Backups. Neuer Namespace: `luxcloud:*`.

---

## Fortschritt

| Phase | Status | Notizen |
|---|---|---|
| 0 Fundament | ✅ fertig | UUID, Icon-Auslagerung, Playtime-Härtung, syncPolicy, hashCache |
| 1 Account-Integration | ✅ fertig | PKCE-Geräte-Login, Bearer-JWT, Geräteliste, 37 grüne Tests |
| 2 Backend / DB | ⬜ offen | **als Nächstes** |
| 3 Storage Layer | ⬜ offen | R2-Account wird gebraucht |
| 4 Instance Manifest | ⬜ offen | |
| 5 Upload / Download | ⬜ offen | |
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

## Nächster Schritt

**Phase 2 — Backend / Datenbank** (siehe `03-ROADMAP.md`).
Die restlichen Tabellen aus `02-ARCHITEKTUR.md §B` in `db_init_cloud.js`
ergänzen und die Instanz-CRUD-Endpunkte in `routes/cloud.js` schreiben —
die Datei existiert bereits und hat mit `ensureCloudUser` / `ensureDeviceAuth`
alles, was sie braucht.

Der `database.js`-Shim wird in Phase 2 als „wahrscheinlichste Fehlerquelle"
genannt. Was Phase 1 dazu bereits gezeigt hat, steht unter „Korrekturen".

---

## Offene Punkte aus Phase 1

| # | Punkt | Warum offen |
|---|---|---|
| 1 | **Deep Link auf einem gebauten Installer testen.** Im Dev-Modus registriert `electron/main.js:977` das Protokoll mit `process.execPath` + `appPath`; das verhält sich anders als im Build. | Braucht `npm run dist` und eine Installation |
| 2 | **Ende-zu-Ende-Login gegen einen laufenden Server.** Lokal: Website mit Postgres starten, im Client `LUXCLOUD_BASE_URL=http://localhost:3001` setzen. | Braucht eine erreichbare Datenbank |
| 3 | `GET /api/cloud/me` liefert `quota.instanceCount: 0` fest verdrahtet | `cloud_instances` gibt es erst ab Phase 2 |
| 4 | `DELETE /api/cloud/me` („Cloud-Daten löschen") aus `§C.2` fehlt | Es gibt noch keine Cloud-Daten; gehört zu Phase 10 |
| 5 | `devserver.js` (Dev-Server ohne Postgres) kennt die Cloud-Routen nicht | Er hat keine Datenbank; der Cloud-Login braucht eine |
| 6 | Website-Dashboard-Abschnitt „Cloud" aus `§G.3` fehlt | Roadmap ordnet ihn Phase 9/10 zu |

---

## Offene Entscheidungen (brauchen den Auftraggeber)

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| 1 | **15-Tage-Regel:** Der Auftrag sagt „nicht angefasst von *einem anderen PC*". Wörtlich genommen verliert ein User mit nur einem PC seine Instanz, obwohl er täglich spielt. | Timer bei **jeder** Aktivität zurücksetzen, auch vom selben PC. Ersparnis praktisch identisch, Datenverlustrisiko weg. | ❓ offen |
| 2 | **Quota-Zahlen:** Der Auftrag nennt 5 GB / 10 Instanzen, das UI-Beispiel in §14 zeigt „2.4 GB / 10 GB". | 5 GB (die ausdrückliche Vorgabe gewinnt), UI-Beispiel war illustrativ. | ✅ so umgesetzt (`user_cloud_settings`-Defaults), rückgängig zu machen durch ein `ALTER TABLE`-Default |
| 3 | **Storage-Anbieter:** Cloudflare R2 (kein Egress-Preis) vs. Backblaze B2 vs. Hetzner. | R2 — dieses Feature ist download-lastig, Egress wäre sonst der Hauptkostenblock. **Wird in Phase 3 gebraucht.** | ❓ offen, jetzt dringend |
| 4 | **Welten-Sync standardmäßig aus?** | Ja, aus. Kostet sonst das 20-fache und ist der häufigste Konfliktfall. | ✅ so umgesetzt (`sync_worlds_default = FALSE`) |
| 5 | **Wording:** Das bestehende Drive/Dropbox-Feature heißt heute „Cloud Backup". | In „Externe Backups" umbenennen, damit „Cloud" eindeutig die Lux Cloud meint. | ❓ offen — Phase 1 hat die Trennung vorerst über die Kategorienamen gelöst („Lux Account" vs. „Cloud & Updates") |
| 6 | **CurseForge-Auflösung** zusätzlich zu Modrinth? | Erst nach der Messung in Phase 11. Wenn die Modrinth-Trefferquote < 70 % liegt, nachrüsten. | ⏸ später |

---

## Korrekturen an der Analyse

*(Hier eintragen, wenn sich etwas aus `01-ANALYSE.md` als falsch herausstellt —
mit Datum und Fundstelle.)*

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
7. Neue Website-Endpunkte bekommen einen Test in
   `tests/deviceAuth.phase1.test.js` oder einer Schwesterdatei daneben.
   `npm run test:cloud` braucht keine Datenbank.
