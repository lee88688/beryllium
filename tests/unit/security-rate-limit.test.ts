import { describe, expect, it } from "vitest";
import { createSlidingWindowLimiter } from "@/server/domain/rate-limit";

const MINUTE = 60 * 1000;

describe("createSlidingWindowLimiter (B2)", () => {
  it("counts only the attempts inside the window", () => {
    const limiter = createSlidingWindowLimiter(3, 15 * MINUTE);

    expect(limiter.count("alice|1.2.3.4", 0)).toBe(0);
    limiter.record("alice|1.2.3.4", 0);
    limiter.record("alice|1.2.3.4", 1 * MINUTE);
    expect(limiter.count("alice|1.2.3.4", 2 * MINUTE)).toBe(2);

    // The first attempt has slid out of the 15-minute window by now.
    expect(limiter.count("alice|1.2.3.4", 15 * MINUTE + 1)).toBe(1);
    expect(limiter.count("alice|1.2.3.4", 30 * MINUTE)).toBe(0);
  });

  it("does not change the count on its own", () => {
    const limiter = createSlidingWindowLimiter(1, 15 * MINUTE);

    expect(limiter.count("alice|1.2.3.4", 0)).toBe(0);
    expect(limiter.count("alice|1.2.3.4", 0)).toBe(0);
    limiter.record("alice|1.2.3.4", 0);
    expect(limiter.count("alice|1.2.3.4", 0)).toBe(1);
  });

  it("counts each key separately, so one IP cannot lock another out", () => {
    const limiter = createSlidingWindowLimiter(1, 15 * MINUTE);

    limiter.record("alice|1.2.3.4", 0);
    expect(limiter.count("alice|1.2.3.4", 0)).toBe(1);
    expect(limiter.count("bob|1.2.3.4", 0)).toBe(0);
    expect(limiter.count("alice|5.6.7.8", 0)).toBe(0);
  });

  it("clears a key on demand and everything when called without one", () => {
    const limiter = createSlidingWindowLimiter(1, 15 * MINUTE);

    limiter.record("alice|1.2.3.4", 0);
    limiter.reset("alice|1.2.3.4");
    expect(limiter.count("alice|1.2.3.4", 0)).toBe(0);

    limiter.record("bob|1.2.3.4", 0);
    limiter.reset();
    expect(limiter.count("bob|1.2.3.4", 0)).toBe(0);
  });

  it("stays correct while tracking many distinct keys", () => {
    const limiter = createSlidingWindowLimiter(1, 1 * MINUTE);

    // More keys than the limiter keeps before it starts sweeping expired ones:
    // the pressure must not make it forget (or cross-wire) live keys.
    for (let index = 0; index <= 10_000; index += 1) {
      limiter.record(`user-${String(index)}|10.0.0.${String(index % 256)}`, 0);
    }
    limiter.record("live|10.0.0.1", 0);

    expect(limiter.count("live|10.0.0.1", 0)).toBe(1);
    expect(limiter.count("user-0|10.0.0.0", 0)).toBe(1);
  });
});
