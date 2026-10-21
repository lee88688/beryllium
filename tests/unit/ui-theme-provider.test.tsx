// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  ThemeModeProvider,
  themeInitScript,
  useThemeMode,
} from "@/components/theme-provider";
import { usePreferredThemeMode } from "@/hooks/use-preferred-theme-mode";

function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", () => mql);
  return { listeners, mql };
}

function PreferredThemeProbe() {
  return <span data-testid="preferred">{usePreferredThemeMode()}</span>;
}

function ThemeSwitcher() {
  const { mode, resolvedTheme, setMode } = useThemeMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setMode("dark")}>
        go dark
      </button>
      <button type="button" onClick={() => setMode("light")}>
        go light
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeModeProvider", () => {
  it("applies the dark class and color-scheme on <html>", () => {
    stubMatchMedia(false);
    render(
      <ThemeModeProvider initialMode="dark">
        <ThemeSwitcher />
      </ThemeModeProvider>,
    );

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("does not add the dark class for light mode", () => {
    stubMatchMedia(true);
    render(
      <ThemeModeProvider initialMode="light">
        <ThemeSwitcher />
      </ThemeModeProvider>,
    );

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("follows the system preference in auto mode", () => {
    stubMatchMedia(true);
    render(
      <ThemeModeProvider>
        <ThemeSwitcher />
      </ThemeModeProvider>,
    );

    expect(screen.getByTestId("mode")).toHaveTextContent("auto");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("persists the selected mode under the legacy 'theme' key", () => {
    stubMatchMedia(false);
    render(
      <ThemeModeProvider initialMode="light">
        <ThemeSwitcher />
      </ThemeModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "go dark" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("syncs across tabs through the storage event", () => {
    stubMatchMedia(false);
    render(
      <ThemeModeProvider initialMode="light">
        <ThemeSwitcher />
      </ThemeModeProvider>,
    );

    fireEvent(
      window,
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        oldValue: "light",
        newValue: "dark",
      }),
    );

    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");

    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "unrelated",
        oldValue: null,
        newValue: "light",
      }),
    );

    expect(document.documentElement).toHaveClass("dark");
  });

  it("exposes a pre-paint script that applies the stored mode", () => {
    stubMatchMedia(false);

    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeInitScript)();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    document.documentElement.className = "";
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(themeInitScript)();
    expect(document.documentElement).not.toHaveClass("dark");

    // unknown/missing value falls back to auto → system preference
    document.documentElement.className = "";
    window.localStorage.setItem(THEME_STORAGE_KEY, "junk");
    new Function(themeInitScript)();
    expect(document.documentElement).not.toHaveClass("dark");
  });
});

describe("usePreferredThemeMode", () => {
  it("returns the resolved mode from the provider", () => {
    stubMatchMedia(true);
    render(
      <ThemeModeProvider initialMode="light">
        <PreferredThemeProbe />
      </ThemeModeProvider>,
    );

    expect(screen.getByTestId("preferred")).toHaveTextContent("light");
  });

  it("falls back to the system preference without a provider", () => {
    stubMatchMedia(true);
    render(<PreferredThemeProbe />);

    expect(screen.getByTestId("preferred")).toHaveTextContent("dark");
  });
});
