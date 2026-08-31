# 03 — Roadmap

12 Phasen. Jede Phase ist für sich lauffähig und einzeln testbar.
Reihenfolge ist bindend, wo Abhängigkeiten stehen.
Fortschritt wird in `STATUS.md` gepflegt, **nicht hier**.

Legende der Repos: **[C]** = `MCLC-Client`, **[W]** = `MCLC-Website`.

---

## Phase 0 — Fundament (Voraussetzung für alles)

**Ziel:** Die drei strukturellen Probleme aus `01-ANALYSE.md §2` beseitigen, ohne
irgendein Cloud-Feature zu bauen. Danach ist der Client sync-fähig, auch wenn es
noch keine Cloud gibt.

**Aufgaben**
1. [C] Stabile `instanceId` (UUID v4) in `instance.json` — beim Start vergeben,
   additiv, idempotent.
2. [C] Icon-Auslagerung: `data:`-URI → `icon.png`/`icon.svg`, Lesecode versteht beide.
3. [C] Playtime-Härtung: Session-Datei mit `lastHeartbeat` alle 60 s;
   verwaiste Sessions beim Start nachbuchen (behebt einen bestehenden Datenverlust-Bug).
4. [C] `backend/luxcloud/syncPolicy.js` + `hashCache.js` — reine Funktionen, ohne Netz.
5. [C] Entscheiden und dokumentieren: `backend/main.js` löschen oder als tot markieren.

**Betroffen**
`backend/handlers/instances.js` (nur `instance:create`, `getMergedInstances`,
`instance:rename`, `instance:duplicate`) · `backend/handlers/launcher.js:2296` ·
neu: `backend/luxcloud/{syncPolicy,hashCache}.js` · `electron/main.js` (Startup-Hook)

**Abhängigkeiten:** keine
**Risiken:** `instances.js` hat 6085 Zeilen und liest `instance.json` an vielen
Stellen — jede Stelle muss ein fehlendes `instanceId` tolerieren. Icon-Migration darf
niemals das Original verlieren (erst schreiben, dann `instance.json` ändern).
**Tests:** Unit-Tests für `syncPolicy` (Ein-/Ausschlussmuster inkl. Windows-Pfade) und
`hashCache` (Invalidierung über size/mtime). Manuell: 20 vorhandene Instanzen migrieren,
Playtime und Icons prüfen; Absturz simulieren (Task-Manager kill) → Playtime kommt an.

---

## Phase 1 — Account-Integration

**Ziel:** Der Client kann sich mit dem bestehenden Website-Account verbinden.
Sonst nichts. Kein Sync.

**Aufgaben**
1. [W] `routes/deviceAuth.js` — Zustimmungsseite, PKCE-Code, Token, Refresh, Revoke.
2. [W] Middleware `ensureDeviceAuth` (JWT) in `middleware/deviceAuth.js`.
3. [W] Tabelle `client_devices` + `user_cloud_settings` (`db_init_cloud.js`).
4. [W] `GET /api/cloud/me`, `GET/DELETE /api/cloud/devices`.
5. [W] `express-rate-limit` installieren und auf die Auth-Endpunkte legen.
6. [C] `backend/luxcloud/auth.js` — Systembrowser öffnen, `luxclient://auth`
   entgegennehmen, Tokens via `safeStorage` ablegen.
7. [C] `electron/main.js:889` — Deep-Link-Parser um `hostname === 'auth'` erweitern.
8. [C] `backend/luxcloud/api.js` — axios mit Auto-Refresh, 401-Retry, Offline-Erkennung.
9. [C] `preload.js`: `luxcloud:login/logout/get-account/list-devices/revoke-device`.
10. [C] `LuxAccountContext` + `LuxAccountPanel` in `Settings.tsx` (nur Login/Logout/Geräte).

**Betroffen**
[W] `server.js` (nur `app.use`), `db_init.js`, `.env.example`, neu `routes/deviceAuth.js`,
`middleware/deviceAuth.js`, `db_init_cloud.js`, `client/src/pages/AuthorizeDevice.jsx`
[C] neu `backend/luxcloud/{auth,api}.js`, `electron/main.js`, `backend/preload.js`,
`src/context/LuxAccountContext.tsx`, `src/components/cloud/LuxAccountPanel.tsx`,
`src/pages/Settings.tsx`

