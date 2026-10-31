import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MarkSearchHitsResult, MarkSearchResult } from "@/lib/mark-search";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/domain/errors";
import { createSlidingWindowLimiter } from "@/server/domain/rate-limit";
import { userHasBook } from "@/server/services/book";
import {
  searchMarkHitsInDb,
  searchMarksInDb,
} from "@/server/services/mark-search";
import { requireSession } from "@/server/session";
import { inputValidator } from "./input";

const SEARCH_LIMIT = 600;
const SEARCH_WINDOW_MS = 60_000;
const searchLimiter = createSlidingWindowLimiter(
  SEARCH_LIMIT,
  SEARCH_WINDOW_MS,
);

/** Bounds one authenticated user's search traffic; search is synchronous. */
function assertSearchAllowed(userId: number): void {
  const key = String(userId);
  if (searchLimiter.count(key) >= SEARCH_LIMIT) {
    throw new RequestError("BAD_REQUEST", "搜索过于频繁，请稍后再试");
  }
  searchLimiter.record(key);
}

const searchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  groupOffset: z.number().int().min(0).max(100_000).default(0),
  groupLimit: z.number().int().min(1).max(30).default(30),
});

/** One page of matching book groups, each with its first three marks. */
export const searchMarks = createServerFn({ method: "POST" })
  .validator(inputValidator(searchSchema))
  .handler(async ({ data }): Promise<MarkSearchResult> => {
    const { user } = await requireSession();
    assertSearchAllowed(user.id);
    return searchMarksInDb(getDb(), user.id, data);
  });

const searchHitsSchema = z.object({
  query: z.string().trim().min(1).max(200),
  bookId: z.number().int(),
  cursorRank: z.number().int().min(0).max(1).optional(),
  cursorId: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

/** Next batch of hits inside one book, for the group's "load more" button. */
export const searchMarkHits = createServerFn({ method: "POST" })
  .validator(inputValidator(searchHitsSchema))
  .handler(async ({ data }): Promise<MarkSearchHitsResult> => {
    const { user } = await requireSession();
    assertSearchAllowed(user.id);
    const db = getDb();
    if (!userHasBook(db, user.id, data.bookId)) {
      throw new RequestError("NOT_FOUND", "书籍不存在");
    }
    return searchMarkHitsInDb(
      db,
      user.id,
      data.bookId,
      data.query,
      data.cursorId === undefined
        ? undefined
        : { rank: data.cursorRank ?? 0, id: data.cursorId },
      data.limit,
    );
  });
