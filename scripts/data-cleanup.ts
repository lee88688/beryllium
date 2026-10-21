#!/usr/bin/env node
/**
 * `pnpm data:cleanup` — reports (and optionally deletes) orphan ASAR files
 * (migration plan §9 / B17).
 *
 * Dry run by default: the script only lists what it *would* delete, because the
 * database is the authority on which archives are live and a stale/incorrect
 * `DATABASE_PATH` would otherwise turn a typo into data loss. Pass `--yes` to
 * delete.
 *
 * Reads `ASAR_DIR` and `DATABASE_PATH` with the same defaults and the same
 * `.env` precedence as the app (`loadEnvFile`, real environment wins).
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findOrphanAsarFiles } from "../src/server/domain/asar-cleanup.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env next to the cwd: process env alone decides.
}

const asarDir = path.resolve(process.env.ASAR_DIR ?? "./data/asar");
const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/db.sqlite",
);
const apply = process.argv.slice(2).includes("--yes");

function readBookFileNames(): string[] {
  const client = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = client.prepare("SELECT fileName FROM Book").all();
    return rows.map((row) => String(row.fileName));
  } finally {
    client.close();
  }
}

function listAsarEntries(): string[] {
  if (!existsSync(asarDir)) return [];
  return readdirSync(asarDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

let bookFileNames: string[];
try {
  bookFileNames = readBookFileNames();
} catch (error) {
  console.error(`无法读取数据库 ${databasePath}：${String(error)}`);
  process.exit(1);
}

const entries = listAsarEntries();
const orphans = findOrphanAsarFiles(bookFileNames, entries);

console.log(
  `asar 目录 ${asarDir}：${entries.length} 个文件，数据库 ${databasePath}：${bookFileNames.length} 本书`,
);

if (orphans.length === 0) {
  console.log("没有孤儿 asar 文件。");
  process.exit(0);
}

for (const orphan of orphans) {
  console.log(`${apply ? "删除" : "将删除"} ${orphan}`);
}

if (!apply) {
  console.log(
    `共 ${orphans.length} 个孤儿 asar 文件（dry-run）。确认后执行：pnpm data:cleanup --yes`,
  );
  process.exit(0);
}

for (const orphan of orphans) {
  rmSync(path.join(asarDir, orphan), { force: true });
}
console.log(`已删除 ${orphans.length} 个孤儿 asar 文件。`);
