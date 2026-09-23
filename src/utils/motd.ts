export type MotdSegment = {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
};

type Style = Omit<MotdSegment, "text">;

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  dark_blue: "#0000AA",
  dark_green: "#00AA00",
  dark_aqua: "#00AAAA",
  dark_red: "#AA0000",
  dark_purple: "#AA00AA",
  gold: "#FFAA00",
  gray: "#AAAAAA",
  dark_gray: "#555555",
  blue: "#5555FF",
  green: "#55FF55",
  aqua: "#55FFFF",
  red: "#FF5555",
  light_purple: "#FF55FF",
  yellow: "#FFFF55",
  white: "#FFFFFF",
};

const LEGACY_CODES: Record<string, string> = {
  "0": "black",
  "1": "dark_blue",
  "2": "dark_green",
  "3": "dark_aqua",
  "4": "dark_red",
  "5": "dark_purple",
  "6": "gold",
  "7": "gray",
  "8": "dark_gray",
  "9": "blue",
  a: "green",
  b: "aqua",
  c: "red",
  d: "light_purple",
  e: "yellow",
  f: "white",
};

function resolveColor(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  if (NAMED_COLORS[color]) return NAMED_COLORS[color];
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return undefined;
}

// Splits a string with legacy §-codes into styled segments.
function parseLegacy(text: string, base: Style, out: MotdSegment[]) {
  let style: Style = { ...base };
  let buffer = "";

  const flush = () => {
    if (buffer) out.push({ text: buffer, ...style });
    buffer = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "§" && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      i++;
      flush();
      if (LEGACY_CODES[code]) {
        // A color code resets formatting, like in game.
        style = { color: NAMED_COLORS[LEGACY_CODES[code]] };
      } else if (code === "l") style = { ...style, bold: true };
      else if (code === "o") style = { ...style, italic: true };
      else if (code === "n") style = { ...style, underlined: true };
      else if (code === "m") style = { ...style, strikethrough: true };
      else if (code === "r") style = { ...base };
      continue;
    }
    buffer += ch;
  }
  flush();
}

function walk(component: unknown, inherited: Style, out: MotdSegment[], depth: number) {
  if (depth > 32 || component === null || component === undefined) return;

  if (typeof component === "string" || typeof component === "number") {
    parseLegacy(String(component), inherited, out);
    return;
  }

  if (Array.isArray(component)) {
    component.forEach((part) => walk(part, inherited, out, depth + 1));
    return;
  }

  if (typeof component !== "object") return;
  const c = component as Record<string, unknown>;

  const style: Style = {
    ...inherited,
    ...(resolveColor(c.color) ? { color: resolveColor(c.color) } : {}),
    ...(typeof c.bold === "boolean" ? { bold: c.bold } : {}),
    ...(typeof c.italic === "boolean" ? { italic: c.italic } : {}),
    ...(typeof c.underlined === "boolean" ? { underlined: c.underlined } : {}),
    ...(typeof c.strikethrough === "boolean" ? { strikethrough: c.strikethrough } : {}),
  };

  if (typeof c.text === "string" || typeof c.text === "number") {
    parseLegacy(String(c.text), style, out);
  } else if (typeof c.translate === "string") {
    parseLegacy(c.translate, style, out);
  }

  if (Array.isArray(c.extra)) {
    c.extra.forEach((part) => walk(part, style, out, depth + 1));
  }
}

export function parseMotd(motd: unknown): MotdSegment[] {
  const out: MotdSegment[] = [];
  walk(motd, {}, out, 0);
  return out;
}

export function motdToPlainText(motd: unknown): string {
  return parseMotd(motd)
    .map((segment) => segment.text)
    .join("");
}
