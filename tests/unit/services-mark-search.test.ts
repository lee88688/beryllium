import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { Book, Mark } from "@/server/db/schema";
import {
  searchMarkHitsInDb,
  searchMarksInDb,
} from "@/server/services/mark-search";
import {
  createTestDb,
  insertBook,
  insertUser,
  type TestDb,
} from "../fixtures/test-db";

let testDb: TestDb | undefined;

afterEach(() => {
  testDb?.close();
  testDb = undefined;
});

function insertMark(
  db: TestDb["db"],
  input: {
    bookId: number;
    userId: number;
    type: "highlight" | "bookmark";
    title?: string;
    content?: string;
    selectedString?: string;
    anchor?: string;
  },
) {
  return db
    .insert(Mark)
    .values({
      type: input.type,
      anchorType: "cfi",
      anchor: input.anchor ?? "epubcfi(/6/2!/4/2/1:0)",
      color: input.type === "highlight" ? "yellow" : "",
      title: input.title ?? "第一章",
      content: input.content ?? "",
      selectedString: input.selectedString ?? "",
      bookId: input.bookId,
      userId: input.userId,
    })
    .returning()
    .get();
}

function search(
  db: TestDb["db"],
  userId: number,
  query: string,
  groupOffset = 0,
  groupLimit = 30,
) {
  return searchMarksInDb(db, userId, { query, groupOffset, groupLimit });
}

