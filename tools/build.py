import subprocess
import os
import sys
import platform

def run_command(command, cwd=None):
    print(f"Executing: {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd, shell=True)
    if result.return_code != 0:
        print(f"Command failed with exit code {result.return_code}")
        return False
    return True

def build_windows():
    print("Building for Windows...")
    return run_command(["bun", "run", "tauri", "build", "--target", "x86_64-pc-windows-msvc"])

def build_linux():
    print("Building for Linux...")
    # Typically needs separate targets or environments (e.g. AppImage, deb, rpm)
    return run_command(["bun", "run", "tauri", "build", "--target", "x86_64-unknown-linux-gnu"])

def build_macos():
    print("Building for macOS...")
    return run_command(["bun", "run", "tauri", "build", "--target", "x86_64-apple-darwin"])

def main():
    current_os = platform.system().lower()
    print(f"Current OS: {current_os}")
    
    # Ensure dependencies are installed
    if not run_command(["bun", "install"]):
        print("Failed to install JS dependencies")
        sys.exit(1)

    success = True
    
    # In a real cross-compilation environment, you'd use 'cross' or specialized CI.
    # This script attempts local builds or native compilation.
    if current_os == "windows":
        success &= build_windows()
    elif current_os == "linux":
        success &= build_linux()
    elif current_os == "darwin":
        success &= build_macos()
    else:
        print(f"Unsupported build host: {current_os}")
        sys.exit(1)

    if success:
        print("\nBuild completed successfully!")
    else:
        print("\nBuild failed for one or more platforms.")
        sys.exit(1)

if __name__ == "__main__":
    main()
