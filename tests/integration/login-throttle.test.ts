import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callServerFn,
  createHttpSession,
  createTestServer,
  parseResult,
  seedUser,
  type ServerFnCall,
  type TestServer,
} from "../fixtures/http";

/**
 * Login throttling (B2): 20 attempts per username+IP per 15 minutes.
 *
 * The limiter is process-wide and lives in the built bundle, so this file uses
 * its own server process (vitest isolates test files) and usernames nothing else
 * touches. Case order matters: the shared budgets are filled on purpose.
 */

const loginResult = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

const ATTEMPT_LIMIT = 20;
const THROTTLED_IP = "203.0.113.9";
const OTHER_IP = "198.51.100.7";
const USERNAME = "throttle-victim";
const PASSWORD = "victim-secret";

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer();
  seedUser(server, USERNAME, { password: PASSWORD });
});

afterAll(async () => {
  await server.close();
});

function attempt(
  username: string,
  password: string,
  ip: string,
): Promise<ServerFnCall> {
  return callServerFn(
    createHttpSession(server),
    "login",
    { username, password },
    { headers: { "x-forwarded-for": ip } },
  );
}

function messageOf(call: ServerFnCall): string {
  return parseResult(call, loginResult).message ?? "";
}

describe("login throttling", () => {
  it(`answers the ${String(ATTEMPT_LIMIT + 1)}th attempt from one ip+username with 429`, async () => {
    for (let index = 0; index < ATTEMPT_LIMIT; index += 1) {
      const call = await attempt(USERNAME, "wrong-password", THROTTLED_IP);
      // Attempts that are still within budget get the normal failure result.
      expect(parseResult(call, loginResult).ok).toBe(false);
      expect(call.status).toBe(200);
      expect(messageOf(call)).not.toContain("过于频繁");
    }

    const throttled = await attempt(USERNAME, "wrong-password", THROTTLED_IP);

    expect(throttled.status).toBe(429);
    expect(parseResult(throttled, loginResult)).toMatchObject({ ok: false });
    expect(messageOf(throttled)).toContain("过于频繁");
  });

  it("keeps the throttle per username, so another account is unaffected", async () => {
    seedUser(server, "throttle-bystander", { password: "bystander-secret" });

    const call = await attempt("throttle-bystander", "nope", THROTTLED_IP);

    expect(call.status).toBe(200);
    expect(parseResult(call, loginResult).ok).toBe(false);
    expect(messageOf(call)).not.toContain("过于频繁");
  });

  it("keeps the throttle per ip, so the same account from elsewhere is unaffected", async () => {
    const call = await attempt(USERNAME, "wrong-password", OTHER_IP);

    expect(call.status).toBe(200);
    expect(messageOf(call)).not.toContain("过于频繁");
  });

  it("refuses the correct password too while the key is throttled (no free retry)", async () => {
    const call = await attempt(USERNAME, PASSWORD, THROTTLED_IP);

    expect(call.status).toBe(429);
    expect(parseResult(call, loginResult).ok).toBe(false);
  });

  it("clears the budget for a successful sign-in", async () => {
    const success = await attempt(USERNAME, PASSWORD, OTHER_IP);
    expect(parseResult(success, loginResult).ok).toBe(true);

    // The success reset that IP's key, so a fresh wrong password is answered
    // normally instead of being throttled.
    const after = await attempt(USERNAME, "wrong-password", OTHER_IP);
    expect(after.status).toBe(200);
    expect(messageOf(after)).not.toContain("过于频繁");
  });

  it("never throttles successful sign-ins, however many there are", async () => {
    seedUser(server, "throttle-busy", { password: PASSWORD });

    for (let index = 0; index < ATTEMPT_LIMIT + 5; index += 1) {
      const call = await attempt("throttle-busy", PASSWORD, OTHER_IP);
      expect(parseResult(call, loginResult).ok).toBe(true);
      expect(call.status).toBe(200);
    }
  });
});
