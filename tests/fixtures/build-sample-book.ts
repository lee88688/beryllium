import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildHostileEpub } from "./hostile-book.ts";
import { buildSampleEpub } from "./sample-book.ts";
import { buildZip } from "./zip.ts";

/**
 * Writes the EPUB unit fixtures: `sample-book.epub` at the repo root (the
 * canonical artifact) plus the copies the tests read from `tests/fixtures/`.
 *
 * Usage: `node tests/fixtures/build-sample-book.ts`
 */
const repoRoot = path.resolve(import.meta.dirname, "../..");
const epub = buildSampleEpub();

await fsp.writeFile(path.join(repoRoot, "sample-book.epub"), epub);
await fsp.writeFile(
  path.join(repoRoot, "tests/fixtures/sample-book.epub"),
  epub,
);

// Reader isolation fixture (A1/A2): a chapter that ships a script and an
// external link. Committed so the E2E specs can upload it as a real file.
const hostile = buildHostileEpub();
await fsp.writeFile(
  path.join(repoRoot, "tests/fixtures/hostile-book.epub"),
  hostile,
);

// Small adversarial archives used by the zip-slip tests.
await fsp.writeFile(
  path.join(repoRoot, "tests/fixtures/zip-slip.epub"),
  buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: "<container/>" },
    { name: "../escaped.txt", data: "zip-slip payload" },
  ]),
);

console.log(`wrote sample-book.epub (${epub.length} bytes) and zip-slip.epub`);
