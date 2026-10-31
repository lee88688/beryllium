import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchMarks } from "@/server/fns/search";

/** Keep one keystroke worth of typing off the database. */
const DEBOUNCE_MS = 300;
const GROUP_LIMIT = 30;

export function useMarkSearch(query: string) {
  const normalized = query.trim();
  const debouncedQuery = useDebouncedValue(normalized, DEBOUNCE_MS);
  const enabled = debouncedQuery.length >= 2;

  const result = useInfiniteQuery({
    queryKey: ["marks-search", debouncedQuery] as const,
    queryFn: ({ pageParam }) =>
      searchMarks({
        data: {
          query: debouncedQuery,
          groupOffset: pageParam,
          groupLimit: GROUP_LIMIT,
        },
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextGroupOffset,
    enabled,
    staleTime: 30_000,
  });

  const pages = result.data?.pages ?? [];
  const groups = pages.flatMap((page) => page.groups);
  const totals = pages[0]?.totals ?? {
    books: 0,
    notes: 0,
    bookmarks: 0,
  };

  return {
    ...result,
    debouncedQuery,
    enabled,
    groups,
    totals,
    isLoading: enabled && result.isPending,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
  };
}
