import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * The E2E suite runs against the throwaway data directory from
 * `playwright.config.ts` (`.tmp/e2e`). Wiping it before the suite gives every
 * run the same starting point: an empty database, so `node server.mjs` performs
 * a first-start migration plus the admin seed (`admin` / `admin123`) and the
 * bookshelf starts with no books.
 *
 * Playwright starts the `webServer` before global setup, but the server opens
 * the database lazily on the first data request and the readiness probe
 * (`/api/health`) never touches it, so removing the directory here cannot race
 * with a live connection.
 */
export default async function globalSetup(): Promise<void> {
  const dataRoot = path.resolve(process.cwd(), ".tmp/e2e");

  await rm(dataRoot, { recursive: true, force: true });
}
