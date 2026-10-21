import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createDatabase,
  openDatabase,
  type Database,
} from "@/server/db/client";
import { assertMigratable, runMigrations } from "@/server/db/migrate";

function tableNames(db: Database): string[] {
  return db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table'`,
    )
    .map((row) => row.name);
}

describe("assertMigratable", () => {
  it("rejects a Prisma-era database that has no drizzle ledger", () => {
    const db = createDatabase(":memory:");
    db.run(sql`create table Book(id integer primary key)`);

    // The fixture really is a legacy-shaped database: the table exists, the
    // ledger does not.
    expect(tableNames(db)).toContain("Book");
    expect(tableNames(db)).not.toContain("__drizzle_migrations");

    expect(() => runMigrations(db)).toThrowError(/Legacy database/);

    db.$client.close();
  });

  it("names the offending legacy table in the message", () => {
    const db = createDatabase(":memory:");
    db.run(sql`create table User(id integer primary key)`);

    expect(() => assertMigratable(db)).toThrowError(/contains "User"/);

    db.$client.close();
  });

  it("rejects a legacy database whose ledger is empty because a migration failed", () => {
    const db = createDatabase(":memory:");
    db.run(sql`create table Book(id integer primary key)`);
    // Exactly what `pnpm db:migrate` (drizzle-kit, so no guard) leaves behind
    // when it runs against a Prisma-era file: the migrator creates its ledger
    // table first and then dies on the first `CREATE TABLE`.
    db.run(
      sql`create table __drizzle_migrations(id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
    );

    expect(() => assertMigratable(db)).toThrowError(/Legacy database/);
    expect(() => runMigrations(db)).toThrowError(/contains "Book"/);

    db.$client.close();
  });

  it("migrates a fresh database that only carries an empty ledger", () => {
    const db = createDatabase(":memory:");
    db.run(
      sql`create table __drizzle_migrations(id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
    );

    expect(() => runMigrations(db)).not.toThrow();
    expect(tableNames(db)).toContain("Book");

    // 每次放新的迁移进来这条都会变，所以只断言「记账了」，不钉具体条数。
    const ledger = db.$client
      .prepare("select count(*) as c from __drizzle_migrations")
      .get() as { c: number };
    expect(Number(ledger.c)).toBeGreaterThan(0);

    db.$client.close();
  });

  it("lets a brand new empty database through", () => {
    const db = createDatabase(":memory:");

    expect(() => runMigrations(db)).not.toThrow();
    // A migrated database can run the migrator again without throwing.
    expect(() => runMigrations(db)).not.toThrow();
    expect(tableNames(db)).toContain("__drizzle_migrations");

    db.$client.close();
  });

  it("lets an already-migrated database through", () => {
    const db = openDatabase(":memory:");
    const before = tableNames(db);

    expect(() => runMigrations(db)).not.toThrow();
    const countLedger = () =>
      Number(
        (
          db.$client
            .prepare("select count(*) as c from __drizzle_migrations")
            .get() as { c: number }
        ).c,
      );
    const applied = countLedger();

    // A second run must be a genuine no-op: same tables, ledger untouched.
    expect(() => runMigrations(db)).not.toThrow();
    expect(tableNames(db)).toEqual(before);
    expect(countLedger()).toBe(applied);

    db.$client.close();
  });
});

describe("openDatabase", () => {
  it("applies the checked-in migrations to :memory: without throwing", () => {
    const db = openDatabase(":memory:");

    const names = tableNames(db);
    for (const table of ["Book", "User", "Mark", "Category", "CategoryBook"]) {
      expect(names).toContain(table);
    }

    db.$client.close();
  });
});
