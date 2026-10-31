// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOOK_READER_PREFS_KEY, READER_PREFS_KEY } from "@/lib/prefs";

/**
 * `lib/prefs.ts` keeps its snapshot in module scope, so every case gets a fresh
 * module after clearing storage. Otherwise the first case's snapshot leaks into
 * the next one.
 */
async function loadPrefs() {
  vi.resetModules();
  return import("@/lib/prefs");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("per-book reader preferences", () => {
  it("keeps the override separate from the global defaults", async () => {
    const prefs = await loadPrefs();
    prefs.setReaderPrefs({ size: 20 });
    prefs.setBookReaderPrefs(1, { size: 26 });

    expect(prefs.readReaderPrefs().size).toBe(20);
    expect(prefs.readBookReaderPrefs(1)).toEqual({ size: 26 });
    expect(prefs.readBookReaderPrefs(2)).toEqual({});
    expect(window.localStorage.getItem(READER_PREFS_KEY)).toContain(
      '"size":20',
    );
    expect(
      JSON.parse(window.localStorage.getItem(BOOK_READER_PREFS_KEY) ?? "null"),
    ).toEqual({ books: { "1": { size: 26 } } });
  });

  it("resets only the selected book", async () => {
    const prefs = await loadPrefs();
    prefs.setBookReaderPrefs(1, { font: "kai" });
    prefs.setBookReaderPrefs(2, { size: 24 });

    prefs.resetBookReaderPrefs(1);

    expect(prefs.readBookReaderPrefs(1)).toEqual({});
    expect(prefs.readBookReaderPrefs(2)).toEqual({ size: 24 });
    expect(prefs.readBookReaderPrefs(3)).toEqual({});
  });

  it("drops invalid fields so those keys keep inheriting the global value", async () => {
    window.localStorage.setItem(
      BOOK_READER_PREFS_KEY,
      JSON.stringify({
        books: {
          "7": {
            font: "comic",
            size: 99,
            leading: "wide",
            align: "start",
            // Device-only UI state must never be captured per book.
            panelMode: "float",
          },
          "8": { size: "20" },
          notABookId: { size: 22 },
        },
      }),
    );

    const prefs = await loadPrefs();

    expect(prefs.readBookReaderPrefs(7)).toEqual({ size: 28, align: "start" });
    expect(prefs.readBookReaderPrefs(8)).toEqual({});
    expect(prefs.readBookReaderPrefs("notABookId")).toEqual({});
  });

  it("falls back to the global defaults when the override payload is corrupt", async () => {
    window.localStorage.setItem(BOOK_READER_PREFS_KEY, "{oops");

    const prefs = await loadPrefs();

    expect(prefs.readBookReaderPrefs(1)).toEqual({});
    expect(prefs.readReaderPrefs()).toMatchObject({ size: 18, font: "serif" });
  });
});

describe("motion preferences", () => {
  it("defaults animations on even when the system prefers reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }),
    );
    try {
      const prefs = await loadPrefs();
      expect(prefs.readMotionPrefs()).toEqual({
        animated: true,
        overrideSystem: true,
      });

      prefs.setMotionPrefs({ animated: false, overrideSystem: false });
      expect(prefs.readMotionPrefs()).toEqual({
        animated: false,
        overrideSystem: false,
      });

      prefs.setMotionPrefs({ animated: true, overrideSystem: true });
      expect(prefs.readMotionPrefs()).toEqual({
        animated: true,
        overrideSystem: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
