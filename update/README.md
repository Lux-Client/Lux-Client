# Lux Cloud Sync

Planungs- und Übergabeordner für das große Update: **Lux Accounts + Cloud Sync +
plattformübergreifende Instanz-Synchronisierung**.

> Arbeitest du hier zum ersten Mal (Mensch oder KI)? → **[STATUS.md](STATUS.md)** zuerst.

| Datei | Inhalt |
|---|---|
| [STATUS.md](STATUS.md) | **Einstiegspunkt.** Fortschritt, nächster Schritt, offene Entscheidungen, Entscheidungslog |
| [00-PROMPT.md](00-PROMPT.md) | Der Auftrag im Original. Unveränderlich. |
| [01-ANALYSE.md](01-ANALYSE.md) | Ist-Zustand beider Repos + 10 Fallstricke. Ersetzt eine erneute Analyse. |
| [02-ARCHITEKTUR.md](02-ARCHITEKTUR.md) | A Architektur · B Datenmodell · C API · D Sync-Engine · E Storage · F Security · G UI/UX · H Migration · I Edge Cases |
| [03-ROADMAP.md](03-ROADMAP.md) | J Roadmap: Phasen 0–12 mit Aufgaben, Dateien, Abhängigkeiten, Risiken, Tests |

## Das Ziel

> „Ich installiere den Lux Client auf einem neuen PC, logge mich ein und meine
> Minecraft-Welt ist einfach wieder da."
> — und der Client funktioniert weiterhin vollständig **ohne** Lux Account.

## Der Kerngedanke in einem Absatz

Eine Instanz wird nicht als ZIP hochgeladen, sondern als **Manifest** beschrieben:
eine Liste aus Pfad + SHA-256 + Herkunft. Alles, was reproduzierbar ist
(Minecraft-Runtime, Libraries, Assets) und alles, was von Modrinth nachladbar ist
(die meisten Mods, Resourcepacks, Shader) wird **nur referenziert, nie gespeichert**.
Der schmale Rest — Configs, private Mods, Serverliste, optional Welten — landet
deduppliziert und komprimiert in einem globalen Content-Addressable Store.
Aus nominell 1.200 TB für 100.000 User werden so **2–4 TB**.
