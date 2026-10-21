import { useEffect, useRef } from "react";

/** Structural type: the DOM lib in this repo may not ship the Wake Lock API. */
type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

type WakeLockApi = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

function getWakeLockApi(): WakeLockApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
}

/**
 * Keeps the screen awake while the reader is mounted and re-acquires the lock
 * after the tab becomes visible again (ported from the legacy
 * `useScreenWakeLock`). Requests that fail silently simply do nothing — the
 * browser rejects them when the document is hidden.
 */
export function useScreenWakeLock(enabled = true): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const api = getWakeLockApi();
    if (!api) return;

    // Guard against StrictMode's mount → unmount → mount: a request that
    // resolves after cleanup must release itself immediately.
    let disposed = false;

    const request = async () => {
      try {
        const sentinel = await api.request("screen");
        if (disposed) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Not allowed (document not visible) or unsupported: nothing to do.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void request();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      void sentinel?.release();
    };
  }, [enabled]);
}
