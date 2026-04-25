# Tech Stack

## Frontend

- **Framework**: React 18 + Vite 7
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 3
- **Animation**: Framer Motion 12
- **UI Components**: Radix UI (multiple packages)
- **Icons**: Lucide React, Heroicons React
- **Tables**: react-window, react-virtualized-auto-sizer
- **3D**: skinview3d (Minecraft skin viewer)
- **Notifications**: Sonner

## Backend (Tauri / Rust) - v1.7+

- **Runtime**: Tauri 2 (Rust)
- **Language**: Rust 1.80+ / TypeScript
- **State Management**: Rust-based persistent storage
- **Parallelism**: Rayon, Tokio (Async I/O)
- **I/O**: Standard FS + tokio-fs
- **Compression**: zip-rs, flate2, tar

## Backend (Legacy Embedded Express) - < v1.7

- **Runtime**: Electron 40
- **Framework**: Express.js
- **Language**: TypeScript
- **Rate Limiting**: express-rate-limit
- **CSRF Protection**: csrf-csrf
- **HTTP Client**: Axios
- **File Handling**: adm-zip, archiver, jszip, fs-extra

## Minecraft Integration (v1.7+)

- **Launcher Core**: Custom Rust-based high-performance implementation.
- **Auth**: Microsoft OAuth via Tauri WebView.
- **Dependency Management**: Parallel async downloads (tokio).
- **Verification**: CPU-parallel SHA1 hashing (rayon).

## Minecraft Integration (Legacy)

- **Launcher Core**: minecraft-launcher-core
- **Auth**: msmc
- **Process Management**: pidtree, pidusage

## Dev Tools & Runtime

- **Package Manager**: Bun 1.2+ (Recommended)
- **Linting**: ESLint 9
- **Type Checking**: TypeScript
- **PostCSS**: Autoprefixer
- **i18n**: i18next, react-i18next
