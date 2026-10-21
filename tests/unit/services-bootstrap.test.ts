import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { User } from "@/server/db/schema";
import { getPasswordHash } from "@/server/domain/password";

// This file gets its own worker (vitest isolate), so configuring the
// environment here cannot leak into other suites. It has to happen before the
// first `getEnv()` call, i.e. before the first `getDb()`; real process env wins
// over .env, and .env does not define DATABASE_PATH.
const storageRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), "beryllium-bootstrap-"),
);
const databasePath = path.join(storageRoot, "boot.sqlite");

process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_USER_NAME = "boot-admin";
process.env.ADMIN_USER_PASSWORD = "boot-secret";
process.env.SESSION_SECRET = "bootstrap_test_session_secret_at_least_32";

describe("getDb lazy bootstrap", () => {
  it("creates the database file, applies migrations and seeds the admin", () => {
    const db = getDb();

    const tables = db.$client
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as unknown as { name: string }[];
    expect(tables.map((table) => table.name)).toContain("Book");

    const admin = db.select().from(User).where(eq(User.isAdmin, true)).get();
    expect(admin?.username).toBe("boot-admin");
    expect(admin?.password).toBe(getPasswordHash("boot-secret"));
  });

  it("opens the file, keeps one connection and never re-seeds", async () => {
    await expect(fsp.access(databasePath)).resolves.toBeUndefined();

    const first = getDb();
    const second = getDb();

    expect(second).toBe(first);
    expect(second.select().from(User).all()).toHaveLength(1);
  });
});

afterAll(async () => {
  getDb().$client.close();
  await fsp.rm(storageRoot, { recursive: true, force: true });
});
