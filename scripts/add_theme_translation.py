import json
from pathlib import Path

def main():
    locales_dir = Path("src/locales")
    if not locales_dir.exists():
        locales_dir = Path("../src/locales")

    new_keys = {
        "common": {
            "theme_marketplace": "Theme Marketplace"
        },
        "extensions": {
            "theme_marketplace": "Theme Marketplace",
            "theme_marketplace_desc": "Discover and install custom themes built by the community."
        }
    }

    for file in locales_dir.glob("*.json"):
        try:
            data = json.loads(file.read_text("utf-8"))

            if "common" in data:
                for k, v in new_keys["common"].items():
                    if k not in data["common"]:
                        data["common"][k] = v

            if "extensions" in data:
                for k, v in new_keys["extensions"].items():
                    if k not in data["extensions"]:
                        data["extensions"][k] = v

            file.write_text(json.dumps(data, indent=4), "utf-8")
            print(f"Updated {file.name}")
        except Exception as e:
            print(f"Error updating {file.name}: {e}")

if __name__ == "__main__":
    main()
