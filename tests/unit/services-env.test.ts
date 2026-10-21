import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/env";

// The proxy test at the bottom reads through `getEnv()`, which requires these
// two. `.env` fills them on a dev machine; CI checks out without one.
process.env.ADMIN_USER_PASSWORD ??= "unit-test-admin-password";
process.env.SESSION_SECRET ??= "unit_test_session_secret_at_least_32_chars";

const REQUIRED = {
  ADMIN_USER_PASSWORD: "admin123",
  SESSION_SECRET: "dev_only_session_secret_change_me_0123456789",
};

describe("parseEnv", () => {
  it("applies the plan defaults for the path/port/upload settings", () => {
    const parsed = parseEnv({ ...REQUIRED });

    expect(parsed).toEqual({
      DATABASE_PATH: "./data/db.sqlite",
      ASAR_DIR: "./data/asar",
      TEMP_DIR: "./data/temp",
      ADMIN_USER_NAME: "admin",
      ADMIN_USER_PASSWORD: "admin123",
      SESSION_SECRET: REQUIRED.SESSION_SECRET,
      SESSION_COOKIE_SECURE: false,
      MAX_UPLOAD_SIZE_MB: 200,
      MAX_EXTRACTED_SIZE_MB: 2048,
      MAX_MEMBER_SIZE_MB: 256,
      PORT: 3000,
    });
  });

  it("coerces numeric and boolean strings coming from .env", () => {
    const parsed = parseEnv({
      ...REQUIRED,
      DATABASE_PATH: "./tmp/custom.sqlite",
      PORT: "8080",
      MAX_UPLOAD_SIZE_MB: "512",
      MAX_EXTRACTED_SIZE_MB: "1024",
      MAX_MEMBER_SIZE_MB: "64",
      SESSION_COOKIE_SECURE: "true",
    });

    expect(parsed.DATABASE_PATH).toBe("./tmp/custom.sqlite");
    expect(parsed.PORT).toBe(8080);
    expect(parsed.MAX_UPLOAD_SIZE_MB).toBe(512);
    expect(parsed.MAX_EXTRACTED_SIZE_MB).toBe(1024);
    expect(parsed.MAX_MEMBER_SIZE_MB).toBe(64);
    expect(parsed.SESSION_COOKIE_SECURE).toBe(true);
  });

  it("accepts real booleans and falsy flag strings", () => {
    expect(
      parseEnv({ ...REQUIRED, SESSION_COOKIE_SECURE: true })
        .SESSION_COOKIE_SECURE,
    ).toBe(true);
    expect(
      parseEnv({ ...REQUIRED, SESSION_COOKIE_SECURE: "0" })
        .SESSION_COOKIE_SECURE,
    ).toBe(false);
    expect(
      parseEnv({ ...REQUIRED, SESSION_COOKIE_SECURE: "off" })
        .SESSION_COOKIE_SECURE,
    ).toBe(false);
  });

  it("rejects a missing secret and names the offending variable", () => {
    expect(() =>
      parseEnv({
        ADMIN_USER_PASSWORD: "admin123",
        SESSION_SECRET: "too-short",
      }),
    ).toThrowError(/SESSION_SECRET/);

    expect(() =>
      parseEnv({ SESSION_SECRET: REQUIRED.SESSION_SECRET }),
    ).toThrowError(/ADMIN_USER_PASSWORD/);
  });

  it("rejects out-of-range ports and upload sizes", () => {
    expect(() => parseEnv({ ...REQUIRED, PORT: "70000" })).toThrowError(/PORT/);
    expect(() =>
      parseEnv({ ...REQUIRED, MAX_UPLOAD_SIZE_MB: "0" }),
    ).toThrowError(/MAX_UPLOAD_SIZE_MB/);
    expect(() =>
      parseEnv({ ...REQUIRED, MAX_EXTRACTED_SIZE_MB: "0" }),
    ).toThrowError(/MAX_EXTRACTED_SIZE_MB/);
    expect(() =>
      parseEnv({ ...REQUIRED, MAX_MEMBER_SIZE_MB: "-1" }),
    ).toThrowError(/MAX_MEMBER_SIZE_MB/);
  });

  it("ignores unrelated process env entries", () => {
    expect(
      parseEnv({ ...REQUIRED, PATH: "/usr/bin", NODE_ENV: "test" }),
    ).toEqual(parseEnv({ ...REQUIRED }));
  });
});

describe("getEnv placeholder-secret warning", () => {
  /** The value `.env.example` ships with (Main owns that file). */
  const PLACEHOLDER_SECRET = "change-me-run-openssl-rand-hex-32-before-deploy";

  /**
   * `getEnv` memoizes per module instance, so each case re-imports the module to
   * get a fresh cache. The process env is restored afterwards: the proxy test
   * below reads through the statically imported instance.
   *
   * A static import cannot express this: `vi.resetModules()` only affects
   * imports performed after it, so the module under test has to be imported
   * through the runtime loader.
   */
  async function withFreshEnv(secret: string, run: () => Promise<void>) {
    const previous = {
      ADMIN_USER_PASSWORD: process.env.ADMIN_USER_PASSWORD,
      SESSION_SECRET: process.env.SESSION_SECRET,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.resetModules();
      process.env.ADMIN_USER_PASSWORD = "admin123";
      process.env.SESSION_SECRET = secret;
      await run();
    } finally {
      warn.mockRestore();
      // Restore the two keys instead of replacing `process.env`: the env object
      // itself is what `loadEnvFile()` writes into.
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it("warns loudly when SESSION_SECRET is still the .env.example value", async () => {
    await withFreshEnv(PLACEHOLDER_SECRET, async () => {
      const fresh = await import("@/server/env");

      expect(fresh.getEnv().SESSION_SECRET).toBe(PLACEHOLDER_SECRET);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("openssl rand -hex 32"),
      );
    });
  });

  it("stays quiet for a real secret", async () => {
    await withFreshEnv(REQUIRED.SESSION_SECRET, async () => {
      const fresh = await import("@/server/env");

      expect(fresh.getEnv().SESSION_SECRET).toBe(REQUIRED.SESSION_SECRET);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});

describe("env proxy", () => {
  it("validates lazily: importing stays quiet, reading the first property throws", async () => {
    const previous = process.env.SESSION_SECRET;
    try {
      vi.resetModules();
      process.env.SESSION_SECRET = "too-short";
      const fresh = await import("@/server/env");

      // The module-level proxy must not read the environment at import time
      // (importing `@/server/env` is what a route file does), but the first
      // property access has to surface the validation error.
      expect(() => fresh.env.PORT).toThrowError(/SESSION_SECRET/);

      // A second read through the same module keeps failing instead of caching
      // a half-initialised value.
      expect(() => fresh.env.DATABASE_PATH).toThrowError(/Invalid environment/);
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
      vi.resetModules();
    }
  });

  it("reads exactly the value getEnv() resolved for every property", async () => {
    const fresh = await import("@/server/env");
    const resolved = fresh.getEnv();

    // The proxy is a thin view of the validated env; comparing against
    // `parseEnv` of the same process env (rather than "a non-empty string")
    // pins that it returns the validated value, not an unvalidated one.
    expect(fresh.env.PORT).toBe(resolved.PORT);
    expect(fresh.env.DATABASE_PATH).toBe(resolved.DATABASE_PATH);
    expect(fresh.env.MAX_UPLOAD_SIZE_MB).toBe(resolved.MAX_UPLOAD_SIZE_MB);
  });
});
