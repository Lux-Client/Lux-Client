import json
from pathlib import Path

def main():
    locales_dir = Path("src/locales")
    if not locales_dir.exists():
        locales_dir = Path("../src/locales")
        
    translations = {
        "en": {
            "profile": "Java Performance Profile",
            "desc_global": "Aikar's Flags are recommended for most modded instances to prevent 'micro-stuttering'.",
            "desc_instance": "Overrides the global launcher setting for this instance."
        },
        "de": {
            "profile": "Java-Performance-Profil",
            "desc_global": "Aikar's Flags werden für die meisten gemoddeten Instanzen empfohlen, um 'Micro-Stuttering' zu verhindern.",
            "desc_instance": "Überschreibt die globale Launcher-Einstellung für diese Instanz."
        },
        "es": {
            "profile": "Perfil de rendimiento de Java",
            "desc_global": "Los parámetros de Aikar se recomiendan para la mayoría de las instancias con mods para evitar micro-tirones.",
            "desc_instance": "Sobrescribe el ajuste global del lanzador para esta instancia."
        },
        "fr": {
            "profile": "Profil de performance Java",
            "desc_global": "Les drapeaux d'Aikar sont recommandés pour la plupart des instances moddées pour éviter les micro-saccades.",
            "desc_instance": "Remplace le paramètre global du lanceur pour cette instance."
        },
        "it": {
            "profile": "Profilo di prestazioni Java",
            "desc_global": "I parametri di Aikar sono consigliati per la maggior parte delle istanze moddate per prevenire micro-scatti.",
            "desc_instance": "Sovrascrive l'impostazione globale del launcher per questa istanza."
        }
    }
    
    search_keys_to_remove = [
        "search_placeholder", "no_results", "navigate", 
        "select", "results", "press_enter"
    ]
    
    for file in locales_dir.glob("*.json"):
        lang = file.stem.split('_')[0]
        trans = translations.get(lang, translations["en"])
        
        print(f"Processing {file.name}...")
        data = json.loads(file.read_text("utf-8"))
        
        if "common" in data:
            for k in search_keys_to_remove:
                data["common"].pop(k, None)
                
        if "settings" in data and "memory" in data["settings"]:
            data["settings"]["memory"]["java_profile"] = trans["profile"]
            data["settings"]["memory"]["java_profile_desc"] = trans["desc_global"]
            
        if "instance_settings" in data and "java" in data["instance_settings"]:
            data["instance_settings"]["java"]["profile_label"] = trans["profile"]
            data["instance_settings"]["java"]["profile_desc"] = trans["desc_instance"]
            
        file.write_text(json.dumps(data, indent=4), "utf-8")
        
    print("All locale files updated.")

if __name__ == "__main__":
    main()
