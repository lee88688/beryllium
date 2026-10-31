import { describe, expect, it } from "vitest";
import { searchBooks } from "@/features/bookshelf/search/book-search";
import type { BookshelfBook } from "@/features/bookshelf/types";

function book(
  id: number,
  title: string,
  author: string,
  categories: string[] = [],
): BookshelfBook {
  return {
    id,
    title,
    author,
    description: "",
    cover: "",
    coverUrl: "",
    fileName: `${id}.epub`,
    contentPath: "OEBPS/content.opf",
    current: "",
    format: "epub",
    percent: 0,
    lastReadAt: id,
    categories: categories.map((name, index) => ({
      id: id * 100 + index,
      name,
    })),
  };
}

const books = [
  book(1, "三体", "刘慈欣", ["科幻"]),
  book(2, "三体Ⅱ·黑暗森林", "刘慈欣", ["科幻"]),
  book(3, "球状闪电", "刘慈欣", ["科幻"]),
  book(4, "活着", "余华", ["文学"]),
  book(5, "百年孤独", "加西亚·马尔克斯", ["文学"]),
];

describe("searchBooks", () => {
  it("returns every book for an empty query", () => {
    expect(searchBooks(books, "  ").map((match) => match.book.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("ranks exact and prefix title matches before broader matches", () => {
    const result = searchBooks(books, "三体");
    expect(result.map((match) => match.book.id)).toEqual([1, 2]);
    expect(result[0]?.rank).toBe(0);
    expect(result[1]?.rank).toBe(1);
  });

  it("matches authors and categories", () => {
    expect(searchBooks(books, "刘慈欣").map((match) => match.book.id)).toEqual([
      3, 2, 1,
    ]);
    expect(searchBooks(books, "文学").map((match) => match.book.id)).toEqual([
      5, 4,
    ]);
  });

  it("ranks mid-title substrings above fuzzy matches", () => {
    const result = searchBooks(books, "黑暗");
    expect(result.map((match) => match.book.id)).toEqual([2]);
    expect(result[0]).toMatchObject({ rank: 2, via: "title" });
  });

  it("falls back to an ordered-character match without accepting misses", () => {
    const fuzzy = searchBooks(books, "三黑");
    expect(fuzzy.map((match) => match.book.id)).toEqual([2]);
    expect(fuzzy[0]?.via).toBe("fuzzy");
    expect(searchBooks(books, "zzzz")).toEqual([]);
  });

  it("normalizes punctuation in both the query and the title", () => {
    expect(searchBooks(books, "三体Ⅱ·黑暗森林")[0]).toMatchObject({
      rank: 0,
      via: "title",
    });
    // A multi-word query is not tokenized; it only matches through the
    // ordered-character fallback.
    expect(searchBooks(books, "三体 黑暗")[0]).toMatchObject({
      rank: 5,
      via: "fuzzy",
    });
  });
});
