import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getMarkColorValue } from "@/components/color-radio";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useViewportSize } from "@/hooks/use-viewport-size";
import { errorMessage } from "@/lib/utils";
import type {
  MarkSearchCursor,
  MarkSearchGroup,
  MarkSearchHit,
  MarkSearchResult,
} from "@/lib/mark-search";
import { searchMarkHits } from "@/server/fns/search";
import { CoverArt } from "../CoverArt";
import { HighlightText } from "./HighlightText";

export type MarkSearchGroupsProps = {
  query: string;
  groups: readonly MarkSearchGroup[];
  totals: MarkSearchResult["totals"];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onFetchNextPage: () => void;
  onOpenBook: (group: MarkSearchGroup) => void;
  onOpenMark: (group: MarkSearchGroup, hit: MarkSearchHit) => void;
};

type ExtraState = {
  hits: MarkSearchHit[];
  cursor?: MarkSearchCursor;
  expanded: boolean;
};

function BookThumb({ group }: { group: MarkSearchGroup }) {
  const { book } = group;
  return (
    <span className="bg-surface-2 block h-11 w-8 shrink-0 overflow-hidden rounded-sm">
      {book.coverUrl === "" ? (
        <CoverArt seed={book.id} title={book.title} />
      ) : (
        <img
          src={book.coverUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function MarkRow({
  group,
  hit,
  query,
  onOpen,
}: {
  group: MarkSearchGroup;
  hit: MarkSearchHit;
  query: string;
  onOpen: () => void;
}) {
  const isBookmark = hit.type === "bookmark";
  const label = isBookmark ? "书签" : hit.hasNote ? "笔记" : "高亮";
  const dotColor = getMarkColorValue(hit.color);
  const badgeClass = isBookmark
    ? "bg-surface-2 text-muted-foreground"
    : hit.hasNote
      ? "bg-primary-soft text-foreground"
      : "bg-surface-2 text-muted-foreground";
  const metaLabel = isBookmark
    ? "书签"
    : hit.matchedField === "content"
      ? "批注"
      : hit.matchedField === "selectedString"
        ? "原文"
        : "章节";
  const meta = isBookmark
    ? group.book.format === "epub" && group.book.percent > 0
      ? `已读 ${group.book.percent}%`
      : hit.location
    : `${metaLabel} · ${hit.location}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-hover flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors"
    >
      <span
        className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs leading-none ${badgeClass}`}
      >
        {!isBookmark && dotColor !== undefined ? (
          <span
            aria-hidden="true"
            className="mr-1 inline-block size-1.5 rounded-full align-[1px]"
            style={{ backgroundColor: dotColor }}
          />
        ) : null}
        {label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm leading-normal">
          <HighlightText text={hit.snippet} query={query} />
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {meta}
        </span>
      </span>
      <span aria-hidden="true" className="text-faint mt-0.5 text-base">
        ›
      </span>
    </button>
  );
}

function MarkBookPanel({
  group,
  query,
  onOpenChange,
  onOpenMark,
}: {
  group: MarkSearchGroup;
  query: string;
  onOpenChange: (open: boolean) => void;
  onOpenMark: (group: MarkSearchGroup, hit: MarkSearchHit) => void;
}) {
  const [hits, setHits] = useState(group.hits);
  const [cursor, setCursor] = useState(group.nextHitCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const { width } = useViewportSize();
  const isNarrow = width > 0 && width < 640;
  const total = group.counts.notes + group.counts.bookmarks;

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await searchMarkHits({
        data: {
          query,
          bookId: group.book.id,
          cursorRank: cursor.rank,
          cursorId: cursor.id,
          limit: 20,
        },
      });
      setHits((current) => [...current, ...result.hits]);
      setCursor(result.nextHitCursor);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-line ml-4 border-l">
          {hits.map((hit) => (
            <MarkRow
              key={hit.id}
              group={group}
              hit={hit}
              query={query}
              onOpen={() => {
                onOpenChange(false);
                onOpenMark(group, hit);
              }}
            />
          ))}
        </div>
      </div>
      <div className="border-line flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
        <span className="text-muted-foreground text-xs">
          已显示 {hits.length} / {total}
        </span>
        {cursor ? (
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              void loadMore();
            }}
          >
            {loading
              ? "加载中…"
              : `加载更多（还剩 ${Math.max(0, total - hits.length)} 条）`}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">已显示全部</span>
        )}
      </div>
      {error ? (
        <p className="text-destructive shrink-0 px-4 pb-3 text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  return isNarrow ? (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-0 p-0">
        <SheetHeader className="border-line shrink-0 border-b p-4 pr-10">
          <SheetTitle>{group.book.title}</SheetTitle>
          <p className="text-muted-foreground text-xs">
            {group.book.author} · {total} 条
          </p>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80dvh] max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <div className="border-line shrink-0 border-b p-4 pr-10">
          <DialogTitle>{group.book.title}</DialogTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {group.book.author} · {total} 条
          </p>
        </div>
        {body}
      </DialogContent>
    </Dialog>
  );
}

export function MarkSearchGroups({
  query,
  groups,
  totals,
  loading,
  error,
  onRetry,
  hasNextPage,
  fetchingNextPage,
  onFetchNextPage,
  onOpenBook,
  onOpenMark,
}: MarkSearchGroupsProps) {
  const [extra, setExtra] = useState<Record<number, ExtraState>>({});
  const [loadingBooks, setLoadingBooks] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [panelGroup, setPanelGroup] = useState<MarkSearchGroup | null>(null);

  const loadMore = async (group: MarkSearchGroup) => {
    const bookId = group.book.id;
    const current = extra[bookId];
    const cursor = current?.cursor ?? group.nextHitCursor;
    if (!cursor || loadingBooks.has(bookId)) return;

    const total = group.counts.notes + group.counts.bookmarks;
    const firstBatch = current === undefined;
    const limit =
      firstBatch && total <= 12 ? Math.max(1, total - group.hits.length) : 10;

    setLoadingBooks((previous) => new Set(previous).add(bookId));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[bookId];
      return next;
    });
    try {
      const result = await searchMarkHits({
        data: {
          query,
          bookId,
          cursorRank: cursor.rank,
          cursorId: cursor.id,
          limit,
        },
      });
      setExtra((previous) => ({
        ...previous,
        [bookId]: {
          hits: [...(previous[bookId]?.hits ?? []), ...result.hits],
          cursor: result.nextHitCursor,
          expanded: true,
        },
      }));
    } catch (reason) {
      setErrors((previous) => ({
        ...previous,
        [bookId]: errorMessage(reason),
      }));
    } finally {
      setLoadingBooks((previous) => {
        const next = new Set(previous);
        next.delete(bookId);
        return next;
      });
    }
  };

  const toggleGroup = (group: MarkSearchGroup) => {
    const bookId = group.book.id;
    const current = extra[bookId];
    const total = group.counts.notes + group.counts.bookmarks;
    const shown = group.hits.length + (current?.hits.length ?? 0);

    if (current?.expanded && shown >= total) {
      setExtra((previous) => ({
        ...previous,
        [bookId]: { ...current, expanded: false },
      }));
      return;
    }
    if (current && !current.expanded) {
      setExtra((previous) => ({
        ...previous,
        [bookId]: { ...current, expanded: true },
      }));
      return;
    }
    void loadMore(group);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="border-line bg-card flex flex-col gap-3 rounded-xl border p-4"
          >
            <div className="bg-surface-2 h-4 w-1/3 animate-pulse rounded" />
            <div className="bg-surface-2 h-3 w-4/5 animate-pulse rounded" />
            <div className="bg-surface-2 h-3 w-3/5 animate-pulse rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-line bg-card flex flex-col items-start gap-2 rounded-xl border p-4">
        <p className="text-destructive text-sm" role="alert">
          {errorMessage(error)}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const state = extra[group.book.id];
        const total = group.counts.notes + group.counts.bookmarks;
        const shown =
          group.hits.length + (state?.expanded ? state.hits.length : 0);
        const visible = state?.expanded
          ? [...group.hits, ...state.hits]
          : group.hits;
        const isExpanded = state?.expanded === true;
        const allShown = isExpanded && shown >= total;
        const canShowMore = total > group.hits.length;
        const loadingThis = loadingBooks.has(group.book.id);
        const errorThis = errors[group.book.id];
        const openPanel = total > 50 && !isExpanded;

        const actionLabel = loadingThis
          ? "加载中…"
          : openPanel
            ? `查看全部 ${total} 条`
            : allShown
              ? "收起"
              : isExpanded
                ? `加载更多（还剩 ${total - shown} 条）`
                : `展开全部 ${total} 条`;

        return (
          <section
            key={group.book.id}
            className="border-line bg-card overflow-hidden rounded-xl border"
          >
            <header className="border-line flex items-center gap-2 border-b px-3 py-2.5">
              <BookThumb group={group} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">
                  <HighlightText text={group.book.title} query={query} />
                </h3>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {group.book.author}
                  {group.counts.notes > 0
                    ? ` · 笔记 ${group.counts.notes}`
                    : ""}
                  {group.counts.bookmarks > 0
                    ? ` · 书签 ${group.counts.bookmarks}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="text-primary-button shrink-0 text-xs hover:underline"
                onClick={() => onOpenBook(group)}
              >
                打开书籍
              </button>
            </header>

            <div
              id={`group-hits-${group.book.id}`}
              className="border-line ml-4 border-l py-1"
            >
              {visible.map((hit) => (
                <MarkRow
                  key={hit.id}
                  group={group}
                  hit={hit}
                  query={query}
                  onOpen={() => onOpenMark(group, hit)}
                />
              ))}
            </div>

            {canShowMore || isExpanded ? (
              <div className="flex flex-wrap items-center gap-2 px-3 pt-1 pb-2.5 pl-6">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`group-hits-${group.book.id}`}
                  className="text-primary-button disabled:text-muted-foreground -my-1 min-h-6 py-1 text-xs hover:underline disabled:no-underline"
                  disabled={loadingThis}
                  onClick={() => {
                    if (openPanel) setPanelGroup(group);
                    else toggleGroup(group);
                  }}
                >
                  {actionLabel}
                </button>
                {errorThis ? (
                  <span className="text-destructive text-xs" role="alert">
                    {errorThis}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={fetchingNextPage}
          onClick={onFetchNextPage}
        >
          {fetchingNextPage
            ? "加载中…"
            : `加载更多书籍（还有 ${Math.max(
                0,
                totals.books - groups.length,
              )} 本）`}
        </Button>
      ) : null}

      {panelGroup ? (
        <MarkBookPanel
          key={panelGroup.book.id}
          group={panelGroup}
          query={query}
          onOpenChange={(open) => {
            if (!open) setPanelGroup(null);
          }}
          onOpenMark={onOpenMark}
        />
      ) : null}
    </div>
  );
}
