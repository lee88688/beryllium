import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callServerFn,
  createAuthenticatedSession,
  createHttpSession,
  createTestServer,
  epubFormData,
  failureMessage,
  parseResult,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

const hit = z.object({
  id: z.number(),
  type: z.enum(["highlight", "bookmark"]),
  color: z.string(),
  location: z.string(),
  hasNote: z.boolean(),
  matchedField: z.enum(["content", "selectedString", "title"]),
  snippet: z.string(),
});

const group = z.object({
  book: z.object({
    id: z.number(),
    title: z.string(),
    author: z.string(),
    coverUrl: z.string(),
    format: z.enum(["epub", "pdf"]),
    percent: z.number(),
    lastReadAt: z.number(),
  }),
  counts: z.object({ notes: z.number(), bookmarks: z.number() }),
  hits: z.array(hit),
  nextHitCursor: z.object({ rank: z.number(), id: z.number() }).optional(),
});

const resultSchema = z.object({
  groups: z.array(group),
  totals: z.object({
    books: z.number(),
    notes: z.number(),
    bookmarks: z.number(),
  }),
  nextGroupOffset: z.number().optional(),
});

const hitsSchema = z.object({
  hits: z.array(hit),
  nextHitCursor: z.object({ rank: z.number(), id: z.number() }).optional(),
});

let server: TestServer;
let owner: HttpSession;
let bookId: number;

beforeAll(async () => {
  server = await createTestServer();
  const user = seedUser(server, "search-http-owner");
  owner = await createAuthenticatedSession(server, user.id);

  const upload = await owner.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(upload.status).toBe(201);
  bookId = z
    .object({ book: z.object({ id: z.number() }) })
    .parse(await upload.json()).book.id;

  const marks = [
    {
      type: "highlight",
      title: "第一章 科学边界",
      content: "三体世界的设定从这里开始。",
      selectedString: "「三体」问题",
    },
    {
      type: "highlight",
      title: "第二章 宇宙闪烁",
      content: "三体世界的宇宙社会学公理。",
      selectedString: "宇宙就是一座黑暗森林。",
    },
    {
      type: "highlight",
      title: "第三章 三体游戏",
      content: "三体游戏模拟三体世界。",
      selectedString: "三体游戏。",
    },
    {
      type: "bookmark",
      title: "三体文明",
      content: "",
      selectedString: "三体文明发来的信息。",
    },
  ];

  for (const mark of marks) {
    const response = await callServerFn(owner, "addMark", {
      bookId,
      anchorType: "cfi",
      anchor: "epubcfi(/6/4!/4/2/1:0)",
      color: mark.type === "highlight" ? "yellow" : "",
      ...mark,
    });
    expect(response.error).toBeUndefined();
  }
});

afterAll(async () => {
  await server.close();
});

describe("search server functions", () => {
  it("requires a session", async () => {
    const anonymous = createHttpSession(server);
    const call = await callServerFn(anonymous, "searchMarks", {
      query: "三体",
      groupOffset: 0,
      groupLimit: 30,
    });

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("登录");
  });

  it("returns grouped hits for the owner and pages the rest of a group", async () => {
    const first = parseResult(
      await callServerFn(owner, "searchMarks", {
        query: "三体",
        groupOffset: 0,
        groupLimit: 30,
      }),
      resultSchema,
    );

    expect(first.totals).toEqual({ books: 1, notes: 3, bookmarks: 1 });
    expect(first.nextGroupOffset).toBeUndefined();
    const [firstGroup] = first.groups;
    if (!firstGroup) throw new Error("expected one group");
    expect(firstGroup.book.id).toBe(bookId);
    expect(firstGroup.counts).toEqual({ notes: 3, bookmarks: 1 });
    expect(firstGroup.hits).toHaveLength(3);
    expect(firstGroup.nextHitCursor).toBeDefined();

    const rest = parseResult(
      await callServerFn(owner, "searchMarkHits", {
        query: "三体",
        bookId,
        cursorRank: firstGroup.nextHitCursor?.rank,
        cursorId: firstGroup.nextHitCursor?.id,
        limit: 10,
      }),
      hitsSchema,
    );

    expect(rest.hits).toHaveLength(1);
    expect(rest.nextHitCursor).toBeUndefined();
    expect(
      new Set([...firstGroup.hits, ...rest.hits].map((item) => item.id)).size,
    ).toBe(4);
  });

  it("refuses a book the caller does not own", async () => {
    const call = await callServerFn(owner, "searchMarkHits", {
      query: "三体",
      bookId: 999_999,
      limit: 10,
    });

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("书籍不存在");
  });
});
