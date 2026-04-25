import { info, warn, error, debug, trace } from "@tauri-apps/plugin-log";

/**
 * Universal logging utility for Lux Client.
 * Bridges frontend logs to the native Rust-based tauri-plugin-log.
 */
export const logger = {
  info: (message: string, ...args: any[]) => {
    const formatted = format(message, args);
    console.info(`[INFO] ${formatted}`);
    info(formatted).catch(console.error);
  },
  warn: (message: string, ...args: any[]) => {
    const formatted = format(message, args);
    console.warn(`[WARN] ${formatted}`);
    warn(formatted).catch(console.error);
  },
  error: (message: string, errorObj?: any, ...args: any[]) => {
    let formatted = format(message, args);
    if (errorObj) {
      if (errorObj instanceof Error) {
        formatted += `\nError: ${errorObj.message}\nStack: ${errorObj.stack}`;
      } else {
        formatted += `\nError Details: ${JSON.stringify(errorObj)}`;
      }
    }
    console.error(`[ERROR] ${formatted}`);
    error(formatted).catch(console.error);
  },
  debug: (message: string, ...args: any[]) => {
    if (import.meta.env.DEV) {
      const formatted = format(message, args);
      console.debug(`[DEBUG] ${formatted}`);
      debug(formatted).catch(console.error);
    }
  },
  trace: (message: string, ...args: any[]) => {
    if (import.meta.env.DEV) {
      const formatted = format(message, args);
      trace(formatted).catch(console.error);
    }
  }
};

function format(message: string, args: any[]): string {
  if (args.length === 0) return message;
  let formatted = message;
  args.forEach(arg => {
    const val = typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    formatted += ` ${val}`;
  });
  return formatted;
}

export default logger;
