import { z } from "zod";

/**
 * Flag-ish env vars arrive as strings ("false") from `.env` files but as real
 * booleans from test/DI callers; accept both and default to `false`.
 */
const booleanFlag = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean().default(false));

export const envSchema = z.object({
  DATABASE_PATH: z.string().min(1).default("./data/db.sqlite"),
  ASAR_DIR: z.string().min(1).default("./data/asar"),
  /** Original PDF files, one `<fileName>.pdf` per book. */
  BOOKS_DIR: z.string().min(1).default("./data/books"),
  TEMP_DIR: z.string().min(1).default("./data/temp"),
  ADMIN_USER_NAME: z.string().min(1).default("admin"),
  ADMIN_USER_PASSWORD: z.string().min(6),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_SECURE: booleanFlag,
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(200),
  /**
   * PDF-specific cap. pdf.js allocates a buffer the size of the file, so this
   * is a memory guard, not just a storage limit. PDFs above this are rejected
   * after format detection.
   */
  MAX_PDF_SIZE_MB: z.coerce.number().int().positive().default(100),
  /**
   * Zip-bomb guard: the total *uncompressed* size one EPUB may expand to.
   * Exceeding it fails the upload with 400 and removes the partial archive.
   */
  MAX_EXTRACTED_SIZE_MB: z.coerce.number().int().positive().default(2048),
  /**
   * Largest single archive member the file route may read into memory
   * (anything bigger answers 413 instead of buffering it).
   */
  MAX_MEMBER_SIZE_MB: z.coerce.number().int().positive().default(256),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates an env source and returns the typed values. Defaults come from the
 * migration plan §12; `ADMIN_USER_PASSWORD` and `SESSION_SECRET` stay required
 * because the app cannot boot safely without them.
 */
export function parseEnv(source: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${details}`);
}

let cached: Env | undefined;

/**
 * Reads `process.env` (filling gaps from `.env` when present — real process
 * env always wins) and validates once per process.
 *
 * A secret still equal to the `.env.example` placeholder means anyone can forge
 * a session cookie; that must be visible (a warning, not a hard failure, so a
 * fresh clone can still run `pnpm dev`).
 */
export function getEnv(): Env {
  if (cached) return cached;
  try {
    process.loadEnvFile();
  } catch {
    // No .env file next to the cwd: process env alone decides.
  }
  cached = parseEnv(process.env);
  if (
    cached.SESSION_SECRET.includes("change-me") ||
    // the value shipped by the previous .env.example, still in git history
    cached.SESSION_SECRET.includes("complex_password_at_least_32")
  ) {
    console.warn(
      "[env] SESSION_SECRET 仍是仓库里的示例值，任何人都可以伪造登录态；" +
        "请用 `openssl rand -hex 32` 生成新值后写入 .env。",
    );
  }
  return cached;
}

/**
 * Lazily validated view of the environment, e.g. `env.SESSION_SECRET`. Nothing
 * is read until a property is accessed, so importing this module never throws.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, key) =>
    typeof key === "string" ? getEnv()[key as keyof Env] : undefined,
});
