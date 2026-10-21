import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { getPasswordHash } from "@/server/domain/password";
import { getEnv } from "@/server/env";
import type { Database } from "./client";
import { User } from "./schema";

/**
 * Refuses to run against a database created by the previous Prisma-based
 * release. This rewrite is intentionally breaking: the old file has the same
 * tables but no applied migration, so the first `CREATE TABLE` would fail with
 * a confusing "table already exists" error. Failing early with an actionable
 * message is the whole point.
 *
 * The ledger table existing proves nothing on its own: drizzle's migrator
 * creates it *before* applying the first migration, so any failed attempt
 * against a legacy file — including `pnpm db:migrate`, which is drizzle-kit and
 * therefore never runs this guard — leaves an empty ledger behind. Treating
 * that as "migrated" would mask the legacy database on every later start. Only
 * a ledger with applied migrations counts.
 */
export function assertMigratable(db: Database): void {
  const ledger = db.get<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
  );
  if (ledger) {
    const applied = db.get<{ applied: number }>(
      sql`select count(*) as applied from __drizzle_migrations`,
    );
    if (applied && Number(applied.applied) > 0) return;
  }

  const legacy = db.get<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name in ('Book', 'User', 'Mark', 'Category') limit 1`,
  );
  if (!legacy) return;

  throw new Error(
    `Legacy database detected at "${getEnv().DATABASE_PATH}": it contains "${legacy.name}" but no applied drizzle migration. ` +
      "This version is a breaking rewrite and cannot upgrade a database created by the previous Prisma-based release. " +
      "Move the old file aside (or delete it) and start again; every book has to be re-uploaded.",
  );
}

/**
 * Applies every pending migration from `migrationsFolder` (drizzle-kit "v3"
 * folder layout, checked into git). Synchronous on the node:sqlite driver and
 * idempotent: applied migrations are recorded in `__drizzle_migrations`.
 */
export function runMigrations(
  db: Database,
  migrationsFolder: string = path.resolve(process.cwd(), "drizzle"),
): void {
  assertMigratable(db);
  migrate(db, { migrationsFolder });
}

export interface SeedAdminOptions {
  username?: string;
  password?: string;
}

export interface SeedAdminResult {
  created: boolean;
  username: string | null;
}

/**
 * Startup bootstrap replacing `firstStartup.ts`: when no admin exists, create
 * one from env. `ADMIN_USER_*` therefore only takes effect on a fresh database.
 */
export function seedAdmin(
  db: Database,
  options: SeedAdminOptions = {},
): SeedAdminResult {
  const existing = db
    .select({ id: User.id })
    .from(User)
    .where(eq(User.isAdmin, true))
    .limit(1)
    .get();
  if (existing) return { created: false, username: null };

  const username = options.username ?? getEnv().ADMIN_USER_NAME;
  const password = options.password ?? getEnv().ADMIN_USER_PASSWORD;

  db.insert(User)
    .values({
      username,
      password: getPasswordHash(password),
      isAdmin: true,
    })
    .run();

  return { created: true, username };
}
