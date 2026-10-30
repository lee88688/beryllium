import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { getEnv } from "@/server/env";
import { runMigrations, seedAdmin } from "./migrate";
import { relations } from "./schema";

/** Drizzle client bound to this schema's relational config. */
export type Database = NodeSQLiteDatabase<typeof relations> & {
  $client: DatabaseSync;
};

/**
 * `timeout` is the SQLite busy timeout in ms (node:sqlite defaults to 0, which
 * fails immediately under contention); `enableForeignKeyConstraints` already
 * defaults to true but is spelled out so the RESTRICT/CASCADE behaviour of the
 * schema is not left to an implicit default.
 */
const SQLITE_OPTIONS = {
  timeout: 5000,
  enableForeignKeyConstraints: true,
} satisfies DatabaseSyncOptions;

/**
 * Opens `databasePath` (creating its directory) and returns a Drizzle client
 * with WAL enabled. No migrations are applied here.
 *
 * Drizzle rc.4 takes the connection through the config object —
 * `drizzle({ client, relations })` — not `drizzle(client, …)`; the latter is
 * not in the rc.4 overloads and silently falls back to a fresh `:memory:` db.
 */
export function createDatabase(
  databasePath: string,
  options: DatabaseSyncOptions = SQLITE_OPTIONS,
): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const client = new DatabaseSync(databasePath, options);
  client.exec("PRAGMA journal_mode = WAL");
  return drizzle({ client, relations });
}

/**
 * Connection factory with the checked-in migrations already applied: the entry
 * point for tests (`openDatabase(":memory:")`) and for the app (`getDb()`).
 */
export function openDatabase(
  databasePath: string,
  options: DatabaseSyncOptions = SQLITE_OPTIONS,
): Database {
  const db = createDatabase(databasePath, options);
  runMigrations(db);
  return db;
}

let instance: Database | undefined;

/**
 * Process-wide connection, bootstrapped on first use: applies pending
 * migrations and, when no admin exists yet, creates one from `ADMIN_USER_*`
 * (both idempotent). The production entry (`server.mjs`) calls this before
 * `listen` through `src/server-entry.ts`, so failures stop startup; tests keep
 * calling it lazily through `openDatabase`.
 */
export function getDb(): Database {
  if (!instance) {
    instance = openDatabase(getEnv().DATABASE_PATH);
    seedAdmin(instance);
  }
  return instance;
}
