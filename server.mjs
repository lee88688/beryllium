import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { toNodeHandler } from "srvx/node";

// Single-process SPA host: express serves the built client, the TanStack Start
// handler owns the dynamic surface (server routes + server functions).
const CLIENT_DIR = path.resolve(import.meta.dirname, "dist/client");

/**
 * Content-Security-Policy for documents.
 *
 * This is the hard stop for EPUB-injected script: foliate-js renders every
 * section from a `blob:` URL in an iframe whose sandbox is fixed to
 * `allow-same-origin allow-scripts` (`vendor/foliate-js/paginator.js:244`),
 * and a blob document inherits the policy of the page that created it — so the
 * policy below is what actually keeps a chapter's inline `<script>` from
 * running. `src/features/reader/epub/sanitize.ts` removes those vectors from
 * the markup itself; this is the second layer.
 *
 * `'unsafe-inline'` is deliberately absent from `script-src`: the prerendered
 * shell ships four inline scripts (theme, scroll restoration, the router
 * manifest and a stream-boundary remover), whose content is hashed here at
 * start-up. `style-src` keeps `'unsafe-inline'` for React's inline style
 * attributes and for the `<style>` elements the reader injects per section.
 */
function cspForShell(html) {
  const hashes = [];
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  for (const [, body] of html.matchAll(pattern)) {
    if (body === "") continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSP = cspForShell(
  readFileSync(path.join(CLIENT_DIR, "_shell.html"), "utf8"),
);

// `.env` is the app's other configuration source (`src/server/env.ts` reads the
// same file), so PORT has to come from it too — a value there that only the
// Start handler honoured would leave express listening on the wrong port (B16).
// Real process env still wins: loadEnvFile never overwrites existing keys.
try {
  process.loadEnvFile();
} catch {
  // No .env file next to the cwd: process env alone decides.
}

const parsedPort = Number.parseInt(process.env.PORT ?? "", 10);
const PORT =
  Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535
    ? parsedPort
    : 3000;

// Dynamic import on purpose: dist/server/server.js only exists after `vite
// build`, so a static import would make this file unrunnable when it is read
// (and unloadable in a clean checkout) before the build step.
const { default: handler } = await import("./dist/server/server.js");
const nodeHandler = toNodeHandler(handler.fetch);

const app = express();

// Baseline hardening for every response, static and dynamic alike (B8).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  // Documents carry the app policy; `/api/*` keeps the policy its own route
  // sets (the sandboxed member responses, B8) so two policies never meet.
  if (!req.path.startsWith("/api/")) {
    res.setHeader("Content-Security-Policy", CSP);
  }
  // HSTS is only meaningful (and only legal) over TLS: either the socket is
  // encrypted or the terminating proxy said so via `X-Forwarded-Proto`.
  const forwardedProto = (req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  if (req.secure || forwardedProto === "https") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

// Throttling (B2) needs a client identity that page script cannot forge, so the
// TCP peer address is stamped onto the request — overwriting, never appending
// to, anything the client sent under this name.
app.use((req, _res, next) => {
  const address = req.socket.remoteAddress;
  if (address !== undefined && address !== "") {
    req.headers["x-client-ip"] = address;
  }
  next();
});

// /api/* and /_serverFn/* go to the Start handler with their path intact: mounting
// with app.use('/api', …) would strip the prefix and the handler would see /health.
app.use(async (req, res, next) => {
  const isDynamic =
    req.path === "/api" ||
    req.path.startsWith("/api/") ||
    req.path === "/_serverFn" ||
    req.path.startsWith("/_serverFn/");
  if (!isDynamic) {
    next();
    return;
  }
  try {
    await nodeHandler(req, res);
  } catch (error) {
    next(error);
  }
});

/** Vite's content-hashed output directory, the only place `immutable` is safe. */
const HASHED_ASSET_DIR = `${path.sep}assets${path.sep}`;

app.use(
  express.static(CLIENT_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      // Only hashed filenames under /assets/ may claim to be immutable; a
      // public file that keeps its name (icons, manifest, shell) would serve a
      // stale copy for a year after an upgrade (B12).
      res.setHeader(
        "Cache-Control",
        filePath.includes(HASHED_ASSET_DIR)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  }),
);

// SPA fallback: every other path renders the prerendered shell and lets the
// client router resolve the location.
app.get("/{*splat}", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(CLIENT_DIR, "_shell.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`beryllium listening on http://127.0.0.1:${PORT}`);
});
