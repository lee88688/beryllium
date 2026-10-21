import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sealData } from "iron-session";
import type { z } from "zod";
import { openDatabase, type Database } from "@/server/db/client";
import { getPasswordHash } from "@/server/domain/password";
import { User, type UserSelect } from "@/server/db/schema";

interface BuiltServer {
  fetch: (request: Request) => Promise<Response>;
}

interface BuiltServerModule {
  default: BuiltServer;
}

interface TestServerPaths {
  root: string;
  database: string;
  asar: string;
  temp: string;
}

interface TestServerEnv {
  sessionSecret: string;
  adminUsername: string;
  adminPassword: string;
  maxUploadSizeMb: number;
  maxExtractedSizeMb: number;
  maxMemberSizeMb: number;
}

export interface TestServer {
  fetch: (request: Request) => Promise<Response>;
  paths: TestServerPaths;
  env: TestServerEnv;
  /** Second connection to the same SQLite file, for seeding and assertions. */
  db: Database;
  close: () => Promise<void>;
}

const BUNDLE_URL = pathToFileURL(path.resolve("dist/server/server.js")).href;

/**
 * Boots the built server (`pnpm build` → `dist/server/server.js`) against a
 * throwaway data directory. The env vars must be in place before the first
 * request, because the bundle reads them lazily but memoizes once read.
 */
export async function createTestServer(
  options: {
    maxUploadSizeMb?: number;
    maxExtractedSizeMb?: number;
    maxMemberSizeMb?: number;
  } = {},
): Promise<TestServer> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "beryllium-it-"));
  const paths: TestServerPaths = {
    root,
    database: path.join(root, "db.sqlite"),
    asar: path.join(root, "asar"),
    temp: path.join(root, "temp"),
  };
  await fsp.mkdir(paths.asar, { recursive: true });
  await fsp.mkdir(paths.temp, { recursive: true });

  const env: TestServerEnv = {
    sessionSecret: "integration_session_secret_at_least_32_chars",
    adminUsername: "admin",
    adminPassword: "admin-password",
    maxUploadSizeMb: options.maxUploadSizeMb ?? 1,
    maxExtractedSizeMb: options.maxExtractedSizeMb ?? 2048,
    maxMemberSizeMb: options.maxMemberSizeMb ?? 256,
  };
  Object.assign(process.env, {
    DATABASE_PATH: paths.database,
    ASAR_DIR: paths.asar,
    TEMP_DIR: paths.temp,
    ADMIN_USER_NAME: env.adminUsername,
    ADMIN_USER_PASSWORD: env.adminPassword,
    SESSION_SECRET: env.sessionSecret,
    SESSION_COOKIE_SECURE: "false",
    MAX_UPLOAD_SIZE_MB: String(env.maxUploadSizeMb),
    MAX_EXTRACTED_SIZE_MB: String(env.maxExtractedSizeMb),
    MAX_MEMBER_SIZE_MB: String(env.maxMemberSizeMb),
  });

  // The bundle only exists after `pnpm build` and its specifier is computed at
  // runtime against the cwd, so a static import cannot express it — this is the
  // module-loading boundary the integration suite exists to exercise.
  const bundle = (await import(BUNDLE_URL)) as BuiltServerModule;
  const db = openDatabase(paths.database);

  return {
    fetch: (request) => bundle.default.fetch(request),
    paths,
    env,
    db,
    close: async () => {
      db.$client.close();
      try {
        await fsp.rm(root, { recursive: true, force: true });
      } catch {
        // The built server keeps its own SQLite handle on this file open until
        // the worker exits, and Windows refuses to unlink an open file. The
        // directory lives under os.tmpdir(), so leaving it behind is safe.
      }
    },
  };
}

/** Account created directly in the database (no server-function round trip). */
export function seedUser(
  server: TestServer,
  username: string,
  options: { password?: string; isAdmin?: boolean } = {},
): UserSelect {
  const password = options.password ?? `${username}-password`;
  return server.db
    .insert(User)
    .values({
      username,
      password: getPasswordHash(password),
      isAdmin: options.isAdmin ?? false,
    })
    .returning()
    .get();
}

/**
 * A browser-ish client for one test: keeps the `Set-Cookie` jar between
 * requests so a session survives, exactly like the browser the UI runs in.
 */
