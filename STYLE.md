# Lux Client — Design Architecture & System Specification

## Aesthetic Philosophy: "Cinematic Precision"

Lux Client moves beyond the "utility launcher" trope to create a high-fidelity digital workspace. Built on the foundations of Elevated Glassmorphism and Bento-Grid layouts, the interface feels like a premium dashboard—prioritizing depth, purposeful motion, and tactile feedback.

### Core Visual Pillars

- **Glassmorphism 2.0:** We use ultra-high backdrop blurs (`blur-3xl`) and whisper-thin overlays (`bg-white/[0.02]`) to create physical depth without visual clutter.

- **Ambient Chromatic Depth:** The UI sits on a "Void Black" canvas (`bg-[#0a0a0a]`), punctuated by pulse-animated ambient glows. These glows act as the "heartbeat" of the engine, providing a living backdrop.

- **Bento Logic:** Information is organized into discrete, rounded containers (`rounded-[2rem]`). This modularity makes the complex feel simple and organized.

- **Physics-Based Motion:** Every transition uses sophisticated physics (via `framer-motion`). Scale transforms and staggered entries ensure the UI feels responsive and weighted, never "floaty."

---

## Core Systems Architecture

### 1. Seamless Access (Native OAuth)

We’ve replaced clunky browser redirects with a native Rust-based implementation of the Microsoft Device Flow.

- **In-App Login:** Uses secure `WebviewWindow` technology. Your credentials never leave the client environment.
- **Account Hot-Swapping:** Switch between accounts instantly without logging out. The account registry handles the tokens; you just handle the gameplay.

### 2. The Bento Library (Smart Instance Manager)

The Library isn't just a list; it's an intelligent index of your entire Minecraft ecosystem.

- **Zero-Wait Scanning:** Powered by Rust's `tokio` threads, the client discovers Modrinth, Curseforge, and local profiles in milliseconds.
- **Adaptive Visibility:** The library learns what you play. Smart filters hide the noise and prioritize your most-used versions.
- **Interactive Snapshots:** Hovering over an instance reveals "At-a-Glance" metadata—playtime, loader type, and version—with a smooth, tactile play button.

### 3. Harmonic Theme Engine

Lux avoids "flat" design. Our theme engine uses HSL-tailored accents to ensure every color choice feels intentional and easy on the eyes.

- **Global Accent Sync:** A single primary color ripples through the app, syncing progress bars, ambient glows, and button states.
- **Community Marketplace:** Browse and apply community-crafted presets directly within the client. Change your entire aesthetic with one click.

### 4. Smart Log Analytics (SLA)

Nobody likes reading raw crash logs. SLA translates technical "gibberish" into human-readable insights.

- **Proactive Interception:** The client monitors the game process in real-time. If something goes wrong, it doesn't just crash; it explains why.
- **One-Click Recovery:** In the event of an error, Lux provides a specialized diagnostic screen with one-click issue reporting and formatted stack traces ready for Discord or Support.

### 5. Hybrid Core Strategy (Rust & C++ Interop)

While Tauri uses Rust as its primary backbone, Lux Client utilizes a Hybrid Core for specific low-level operations.

- **When we use Rust:** For the majority of "Business Logic"—file I/O, IPC (Inter-Process Communication), UI state management, and safety-critical networking.
- **When we use C++:** We bridge into C++ via `autocxx` or `cxx` crates for:
  - **Legacy Library Hooks:** Interacting with existing C++ game modification frameworks or native libraries (like specialized JVM injectors).
  - **Low-Level Platform APIs:** Accessing Windows/macOS/Linux system hooks that haven't been fully abstracted into safe Rust wrappers yet.
  - **High-Intensity Math:** Specific computational benchmarks (like matrix math for 3D skin rendering previews) where C++ still holds a marginal optimization edge.

---

## Design Tokens

| Category | Value | Application |
|---|---|---|
| **Canvas** | `#0a0a0a` | The deep-black primary background |
| **Surface** | `rgba(255, 255, 255, 0.02)` | Bento card backgrounds |
| **Stroke** | `rgba(255, 255, 255, 0.05)` | Subtle card borders |
| **Radius** | `32px` (`2rem`) | Main container corners |
| **Blur** | `64px` | Overlay and modal depth |
| **Glow** | `blur(120px)` | Background atmosphere |

---

## Interactive Details

- **Buttons:** Feature a subtle `scale-95` on click and "inner-glow" translations on hover.
- **Sidebar:** Transitions smoothly from a space-saving icon rail to a fully labeled navigation list.
- **Soft Breathing:** Ambient glows pulse at 20% opacity, maintaining a sense of life without being a distraction during focus.
