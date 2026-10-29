#!/usr/bin/env node
/**
 * `pnpm data:cleanup` — reports (and optionally deletes) orphan book files
 * (migration plan §9 / B17).
 *
 * Dry run by default: the script only lists what it *would* delete, because the
 * database is the authority on which files are live and a stale/incorrect
 * `DATABASE_PATH` would otherwise turn a typo into data loss. Pass `--yes` to
 * delete.
 *
 * Reads `ASAR_DIR`, `BOOKS_DIR` and `DATABASE_PATH` with the same defaults and
 * the same `.env` precedence as the app (`loadEnvFile`, real environment wins).
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  findOrphanAsarFiles,
  findOrphanPdfFiles,
} from "../src/server/domain/asar-cleanup.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env next to the cwd: process env alone decides.
}

const asarDir = path.resolve(process.env.ASAR_DIR ?? "./data/asar");
const booksDir = path.resolve(process.env.BOOKS_DIR ?? "./data/books");
const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/db.sqlite",
);
const apply = process.argv.slice(2).includes("--yes");

function readBookFiles(): { epub: string[]; pdf: string[] } {
  const client = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = client.prepare("SELECT fileName, format FROM Book").all() as {
      fileName: string;
      format: string;
    }[];
    return {
      epub: rows
        .filter((row) => row.format !== "pdf")
        .map((row) => String(row.fileName)),
      pdf: rows
        .filter((row) => row.format === "pdf")
        .map((row) => String(row.fileName)),
    };
  } finally {
    client.close();
  }
}

function listEntries(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

let bookFiles: { epub: string[]; pdf: string[] };
try {
  bookFiles = readBookFiles();
} catch (error) {
  console.error(`无法读取数据库 ${databasePath}：${String(error)}`);
  process.exit(1);
}

const asarEntries = listEntries(asarDir);
const pdfEntries = listEntries(booksDir);
const asarOrphans = findOrphanAsarFiles(bookFiles.epub, asarEntries);
const pdfOrphans = findOrphanPdfFiles(bookFiles.pdf, pdfEntries);

console.log(
  `asar 目录 ${asarDir}：${asarEntries.length} 个文件；PDF 目录 ${booksDir}：${pdfEntries.length} 个文件；数据库 ${bookFiles.epub.length + bookFiles.pdf.length} 本书`,
);

if (asarOrphans.length === 0 && pdfOrphans.length === 0) {
  console.log("没有孤儿书籍文件。");
  process.exit(0);
}

for (const orphan of asarOrphans) {
  console.log(`${apply ? "删除" : "将删除"} ${path.join(asarDir, orphan)}`);
}
for (const orphan of pdfOrphans) {
  console.log(`${apply ? "删除" : "将删除"} ${path.join(booksDir, orphan)}`);
}

if (!apply) {
  console.log(
    `共 ${asarOrphans.length + pdfOrphans.length} 个孤儿文件（dry-run）。确认后执行：pnpm data:cleanup --yes`,
  );
  process.exit(0);
}

for (const orphan of asarOrphans) {
  rmSync(path.join(asarDir, orphan), { force: true });
}
for (const orphan of pdfOrphans) {
  rmSync(path.join(booksDir, orphan), { force: true });
}
console.log(`已删除 ${asarOrphans.length + pdfOrphans.length} 个孤儿文件。`);
