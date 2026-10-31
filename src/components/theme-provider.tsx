import * as React from "react";
import {
  applyPalette,
  isPaletteName,
  PALETTE_STORAGE_KEY,
  paletteInitScript,
  readStoredPalette,
  type PaletteName,
} from "@/lib/palette";
import { MOTION_PREFS_KEY, useMotionPrefs } from "@/lib/prefs";

/**
 * Three-state theme mode. `auto` follows `prefers-color-scheme`.
 * Values are intentionally the same strings the legacy app stored under the
 * `theme` localStorage key, so existing users keep their preference.
 */
export type ThemeMode = "auto" | "dark" | "light";

/** Concrete theme actually applied to the document. */
export type ResolvedTheme = "dark" | "light";

/** Legacy localStorage key (unchanged on purpose: `src/utils/constants.ts#ThemeLocalName`). */
export const THEME_STORAGE_KEY = "theme";

export type ThemeModeContextValue = {
  /** The user preference. */
  mode: ThemeMode;
  /** `mode` resolved against the OS preference (`dark` | `light`). */
  resolvedTheme: ResolvedTheme;
  /** Persist + apply a new preference (also syncs other tabs via `storage`). */
  setMode: (mode: ThemeMode) => void;
  /** 配色名（`lib/palette.ts#PALETTES`），与明暗模式正交。 */
  palette: PaletteName;
  /** 换配色；明暗两套由 `resolvedTheme` 决定，这里只选名字。 */
  setPalette: (palette: PaletteName) => void;
};

const ThemeModeContext = React.createContext<ThemeModeContextValue | null>(
  null,
);

/** Normalises any stored value to a valid mode (`auto` for unknown/absent). */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === "dark" || value === "light" ? value : "auto";
}

/** Reads the persisted preference; `auto` when unavailable (SSR/jailed storage). */
export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Current OS preference. Defaults to `light` without `matchMedia` (SSR/jsdom). */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Applies the class strategy: `<html class="dark">` + `color-scheme`.
 * The stylesheet declares `@custom-variant dark (&:is(.dark *))`.
 */
export function applyTheme(
  resolvedTheme: ResolvedTheme,
  target?: Document | null,
): void {
  const doc = target ?? (typeof document === "undefined" ? null : document);
  if (!doc) return;
  const root = doc.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
}

/**
 * Head-inline, pre-paint script (no defer/async) that avoids a flash of the
 * wrong theme. `__root.tsx` injects it as
 * `<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />` so that
 * the class is present before first paint. Must stay dependency-free.
 *
 * 两半：先定明暗（class 策略），再按已解析的明暗写入配色种子 —— 顺序不能反，
 * 因为配色脚本要读 `<html class="dark">`。
 */
export const themeInitScript =
  `(function(){try{var m=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});if(m!=="dark"&&m!=="light"){m="auto"}var d=m==="dark"||(m==="auto"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(e){}})();` +
  `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
    MOTION_PREFS_KEY,
  )});var p=raw?JSON.parse(raw):null;var a=!p||typeof p!=="object"||p.animated!==false;var e=document.documentElement;e.classList.toggle("reduce-motion",!a);e.classList.toggle("motion-forced",a)}catch(e){}})();` +
  paletteInitScript;

/** Subscribes to the OS preference (always active; cheap). */
export function useSystemTheme(): ResolvedTheme {
  const [systemTheme, setSystemTheme] =
    React.useState<ResolvedTheme>(getSystemTheme);

  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const mql = window.matchMedia(DARK_QUERY);
    const handleChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    handleChange();
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return systemTheme;
}

export type ThemeModeProviderProps = {
  children: React.ReactNode;
  /** Overrides the persisted value (tests / SSR hydration). */
  initialMode?: ThemeMode;
  /** Overrides the persisted palette (tests / SSR hydration). */
  initialPalette?: PaletteName;
  /** Document to apply the class to; defaults to the global document. */
  target?: Document | null;
};

export function ThemeModeProvider({
  children,
  initialMode,
  initialPalette,
  target,
}: ThemeModeProviderProps) {
  const [mode, setModeState] = React.useState<ThemeMode>(
    () => initialMode ?? readStoredThemeMode(),
  );
  const [palette, setPaletteState] = React.useState<PaletteName>(
    () => initialPalette ?? readStoredPalette(),
  );
  const systemTheme = useSystemTheme();
  const resolvedTheme: ResolvedTheme = mode === "auto" ? systemTheme : mode;
  const { animated, overrideSystem } = useMotionPrefs();

  // side effect: <html class="dark"> + color-scheme + 配色种子
  React.useEffect(() => {
    applyTheme(resolvedTheme, target);
    applyPalette(palette, resolvedTheme, target);
  }, [palette, resolvedTheme, target]);

  // side effect: <html class="reduce-motion"> when animations are off, and
  // <html class="motion-forced"> when the user explicitly overrides the OS
  // reduced-motion preference.
  React.useEffect(() => {
    const doc = target ?? (typeof document === "undefined" ? null : document);
    if (!doc) return;
    doc.documentElement.classList.toggle("reduce-motion", !animated);
    doc.documentElement.classList.toggle(
      "motion-forced",
      animated && overrideSystem,
    );
  }, [animated, overrideSystem, target]);

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // jailed storage (private mode): keep the in-memory preference
    }
  }, []);

  const setPalette = React.useCallback((next: PaletteName) => {
    setPaletteState(next);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // 同上
    }
  }, []);

  // cross-tab sync (both keys, written by the other tab)
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.oldValue === event.newValue) return;
      if (event.key === THEME_STORAGE_KEY)
        setModeState(parseThemeMode(event.newValue));
      else if (
        event.key === PALETTE_STORAGE_KEY &&
        isPaletteName(event.newValue)
      )
        setPaletteState(event.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = React.useMemo<ThemeModeContextValue>(
    () => ({ mode, resolvedTheme, setMode, palette, setPalette }),
    [mode, resolvedTheme, setMode, palette, setPalette],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

/** Context value, `null` outside of a provider. */
export function useThemeModeOptional(): ThemeModeContextValue | null {
  return React.useContext(ThemeModeContext);
}

/** Context value; throws when used outside `<ThemeModeProvider>`. */
export function useThemeMode(): ThemeModeContextValue {
  const value = useThemeModeOptional();
  if (!value) {
    throw new Error("useThemeMode must be used within a <ThemeModeProvider>");
  }
  return value;
}