**Abhängigkeiten:** Phase 0 (nur lose)
**Risiken:** Deep Links sind auf Windows im Dev-Modus fummelig
(`setAsDefaultProtocolClient` mit `process.execPath` + `appPath`, siehe
`electron/main.js:956`) — früh auf einem gebauten Installer testen, nicht nur in `npm run dev`.
Refresh-Rotation kann bei Race Conditions User aussperren → ein 30-s-Gnadenfenster,
in dem der vorherige Token noch akzeptiert wird.
**Tests:** Login/Logout/Reconnect · Token-Ablauf (JWT-TTL auf 60 s stellen) ·
Refresh-Reuse → Kette invalidiert · gebannter User bekommt kein Token ·
Gerät auf der Website abmelden → Client bemerkt 401.

**Abnahme:** Nach diesem Punkt zeigt der Client „Angemeldet als beatv" und listet
die Geräte. Alles andere ist unverändert.

---

## Phase 2 — Backend / Datenbank

**Ziel:** Alle Cloud-Tabellen und die CRUD-Endpunkte für Instanzen — ohne Dateien.

**Aufgaben**
1. [W] Restliche Tabellen aus `02-ARCHITEKTUR.md §B` anlegen.
2. [W] `routes/cloud.js` — `GET /instances`, `POST /instances`, `PATCH`, `DELETE`,
   `POST /restore`, `GET /head`.
3. [W] `ownedInstance()`-Helper, einheitliches Fehlerformat, Quota-Prüfung
   (Instanzzahl).
4. [W] Papierkorb-Logik (`status='trashed'`).
5. [W] **`database.js`-Fallstricke verifizieren**: ein Insert in `blob_refs` und in
   `cloud_instance_playtime` testen — sie haben kein `id`-Feld und der Shim hängt
   automatisch `RETURNING id` an. Falls es knallt: `pool.raw.query` benutzen und
   das hier dokumentieren.

**Betroffen** [W] `db_init_cloud.js`, `routes/cloud.js`, `server.js`
**Abhängigkeiten:** Phase 1
**Risiken:** Der `database.js`-Shim (siehe oben) ist die wahrscheinlichste
Fehlerquelle der ganzen Phase.
**Tests:** Integrationstests gegen eine Wegwerf-Postgres-DB (Docker):
User A sieht Instanzen von User B nicht (404) · 11. Instanz → `instance_limit_reached` ·
`head` unter 20 ms · Papierkorb-Zyklus.

---

## Phase 3 — Storage Layer

**Ziel:** Blobs speichern und ausliefern, mit Refcounting und GC.

**Aufgaben**
1. [W] `storage/index.js` + `storage/s3.js` + `storage/fs.js`.
2. [W] `PUT /api/cloud/blobs/:hash` (Hash serverseitig nachrechnen, Content-Range),
   `POST /blobs/batch`, `GET /blobs/:hash` mit dem Besitz-Check aus `§F.4`.
3. [W] Refcount-Pflege in `blob_refs` / `blobs`.
4. [W] GC-Job + Reconcile-Job (`jobs/cloudGc.js`, `node-cron`).
5. [W] `POST /api/admin/cloud/gc/run`, `GET /api/admin/cloud/gc`.

**Betroffen** [W] neu `storage/`, `jobs/`, `routes/cloud.js`, `server.js`, `.env.example`,
`docker-compose.yml`
**Abhängigkeiten:** Phase 2
**Risiken:** GC ist die einzige Stelle, die dauerhaft Daten löscht — die
24-h-Karenz und der „refcount erneut prüfen"-Schritt sind **nicht** optional.
Zuerst mit `LUXCLOUD_GC_DRY_RUN=true` in Produktion laufen lassen und die Logs
eine Woche beobachten.
**Tests:** Upload mit falschem Hash → 400 · zwei User laden dieselbe Datei hoch →
ein Objekt, refcount 2 · fremder Hash → 404 · GC löscht nichts Referenziertes ·
Reconcile korrigiert manuell verfälschte refcounts · Resume nach Abbruch bei 50 %.

---

## Phase 4 — Instance Manifest

