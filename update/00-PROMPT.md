# Lux Cloud Sync — Original-Auftrag (Referenz)

> Dieses Dokument hält den ursprünglichen Auftrag fest, damit jede weitere KI-Session
> (auch auf einem anderen PC) ohne erneutes Nachfragen weiterarbeiten kann.
> **Nicht ändern.** Statusänderungen gehören nach `STATUS.md`.

**Datum des Auftrags:** 2026-08-30
**Repos:**
- Client: `C:\Users\beatv\Documents\GitHub\MCLC-Client` (Electron/React, "Lux")
- Website: `C:\Users\beatv\Documents\GitHub\MCLC-Website` (Express/Postgres, `lux.pluginhub.de`)

## Ziel in einem Satz

> "Ich installiere den Lux Client auf einem neuen PC, logge mich ein und meine
> Minecraft-Welt ist einfach wieder da." — und der Client funktioniert trotzdem
> vollständig **ohne** Lux Account.

## Kernanforderungen

### 1. Zwei Betriebsmodi
- **Ohne Lux Account:** Client läuft wie bisher. Nur der offizielle Microsoft/Mojang-Login.
  Instanzen bleiben rein lokal. Keine Cloud.
- **Mit Lux Account:** Anmeldung mit dem **bereits bestehenden** Account-System der Website.
  Danach werden synchronisiert: Instanzen, Instance-Metadaten, Playtime, ausgewählte
  Einstellungen, Mod-/Resourcepack-/Shader-Infos, zuletzt genutzte Instanzen.

### 2. Kein blindes Hochladen
Nicht der komplette Instanz-Ordner 1:1. Das System muss Speicher und Bandbreite
intelligent nutzen: File Hashes, Chunking, inkrementelle Updates, Deduplizierung,
Kompression, Delta-Sync. Beispiel: 8-GB-Instanz, 4-KB-Config geändert → es dürfen
nicht 8 GB erneut hochgeladen werden.

### 3. Mehrere PCs
PC 1 erstellt "Skyblock" (Version, Loader, Mods, Configs, Resourcepacks, Shader, Saves),
spielt 42 h. PC 2 meldet sich mit demselben Account an und muss unterscheiden können
zwischen **Local Instances** und **Cloud Instances** und selbst entscheiden, welche
Cloud-Instanz lokal verfügbar gemacht wird.

### 4. Erstlogin-Modul
Beim ersten Login auf einem Client: Auswahl-Dialog "welche lokalen Instanzen hochladen"
bzw. "welche Cloud-Instanzen herunterladen".

Beispiel-UI aus dem Auftrag:

```
We found 5 local instances.

[x] Skyblock
[x] Vanilla Survival
[ ] Test
[x] PvP
[ ] Development

[ Upload selected ]
```

### 5. Was wird synchronisiert
- **Ja:** Instance-Konfiguration, MC-Version, Loader-Version, Mods + Mod-Versionen,
  Configs, Resourcepacks, Shaderpacks, Metadaten, Playtime, zuletzt gestartete Version,
  Saves/Worlds *falls vom User aktiviert*, ggf. Screenshots (optional).
- **Nein:** Minecraft Libraries, Loader Libraries, Assets, alles was erneut heruntergeladen
  werden kann, Cache- und Temp-Dateien.
- Der Client soll erkennen: was muss wirklich in die Cloud, was kann der Ziel-PC einfach
  neu herunterladen?

### 6. Platform-/Instance-Sync
Der User legt pro Instanz fest: nur dieser PC / mit Cloud Sync / auf allen PCs /
nicht auf andere Plattformen übertragen. "Cross-Platform" muss technisch definiert
werden inkl. Umgang mit inkompatiblen Dateien.

### 7. Konflikte
Zwei PCs ändern dieselbe Instanz (PC1: 42 h, Config A = X; PC2: 45 h, Config A = Y).
Es darf nicht blind überschrieben werden.
**Vom Auftraggeber gewünschtes System:** Der Launcher prüft **vor jedem Start**, ob die
lokalen Dateien der Instanz noch aktuell zur Cloud sind. Wenn nein → erst updaten, dann
starten. Wenn ja → direkt starten.

### 8. Playtime Sync
PC1 20 h + PC2 15 h = 35 h auf dem Account. Doppelzählung und Fehlzählung bei mehreren
gleichzeitig laufenden Clients muss verhindert werden.

### 9. Account Authentication
Das **bestehende** Account-System der Website verwenden. Zuerst analysieren: aktuelle
Authentifizierung, Backend-Technologie, Datenbank, Session-/Token-Verwaltung, vorhandene
APIs, sichere Client-Authentifizierung, fehlende Endpunkte, neue Tabellen.
**Keine zweite, unabhängige User-Datenbank für den Client.**

### 10./11. Backend, Cloud-Infrastruktur, Speicheroptimierung
Vollständige Cloud-Architektur. Besonders wichtig: Speicheroptimierung.
Bei 100.000 Usern mit je mehreren Instanzen wäre "Instance = ZIP" extrem teuer.
Zu untersuchen: Kompression, Chunk Storage, Content-Addressable Storage, Deduplizierung,
hash-basierte Speicherung, inkrementelle Backups, gemeinsame Libraries, Wiederverwendung,
Lifecycle Policies, Storage Limits.
Beispiel: 100 User nutzen dieselbe 200-MB-Mod → darf nicht 100-mal gespeichert werden.