describe("searchMarksInDb", () => {
  it("groups hits by book, counts notes and bookmarks, and orders notes first", () => {
    testDb = createTestDb();
    const user = insertUser(testDb.db, "search-user");
    const first = insertBook(testDb.db, user.id, { title: "三体" });
    const second = insertBook(testDb.db, user.id, { title: "黑暗森林" });

    insertMark(testDb.db, {
      bookId: first.id,
      userId: user.id,
      type: "highlight",
      title: "第一章 科学边界",
      content: "三体世界的设定从这里开始。",
      selectedString: "「三体」问题",
    });
    insertMark(testDb.db, {
      bookId: first.id,
      userId: user.id,
      type: "highlight",
      title: "第二章 宇宙闪烁",
      content: "宇宙社会学公理。",
      selectedString: "宇宙就是一座黑暗森林。",
    });
    insertMark(testDb.db, {
      bookId: first.id,
      userId: user.id,
      type: "bookmark",
      title: "三体文明",
      selectedString: "三体文明发来的信息。",
    });
    insertMark(testDb.db, {
      bookId: second.id,
      userId: user.id,
      type: "highlight",
      title: "序章",
      content: "三体世界就在那里。",
      selectedString: "宇宙就是一座黑暗森林。",
    });
    insertMark(testDb.db, {
      bookId: second.id,
      userId: user.id,
      type: "highlight",
      title: "第一章",
      content: "无关内容。",
      selectedString: "无关内容。",
    });

    const result = search(testDb.db, user.id, "三体");

    expect(result.totals).toEqual({ books: 2, notes: 2, bookmarks: 1 });
    expect(result.groups.map((group) => group.book.title)).toEqual([
      "三体",
      "黑暗森林",
    ]);
    const group = result.groups[0];
    if (!group) throw new Error("expected a book group");
    expect(group.counts).toEqual({ notes: 1, bookmarks: 1 });
    expect(group.hits.map((hit) => hit.type)).toEqual([
      "highlight",
      "bookmark",
    ]);
    expect(group.hits[0]?.matchedField).toBe("content");
    expect(group.hits[1]?.matchedField).toBe("title");
    expect(group.hits[0]?.snippet).toContain("三体");
    expect(group.hits[0]?.hasNote).toBe(true);
  });

  it("matches highlights on selectedString/title and bookmarks on title/selectedString only", () => {
    testDb = createTestDb();
    const user = insertUser(testDb.db, "search-fields");
    const book = insertBook(testDb.db, user.id, { title: "三体" });

    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "highlight",
      title: "第一章",
      content: "",
      selectedString: "宇宙就是一座黑暗森林。",
    });
    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "bookmark",
      title: "面壁计划",
      selectedString: "面壁计划启动。",
    });
    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "bookmark",
      title: "只有标题",
      selectedString: "正文不含关键词。",
    });
    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "highlight",
      title: "破壁计划",
      content: "无关内容。",
      selectedString: "无关内容。",
    });
    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "bookmark",
      title: "无关键词",
      selectedString: "无关键词。",
      content: "破壁计划",
    });

    const result = search(testDb.db, user.id, "宇宙");
    expect(result.totals).toEqual({ books: 1, notes: 1, bookmarks: 0 });
    expect(result.groups[0]?.hits[0]?.matchedField).toBe("selectedString");

    const bookmarkOnlyContent = search(testDb.db, user.id, "启动");
    expect(bookmarkOnlyContent.totals).toEqual({
      books: 1,
      notes: 0,
      bookmarks: 1,
    });

    const bookmarkTitle = search(testDb.db, user.id, "面壁");
    expect(bookmarkTitle.groups[0]?.hits[0]?.matchedField).toBe("title");
    expect(bookmarkTitle.groups[0]?.hits[0]?.type).toBe("bookmark");

    const highlightTitle = search(testDb.db, user.id, "破壁");
    expect(highlightTitle.totals).toEqual({
      books: 1,
      notes: 1,
      bookmarks: 0,
    });
    expect(highlightTitle.groups[0]?.hits[0]?.type).toBe("highlight");
    expect(highlightTitle.groups[0]?.hits[0]?.matchedField).toBe("title");

    const wildcard = search(testDb.db, user.id, "%");
    expect(wildcard.totals).toEqual({ books: 0, notes: 0, bookmarks: 0 });
  });

  it("returns a cursor for the next batch inside one book", () => {
    testDb = createTestDb();
    const user = insertUser(testDb.db, "search-cursor");
    const book = insertBook(testDb.db, user.id, { title: "三体" });

    for (let index = 0; index < 5; index += 1) {
      insertMark(testDb.db, {
        bookId: book.id,
        userId: user.id,
        type: "highlight",
        title: `第 ${index + 1} 章`,
        content: `三体世界 ${index}`,
        selectedString: "三体",
      });
    }

    const first = search(testDb.db, user.id, "三体");
    const group = first.groups[0];
    expect(group?.hits).toHaveLength(3);
    expect(group?.counts.notes).toBe(5);
    expect(group?.nextHitCursor).toBeDefined();

    const next = searchMarkHitsInDb(
      testDb.db,
      user.id,
      book.id,
      "三体",
      group?.nextHitCursor,
      10,
    );
    expect(next.hits).toHaveLength(2);
    expect(next.nextHitCursor).toBeUndefined();
    expect([...(group?.hits ?? []), ...next.hits].map((hit) => hit.id)).toEqual(
      [...(group?.hits ?? []), ...next.hits]
        .map((hit) => hit.id)
        .sort((a, b) => b - a),
    );
  });

  it("pages across the highlight/bookmark boundary without duplicates", () => {
    testDb = createTestDb();
    const db = testDb.db;
    const user = insertUser(db, "search-mixed-cursor");
    const book = insertBook(db, user.id, { title: "三体" });

    const highlights = Array.from({ length: 3 }, (_, index) =>
      insertMark(db, {
        bookId: book.id,
        userId: user.id,
        type: "highlight",
        title: `高亮 ${index + 1}`,
        content: "三体",
        selectedString: "三体",
      }),
    );
    const bookmarks = Array.from({ length: 3 }, (_, index) =>
      insertMark(db, {
        bookId: book.id,
        userId: user.id,
        type: "bookmark",
        title: `书签 ${index + 1}`,
        selectedString: "三体",
      }),
    );

    const first = searchMarkHitsInDb(
      db,
      user.id,
      book.id,
      "三体",
      undefined,
      2,
    );
    expect(first.hits.map((hit) => hit.id)).toEqual([
      highlights[2]?.id,
      highlights[1]?.id,
    ]);
    expect(first.nextHitCursor).toBeDefined();

    const second = searchMarkHitsInDb(
      db,
      user.id,
      book.id,
      "三体",
      first.nextHitCursor,
      2,
    );
    expect(second.hits.map((hit) => hit.id)).toEqual([
      highlights[0]?.id,
      bookmarks[2]?.id,
    ]);
    expect(second.nextHitCursor).toBeDefined();

    const third = searchMarkHitsInDb(
      db,
      user.id,
      book.id,
      "三体",
      second.nextHitCursor,
      2,
    );
    expect(third.hits.map((hit) => hit.id)).toEqual([
      bookmarks[1]?.id,
      bookmarks[0]?.id,
    ]);
    expect(third.nextHitCursor).toBeUndefined();

    const all = [...first.hits, ...second.hits, ...third.hits].map(
      (hit) => hit.id,
    );
    expect(new Set(all).size).toBe(6);
    expect(new Set(all)).toEqual(
      new Set([
        ...highlights.map((mark) => mark.id),
        ...bookmarks.map((mark) => mark.id),
      ]),
    );
  });

  it("finds literal percent, underscore, and backslash characters", () => {
    testDb = createTestDb();
    const user = insertUser(testDb.db, "search-wildcards");
    const book = insertBook(testDb.db, user.id, { title: "三体" });

    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "highlight",
      content: "达成 100% 完成_ok",
      selectedString: "C:\\temp",
    });
    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "highlight",
      content: "无特殊字符",
      selectedString: "无特殊字符",
    });

    expect(search(testDb.db, user.id, "100%").totals).toEqual({
      books: 1,
      notes: 1,
      bookmarks: 0,
    });
    expect(search(testDb.db, user.id, "_").totals).toEqual({
      books: 1,
      notes: 1,
      bookmarks: 0,
    });
    expect(search(testDb.db, user.id, "\\").totals).toEqual({
      books: 1,
      notes: 1,
      bookmarks: 0,
    });
    expect(search(testDb.db, user.id, "zzz").totals).toEqual({
      books: 0,
      notes: 0,
      bookmarks: 0,
    });
  });

  it("truncates long snippets around the match", () => {
    testDb = createTestDb();
    const user = insertUser(testDb.db, "search-snippet");
    const book = insertBook(testDb.db, user.id, { title: "三体" });
    const content = `${"甲".repeat(100)}三体${"乙".repeat(100)}`;

    insertMark(testDb.db, {
      bookId: book.id,
      userId: user.id,
      type: "highlight",
      content,
      selectedString: content,
    });

    const result = search(testDb.db, user.id, "三体");
    const snippet = result.groups[0]?.hits[0]?.snippet ?? "";
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("三体");
    expect(snippet.length).toBeLessThan(content.length);
  });

  it("does not leak another user's marks and supports group offsets", () => {
    testDb = createTestDb();
    const owner = insertUser(testDb.db, "search-owner");
    const other = insertUser(testDb.db, "search-other");
    const first = insertBook(testDb.db, owner.id, { title: "三体" });
    const second = insertBook(testDb.db, owner.id, { title: "黑暗森林" });
    const foreign = insertBook(testDb.db, other.id, { title: "别人的书" });
    testDb.db
      .update(Book)
      .set({ lastReadAt: 10 })
      .where(eq(Book.id, first.id))
      .run();
    testDb.db
      .update(Book)
      .set({ lastReadAt: 20 })
      .where(eq(Book.id, second.id))
      .run();

    insertMark(testDb.db, {
      bookId: first.id,
      userId: owner.id,
      type: "highlight",
      content: "三体一",
      selectedString: "三体",
    });
    insertMark(testDb.db, {
      bookId: second.id,
      userId: owner.id,
      type: "highlight",
      content: "三体二",
      selectedString: "三体",
    });
    insertMark(testDb.db, {
      bookId: foreign.id,
      userId: other.id,
      type: "highlight",
      content: "三体三",
      selectedString: "三体",
    });

    const all = search(testDb.db, owner.id, "三体");
    expect(all.totals.books).toBe(2);
    expect(all.groups.every((group) => group.book.id !== foreign.id)).toBe(
      true,
    );

    const page = search(testDb.db, owner.id, "三体", 0, 1);
    expect(page.groups).toHaveLength(1);
    expect(page.groups[0]?.book.id).toBe(second.id);
    expect(page.totals).toEqual({ books: 2, notes: 2, bookmarks: 0 });
    expect(page.nextGroupOffset).toBe(1);

    const nextPage = search(testDb.db, owner.id, "三体", 1, 1);
    expect(nextPage.groups).toHaveLength(1);
    expect(nextPage.groups[0]?.book.id).toBe(first.id);
    expect(nextPage.totals).toEqual({ books: 2, notes: 2, bookmarks: 0 });
    expect(nextPage.nextGroupOffset).toBeUndefined();
    expect([
      ...page.groups.map((group) => group.book.id),
      ...nextPage.groups.map((group) => group.book.id),
    ]).toEqual(all.groups.map((group) => group.book.id));
  });
});
