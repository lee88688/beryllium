import { sealData } from "iron-session";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { User } from "@/server/db/schema";
import {
  callServerFn,
  createHttpSession,
  createTestServer,
  failureMessage,
  parseResult,
  sealSessionCookie,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

/**
 * Session expiry / tampering: `iron-session` owns the seal, so the only thing
 * worth pinning here is that a cookie the server cannot trust degrades to "no
 * session at all" instead of authenticating.
 */

const bookList = z.array(z.object({ id: z.number() }));

let server: TestServer;
let userId: number;

beforeAll(async () => {
  server = await createTestServer();
  userId = seedUser(server, "session-reader").id;
});

afterAll(async () => {
  await server.close();
});

function clientWithSeal(seal: string): HttpSession {
  const http = createHttpSession(server);
  http.cookies.set("sealed", encodeURIComponent(seal));
  return http;
}

async function expiredSeal(): Promise<string> {
  // `ttl` is in seconds; `-3600` is an hour in the past, which is well outside
  // the 60s timestamp skew iron still accepts. (`0` would mean "never
  // expires", the opposite of what this test needs.)
  return sealData(
    { user: { id: userId } },
    { password: server.env.sessionSecret, ttl: -3600 },
  );
}

/** Replaces the character in the middle of the seal with a different one. */
function tamperWith(seal: string): string {
  const index = Math.floor(seal.length / 2);
  const replacement = seal[index] === "A" ? "B" : "A";
  return `${seal.slice(0, index)}${replacement}${seal.slice(index + 1)}`;
}

describe("expired session", () => {
  it("rejects a server-function call with UNAUTHORIZED", async () => {
    const http = clientWithSeal(await expiredSeal());

    const call = await callServerFn(http, "getBooks");

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("登录");
  });

  it("rejects a REST call with 401 JSON", async () => {
    const http = clientWithSeal(await expiredSeal());

    const response = await http.fetch("/api/books/1/files/OEBPS/content.opf");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });
});

describe("untrustworthy session cookie", () => {
  it("rejects a tampered seal", async () => {
    const valid = await sealSessionCookie(server, userId);
    const http = clientWithSeal(tamperWith(valid));

    const call = await callServerFn(http, "getBooks");

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("登录");
  });

  it("rejects a value that is not a seal at all", async () => {
    const http = clientWithSeal("not-a-sealed-session");

    const response = await http.fetch("/api/books/1/files/OEBPS/content.opf");

    expect(response.status).toBe(401);
  });

  it("still accepts a valid seal (control)", async () => {
    const http = clientWithSeal(await sealSessionCookie(server, userId));

    const call = await callServerFn(http, "getBooks");

    expect(parseResult(call, bookList)).toEqual([]);
  });
});

describe("session of a deleted account (B5)", () => {
  it("rejects both server functions and REST calls for a user that no longer exists", async () => {
    const deleted = seedUser(server, "deleted-reader");
    const seal = await sealSessionCookie(server, deleted.id);
    server.db.delete(User).where(eq(User.id, deleted.id)).run();

    const call = await callServerFn(clientWithSeal(seal), "getBooks");
    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("登录");

    const response = await clientWithSeal(seal).fetch(
      "/api/books/1/files/OEBPS/content.opf",
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });
});