export interface HttpSession {
  readonly cookies: Map<string, string>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export function createHttpSession(
  server: TestServer,
  options: { origin?: string } = {},
): HttpSession {
  const origin = options.origin ?? "http://localhost";
  const cookies = new Map<string, string>();

  return {
    cookies,
    fetch: async (requestPath, init = {}) => {
      const headers = new Headers(init.headers);
      // Browser-like defaults: a real browser sends `Origin` on writes and the
      // Fetch Metadata headers on everything, which is what both the CSRF
      // middleware (server functions) and `assertSameOrigin` (REST, B3) check.
      // Tests that need a cross-site request set these themselves, and an
      // explicit value always wins.
      if (!headers.has("origin")) headers.set("origin", origin);
      if (!headers.has("sec-fetch-site")) {
        headers.set("sec-fetch-site", "same-origin");
      }
      if (cookies.size > 0) {
        headers.set(
          "cookie",
          [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        );
      }
      const response = await server.fetch(
        new Request(new URL(requestPath, origin), { ...init, headers }),
      );
      for (const setCookie of response.headers.getSetCookie()) {
        const [name = "", ...rest] = setCookie.split("=");
        const value = (rest.join("=").split(";")[0] ?? "").trim();
        if (value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
      return response;
    },
  };
}

/**
 * A `sealed` cookie holding `userId`, produced by the same library the server
 * unseals with (`iron-session`). Lets the API tests authenticate without going
 * through the login server function.
 */
export function sealSessionCookie(server: TestServer, userId: number) {
  return sealData(
    { user: { id: userId } },
    { password: server.env.sessionSecret, ttl: 60 * 60 },
  );
}

/** Client with the session cookie already attached. */
export function createAuthenticatedSession(
  server: TestServer,
  userId: number,
): Promise<HttpSession> {
  const http = createHttpSession(server);
  return sealSessionCookie(server, userId).then((seal) => {
    http.cookies.set("sealed", encodeURIComponent(seal));
    return http;
  });
}

interface SerovalModule {
  toJSONAsync: (value: unknown, options?: unknown) => Promise<unknown>;
  fromCrossJSON: (value: unknown, options: { plugins: unknown[] }) => unknown;
  createPlugin: <T>(plugin: T) => T;
}

interface PluginParseContext {
  parse: (value: unknown) => unknown;
}
interface PluginSerializeContext {
  serialize: (value: unknown) => string;
}
interface PluginDeserializeContext {
  deserialize: (value: unknown) => unknown;
}

/**
 * seroval is a transitive dependency of TanStack Start (every server-function
 * payload and result is encoded with it). pnpm keeps it in the virtual store
 * rather than at the root, so resolve it from the package that owns it instead
 * of pinning a version in this file.
 */
function loadSeroval(): SerovalModule {
  const [startClientCore] = fs.globSync(
    "node_modules/.pnpm/@tanstack+start-client-core@*/node_modules/@tanstack/start-client-core/package.json",
  );
  if (startClientCore === undefined) {
    throw new Error("seroval: @tanstack/start-client-core is not installed");
  }
  const require = createRequire(path.resolve(startClientCore));
  return require(require.resolve("seroval")) as SerovalModule;
}

let cachedSeroval: SerovalModule | undefined;

/**
 * Mirrors TanStack's `ShallowErrorPlugin` (tag `$TSR/Error`, from
 * `@tanstack/router-core/ssr/serializer`): a thrown `Error` crosses the wire as
 * `new Error(message)` and nothing else. Consequence for callers: the
 * `RequestError` *code* never reaches the browser, only its message — which is
 * what the UI shows and what these tests assert on.
 */
function createErrorPlugin(seroval: SerovalModule) {
  return seroval.createPlugin({
    tag: "$TSR/Error",
    test: (value: unknown) => value instanceof Error,
    parse: {
      sync: (value: Error, ctx: PluginParseContext) => ({
        message: ctx.parse(value.message),
      }),
      async: async (value: Error, ctx: PluginParseContext) => ({
        message: await ctx.parse(value.message),
      }),
      stream: (value: Error, ctx: PluginParseContext) => ({
        message: ctx.parse(value.message),
      }),
    },
    serialize: (node: { message: unknown }, ctx: PluginSerializeContext) =>
      `new Error(${ctx.serialize(node.message)})`,
    deserialize: (node: { message: unknown }, ctx: PluginDeserializeContext) =>
      new Error(String(ctx.deserialize(node.message))),
  });
}

/** The decoder TanStack's client uses on a cross-JSON payload. */
function decodePayload(payload: unknown): unknown {
  cachedSeroval ??= loadSeroval();
  return cachedSeroval.fromCrossJSON(payload, {
    plugins: [createErrorPlugin(cachedSeroval)],
  });
}

/** HTTP method of every server function, as `createServerFn` declares it. */
const SERVER_FN_METHODS: Record<string, "GET" | "POST"> = {
  login: "POST",
  logout: "POST",
  me: "GET",
  getBooks: "GET",
  deleteBook: "POST",
  getCategories: "GET",
  createCategory: "POST",
  removeCategory: "POST",
  addBooksToCategory: "POST",
  removeBooksFromCategory: "POST",
  getMarks: "POST",
  addMark: "POST",
  updateMark: "POST",
  removeMark: "POST",
  updateBookCurrent: "POST",
  getReaderData: "POST",
  addUser: "POST",
  removeUser: "POST",
  changePassword: "POST",
  getUsers: "GET",
};

/**
 * Server-function id (sha256 of `file--export` chosen at build time) → export
 * name, read back from the resolver manifest the production build emits into
 * `dist/server/server.js`.
 */
function serverFunctionIds(): Record<string, string> {
  const sources = [
    path.resolve("dist/server/server.js"),
    ...fs.globSync("dist/server/assets/*.js"),
  ];
  const ids: Record<string, string> = {};
  for (const file of sources) {
    const code = fs.readFileSync(file, "utf8");
    const entry =
      /["']([0-9a-f]{64}(?:_\d+)?)["']\s*:\s*\{[^{}]*?functionName:\s*["']([^"']+)["']/g;
    for (const [, id, functionName] of code.matchAll(entry)) {
      if (id === undefined || functionName === undefined) continue;
      const name = functionName.replace(/_createServerFn_handler$/, "");
      ids[name] = id;
    }
  }
  return ids;
}

export interface ServerFnCall {
  status: number;
  /** Decoded `result`, when the call reached the handler. */
  result?: unknown;
  /** Decoded thrown value, when the handler threw. */
  error?: unknown;
  response: Response;
}

/**
 * Calls one server function the way the browser does: POST to
 * `/_serverFn/<id>` (or GET for the read-only ones) with a seroval-encoded
 * `{ data }` body, the `x-tsr-serverfn` marker and the same-origin headers the
 * CSRF middleware checks.
 */
export async function callServerFn(
  http: HttpSession,
  name: string,
  data?: unknown,
  options: { sameOrigin?: boolean; headers?: HeadersInit } = {},
): Promise<ServerFnCall> {
  const method = SERVER_FN_METHODS[name];
  if (method === undefined) throw new Error(`unknown server function: ${name}`);

  const ids = serverFunctionIds();
  const id = ids[name];
  if (id === undefined) {
    throw new Error(
      `server function ${name} is not registered in the build; run pnpm build`,
    );
  }

  const headers = new Headers({ "x-tsr-serverfn": "true" });
  if (options.sameOrigin ?? true) {
    headers.set("origin", "http://localhost");
    headers.set("sec-fetch-site", "same-origin");
  } else {
    // Be explicit instead of relying on the session's browser-like defaults:
    // this is what a page on another site would send.
    headers.set("origin", "https://evil.example");
    headers.set("sec-fetch-site", "cross-site");
  }
  // Extra headers win: tests use this for `x-forwarded-for` (throttling key).
  for (const [header, value] of new Headers(options.headers ?? {})) {
    headers.set(header, value);
  }
  let body: string | undefined;
  if (data !== undefined) {
    cachedSeroval ??= loadSeroval();
    body = JSON.stringify(await cachedSeroval.toJSONAsync({ data }));
    headers.set("content-type", "application/json");
  }

  const response = await http.fetch(`/_serverFn/${id}`, {
    method,
    headers,
    body,
  });

  // A serialized payload (`x-tss-serialized`) is a server-function result; a
  // plain `Response` — the CSRF middleware's 403, a redirect — is passed through.
  if (response.headers.get("x-tss-serialized") === null) {
    return { status: response.status, response };
  }

  const payload = await response.json();
  const decoded = decodePayload(payload) as {
    result?: unknown;
    error?: unknown;
  };
  return {
    status: response.status,
    result: decoded.result,
    error: decoded.error,
    response,
  };
}

/** Message of a decoded server-function error, for assertions. */
export function errorMessage(call: ServerFnCall): string {
  const error = call.error;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/**
 * Message of a call that must have failed; throws when it actually succeeded,
 * so a passing expectation cannot silently read an empty message.
 */
export function failureMessage(call: ServerFnCall): string {
  if (call.error === undefined) {
    throw new Error(
      `expected the call to fail, but it returned ${JSON.stringify(call.result)}`,
    );
  }
  return errorMessage(call);
}

/**
 * Decodes a successful call's `result` through a schema. Test code never trusts
 * a seroval round trip blindly: an unexpected shape fails here, with the shape
 * (not a silent `undefined`) in the message.
 */
export function parseResult<T>(call: ServerFnCall, schema: z.ZodType<T>): T {
  if (call.error !== undefined) {
    throw new Error(`server function failed: ${errorMessage(call)}`);
  }
  const parsed = schema.safeParse(call.result);
  if (!parsed.success) {
    throw new Error(
      `unexpected server function result: ${JSON.stringify(call.result)}`,
    );
  }
  return parsed.data;
}

/** Multipart body for `POST /api/books` built from real file bytes. */
export function epubFormData(epub: Buffer, filename = "sample.epub"): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(epub)], { type: "application/epub+zip" }),
    filename,
  );
  return form;
}

/** Reads the EPUB fixture produced by `tests/fixtures/sample-book.ts`. */
export function sampleEpubBytes(): Buffer {
  return fs.readFileSync(
    path.join(process.cwd(), "tests", "fixtures", "sample-book.epub"),
  );
}
