import { Button } from "@/components/ui/button";
import type { MarkSearchGroup, MarkSearchHit } from "@/lib/mark-search";
import type { BookSearchMatch } from "./book-search";
import { MarkSearchGroups } from "./MarkSearchGroups";
import { SearchBookShelf } from "./SearchBookShelf";
import type { useMarkSearch } from "./use-mark-search";

export type SearchResultsProps = {
  query: string;
  bookResults: readonly BookSearchMatch[];
  markSearch: ReturnType<typeof useMarkSearch>;
  onOpenBook: (book: { id: number }) => void;
  onOpenMark: (group: MarkSearchGroup, hit: MarkSearchHit) => void;
  onClear: () => void;
};

function SummaryChip({
  label,
  count,
  loading = false,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  loading?: boolean;
  tone: "primary" | "muted";
  onClick: () => void;
}) {
  const disabled = !loading && count === 0;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border-line bg-card text-muted-foreground hover:bg-hover disabled:hover:bg-card inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-55"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${
          tone === "primary" ? "bg-primary" : "bg-faint"
        }`}
      />
      {label}
      <span className="text-foreground font-semibold">
        {loading ? "…" : count}
      </span>
    </button>
  );
}

function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce =
    document.documentElement.classList.contains("reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * The search-mode shelf: book row, then notes/bookmarks grouped by book.
 * The summary chips are anchors, not filters, so the book row keeps its
 * existing semantics.
 */
export function SearchResults({
  query,
  bookResults,
  markSearch,
  onOpenBook,
  onOpenMark,
  onClear,
}: SearchResultsProps) {
  const shortQuery = query.trim().length < 2;
  const markQuery = markSearch.debouncedQuery;
  const marksPending =
    !shortQuery && (markSearch.isLoading || query.trim() !== markQuery);
  const notes = markSearch.totals.notes;
  const bookmarks = markSearch.totals.bookmarks;
  const totalMarks = notes + bookmarks;
  const bothEmpty =
    !shortQuery &&
    !marksPending &&
    !markSearch.isError &&
    bookResults.length === 0 &&
    totalMarks === 0;

  if (bothEmpty) {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="text-muted-foreground text-base">
          没有匹配「{query.trim()}」的书籍、笔记或书签。
        </p>
        <Button variant="outline" size="sm" onClick={onClear}>
          清除搜索
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip
          label="书籍"
          count={bookResults.length}
          tone="primary"
          onClick={() => jumpTo("search-books-section")}
        />
        <SummaryChip
          label="笔记"
          count={notes}
          loading={marksPending}
          tone="primary"
          onClick={() => jumpTo("search-marks-section")}
        />
        <SummaryChip
          label="书签"
          count={bookmarks}
          loading={marksPending}
          tone="muted"
          onClick={() => jumpTo("search-marks-section")}
        />
      </div>

      <SearchBookShelf
        results={bookResults}
        query={query}
        onOpenBook={onOpenBook}
      />

      {shortQuery ? (
        <p className="text-muted-foreground text-sm">
          再输入一个字符，就会同时搜索笔记和书签。
        </p>
      ) : marksPending || markSearch.isError || markSearch.groups.length > 0 ? (
        <section
          id="search-marks-section"
          tabIndex={-1}
          className="flex scroll-mt-32 flex-col gap-3 outline-none sm:scroll-mt-16"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex items-baseline gap-2 text-lg font-semibold">
              笔记与书签
              <span className="text-muted-foreground text-xs font-normal">
                {marksPending ? "…" : `${totalMarks} 条`}
              </span>
            </h2>
            <span className="text-muted-foreground text-xs">按书分组</span>
          </div>
          <MarkSearchGroups
            key={markQuery}
            query={markQuery}
            groups={marksPending ? [] : markSearch.groups}
            totals={markSearch.totals}
            loading={marksPending}
            error={
              markSearch.groups.length === 0 ? markSearch.error : undefined
            }
            onRetry={() => {
              void markSearch.refetch();
            }}
            hasNextPage={markSearch.hasNextPage}
            fetchingNextPage={markSearch.isFetchingNextPage}
            onFetchNextPage={() => {
              void markSearch.fetchNextPage();
            }}
            onOpenBook={(group) => onOpenBook(group.book)}
            onOpenMark={onOpenMark}
          />
        </section>
      ) : null}
    </div>
  );
}
