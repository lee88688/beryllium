/**
 * 11 套配色（对齐 `data/prototype/content.js#THEME_SEEDS`）。
 *
 * 每套只声明三个种子：背景 / 前景 / 主操作色。其余层级色（surface、发丝线、
 * 悬停、次要文字、主操作浅底）全部由 `src/styles/app.css` 用 `color-mix` 从这三个
 * 推导 —— 所以加配色不需要改样式表，也不会出现某套配色单独跑偏。
 *
 * 明暗两套同属一个配色名（`scheme` 由 `themeMode` 决定），对齐原型的
 * `{ name, scheme }` 存储模型。
 */

export const PALETTE_NAMES = [
  "default",
  "gray",
  "sepia",
  "grass",
  "cherry",
  "sky",
  "solarized",
  "gruvbox",
  "nord",
  "contrast",
  "sunset",
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

/** 明色 / 暗色。读取器正文与界面共用同一套。 */
export type PaletteScheme = "light" | "dark";

/** `[背景, 前景, 主操作]`。 */
export type PaletteSeeds = readonly [string, string, string];

export interface PaletteDefinition {
  label: string;
  light: PaletteSeeds;
  dark: PaletteSeeds;
}

export const PALETTES: Record<PaletteName, PaletteDefinition> = {
  default: {
    label: "默认",
    light: ["#ffffff", "#171717", "#0066cc"],
    dark: ["#222222", "#e0e0e0", "#77bbee"],
  },
  gray: {
    label: "灰",
    light: ["#e0e0e0", "#222222", "#4488cc"],
    dark: ["#444444", "#c6c6c6", "#88ccee"],
  },
  sepia: {
    label: "牛皮纸",
    light: ["#f1e8d0", "#5b4636", "#008b8b"],
    dark: ["#342e25", "#ffd595", "#48d1cc"],
  },
  grass: {
    label: "草木",
    light: ["#d7dbbd", "#232c16", "#177b4d"],
    dark: ["#333627", "#d8deba", "#a6d608"],
  },
  cherry: {
    label: "樱桃",
    light: ["#f0d1d5", "#4e1609", "#de3838"],
    dark: ["#462f32", "#e5c4c8", "#ff646e"],
  },
  sky: {
    label: "天空",
    light: ["#cedef5", "#262d48", "#2d53e5"],
    dark: ["#282e47", "#babee1", "#ff646e"],
  },
  solarized: {
    label: "Solarized",
    light: ["#fdf6e3", "#586e75", "#268bd2"],
    dark: ["#002b36", "#93a1a1", "#268bd2"],
  },
  gruvbox: {
    label: "Gruvbox",
    light: ["#fbf1c7", "#3c3836", "#076678"],
    dark: ["#282828", "#ebdbb2", "#83a598"],
  },
  nord: {
    label: "Nord",
    light: ["#eceff4", "#2e3440", "#5e81ac"],
    dark: ["#2e3440", "#d8dee9", "#88c0d0"],
  },
  contrast: {
    label: "高对比",
    light: ["#ffffff", "#000000", "#4488cc"],
    dark: ["#000000", "#ffffff", "#88ccee"],
  },
  sunset: {
    label: "日落",
    light: ["#fff7f0", "#423126", "#fe6b64"],
    dark: ["#3c2b25", "#f6e1d7", "#ff9c94"],
  },
};

/** 与 `THEME_STORAGE_KEY` 并列的第二个本地偏好（同一个存储约定）。 */
export const PALETTE_STORAGE_KEY = "palette";

export const DEFAULT_PALETTE: PaletteName = "default";

export function isPaletteName(value: unknown): value is PaletteName {
  return (
    typeof value === "string" &&
    (PALETTE_NAMES as readonly string[]).includes(value)
  );
}

/** Persisted palette name; `default` when absent/unavailable (SSR, jailed storage). */
export function readStoredPalette(): PaletteName {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPaletteName(stored) ? stored : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** 相对亮度（WCAG 公式），只用来给主操作按钮挑可读的标签色。 */
function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (raw: number) => {
    const ratio = raw / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

/** WCAG 对比度（1–21）。 */
function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * 主操作按钮上的文字色。
 *
 * 原型用「配色自己的背景色」当按钮文字（`--primary-fg = palette.bg`），浅色配色里
 * 会变成浅字浅底：樱桃（#de3838 上的 #f0d1d5）≈2.9:1、牛皮纸（#008b8b 上的
 * #f1e8d0）≈2.9:1，都低于 4.5:1。改成在黑白两色（纯黑/纯白：接近黑的 #141414
 * 会把对比度白白丢掉约 12%）里取对比度更高的那个 —— 22 个组合最差 5.0:1。
 */
function primaryForeground(primary: string): string {
  return contrastRatio(primary, "#000000") >= contrastRatio(primary, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/**
 * Writes the three seeds onto `<html>`. Everything else in the design system
 * derives from them, so this is the *only* place a palette touches the DOM.
 *
 * Inline custom properties win over both `:root` and `.dark`, which is why the
 * palette keeps working whichever scheme class is active.
 */
export function applyPalette(
  name: PaletteName,
  scheme: PaletteScheme,
  target?: Document | null,
): void {
  const doc = target ?? (typeof document === "undefined" ? null : document);
  if (!doc) return;
  const [bg, fg, primary] = PALETTES[name][scheme];
  const style = doc.documentElement.style;
  style.setProperty("--bg", bg);
  style.setProperty("--fg", fg);
  style.setProperty("--primary", primary);
  style.setProperty("--primary-foreground", primaryForeground(primary));
}

/**
 * Head-inline, pre-paint script for the palette half of the theme (the scheme
 * half lives in `theme-provider.tsx#themeInitScript`). Generated from
 * `PALETTES` so the two can never drift. Must stay dependency-free.
 */
export const paletteInitScript = `(function(){try{var P=${JSON.stringify(
  Object.fromEntries(
    PALETTE_NAMES.map((name) => [
      name,
      (["light", "dark"] as const).map((scheme) => {
        const [bg, fg, primary] = PALETTES[name][scheme];
        return [bg, fg, primary, primaryForeground(primary)].join(",");
      }),
    ]),
  ),
)};var n=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});if(!Object.hasOwn(P,n))n=${JSON.stringify(DEFAULT_PALETTE)};var d=document.documentElement.classList.contains("dark");var s=(d?P[n][1]:P[n][0]).split(",");var e=document.documentElement.style;e.setProperty("--bg",s[0]);e.setProperty("--fg",s[1]);e.setProperty("--primary",s[2]);e.setProperty("--primary-foreground",s[3])}catch(e){}})();`;
