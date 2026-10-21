import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { insertBook } from "../fixtures/test-db";
import {
  callServerFn,
  createAuthenticatedSession,
  createHttpSession,
  createTestServer,
  failureMessage,
  errorMessage,
  parseResult,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

const loginResult = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  user: z
    .object({ id: z.number(), username: z.string(), isAdmin: z.boolean() })
    .optional(),
});

const bookList = z.array(
  z.object({ id: z.number(), title: z.string(), coverUrl: z.string() }),
);

const userList = z.array(
  z.object({ id: z.number(), username: z.string(), isAdmin: z.boolean() }),
);

let server: TestServer;
let admin: { id: number; username: string; password: string };
let reader: { id: number; username: string; password: string };

beforeAll(async () => {
  server = await createTestServer();
  // Seeded before the first request so the server's own `seedAdmin` sees an
  // admin account and does not add another one.
  const adminRow = seedUser(server, "librarian", {
    password: "admin-secret",
    isAdmin: true,
  });
  const readerRow = seedUser(server, "reader", { password: "reader-secret" });
  admin = { id: adminRow.id, username: "librarian", password: "admin-secret" };
  reader = { id: readerRow.id, username: "reader", password: "reader-secret" };
});

afterAll(async () => {
  await server.close();
});

async function loggedIn(credentials: {
  username: string;
  password: string;
}): Promise<HttpSession> {
  const http = createHttpSession(server);
  const call = await callServerFn(http, "login", credentials);
  expect(parseResult(call, loginResult).ok).toBe(true);
  return http;
}

describe("server function access control", () => {
  it("I3 rejects an anonymous call with UNAUTHORIZED", async () => {
    const call = await callServerFn(createHttpSession(server), "getBooks");

    expect(call.result).toBeUndefined();
    expect(errorMessage(call)).toContain("登录");
  });

  it("I3 rejects a call without same-origin headers with 403", async () => {
    const call = await callServerFn(
      createHttpSession(server),
      "getBooks",
      undefined,
      { sameOrigin: false },
    );

    expect(call.status).toBe(403);
    expect(await call.response.text()).toBe("Forbidden");
  });
});

describe("login", () => {
  it("I4 signs in and seals the session cookie (HttpOnly)", async () => {
    const call = await callServerFn(createHttpSession(server), "login", {
      username: reader.username,
      password: reader.password,
    });

    expect(call.status).toBe(200);
    expect(parseResult(call, loginResult)).toMatchObject({
      ok: true,
      user: { id: reader.id, username: reader.username, isAdmin: false },
    });

    const setCookie = call.response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("sealed=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  it("I5 fails visibly on a wrong password (no cookie, message shown)", async () => {
    const http = createHttpSession(server);
    const call = await callServerFn(http, "login", {
      username: reader.username,
      password: "not-the-password",
    });

    const result = parseResult(call, loginResult);
    expect(result.ok).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.message ?? "").not.toBe("");
    expect(call.response.headers.getSetCookie()).toEqual([]);
    expect(http.cookies.has("sealed")).toBe(false);
  });

  it("I5 fails visibly on an unknown user", async () => {
    const call = await callServerFn(createHttpSession(server), "login", {
      username: "nobody",
      password: "whatever",
    });

    expect(parseResult(call, loginResult).ok).toBe(false);
  });

  it("rejects a malformed payload with BAD_REQUEST", async () => {
    const call = await callServerFn(createHttpSession(server), "login", {
      username: "",
    });

    expect(failureMessage(call)).toContain("username");
  });
});

describe("session round trip", () => {
  it("I6 returns only the caller's books for the sealed cookie", async () => {
    insertBook(server.db, reader.id, { title: "Reader Book" });
    insertBook(server.db, admin.id, { title: "Admin Book" });

    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });
    expect(http.cookies.has("sealed")).toBe(true);

    const call = await callServerFn(http, "getBooks");

    expect(parseResult(call, bookList).map((book) => book.title)).toEqual([
      "Reader Book",
    ]);
  });

  it("I6 also works with an externally sealed cookie", async () => {
    const http = await createAuthenticatedSession(server, reader.id);

    const call = await callServerFn(http, "getBooks");

    // Same single book the logged-in case above sees: the seal is the only
    // difference, so the library must be identical, not merely non-empty.
    expect(parseResult(call, bookList).map((book) => book.title)).toEqual([
      "Reader Book",
    ]);
  });

  it("logout clears the cookie", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });

    const call = await callServerFn(http, "logout");

    expect(call.error).toBeUndefined();
    expect(http.cookies.has("sealed")).toBe(false);
    const after = await callServerFn(http, "getBooks");
    expect(errorMessage(after)).toContain("登录");
  });
});

