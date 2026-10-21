import { expect, test } from "./fixtures";

// Runs against `node server.mjs` (see playwright.config.ts webServer) and needs
// a prior `pnpm build`. Uses the API request context, so no browser download.
// Shares the console/response guard contract of the other specs through
// `./fixtures` (I4); the request-only cases simply produce no console traffic.

test("serves the SPA shell for client routes", async ({ request }) => {
  const response = await request.get("/");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("bg-background");
});

test("serves hashed static assets", async ({ request }) => {
  const shell = await (await request.get("/")).text();
  const assetHref = shell.match(/\/assets\/index-[\w-]+\.js/)?.[0];

  expect(assetHref).toBeDefined();
  const asset = await request.get(assetHref ?? "");
  expect(asset.status()).toBe(200);
  expect(asset.headers()["content-type"]).toContain("javascript");
});

test("answers /api/health and unknown API paths with JSON", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok" });

  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "not_found", splat: "nope" });
});

test("keeps /_serverFn out of the shell fallback", async ({ request }) => {
  const response = await request.get("/_serverFn/definitely-not-a-server-fn");

  // The Start handler rejects unknown server-fn ids (403 Forbidden) instead of
  // handing the path back to the shell fallback.
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).not.toContain("text/html");
});
