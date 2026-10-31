import type { BookshelfBook } from "../types";

export type BookSearchMatch = {
  book: BookshelfBook;
  rank: number;
  score: number;
  via: "title" | "author" | "category" | "fuzzy";
};

/** Case/punctuation-insensitive key used only for matching. */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s·:：,，.。!！?？'"“”‘’\-—_/\\()（）[\]【】]+/g, "");
}

/** True when every character of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length < 2) return false;
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

/**
 * Local book search. Exact title > title prefix > title substring > author >
 * category > ordered-character fuzzy match. `score` only breaks ties inside a
 * rank; the RNG-like Fuse ranking is deliberately not trusted for Chinese.
 *
 * This is a dependency-free first pass. If fuzzy typo tolerance is needed,
 * swap the final rank for Fuse.js and keep this comparator as the tie-break.
 */
export function searchBooks(
  books: readonly BookshelfBook[],
  query: string,
): BookSearchMatch[] {
  const needle = normalize(query.trim());
  if (needle === "") {
    return books.map((book) => ({
      book,
      rank: 0,
      score: 0,
      via: "title",
    }));
  }

  const matches: BookSearchMatch[] = [];
  for (const book of books) {
    const title = normalize(book.title);
    const author = normalize(book.author);
    const categories = book.categories.map((category) =>
      normalize(category.name),
    );

    if (title === needle) {
      matches.push({ book, rank: 0, score: 0, via: "title" });
      continue;
    }
    if (title.startsWith(needle)) {
      matches.push({ book, rank: 1, score: 0.1, via: "title" });
      continue;
    }
    if (title.includes(needle)) {
      matches.push({ book, rank: 2, score: 0.2, via: "title" });
      continue;
    }
    if (author.includes(needle)) {
      matches.push({ book, rank: 3, score: 0.3, via: "author" });
      continue;
    }
    if (categories.some((category) => category.includes(needle))) {
      matches.push({ book, rank: 4, score: 0.4, via: "category" });
      continue;
    }
    if (isSubsequence(needle, title)) {
      matches.push({ book, rank: 5, score: 0.5, via: "fuzzy" });
    }
  }

  return matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.score - b.score ||
      b.book.lastReadAt - a.book.lastReadAt ||
      a.book.title.localeCompare(b.book.title, "zh-Hans-CN"),
  );
}
