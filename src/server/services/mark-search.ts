import { eq } from "drizzle-orm";
import type { AnchorType } from "@/lib/reader-anchor";
import { parseStoredAnchor } from "@/lib/reader-anchor";
import type {
  MarkSearchBook,
  MarkSearchCursor,
  MarkSearchField,
  MarkSearchGroup,
  MarkSearchHit,
  MarkSearchHitsResult,
  MarkSearchResult,
} from "@/lib/mark-search";
import type { Database } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import { bookFileUrl } from "@/server/fns/urls";

/**
 * Grouped mark search.
 *
 * The expensive part is the leading-wildcard `LIKE` over three text columns;
 * grouping itself is cheap. So the first query only counts per book/type, the
 * second loads at most three hits for the visible groups, and the reader can
 * append the rest one book at a time. Never run a window function over every
 * match just to take the first three per group.
 */

const MATCH_SQL = `
  (
    (m.type = 'bookmark' AND (
      m.title LIKE ? ESCAPE '\\' OR
      m.selectedString LIKE ? ESCAPE '\\'
    ))
    OR
    (m.type = 'highlight' AND (
      m.content LIKE ? ESCAPE '\\' OR
      m.selectedString LIKE ? ESCAPE '\\' OR
      m.title LIKE ? ESCAPE '\\'
    ))
  )
`;

const HIT_COLUMNS = `
  m.id, m.bookId, m.type, m.color, m.title, m.content, m.selectedString,
  m.anchorType, m.anchor
`;

interface CountRow {
  bookId: number;
  type: string;
  n: number;
}

interface HitRow {
  id: number;
  bookId: number;
  type: string;
  color: string;
  title: string;
  content: string;
  selectedString: string;
  anchorType: string;
  anchor: string;
}

/** Escape the characters SQLite assigns special meaning under `LIKE`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function likePattern(query: string): string {
  return `%${escapeLike(query)}%`;
}

function rankOf(type: string): number {
  return type === "bookmark" ? 1 : 0;
}

/** Shortest useful excerpt around the first match, with the query intact. */
function makeSnippet(text: string, query: string, radius = 44): string {
  if (text === "") return "";
  const needle = query.toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(needle);
  if (index < 0) {
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function pickMatch(
  row: HitRow,
  query: string,
): { field: MarkSearchField; text: string } {
  const needle = query.toLocaleLowerCase();
  const fields: readonly [MarkSearchField, string][] =
    row.type === "bookmark"
      ? [
          ["title", row.title],
          ["selectedString", row.selectedString],
        ]
      : [
          ["content", row.content],
          ["selectedString", row.selectedString],
          ["title", row.title],
        ];

  for (const [field, text] of fields) {
    if (text !== "" && text.toLocaleLowerCase().includes(needle)) {
      return { field, text };
    }
  }
  const fallback = fields.find(([, text]) => text !== "");
  return fallback
    ? { field: fallback[0], text: fallback[1] }
    : { field: "title", text: "" };
}

function locationOf(
  row: HitRow,
  anchor: ReturnType<typeof parseStoredAnchor>,
): string {
  if (row.type === "bookmark") {
    if (anchor?.type === "pdf" && anchor.pages[0]) {
      return `第 ${anchor.pages[0].page + 1} 页`;
    }
    return "书签";
  }
  return row.title === "" ? "正文" : row.title;
}

function toHit(row: HitRow, query: string): MarkSearchHit | undefined {
  const anchor = parseStoredAnchor(row.anchorType as AnchorType, row.anchor);
  if (!anchor) return undefined;

  const match = pickMatch(row, query);
  const type = row.type === "bookmark" ? "bookmark" : "highlight";

  return {
    id: row.id,
    type,
    color: row.color,
    location: locationOf(row, anchor),
    hasNote: type === "highlight" && row.content.trim() !== "",
    matchedField: match.field,
    snippet: makeSnippet(match.text, query),
  };
}

function loadHits(
  db: Database,
  userId: number,
  bookId: number,
  query: string,
  cursor: MarkSearchCursor | undefined,
  limit: number,
): MarkSearchHitsResult {
  const pattern = likePattern(query);
  const patterns = [pattern, pattern, pattern, pattern, pattern] as const;
  const cursorSql = cursor
    ? `AND (
        (CASE WHEN m.type = 'bookmark' THEN 1 ELSE 0 END) > ?
        OR (
          (CASE WHEN m.type = 'bookmark' THEN 1 ELSE 0 END) = ?
          AND m.id < ?
        )
      )`
    : "";

  const sql = `
    SELECT ${HIT_COLUMNS}
    FROM Mark m
    WHERE m.userId = ? AND m.bookId = ? AND ${MATCH_SQL}
    ${cursorSql}
    ORDER BY (CASE WHEN m.type = 'bookmark' THEN 1 ELSE 0 END) ASC, m.id DESC
    LIMIT ?
  `;

  const params: (string | number)[] = [userId, bookId, ...patterns];
  if (cursor) params.push(cursor.rank, cursor.rank, cursor.id);
  params.push(limit + 1);

  const rows = db.$client.prepare(sql).all(...params) as unknown as HitRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const hits = pageRows.flatMap((row) => {
    const hit = toHit(row, query);
    return hit ? [hit] : [];
  });
  const last = pageRows[pageRows.length - 1];

  return {
    hits,
    ...(hasMore && last
      ? {
          nextHitCursor: {
            rank: rankOf(last.type),
            id: last.id,
          },
        }
      : {}),
  };
}

function toSearchBook(book: {
  id: number;
  title: string;
  author: string;
  cover: string;
  format: "epub" | "pdf";
  percent: number;
  lastReadAt: number;
}): MarkSearchBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.cover === "" ? "" : bookFileUrl(book.id, book.cover),
    format: book.format,
    percent: book.percent,
    lastReadAt: book.lastReadAt,
  };
}

