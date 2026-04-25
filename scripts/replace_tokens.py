from pathlib import Path

def walk_dir(directory: Path):
    for path in directory.iterdir():
        if path.is_dir():
            yield from walk_dir(path)
        else:
            yield path

def main():
    modified_files = 0
    
    for directory in ["src/pages", "src/components"]:
        base_path = Path(directory)
        if not base_path.exists():
            base_path = Path("../" + directory)
            if not base_path.exists():
                continue
        
        for file in walk_dir(base_path):
            if file.suffix in (".tsx", ".ts"):
                content = file.read_text("utf-8")
                new_content = (content
                    .replace("bg-background", "bg-canvas")
                    .replace("bg-card", "bg-surface")
                    .replace("border-border", "border-stroke")
                )
                if new_content != content:
                    file.write_text(new_content, "utf-8")
                    print(f"Updated {file}")
                    modified_files += 1

    print(f"Successfully replaced legacy tokens in {modified_files} files.")

if __name__ == "__main__":
    main()
