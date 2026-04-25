import json
from pathlib import Path

def main():
    locales_dir = Path("src/locales")
    if not locales_dir.exists():
        locales_dir = Path("../src/locales")

    translations_map = {
        "en": {
            "dashboard": {
                "export_choice": {
                    "title": "Export Instance",
                    "description": "Choose how you want to export this instance.",
                    "code": "Export as Code", "file": "Export as .mcpack file",
                    "partial_load_warning": "Some content could not be read and will be skipped.",
                    "target_prefix": "Instance:"
                }
            },
            "settings": {
                "integration": {
                    "smart_log_analytics": "Smart Log Analytics",
                    "smart_log_analytics_desc": "Automatically analyze crashes and suggest fixes."
                }
            },
            "crash": {
                "title": "Game Crash Detected", "analysis": "Log Analysis",
                "no_issues": "We couldn't automatically identify the cause of this crash.",
                "view_log": "View Uploaded Log", "check_manually": "Please check the latest.log file manually."
            }
        },
        "de": {
            "dashboard": {
                "export_choice": {
                    "title": "Instanz exportieren",
                    "description": "Wähle, wie du diese Instanz exportieren möchtest.",
                    "code": "Als Code exportieren", "file": "Als .mcpack-Datei exportieren",
                    "partial_load_warning": "Einige Inhalte konnten nicht gelesen werden und werden übersprungen.",
                    "target_prefix": "Instanz:"
                }
            },
            "settings": {
                "integration": {
                    "smart_log_analytics": "Smart Log Analytics",
                    "smart_log_analytics_desc": "Analysiert Abstürze automatisch und schlägt Lösungen vor."
                }
            },
            "crash": {
                "title": "Spielabsturz erkannt", "analysis": "Log-Analyse",
                "no_issues": "Wir konnten die Ursache dieses Absturzes nicht automatisch identifizieren.",
                "view_log": "Hochgeladenes Protokoll ansehen", "check_manually": "Bitte überprüfe die Datei latest.log manuell."
            }
        },
        "de_ch": {
            "dashboard": {
                "export_choice": {
                    "title": "Instanz exportiere",
                    "description": "Wähl, wie du die Instanz exportiere wotsch.",
                    "code": "Als Code exportiere", "file": "Als .mcpack-Datei exportiere",
                    "partial_load_warning": "Es hät Inhält, wo nöd gläse worde sind und übersprunge wärde.",
                    "target_prefix": "Instanz:"
                }
            },
            "settings": {
                "integration": {
                    "smart_log_analytics": "Smart Log Analytics",
                    "smart_log_analytics_desc": "Analysiert Abstürz automatisch und schlaat Lösige vor."
                }
            },
            "crash": {
                "title": "Spielabsturz erchannt", "analysis": "Log-Analyse",
                "no_issues": "Mir händ d'Ursach vo dem Absturz nöd automatisch chöne identifiziere.",
                "view_log": "Ufegladnes Protokoll aaluege", "check_manually": "Bitte überprüef d'Datei latest.log manuell."
            }
        }
    }
    
    # Missing locales fallback maps for specific short languages that aren't en, de, de_ch
    fallback_shorts = ["es", "fr", "it", "pl", "pt", "ro", "ru", "sk", "sl", "sv"]
    # Provide English 'dashboard' to those:
    for short in fallback_shorts:
        if short not in translations_map:
            translations_map[short] = {"settings": translations_map["en"]["settings"], "crash": translations_map["en"]["crash"], "dashboard": translations_map["en"]["dashboard"]}

    for file in locales_dir.glob("*.json"):
        data = json.loads(file.read_text("utf-8"))
        file_name_stem = file.stem
        lang_code = file_name_stem.split('_')[0]
        
        source = translations_map.get(file_name_stem, translations_map.get(lang_code, translations_map["en"]))

        if "settings" not in data: data["settings"] = {}
        if "integration" not in data["settings"]: data["settings"]["integration"] = {}
        if "dashboard" not in data: data["dashboard"] = {}
        if "export_choice" not in data["dashboard"]: data["dashboard"]["export_choice"] = {}

        export_choice = source.get("dashboard", {}).get("export_choice", translations_map["en"]["dashboard"]["export_choice"])

        data["settings"]["integration"]["smart_log_analytics"] = source["settings"]["integration"].get("smart_log_analytics", translations_map["en"]["settings"]["integration"]["smart_log_analytics"])
        data["settings"]["integration"]["smart_log_analytics_desc"] = source["settings"]["integration"].get("smart_log_analytics_desc", translations_map["en"]["settings"]["integration"]["smart_log_analytics_desc"])

        data["dashboard"]["export_choice"]["title"] = export_choice["title"]
        data["dashboard"]["export_choice"]["description"] = export_choice["description"]
        data["dashboard"]["export_choice"]["code"] = export_choice["code"]
        data["dashboard"]["export_choice"]["file"] = export_choice["file"]
        data["dashboard"]["export_choice"]["partial_load_warning"] = export_choice["partial_load_warning"]

        data["crash"] = source["crash"]

        file.write_text(json.dumps(data, indent=4), "utf-8")
        label = file_name_stem if file_name_stem in translations_map else lang_code
        print(f"Updated {file.name} with {label} translations")

if __name__ == "__main__":
    main()
