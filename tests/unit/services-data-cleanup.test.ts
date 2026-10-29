import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import {
  findOrphanAsarFiles,
  findOrphanPdfFiles,
} from "@/server/domain/asar-cleanup";
import { insertUser } from "../fixtures/test-db";

describe("findOrphanAsarFiles (B17)", () => {
  it("keeps the archives a book row points at and lists the rest", () => {
    expect(
      findOrphanAsarFiles(
        ["kept", "also-kept"],
        ["kept.asar", "also-kept.asar", "orphan.asar", "another-orphan.asar"],
      ),
    ).toEqual(["another-orphan.asar", "orphan.asar"]);
  });

  it("ignores other file types and stray directory names", () => {
    expect(
      findOrphanAsarFiles(
        ["kept"],
        ["kept.asar", "cover.png", "notes.txt", ".gitkeep"],
      ),
    ).toEqual([]);
  });

  it("treats a name without the .asar suffix as unrelated", () => {
    expect(
      findOrphanAsarFiles(["book"], ["book", "book.asar.bak", "book.asar"]),
    ).toEqual([]);
  });

  it("returns nothing when every archive is accounted for", () => {
    expect(findOrphanAsarFiles([], [])).toEqual([]);
    expect(findOrphanAsarFiles(["a"], ["a.asar"])).toEqual([]);
  });

  it("does not mistake an empty name for an archive", () => {
    expect(findOrphanAsarFiles([], [".asar"])).toEqual([]);
  });
});

const CLI = path.resolve("scripts/data-cleanup.ts");

describe("pnpm data:cleanup CLI", () => {
  let root: string;
  let asarDir: string;
  let databasePath: string;
  let db: Database;

  function runCli(...args: string[]): string {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      env: {
        ...process.env,
        ASAR_DIR: asarDir,
        DATABASE_PATH: databasePath,
        // Keep the run independent of a developer's .env.
        PORT: "0",
      },
      encoding: "utf8",
    });
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "beryllium-cleanup-"));
    asarDir = path.join(root, "asar");
    databasePath = path.join(root, "db.sqlite");
    await fsp.mkdir(asarDir, { recursive: true });

    db = openDatabase(databasePath);
    const user = insertUser(db, "cleanup-owner");
    db.insert(Book)
      .values({
        title: "Live Book",
        author: "Author",
        description: "",
        cover: "",
        fileName: "live-book",
        contentPath: "OEBPS/content.opf",
        current: "",
        format: "epub",
        content: { package: { metadata: [{}], manifest: [{}], spine: [{}] } },
        userId: user.id,
      })
      .run();
    db.$client.close();

    await fsp.writeFile(path.join(asarDir, "live-book.asar"), "live");
    await fsp.writeFile(path.join(asarDir, "orphan-one.asar"), "orphan");
    await fsp.writeFile(path.join(asarDir, "orphan-two.asar"), "orphan");
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("reports orphans without deleting anything by default", async () => {
    const output = runCli();

    expect(output).toContain("orphan-one.asar");
    expect(output).toContain("orphan-two.asar");
    expect(output).toContain("--yes");
    expect(await fsp.readdir(asarDir)).toEqual([
      "live-book.asar",
      "orphan-one.asar",
      "orphan-two.asar",
    ]);
  });

  it("deletes only the orphans when --yes is passed", async () => {
    const output = runCli("--yes");

    expect(output).toContain("已删除 2");
    expect(await fsp.readdir(asarDir)).toEqual(["live-book.asar"]);
    expect(
      await fsp.readFile(path.join(asarDir, "live-book.asar"), "utf8"),
    ).toBe("live");
  });

  it("says so when there is nothing to clean", async () => {
    await fsp.rm(path.join(asarDir, "orphan-one.asar"));
    await fsp.rm(path.join(asarDir, "orphan-two.asar"));

    expect(runCli()).toContain("没有孤儿书籍文件");
  });
});

describe("findOrphanPdfFiles", () => {
  it("applies the same retention policy to BOOKS_DIR", () => {
    expect(
      findOrphanPdfFiles(
        ["kept", "also-kept"],
        ["kept.pdf", "also-kept.pdf", "orphan.pdf", "cover.webp"],
      ),
    ).toEqual(["orphan.pdf"]);
    expect(findOrphanPdfFiles([], [".pdf", "notes.txt"])).toEqual([]);
  });
});

describe("pnpm data:cleanup CLI (PDF files)", () => {
  let root: string;
  let asarDir: string;
  let booksDir: string;
  let databasePath: string;

  function runCli(...args: string[]): string {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      env: {
        ...process.env,
        ASAR_DIR: asarDir,
        BOOKS_DIR: booksDir,
        DATABASE_PATH: databasePath,
        PORT: "0",
      },
      encoding: "utf8",
    });
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "beryllium-cleanup-pdf-"));
    asarDir = path.join(root, "asar");
    booksDir = path.join(root, "books");
    databasePath = path.join(root, "db.sqlite");
    await fsp.mkdir(asarDir, { recursive: true });
    await fsp.mkdir(booksDir, { recursive: true });

    const db = openDatabase(databasePath);
    const user = insertUser(db, "cleanup-pdf-owner");
    db.insert(Book)
      .values({
        title: "Live PDF",
        author: "Author",
        description: "",
        cover: "",
        fileName: "live-pdf",
        contentPath: "books/live-pdf.pdf",
        current: "",
        format: "pdf",
        content: { package: { metadata: [], manifest: [], spine: [] } },
        userId: user.id,
      })
      .run();
    db.$client.close();

    await fsp.writeFile(path.join(booksDir, "live-pdf.pdf"), "live");
    await fsp.writeFile(path.join(booksDir, "orphan.pdf"), "orphan");
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("reports PDF orphans without deleting", async () => {
    const output = runCli();
    expect(output).toContain("orphan.pdf");
    expect(output).not.toContain("live-pdf.pdf");
    expect(await fsp.readdir(booksDir)).toEqual(["live-pdf.pdf", "orphan.pdf"]);
  });

  it("deletes only PDF orphans with --yes", async () => {
    const output = runCli("--yes");
    expect(output).toContain("已删除 1");
    expect(await fsp.readdir(booksDir)).toEqual(["live-pdf.pdf"]);
  });
});
