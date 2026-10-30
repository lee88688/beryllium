import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const ROOT = path.resolve(".");
const SERVER = path.join(ROOT, "server.mjs");

/**
 * `server.mjs` is the only place that turns a bootstrap failure into "log and
 * exit 1 before listen"; importing the bundle directly (as the other specs do)
 * never exercises it. A legacy database makes `getDb()` throw on purpose: if
 * the call moved after `app.listen`, the child would keep running until the
 * timeout and print the listening line instead of failing the assertion.
 */
it("refuses to start against a legacy database", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "beryllium-startup-"));
  const database = path.join(root, "db.sqlite");

  const legacy = new DatabaseSync(database);
  legacy.exec("create table Book(id integer primary key)");
  legacy.close();

  try {
    const child = spawnSync(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: "0",
        DATABASE_PATH: database,
        ASAR_DIR: path.join(root, "asar"),
        BOOKS_DIR: path.join(root, "books"),
        TEMP_DIR: path.join(root, "temp"),
        ADMIN_USER_NAME: "admin",
        ADMIN_USER_PASSWORD: "admin-startup-password",
        SESSION_SECRET: "startup_test_session_secret_at_least_32_chars",
      },
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(child.status).toBe(1);
    expect(child.stderr).toContain("[db] startup failed; refusing to listen");
    expect(child.stderr).toContain("Legacy database detected");
    expect(child.stdout).not.toContain("beryllium listening");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}, 20_000);
