/**
 * In-memory sliding-window counter (B2).
 *
 * Deliberately dependency-free and process-local: the app is a single-process
 * host (`server.mjs`), so a shared store would be premature. Restarting the
 * process clears the counters, and a second replica would split them — both
 * acceptable, both worth revisiting the day the app stops being single-process.
 *
 * `count` and `record` are separate on purpose: the login throttle only counts
 * *failed* attempts, so it can ask "how many failures so far?" before deciding,
 * and record one afterwards.
 */
export interface SlidingWindowLimiter {
  /** Attempts recorded for `key` inside the window ending at `at`. */
  count(key: string, at?: number): number;
  /** Records one attempt for `key`. */
  record(key: string, at?: number): void;
  /** Forgets one key, or everything when called without one (tests, success paths). */
  reset(key?: string): void;
}

/** Keys kept before expired ones are swept, bounding worst-case memory. */
const MAX_TRACKED_KEYS = 10_000;

export function createSlidingWindowLimiter(
  limit: number,
  windowMs: number,
): SlidingWindowLimiter {
  const hits = new Map<string, number[]>();

  const withinWindow = (key: string, at: number) =>
    (hits.get(key) ?? []).filter((timestamp) => at - timestamp < windowMs);

  return {
    count(key, at = Date.now()) {
      return withinWindow(key, at).length;
    },
    record(key, at = Date.now()) {
      if (hits.size >= MAX_TRACKED_KEYS && !hits.has(key)) {
        for (const [tracked, timestamps] of hits) {
          if (timestamps.every((timestamp) => at - timestamp >= windowMs)) {
            hits.delete(tracked);
          }
        }
      }

      const recent = withinWindow(key, at);
      recent.push(at);
      hits.set(key, recent);
    },
    reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },
  };
}
