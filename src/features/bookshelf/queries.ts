import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getBooks } from "@/server/fns/books";
import { getCategories } from "@/server/fns/categories";
import type { BookshelfBook, BookshelfCategory } from "./types";

export const BOOKS_QUERY_KEY = ["books"] as const;
export const CATEGORIES_QUERY_KEY = ["categories"] as const;

/**
 * The shelf loads client-side (no SSR data in SPA mode): `getBooks` carries the
 * category links and the cover URL, so one request renders the whole grid.
 */
export function booksQueryOptions() {
  return queryOptions({
    queryKey: BOOKS_QUERY_KEY,
    queryFn: async (): Promise<BookshelfBook[]> => getBooks(),
  });
}

export function categoriesQueryOptions() {
  return queryOptions({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: async (): Promise<BookshelfCategory[]> => getCategories(),
  });
}

/**
 * Refreshes both lists. They are invalidated together because creating a
 * category changes the drawer, linking a book changes both, and deleting a book
 * changes the per-category book sets.
 */
export async function invalidateBookshelf(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY }),
    client.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY }),
  ]);
}

/** Refreshes just the drawer (create / delete category). */
export async function invalidateCategories(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
}
