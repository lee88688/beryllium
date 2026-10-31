import { describe, expect, it } from "vitest";
import { pickContinueReading } from "@/features/bookshelf/continue-reading";
import type { BookshelfBook } from "@/features/bookshelf/types";

function book(
  id: number,
  options: Partial<
    Pick<BookshelfBook, "current" | "format" | "lastReadAt" | "percent">
  > = {},
): BookshelfBook {
  return {
    id,
    title: `Book ${id}`,
    author: "",
    description: "",
    cover: "",
    coverUrl: "",
    fileName: `${id}.epub`,
    contentPath: "",
    current: "",
    format: "epub",
    percent: 0,
    lastReadAt: 0,
    categories: [],
    ...options,
  };
}

describe("pickContinueReading", () => {
  it("picks the most recently read book regardless of format", () => {
    const books = [
      book(2, { current: "epubcfi(/6/4!/4/2/1:10)", lastReadAt: 100 }),
      book(6, {
        current: "page:0",
        format: "pdf",
        lastReadAt: 300,
        percent: 33,
      }),
      book(7, {
        current: "page:12",
        format: "pdf",
        lastReadAt: 200,
        percent: 5,
      }),
    ];

    expect(pickContinueReading(books)?.id).toBe(6);
  });

  it("ignores books that were never opened", () => {
    const books = [
      book(1, { current: "", lastReadAt: 500 }),
      book(2, { current: "page:0", format: "pdf", lastReadAt: 100 }),
    ];

    expect(pickContinueReading(books)?.id).toBe(2);
  });

  it("keeps the service order for legacy progress without a timestamp", () => {
    const books = [
      book(1, { current: "epubcfi(/6/4!/4/2/1:10)" }),
      book(2, { current: "epubcfi(/6/6!/4/2/1:10)" }),
    ];

    expect(pickContinueReading(books)?.id).toBe(1);
  });

  it("returns undefined when every book is unread", () => {
    expect(pickContinueReading([book(1), book(2)])).toBeUndefined();
  });
});
