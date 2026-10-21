import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the app: fill gaps from .env (real env wins, exactly
// like src/server/env.ts) so the CLI targets the same file the server opens.
try {
  process.loadEnvFile();
} catch {
  // No .env next to the cwd: process env alone decides.
}

/**
 * Keep in sync with `env.DATABASE_PATH` (src/server/env.ts). Only the local
 * `db:migrate`/`db:studio` scripts use this connection; the server itself
 * migrates on first use through `getDb()`.
 */
const DATABASE_FILE = process.env.DATABASE_PATH ?? "./data/db.sqlite";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: DATABASE_FILE,
  },
});
