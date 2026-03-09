import type React from "react";
import type ReactDOM from "react-dom";

export {};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    React: typeof React;
    ReactDOM: typeof ReactDOM;
    Lux_API: Record<string, unknown>;
  }
}
