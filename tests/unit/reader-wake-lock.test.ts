// @vitest-environment jsdom
import { StrictMode, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useScreenWakeLock } from "@/features/reader/hooks/use-screen-wake-lock";

/**
 * N2/A15: the reader keeps the screen awake. The Wake Lock API never runs in
 * jsdom, so this stubs `navigator.wakeLock` and pins the contract the hook
 * promises: request on mount, re-acquire when the tab becomes visible again,
 * release exactly what is still held on unmount, and never leak a sentinel
 * whose request resolves after its effect was torn down (the StrictMode race).
 */

interface FakeSentinel {
  released: boolean;
  release: () => Promise<void>;
}

function fakeSentinel(): FakeSentinel {
  const sentinel: FakeSentinel = {
    released: false,
    release: () => {
      sentinel.released = true;
      return Promise.resolve();
    },
  };
  return sentinel;
}

function installWakeLock(): {
  sentinels: FakeSentinel[];
  requested: string[];
} {
  const sentinels: FakeSentinel[] = [];
  const requested: string[] = [];
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: (type: "screen") => {
        requested.push(type);
        const sentinel = fakeSentinel();
        sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      },
    },
  });
  return { sentinels, requested };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const strictWrapper = ({ children }: { children: ReactNode }) =>
  createElement(StrictMode, null, children);

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("useScreenWakeLock", () => {
  it("requests on mount, re-acquires when the tab becomes visible, and releases on unmount", async () => {
    const { sentinels, requested } = installWakeLock();
    setVisibility("visible");

    const rendered = renderHook(() => useScreenWakeLock());

    await vi.waitFor(() => expect(requested).toEqual(["screen"]));
    expect(sentinels[0]?.released).toBe(false);

    // Hidden: the browser drops the lock itself, so the hook must not request
    // another one while the document cannot be seen.
    setVisibility("hidden");
    expect(requested).toEqual(["screen"]);

    setVisibility("visible");
    await vi.waitFor(() => expect(requested).toEqual(["screen", "screen"]));
    expect(sentinels).toHaveLength(2);
    // The hook only ever releases what it still holds: the first sentinel is
    // the browser's business once the tab was hidden.
    expect(sentinels[0]?.released).toBe(false);

    rendered.unmount();

    expect(sentinels[1]?.released).toBe(true);
    expect(sentinels[0]?.released).toBe(false);
  });

  it("releases a request that resolves only after its effect was torn down", async () => {
    let resolveRequest!: (sentinel: FakeSentinel) => void;
    const requested: string[] = [];
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: (type: "screen") => {
          requested.push(type);
          return new Promise<FakeSentinel>((resolve) => {
            resolveRequest = resolve;
          });
        },
      },
    });

    const rendered = renderHook(() => useScreenWakeLock());
    expect(requested).toEqual(["screen"]);

    // Unmount while the request is still unanswered — exactly what StrictMode's
    // mount → cleanup → mount cycle does to the first effect.
    rendered.unmount();

    const sentinel = fakeSentinel();
    resolveRequest(sentinel);

    await vi.waitFor(() => expect(sentinel.released).toBe(true));
  });

  it("releases every sentinel it created once the tree unmounts (StrictMode)", async () => {
    const { sentinels, requested } = installWakeLock();
    setVisibility("visible");

    const rendered = renderHook(() => useScreenWakeLock(), {
      wrapper: strictWrapper,
    });

    await vi.waitFor(() => expect(requested.length).toBeGreaterThan(0));
    rendered.unmount();

    // Whether or not StrictMode double-invoked the effect, nothing may stay
    // held after the tree is gone.
    await vi.waitFor(() =>
      expect(sentinels.every((sentinel) => sentinel.released)).toBe(true),
    );
    expect(sentinels.length).toBeGreaterThan(0);
  });

  it("does nothing while disabled", () => {
    const { requested } = installWakeLock();

    const rendered = renderHook(() => useScreenWakeLock(false));

    expect(requested).toEqual([]);
    rendered.unmount();
    expect(requested).toEqual([]);
  });

  it("survives a browser without the Wake Lock API", () => {
    Reflect.deleteProperty(navigator, "wakeLock");

    const rendered = renderHook(() => useScreenWakeLock());

    rendered.unmount();
  });

  it("ignores a rejected request (document not visible / not allowed)", async () => {
    const requested: string[] = [];
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: (type: "screen") => {
          requested.push(type);
          return Promise.reject(new DOMException("denied", "NotAllowedError"));
        },
      },
    });

    const rendered = renderHook(() => useScreenWakeLock());
    await vi.waitFor(() => expect(requested).toEqual(["screen"]));

    // No unhandled rejection, nothing to release on the way out.
    expect(rendered.result.current).toBeUndefined();
  });
});