export interface SearchMarksInput {
  query: string;
  groupOffset: number;
  groupLimit: number;
}

/** One page of book groups, each with its first three hits. */
export function searchMarksInDb(
  db: Database,
  userId: number,
  input: SearchMarksInput,
): MarkSearchResult {
  const query = input.query.trim();
  if (query === "") {
    return { groups: [], totals: { books: 0, notes: 0, bookmarks: 0 } };
  }

  const pattern = likePattern(query);
  const patterns = [pattern, pattern, pattern, pattern, pattern] as const;
  const countRows = db.$client
    .prepare(`
      SELECT m.bookId AS bookId, m.type AS type, COUNT(*) AS n
      FROM Mark m
      WHERE m.userId = ? AND ${MATCH_SQL}
      GROUP BY m.bookId, m.type
    `)
    .all(userId, ...patterns) as unknown as CountRow[];

  const countsByBook = new Map<number, { notes: number; bookmarks: number }>();
  for (const row of countRows) {
    const counts = countsByBook.get(row.bookId) ?? {
      notes: 0,
      bookmarks: 0,
    };
    if (row.type === "bookmark") counts.bookmarks += row.n;
    else counts.notes += row.n;
    countsByBook.set(row.bookId, counts);
  }

  const books = db
    .select({
      id: Book.id,
      title: Book.title,
      author: Book.author,
      cover: Book.cover,
      format: Book.format,
      percent: Book.percent,
      lastReadAt: Book.lastReadAt,
    })
    .from(Book)
    .where(eq(Book.userId, userId))
    .all();

  const groups: MarkSearchGroup[] = books.flatMap((book) => {
    const counts = countsByBook.get(book.id);
    if (!counts) return [];
    return [
      {
        book: toSearchBook(book),
        counts,
        hits: [],
      },
    ];
  });

  groups.sort((a, b) => {
    const totalA = a.counts.notes + a.counts.bookmarks;
    const totalB = b.counts.notes + b.counts.bookmarks;
    return (
      totalB - totalA ||
      b.book.lastReadAt - a.book.lastReadAt ||
      a.book.title.localeCompare(b.book.title, "zh-Hans-CN")
    );
  });

  const totals = groups.reduce(
    (sum, group) => ({
      books: sum.books + 1,
      notes: sum.notes + group.counts.notes,
      bookmarks: sum.bookmarks + group.counts.bookmarks,
    }),
    { books: 0, notes: 0, bookmarks: 0 },
  );

  const offset = Math.max(0, input.groupOffset);
  const limit = Math.max(1, input.groupLimit);
  const page = groups.slice(offset, offset + limit);
  for (const group of page) {
    const { hits, nextHitCursor } = loadHits(
      db,
      userId,
      group.book.id,
      query,
      undefined,
      3,
    );
    group.hits = hits;
    if (nextHitCursor) group.nextHitCursor = nextHitCursor;
  }

  const end = offset + page.length;
  return {
    groups: page,
    totals,
    ...(end < groups.length ? { nextGroupOffset: end } : {}),
  };
}

/** Next batch of hits inside one book, continuing after `cursor`. */
export function searchMarkHitsInDb(
  db: Database,
  userId: number,
  bookId: number,
  query: string,
  cursor: MarkSearchCursor | undefined,
  limit: number,
): MarkSearchHitsResult {
  if (query.trim() === "") return { hits: [] };
  return loadHits(db, userId, bookId, query.trim(), cursor, limit);
}
