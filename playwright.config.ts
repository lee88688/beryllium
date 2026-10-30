import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const ROOT = import.meta.dirname;

// E2E runs against a throwaway data directory so it never touches ./data.
// `e2e/serve.mjs` wipes it before starting the server: migrations now run
// before `listen`, i.e. before Playwright's globalSetup would get a chance to.
// Absolute paths keep the destructive wipe and the server's data anchored to
// the repository even when Playwright is invoked from another working dir.
const DATA_ROOT = path.join(ROOT, ".tmp/e2e");

export default defineConfig({
  testDir: "./e2e",
  // One server, one SQLite database: specs must not mutate the same library in
  // parallel. They are self-contained, but run them one at a time.
  fullyParallel: false,
  workers: 1,
  // headless-shell occasionally hangs while closing a context in CI; one retry
  // keeps the suite honest without masking real failures.
  retries: process.env.CI ? 1 : 0,
  // `list` for the terminal; the html report is what CI uploads on failure.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/serve.mjs",
    cwd: ROOT,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: path.join(DATA_ROOT, "db.sqlite"),
      ASAR_DIR: path.join(DATA_ROOT, "asar"),
      BOOKS_DIR: path.join(DATA_ROOT, "books"),
      TEMP_DIR: path.join(DATA_ROOT, "temp"),
      ADMIN_USER_NAME: "admin",
      ADMIN_USER_PASSWORD: "admin123",
      SESSION_SECRET: "e2e_session_secret_at_least_32_characters",
    },
    url: `http://127.0.0.1:${PORT}/api/health`,
    // A reused server would keep the previous run's database, which defeats
    // the fresh-migration contract; always start our own.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
