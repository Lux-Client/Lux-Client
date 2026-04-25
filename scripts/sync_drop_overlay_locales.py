import json
from pathlib import Path

def main():
    locales_dir = Path("src/locales")
    if not locales_dir.exists():
        locales_dir = Path("../src/locales")
    
    defaults = {
        "drop_packs": "Drag and drop resource packs here to install",
        "drop_shaders": "Drag and drop shader packs here to install",
        "accepting_archives": "Accepting .zip and .rar files"
    }

    by_locale = {
        "de_de": {
            "drop_packs": "Resource Packs hierher ziehen und ablegen, um sie zu installieren",
            "drop_shaders": "Shader hierher ziehen und ablegen, um sie zu installieren",
            "accepting_archives": ".zip- und .rar-Dateien werden akzeptiert"
        },
        "de_ch": {
            "drop_packs": "Resource Packs da ahzoge zum Installiere",
            "drop_shaders": "Shader da ahzoge zum Installiere",
            "accepting_archives": ".zip und .rar Dateie wäre aktzeptiert"
        }
    }

    changed = 0
    files = list(locales_dir.glob("*.json"))
    for file in files:
        locale_id = file.stem
        raw = file.read_text("utf-8")
        data = json.loads(raw)

        if "instance_details" not in data:
            data["instance_details"] = {}
        if "content" not in data["instance_details"]:
            data["instance_details"]["content"] = {}

        values = by_locale.get(locale_id, defaults)
        local_changed = False
        
        for k, v in values.items():
            if data["instance_details"]["content"].get(k) != v:
                data["instance_details"]["content"][k] = v
                local_changed = True

        if local_changed:
            file.write_text(json.dumps(data, indent=4) + "\n", "utf-8")
            changed += 1

    print(f"Updated locale files: {changed}/{len(files)}")

if __name__ == "__main__":
    main()