**Ziel:** Der Client kann ein korrektes Manifest bauen. Noch kein Netzwerk.

**Aufgaben**
1. [C] `manifest.js` — Baum scannen, Policy anwenden, hashen (im Worker),
   Quellen über `mod_cache.json` auflösen, `instance.json` normalisieren.
2. [C] `chunker.js` (FastCDC) — vorerst nur hinter einem Flag.
3. [C] Kompressionsheuristik (`§D.5`).
4. [W] Manifest-Validator (JSON-Schema + Pfadvalidierung `§F.5`) als
   `routes/manifestSchema.js` — **die Pfadregeln müssen auf beiden Seiten identisch sein.**
5. [C] Debug-Befehl „Manifest anzeigen" (Größen, Ausschlussgründe, Upload-Schätzung).

**Betroffen** [C] `backend/luxcloud/{manifest,chunker,hashCache,syncPolicy}.js`,
neuer Worker · [W] `routes/manifestSchema.js`
**Abhängigkeiten:** Phase 0
**Risiken:** Vollscan einer 8-GB-Instanz darf die UI nicht blockieren (Worker!).
Der Hash-Cache muss beim ersten Lauf ehrlich langsam sein dürfen — mit Fortschrittsanzeige.
**Tests:** Golden-File-Tests gegen echte Instanzen aus `%APPDATA%/lux/instances/`
(darunter „PVP MISCHE (Real)" mit dem 3-MB-`instance.json`) · Pfadvalidierung
mit Angriffsvektoren (`../`, `C:\`, `CON`, Trailing-Dot, NUL, Unicode-Tricks) ·
FastCDC: 1 Byte in der Mitte ändern → nur 1–2 Chunks ändern sich.

---

## Phase 5 — Upload / Download

**Ziel:** Eine Instanz vollständig hochladen und auf einem zweiten PC wiederherstellen.
**Das ist der erste Moment, in dem das Feature real ist.**

**Aufgaben**
1. [W] `POST /negotiate`, `POST /commit` (Transaktion + Optimistic Locking),
   `GET /manifest`.
2. [C] `uploader.js` — negotiate → Blobs (batch/parallel) → commit, mit Fortschritt.
3. [C] `downloader.js` — Auflösungskette lokal → Cache → Modrinth → Server,
   Staging + atomares `rename`, Runtime über `startBackgroundInstall`.
4. [C] `blobStore.js` — lokaler CAS-Cache mit Größenbegrenzung (LRU, Default 5 GB).
5. [C] `CloudTransferPanel` + `luxcloud:progress`-IPC.

**Betroffen** [W] `routes/cloud.js` · [C] `backend/luxcloud/{uploader,downloader,blobStore}.js`,
`src/components/cloud/CloudTransferPanel.tsx`, `preload.js`
**Abhängigkeiten:** 3 + 4
**Risiken:** Der Commit ist der heikelste Code im Projekt — eine falsch gesetzte
Transaktionsgrenze erzeugt Blobs ohne Refs oder Refs ohne Blobs. Explizit
`SELECT … FOR UPDATE` auf `cloud_instances`.
Der Restore darf **nie** außerhalb des Instanzordners schreiben.
**Tests:** End-to-End auf zwei Rechnern (oder zwei `userData`-Verzeichnissen):
hochladen, herunterladen, byte-genau vergleichen · Netz während des Uploads
abschalten → fortsetzen · Server während des Commits killen → keine halbe Revision ·
Restore auf einen PC, der die Mods schon hat → nahe 0 Bytes Traffic (messen!).

**Abnahme:** „Neuer PC, einloggen, Instanz herunterladen, spielen" funktioniert.

---

## Phase 6 — Inkrementeller Sync

**Ziel:** Die 4-KB-Config in der 8-GB-Instanz kostet 4 KB, nicht 8 GB.

**Aufgaben**
1. [C] Delta-Erkennung über Hash-Cache + Manifest-Vergleich.
2. [C] Auto-Sync-Trigger: nach Spielende, bei Instanz-Änderungen (debounced 30 s),
   App-Start, manuell.
3. [C] Welten-Chunking scharf schalten (`syncWorlds`).
4. [C] Lokaler Blob-Cache instanzübergreifend nutzen.
5. [W] Retention-Job (`§E.5`) inkl. Welt-Degradierung älterer Revisionen.
6. [W] `GET /revisions`, `POST /revisions/:rev/rollback` + `RevisionHistoryModal`.

**Betroffen** [C] `uploader.js`, `manifest.js`, `chunker.js` · [W] `jobs/cloudRetention.js`,
`routes/cloud.js` · [C] `src/components/cloud/RevisionHistoryModal.tsx`
**Abhängigkeiten:** Phase 5
**Risiken:** Auto-Sync darf keine Sync-Schleife erzeugen (Sync schreibt Dateien →
löst Sync aus). Lösung: während eines Restores ist der Watcher für die Instanz aus,
und der Vergleich läuft gegen Hashes, nicht gegen mtime allein.
**Tests:** eine Config ändern → Upload < 50 KB messen · 8 GB Instanz, nichts geändert →
Upload = 0 Bytes · Welt bespielen → nur geänderte Regionen · Rollback auf v9 und zurück.

---

## Phase 7 — Konfliktauflösung

**Ziel:** Zwei PCs, dieselbe Instanz, kein Datenverlust. Plus der Pre-Launch-Gate.

**Aufgaben**
1. [C] `conflict.js` — 3-Wege-Diff gegen die Basis-Revision.
2. [C] Automatik-Regeln aus `§D.7`; alles andere in den Dialog.
3. [C] Verlierersicherung nach `.lux-sync/conflicts/rev<N>/`.
4. [C] `PreLaunchSyncOverlay` + Einhängen in den Play-Button (Timeout 2,5 s).
5. [C]/[W] Advisory Lock: `POST /session`, Heartbeat, „wird gerade gespielt auf …".
6. [C] `SyncConflictModal`.

**Betroffen** [C] `backend/luxcloud/conflict.js`, `backend/handlers/launcher.js`
(Start-Hook), `src/components/cloud/{SyncConflictModal,PreLaunchSyncOverlay}.tsx` ·
[W] `routes/cloud.js`
**Abhängigkeiten:** Phase 6
**Risiken:** Der Play-Button ist die meistgenutzte Funktion des Clients — jede
Verzögerung oder Fehlfunktion hier ist maximal sichtbar. Deshalb: harter Timeout,
Fallback ist immer „starten", und ein Schalter „vor dem Start nicht prüfen".
**Tests:** Matrix aus `§D.7` durchspielen · beide PCs offline ändern, dann beide
online · Welt-Konflikt mit „beide behalten" · Server während des Gates nicht
erreichbar → Start nach ≤ 2,5 s.

---

## Phase 8 — Playtime-Sync

**Ziel:** 20 h + 15 h = 35 h, garantiert ohne Doppelzählung.

**Aufgaben**
1. [W] `PUT /playtime` mit Monotonie-Prüfung, `POST /session|heartbeat|end`.
2. [C] `playtime.js` — G-Counter, Sessiondatei, Crash-Recovery.
3. [C] Migration bestehender lokaler Playtime aufs Origin-Gerät.
4. [C] UI: Gesamt vs. dieses Gerät, Aufschlüsselung nach Geräten.
5. [W] Plausibilitätsgrenze (max 24 h pro Tag pro Gerät) → sonst Admin-Flag.

**Betroffen** [W] `routes/cloud.js` · [C] `backend/luxcloud/playtime.js`,
`backend/handlers/launcher.js`, `src/pages/InstanceDetails.tsx`, `src/pages/Dashboard.tsx`
**Abhängigkeiten:** Phase 2 (kann parallel zu 5–7 laufen)
**Risiken:** gering — der G-Counter ist konstruktiv sicher. Größte Gefahr ist eine
falsche Erstmigration (Playtime doppelt gutgeschrieben) → nur einmal, an ein Flag
`playtimeMigrated` in `state.json` gebunden.
**Tests:** zwei Geräte parallel spielen → Summe stimmt · dieselbe Meldung 5× senden →
unverändert · Absturz mitten in der Session → Zeit bis `lastHeartbeat` gebucht ·
Uhr zurückstellen → keine negative Zeit.

---

## Phase 9 — UI / UX und Onboarding

**Ziel:** Das Feature ist für einen normalen User bedienbar und verständlich.

**Aufgaben**
1. [C] `CloudStatusBadge` überall (Dashboard, Sidebar, Details).
2. [C] `CloudOnboardingModal` — Erstlogin-Auswahl in beide Richtungen (`§G.2`).
3. [C] Cloud-only-Instanzen im Dashboard + Filter.
4. [C] `InstanceSyncScopeEditor` mit echten Größen.
5. [C] Vollständiges `LuxAccountPanel` (Toggles, Speicherbalken, Geräte,
   „Cloud-Daten löschen", „Account löschen").
6. [C] i18n für alle neuen Texte (`src/locales/`).
7. [W] Dashboard-Abschnitt „Cloud" auf der Website.

**Betroffen** [C] `src/components/cloud/*`, `src/pages/{Dashboard,InstanceDetails,Settings}.tsx`,
`src/components/AppSidebar.tsx`, `src/locales/*` · [W] `client/src/pages/Dashboard.jsx`
**Abhängigkeiten:** 5–8
**Risiken:** Verwechslungsgefahr mit dem bestehenden „Cloud Backup"
(Google Drive/Dropbox) — Wording sauber trennen: **„Lux Cloud"** vs.
**„Backup zu Google Drive"**. Ggf. das alte Feature in „Externe Backups" umbenennen.
**Tests:** Erstlogin mit 0 / 1 / 20 lokalen Instanzen · Quota knapp voll ·
alle sieben Badge-Zustände erzwingen · Klickpfad ohne Account (nichts Cloud-artiges sichtbar).

---

## Phase 10 — Konto-Verwaltung, Ablauf, Admin

**Ziel:** Die Produktvorgaben aus `00-PROMPT.md §21` vollständig, plus Admin-Sicht.

**Aufgaben**
1. [W] `DELETE /api/user/delete` erweitern (`§F.8`) — **transaktional**, refcounts zuerst.
2. [W] `DELETE /api/cloud/me` (nur Cloud-Daten).
3. [W] 15-Tage-Job mit den vier Stufen aus `§E.6`, Notifications in die bestehende
   `notifications`-Tabelle + E-Mail über `email.js`.
4. [W] Admin-Tab `cloud` in `AdminPanel.jsx:205` + `CloudPanel.jsx` +
   `/api/admin/cloud/*`, jede Schreibaktion durch `logAdminAction`.
5. [C] Notifications im Client anzeigen (`NotificationContext` erweitern).
6. [C] „Account löschen"-Fluss mit doppelter Bestätigung und klarer Auflistung,
   was verschwindet und was lokal bleibt.

**Betroffen** [W] `server.js:1088`, `routes/adminCloud.js`, `jobs/cloudExpiry.js`,
`email.js`, `client/src/pages/AdminPanel.jsx`, `client/src/components/admin/CloudPanel.jsx` ·
[C] `src/context/NotificationContext.tsx`, `LuxAccountPanel.tsx`
**Abhängigkeiten:** Phase 3 (GC), Phase 9 (UI)
**Risiken:** **Höchstes Datenverlust-Risiko im ganzen Projekt.** Der Ablauf-Job
löscht automatisch Userdaten. Absicherung: erst mehrere Wochen im Dry-Run mit
Notifications, aber ohne Löschung; Soft-Delete mit 30 Tagen Papierkorb;
`LUXCLOUD_EXPIRY_DAYS` konfigurierbar; die offene Frage aus `§E.6` **vor** dem
Scharfschalten klären.
**Tests:** Account löschen → keine verwaisten Blobs, keine gültigen Tokens,
**lokale Dateien unangetastet** · Ablauf-Job mit manipulierten Zeitstempeln
(Tag 8/12/15/45) · Papierkorb-Wiederherstellung · Admin-Quota-Änderung greift sofort.

---

## Phase 11 — Testing und Härtung

**Ziel:** Belastbarkeit statt Funktionsumfang.

**Aufgaben**
1. Lasttest: 1.000 simulierte Geräte, je 3 Instanzen, gemischt Upload/Download.
2. Chaos-Tests: Netz mittendrin trennen, Server neu starten, Prozess killen,
   Platte volllaufen lassen.
3. Sicherheitsprüfung: `/security-review` über alle neuen Endpunkte;
   Pfad-Traversal, IDOR (User A ↔ User B), Token-Reuse, Quota-Umgehung.
4. Kostenmessung an echten Daten: Dedup-Faktor, Bytes pro User, Modrinth-Trefferquote
   → gegen die Schätzung in `§E.3` halten und `STATUS.md` aktualisieren.
5. Metriken: Sync-Dauer, Fehlerquote, Konfliktrate, GC-Durchsatz.
6. `docs/` für User: was wird synchronisiert, was nicht, wie funktioniert der Ablauf.

**Abhängigkeiten:** alle
**Risiken:** Wenn die Modrinth-Trefferquote deutlich unter ~70 % liegt, bricht die
Kostenrechnung. Früh messen (schon in Phase 4 möglich!) und ggf. CurseForge-Auflösung
nachrüsten.

---

## Phase 12 — Produktions-Launch

**Ziel:** Ausrollen, ohne dass ein Fehler alle User trifft.

**Aufgaben**
1. `LUXCLOUD_ENABLED` als globaler Killswitch, produktiv verifiziert.
2. Staged Rollout: interner Test → Beta-Flag für Freiwillige → 10 % → alle.
3. Postgres-Backups und Bucket-Lifecycle scharf.
4. Monitoring/Alarme: Storage-Wachstum, GC-Rückstand, 5xx-Rate, Commit-Konfliktrate.
5. Datenschutzerklärung und Nutzungsbedingungen ergänzen (was wir speichern, wie
   lange, wie gelöscht wird, 15-Tage-Regel).
6. Support-Runbook: „User meldet fehlende Instanz", „Storage voll", „Konflikt hängt".

**Risiken:** Der erste Massen-Upload erzeugt eine Traffic- und Speicherspitze mit
schlechter Dedup-Rate (der Pool ist noch leer). Rollout deshalb gestaffelt und
mit einem Speicher-Alarm bei 70 % des geplanten Budgets.

---

## Parallelisierbarkeit

```
Phase 0 ─┬─> Phase 1 ──> Phase 2 ─┬─> Phase 3 ─┐
         │                        │            ├─> Phase 5 ──> 6 ──> 7 ─┐
         └─> Phase 4 ─────────────┘            │                        ├─> 9 ─> 10 ─> 11 ─> 12
                                  └─> Phase 8 ─┘ (unabhängig von 5–7) ──┘
```
Phase 4 (Client-Manifest) und Phase 3 (Server-Storage) können von zwei Personen
gleichzeitig gebaut werden — sie treffen sich erst in Phase 5.
Phase 8 (Playtime) hängt nur an Phase 2 und ist der beste Kandidat, wenn zwischendurch
ein kleines, abgeschlossenes Stück gebraucht wird.

## Aufwandsschätzung (grob, eine Person)

| Phase | Aufwand |
|---|---|
| 0 Fundament | 2–3 Tage |
| 1 Account | 3–4 Tage |
| 2 Backend/DB | 2–3 Tage |
| 3 Storage | 4–5 Tage |
| 4 Manifest | 4–5 Tage |
| 5 Upload/Download | 5–7 Tage |
| 6 Inkrementell | 4–6 Tage |
| 7 Konflikte | 5–7 Tage |
| 8 Playtime | 2–3 Tage |
| 9 UI/UX | 6–8 Tage |
| 10 Konto/Ablauf/Admin | 4–5 Tage |
| 11 Testing | 5–8 Tage |
| 12 Launch | 2–3 Tage |
| **Summe** | **~48–67 Tage** |

Das ist eine Schätzung ohne Erfahrungswerte aus diesem Code — die Zahlen sind zum
Priorisieren da, nicht zum Zusagen.

## Minimal sinnvoller Ausschnitt (falls die Zeit knapp wird)
Phasen **0 + 1 + 2 + 3 + 4 + 5 + 8**. Das liefert:
Login, Upload, Download auf einem zweiten PC, korrekte Playtime.
Es fehlt dann: inkrementelles Sparen (jeder Sync lädt alle geänderten Dateien neu
hoch — bei ausgeschaltetem Welten-Sync verschmerzbar), Konfliktdialog (stattdessen
„Cloud gewinnt, lokal wird gesichert") und der Auto-Ablauf.
