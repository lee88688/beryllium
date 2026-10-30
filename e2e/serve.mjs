import { rm } from "node:fs/promises";
import path from "node:path";

// `server.mjs` now applies migrations before listening, which is earlier than
// Playwright's globalSetup. Wipe the throwaway data directory here, before the
// server opens the database, so every run still starts from an empty file.
const dataRoot = path.resolve(import.meta.dirname, "..", ".tmp", "e2e");
await rm(dataRoot, { recursive: true, force: true });

await import("../server.mjs");
