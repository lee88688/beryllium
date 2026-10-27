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

/** 主操作按钮标签的最低对比度（WCAG AA，正常字重/字号）。 */
const BUTTON_CONTRAST = 4.5;

/** 按比例压暗 sRGB 三通道；保留色相，用来把按钮表面或标签拉到目标对比度。 */
function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = Math.round(((value >> 16) & 255) * factor);
  const green = Math.round(((value >> 8) & 255) * factor);
  const blue = Math.round((value & 255) * factor);
  return `#${((1 << 24) + (red << 16) + (green << 8) + blue)
    .toString(16)
    .slice(1)}`;
}

/** 从 `start` 往黑色方向逐档压暗，返回第一个达到对比度要求的颜色。 */
function darkenUntilContrast(start: string, against: string): string {
  for (let factor = 0.96; factor > 0.02; factor -= 0.04) {
    const candidate = shade(start, factor);
    if (contrastRatio(candidate, against) >= BUTTON_CONTRAST) return candidate;
  }
  return "#000000";
}

export interface PrimaryButtonColors {
  /** 按钮表面；明色下可能比 `--primary` 略暗，其他主色用法不受影响。 */
  background: string;
  /** 按钮标签。 */
  foreground: string;
}

/**
 * 按配色与明暗推导主操作按钮的「表面 + 标签」。
 *
 * 原型让标签色等于配色背景（`--primary-fg = palette.bg`），但浅色配色的主操作色
 * 托不住浅色字：樱桃（#de3838 上的 #f0d1d5）≈2.9:1、牛皮纸（#008b8b 上的
 * #f1e8d0）≈2.9:1。现在明色统一用白字，只把不够暗的按钮表面压到 4.5:1，
 * `--primary` 本身不动 —— 开关、进度、焦点环仍保持配色原色。
 *
 * 暗色相反：主操作色偏亮，标签取配色自己的背景色（比纯黑柔和），对比度不足
 * 时再压暗这个背景色，不做千篇一律的纯黑。
 */
export function primaryButtonColors(
  scheme: PaletteScheme,
  background: string,
  primary: string,
): PrimaryButtonColors {
  if (scheme === "light") {
    const foreground = "#ffffff";
    return {
      background:
        contrastRatio(primary, foreground) >= BUTTON_CONTRAST
          ? primary
          : darkenUntilContrast(primary, foreground),
      foreground,
    };
  }
  return {
    background: primary,
    foreground:
      contrastRatio(background, primary) >= BUTTON_CONTRAST
        ? background
        : darkenUntilContrast(background, primary),
  };
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
  const button = primaryButtonColors(scheme, bg, primary);
  const style = doc.documentElement.style;
  style.setProperty("--bg", bg);
  style.setProperty("--fg", fg);
  style.setProperty("--primary", primary);
  style.setProperty("--primary-button", button.background);
  style.setProperty("--primary-foreground", button.foreground);
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
        const button = primaryButtonColors(scheme, bg, primary);
        return [bg, fg, primary, button.background, button.foreground].join(
          ",",
        );
      }),
    ]),
  ),
)};var n=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});if(!Object.hasOwn(P,n))n=${JSON.stringify(DEFAULT_PALETTE)};var d=document.documentElement.classList.contains("dark");var s=(d?P[n][1]:P[n][0]).split(",");var e=document.documentElement.style;e.setProperty("--bg",s[0]);e.setProperty("--fg",s[1]);e.setProperty("--primary",s[2]);e.setProperty("--primary-button",s[3]);e.setProperty("--primary-foreground",s[4])}catch(e){}})();`;
