import {
  useSystemTheme,
  useThemeModeOptional,
} from "../components/theme-provider";

/** Concrete theme currently in effect (`dark` | `light`). */
export type PreferredThemeMode = "dark" | "light";

/**
 * Port of the legacy `hooks/usePreferredThemeMode`: resolves the three-state
 * preference (`auto` follows the OS). Works with or without a
 * `<ThemeModeProvider>` ancestor (falls back to the OS preference).
 */
export function usePreferredThemeMode(): PreferredThemeMode {
  const themeMode = useThemeModeOptional();
  const systemTheme = useSystemTheme();
  return themeMode?.resolvedTheme ?? systemTheme;
}
