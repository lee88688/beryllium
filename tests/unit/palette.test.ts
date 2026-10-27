// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyPalette,
  PALETTE_NAMES,
  PALETTE_STORAGE_KEY,
  PALETTES,
  paletteInitScript,
  primaryButtonColors,
} from "@/lib/palette";

function luminance(hex: string): number {
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

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  window.localStorage.clear();
});

describe("primaryButtonColors", () => {
  it("keeps every palette's button label at WCAG AA contrast", () => {
    for (const name of PALETTE_NAMES) {
      for (const scheme of ["light", "dark"] as const) {
        const [background, , primary] = PALETTES[name][scheme];
        const colors = primaryButtonColors(scheme, background, primary);
        expect(
          contrast(colors.background, colors.foreground),
          `${name}/${scheme}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("leaves the seed primary alone when it can already carry white text", () => {
    const [background, , primary] = PALETTES.gruvbox.light;
    expect(primaryButtonColors("light", background, primary)).toEqual({
      background: primary,
      foreground: "#ffffff",
    });
  });

  it("darkens only the button surface when the light primary is too bright", () => {
    const [background, , primary] = PALETTES.cherry.light;
    const colors = primaryButtonColors("light", background, primary);
    expect(colors.background).not.toBe(primary);
    expect(colors.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.foreground).toBe("#ffffff");
    expect(
      contrast(colors.background, colors.foreground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the palette background as the label on bright dark-scheme primaries", () => {
    const [background, , primary] = PALETTES.default.dark;
    expect(primaryButtonColors("dark", background, primary)).toEqual({
      background: primary,
      foreground: background,
    });
  });
});

describe("applyPalette", () => {
  it("writes the button surface and label alongside the three seeds", () => {
    applyPalette("cherry", "light");

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--primary")).toBe("#de3838");
    expect(style.getPropertyValue("--primary-foreground")).toBe("#ffffff");
    expect(style.getPropertyValue("--primary-button")).not.toBe("#de3838");
  });

  it("matches the pre-paint script output", () => {
    applyPalette("sunset", "dark");
    const applied = document.documentElement.style;
    const appliedButton = applied.getPropertyValue("--primary-button");
    const appliedForeground = applied.getPropertyValue("--primary-foreground");

    document.documentElement.removeAttribute("style");
    document.documentElement.classList.add("dark");
    window.localStorage.setItem(PALETTE_STORAGE_KEY, "sunset");
    new Function(paletteInitScript)();

    expect(appliedButton).toBe(
      document.documentElement.style.getPropertyValue("--primary-button"),
    );
    expect(appliedForeground).toBe(
      document.documentElement.style.getPropertyValue("--primary-foreground"),
    );
  });
});
