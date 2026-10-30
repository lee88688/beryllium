import { defineConfig } from "vitest/config";

/**
 * Drives the built server bundle (`pnpm build` runs first, see package.json).
 * Requires a prior build: it imports dist/server/server-entry.js and calls its fetch.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // The bundle memoizes the environment (`getEnv()` caches on first read) and
    // the session/rate-limit state lives in module scope. Sharing a process
    // between test files would leak both (a later file would see the first
    // file's DATABASE_PATH and login budget), so every file gets its own forked
    // process with isolation on. This is the only thing that makes the
    // "each file boots its own server against its own data dir" contract true.
    pool: "forks",
    isolate: true,
  },
});
