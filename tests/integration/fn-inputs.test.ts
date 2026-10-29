import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callServerFn,
  createAuthenticatedSession,
  createTestServer,
  epubFormData,
  failureMessage,
  parseResult,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

/**
 * Server-function input boundaries (N6): the validator turns a wrong shape into
 * a `BAD_REQUEST` with the offending path, and every "unknown id" path has a
 * defined answer instead of a 500.
 */

const idResult = z.object({ id: z.number() });
const markList = z.array(
  z.object({ id: z.number(), content: z.string(), type: z.string() }),
);

let server: TestServer;
let owner: HttpSession;
let admin: HttpSession;
let bookId: number;
let adminId: number;

beforeAll(async () => {
  server = await createTestServer();
  const ownerRow = seedUser(server, "inputs-reader");
  const adminRow = seedUser(server, "inputs-admin", { isAdmin: true });
  adminId = adminRow.id;
  owner = await createAuthenticatedSession(server, ownerRow.id);
  admin = await createAuthenticatedSession(server, adminRow.id);

  const upload = await owner.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(upload.status).toBe(201);
  bookId = z
    .object({ book: z.object({ id: z.number() }) })
    .parse(await upload.json()).book.id;
});

afterAll(async () => {
  await server.close();
});

describe("invalid payloads (N6)", () => {
  it("rejects a mark type outside the enum and points at the field", async () => {
    const call = await callServerFn(owner, "addMark", {
      bookId,
      type: "note",
      epubcfi: "epubcfi(/6/2!/4/2)",
    });

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("type");
  });

  it("rejects a mark without an epubcfi", async () => {
    const call = await callServerFn(owner, "addMark", {
      bookId,
      type: "bookmark",
    });

    expect(failureMessage(call)).toContain("epubcfi");
  });

  it("rejects a category with a blank name", async () => {
    const call = await callServerFn(owner, "createCategory", { name: "   " });

    expect(failureMessage(call)).toContain("name");
  });

  it("rejects an empty book id list for a category", async () => {
    const category = parseResult(
      await callServerFn(owner, "createCategory", { name: "Empty targets" }),
      idResult,
    );

    const call = await callServerFn(owner, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [],
    });

    expect(failureMessage(call)).toContain("bookIds");
  });
});

describe("unknown ids (N6)", () => {
  it("refuses a mark on a book that does not exist", async () => {
    const call = await callServerFn(owner, "addMark", {
      bookId: 999_999,
      type: "bookmark",
      epubcfi: "epubcfi(/6/2!/4/2)",
    });

    // Ownership and existence are the same question for the caller: a book that
    // is not theirs reads as "not markable".
    expect(failureMessage(call)).toContain("自己的书籍");
  });

  it("answers 标记不存在 for unknown mark ids", async () => {
    const updated = await callServerFn(owner, "updateMark", { id: 999_999 });
    expect(failureMessage(updated)).toContain("标记不存在");

    const removed = await callServerFn(owner, "removeMark", { id: 999_999 });
    expect(failureMessage(removed)).toContain("标记不存在");
  });

  it("answers 书籍不存在 for the reader and marks reads of an unknown book", async () => {
    const reader = await callServerFn(owner, "getReaderData", {
      bookId: 999_999,
    });
    expect(failureMessage(reader)).toContain("书籍不存在");

    const marks = await callServerFn(owner, "getMarks", { bookId: 999_999 });
    expect(failureMessage(marks)).toContain("书籍不存在");

    const progress = await callServerFn(owner, "updateBookCurrent", {
      bookId: 999_999,
      current: "epubcfi(/6/2!/4/2)",
      percent: 10,
    });
    expect(failureMessage(progress)).toContain("书籍不存在");
  });

  it("answers 分类不存在 for unknown category ids", async () => {
    const removed = await callServerFn(owner, "removeCategory", {
      id: 999_999,
    });
    expect(failureMessage(removed)).toContain("分类不存在");

    const linked = await callServerFn(owner, "addBooksToCategory", {
      categoryId: 999_999,
      bookIds: [bookId],
    });
    expect(failureMessage(linked)).toContain("分类不存在");
  });

  it("answers 用户不存在 when an admin deletes an unknown account", async () => {
    const call = await callServerFn(admin, "removeUser", { id: 999_999 });

    expect(failureMessage(call)).toContain("用户不存在");
  });
});

describe("large annotation (N6)", () => {
  it("stores and returns a very long annotation byte-for-byte", async () => {
    // There is no server-side length cap on mark content, so the boundary that
    // matters is that nothing truncates or 500s: the value has to survive the
    // round trip intact.
    const content = "批注".repeat(50_000);
    const mark = parseResult(
      await callServerFn(owner, "addMark", {
        bookId,
        type: "highlight",
        epubcfi: "epubcfi(/6/4!/4/2/1:0)",
        color: "yellow",
        content,
      }),
      idResult,
    );

    const stored = parseResult(
      await callServerFn(owner, "getMarks", { bookId }),
      markList,
    ).find((row) => row.id === mark.id);

    expect(stored?.content).toBe(content);

    parseResult(
      await callServerFn(owner, "removeMark", { id: mark.id }),
      idResult,
    );
  });
});

describe("admin identity (N6)", () => {
  it("keeps the seeded admin addressable", async () => {
    // Guards the fixture itself: the "unknown user" case above is only about the
    // id, not about the caller's admin rights.
    const removed = await callServerFn(admin, "removeUser", { id: adminId });
    expect(failureMessage(removed)).toContain("管理员");
  });
});
