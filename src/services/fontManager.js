const STYLE_ID = "custom-launcher-fonts";

const FORMAT_MAP = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
};

const escapeFontValue = (value = "") =>
  String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export const syncCustomFonts = (customFonts = []) => {
  if (typeof document === "undefined") {
    return;
  }

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = customFonts
    .filter((font) => font?.family && font?.path)
    .map((font) => {
      const format = FORMAT_MAP[font.format] || "truetype";
      const family = escapeFontValue(font.family);
      const path = String(font.path).replace(/\\/g, "/");

      return `@font-face { font-family: '${family}'; src: url("app-media:///${path}") format('${format}'); font-weight: 100 900; font-style: normal; }`;
    })
    .join("\n");
};
