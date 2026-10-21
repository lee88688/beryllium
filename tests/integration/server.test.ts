import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

interface BuiltServer {
  fetch: (request: Request) => Promise<Response>;
}

interface BuiltServerModule {
  default: BuiltServer;
}

/**
 * The built server bundle: `pnpm build` produces dist/server/server.js, whose
 * default export is the Start handler. The specifier is a file URL computed at
 * runtime against the working directory, so a static import cannot express it;
 * this test exists precisely to exercise that module-loading boundary.
 */
const bundleUrl = pathToFileURL(path.resolve("dist/server/server.js")).href;

let server: BuiltServer;

beforeAll(async () => {
  const module = (await import(bundleUrl)) as BuiltServerModule;
  server = module.default;
});

function request(pathname: string): Promise<Response> {
  return server.fetch(new Request(`http://localhost${pathname}`));
}

describe("built server", () => {
  it("answers /api/health with the liveness contract and nothing else (B6)", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    // Anonymous callers get liveness only: no runtime/pid/uptime/environment.
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers unknown /api paths with a JSON 404", async () => {
    const response = await request("/api/nope");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "not_found",
      splat: "nope",
    });
  });

  it("redirects / to the bookshelf (W4 guard) and still serves the shell", async () => {
    const root = await request("/");
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe("/bookshelf");

    const login = await request("/login");
    const html = await login.text();

    expect(login.status).toBe(200);
    expect(login.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("bg-background");
  });
});