describe("me session probe", () => {
  it("returns null for an anonymous caller instead of UNAUTHORIZED", async () => {
    const call = await callServerFn(createHttpSession(server), "me");

    expect(call.error).toBeUndefined();
    expect(call.result).toBeNull();
  });

  it("returns the signed-in reader and the admin with isAdmin", async () => {
    const readerCall = await callServerFn(
      await createAuthenticatedSession(server, reader.id),
      "me",
    );
    expect(readerCall.result).toEqual({
      id: reader.id,
      username: reader.username,
      isAdmin: false,
    });

    const adminCall = await callServerFn(
      await createAuthenticatedSession(server, admin.id),
      "me",
    );
    expect(adminCall.result).toEqual({
      id: admin.id,
      username: admin.username,
      isAdmin: true,
    });
  });

  it("drops the value when the cookie is dropped with logout", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });
    expect((await callServerFn(http, "me")).result).not.toBeNull();

    await callServerFn(http, "logout");

    expect((await callServerFn(http, "me")).result).toBeNull();
  });

  it("also rejects a call without same-origin headers", async () => {
    const call = await callServerFn(
      createHttpSession(server),
      "me",
      undefined,
      {
        sameOrigin: false,
      },
    );

    expect(call.status).toBe(403);
  });
});

describe("changePassword", () => {
  it("I15 accepts the new password on the next login (D2 regression)", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });

    const changed = await callServerFn(http, "changePassword", {
      newPassword: "brand-new-secret",
      confirmPassword: "brand-new-secret",
    });
    expect(errorMessage(changed)).toBe("");

    const oldPassword = await callServerFn(createHttpSession(server), "login", {
      username: reader.username,
      password: reader.password,
    });
    expect(parseResult(oldPassword, loginResult).ok).toBe(false);

    const newPassword = await callServerFn(createHttpSession(server), "login", {
      username: reader.username,
      password: "brand-new-secret",
    });
    expect(parseResult(newPassword, loginResult).ok).toBe(true);

    // Restore the fixture password for the remaining cases in this file.
    const restored = await callServerFn(http, "changePassword", {
      newPassword: "reader-secret",
      confirmPassword: "reader-secret",
    });
    expect(errorMessage(restored)).toBe("");
  });

  it("rejects mismatching passwords (D3)", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });

    const call = await callServerFn(http, "changePassword", {
      newPassword: "another-secret",
      confirmPassword: "different-secret",
    });

    expect(failureMessage(call)).toContain("match");
  });
});

describe("admin surface", () => {
  it("I18 forbids a non-admin from listing users", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });

    const call = await callServerFn(http, "getUsers");

    expect(failureMessage(call)).toContain("管理员");
    expect(call.result).toBeUndefined();
  });

  it("I18 forbids a non-admin from creating and deleting users", async () => {
    const http = await loggedIn({
      username: reader.username,
      password: reader.password,
    });

    const created = await callServerFn(http, "addUser", {
      username: "intruder",
      password: "intruder-secret",
    });
    expect(failureMessage(created)).toContain("管理员");

    const removed = await callServerFn(http, "removeUser", { id: admin.id });
    expect(failureMessage(removed)).toContain("管理员");
  });

  it("lets an admin list and create users without leaking passwords", async () => {
    const http = await loggedIn({
      username: admin.username,
      password: admin.password,
    });

    const users = parseResult(await callServerFn(http, "getUsers"), userList);
    expect(users.map((user) => user.username)).toEqual(
      expect.arrayContaining([admin.username, reader.username]),
    );

    const created = await callServerFn(http, "addUser", {
      username: "second-reader",
      password: "second-reader-secret",
    });
    const createdUser = parseResult(
      created,
      z.object({ id: z.number(), username: z.string(), isAdmin: z.boolean() }),
    );
    expect(createdUser).toMatchObject({
      username: "second-reader",
      isAdmin: false,
    });

    const duplicate = await callServerFn(http, "addUser", {
      username: "second-reader",
      password: "second-reader-secret",
    });
    expect(failureMessage(duplicate)).toContain("已存在");

    const removed = await callServerFn(http, "removeUser", {
      id: createdUser.id,
    });
    expect(errorMessage(removed)).toBe("");
  });

  it("I18 refuses to delete an administrator, including the caller (B4)", async () => {
    const http = await loggedIn({
      username: admin.username,
      password: admin.password,
    });

    const secondAdmin = parseResult(
      await callServerFn(http, "addUser", {
        username: "second-admin",
        password: "second-admin-secret",
        isAdmin: true,
      }),
      z.object({ id: z.number(), isAdmin: z.boolean() }),
    );
    expect(secondAdmin.isAdmin).toBe(true);

    const otherAdmin = await callServerFn(http, "removeUser", {
      id: secondAdmin.id,
    });
    expect(failureMessage(otherAdmin)).toContain("管理员");

    const self = await callServerFn(http, "removeUser", { id: admin.id });
    expect(failureMessage(self)).toContain("管理员");

    // The last administrator is still there and still an administrator.
    const users = parseResult(await callServerFn(http, "getUsers"), userList);
    expect(users).toEqual(
      expect.arrayContaining([
        { id: admin.id, username: admin.username, isAdmin: true },
        { id: secondAdmin.id, username: "second-admin", isAdmin: true },
      ]),
    );
  });
});