### 12. Sicherheit
Authentication, Authorization, User-Isolation, Token-Sicherheit, HTTPS,
Upload-Validierung, Path-Traversal-Schutz, Malware-/Datei-Risiken, Rate Limits,
Storage Limits, Abuse Prevention, Account-Löschung, Datenlöschung, Backups,
Verschlüsselung, Zugriff auf Cloud-Dateien.
**Ein User darf niemals Zugriff auf die Daten eines anderen Users bekommen.**

### 13. Offline
Client muss offline funktionieren. Playtime steigt offline, wird nach Rückkehr der
Verbindung synchronisiert. Lokale Sync Queue / zuverlässiges Offline-Sync-System.

### 14. UI/UX
Sichtbare Zustände: `Synced`, `Syncing...`, `Conflict`, `Offline`, `Up to date`.

Instanz-Menü, Beispiel aus dem Auftrag:
```
Skyblock
  Cloud       Synced
  Last Sync   Today, 21:43
  Playtime    42h 17m
```

Globale Account-Einstellungen, Beispiel aus dem Auftrag:
```
Lux Account   beatv
  Cloud Sync        ON
  Auto Sync         ON
  Cross-Platform    ON
  Sync Worlds       OFF
  Sync Screenshots  OFF
  Storage           2.4 GB / 10 GB
```

### 15./16. Import und Restore
Erstlogin erkennt lokale, noch nicht hochgeladene Instanzen.
Beim Download auf einem neuen PC soll anhand Manifest/Hashes erkannt werden, was schon da
ist (MC-Version, Fabric, Mod A) und nur der Rest geladen werden.

### 17. Versionierung / Backups
Cloud-Instanzen versioniert (v12 heute, v11 heute, v10 gestern, v9 vor 3 Tagen),
Wiederherstellung älterer Versionen möglich, mit sinnvoller Retention Policy
unter Berücksichtigung der Storage-Kosten.

### 18. Admin
Das bestehende Admin-Panel erweitern.

### 19. Vorgehen (ausdrückliche Vorgabe)
Erst das komplette Repository analysieren, Architektur verstehen, Client/Backend/Website
identifizieren, bestehendes Account- und Instance-System analysieren, vorhandene APIs und
Datenmodelle identifizieren, Breaking Changes finden, wiederverwendbare Teile prüfen.
**Nicht einfach neue Systeme daneben bauen.**
Reihenfolge: analysieren → Architektur → Datenmodell/API → Sync-System → schrittweise
implementieren.

### 20. Erwartete Liefergegenstände
Ein vollständiger technischer Plan mit den Abschnitten:
A Architektur · B Datenmodell · C API (Methode, Endpoint, Request, Response, Auth, Zweck) ·
D Sync Engine (Hashing, Manifest, Chunking, Dedup, Kompression, Upload, Download,
Delta Sync, Conflict Resolution, Offline Queue) · E Storage · F Security (Bedrohungsmodell) ·
G UI/UX · H Migration · I Edge Cases · J Roadmap in Phasen mit Ziel, Aufgaben, betroffenen
Dateien, Abhängigkeiten, Risiken, Tests.

Genannte Edge Cases: User offline · PC während Upload aus · Upload bricht ab · Download
bricht ab · zwei PCs ändern dieselbe Instanz · Instanz lokal gelöscht · Instanz in Cloud
gelöscht · Account gelöscht · Speicherlimit erreicht · beschädigte Dateien · inkompatible
Mods · unterschiedliche Betriebssysteme · unterschiedliche MC-Versionen · Cross-Platform
deaktiviert · gleichzeitig eingeloggte PCs.

Genannte Roadmap-Phasen: 1 Account Integration · 2 Backend/Database · 3 Storage Layer ·
4 Instance Manifest · 5 Upload/Download · 6 Incremental Sync · 7 Conflict Resolution ·
8 Playtime Sync · 9 UI/UX · 10 Testing · 11 Production Launch.

### 21. Harte Produktvorgaben (Zahlen)
- Kontoeinstellungen im Client, in denen alles verwaltet wird.
- **Konto löschen möglich → dann geht alles weg, inklusive Cloud.**
- **5 GB Speicher pro User.**
- **Maximal 10 Instanzen in der Cloud pro User.**
- **Auto-Löschung:** Wird eine Cloud-Instanz 15 Tage lang nicht angefasst, wird sie
  automatisch gelöscht. Es soll Notifications dazu geben.

### 22. Nachtrag vom 2026-08-31 — Instanz-UUID

Ausdrückliche Ergänzung des Auftraggebers:

> **Jede Cloud-Instanz hat eine UUID.**

Das ist damit eine **bestätigte Vorgabe**, keine Empfehlung mehr. Die UUID ist die
Identität einer Instanz über alle PCs hinweg — nicht der Ordnername, nicht der
Anzeigename. Umbenennen, Verschieben oder Kopieren ändern sie nicht.

Umsetzung siehe:
- `02-ARCHITEKTUR.md §B` — Spalte `cloud_instances.instance_uuid`,
  `UNIQUE (user_id, instance_uuid)`
- `02-ARCHITEKTUR.md §B.2` — Feld `instanceId` im Manifest
- `03-ROADMAP.md` Phase 0, Aufgabe 1 — Vergabe in `instance.json`

### 23. Arbeitsweise über mehrere Sessions
Der Auftrag ist zu groß für eine Session. Prompt und aktueller Stand müssen laufend
schriftlich festgehalten werden, damit eine andere KI (auch von einem anderen PC)
weiterarbeiten kann, ohne alles neu zu analysieren.
→ Das ist der Zweck dieses Ordners. Siehe `STATUS.md`.
