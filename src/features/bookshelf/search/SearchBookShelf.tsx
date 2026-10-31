import { useState } from "react";
import { useViewportSize } from "@/hooks/use-viewport-size";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CoverArt } from "../CoverArt";
import type { BookshelfBook } from "../types";
import type { BookSearchMatch } from "./book-search";
import { HighlightText } from "./HighlightText";

export type SearchBookShelfProps = {
  results: readonly BookSearchMatch[];
  query: string;
  onOpenBook: (book: BookshelfBook) => void;
};

type CardProps = {
  match: BookSearchMatch;
  query: string;
  onOpen: () => void;
  grid?: boolean;
};

function SearchBookCard({ match, query, onOpen, grid = false }: CardProps) {
  const book = match.book;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={book.title}
      className="group w-full text-left outline-none"
    >
      <span
        className={
          grid
            ? "bg-surface-2 group-focus-visible:ring-ring/40 relative block aspect-[2/3] w-full overflow-hidden rounded-md group-focus-visible:ring-2"
            : "bg-surface-2 shadow-soft group-hover:shadow-lift group-focus-visible:ring-ring/40 relative block aspect-[2/3] w-full overflow-hidden rounded-md transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:ring-2"
        }
      >
        {book.coverUrl === "" ? (
          <CoverArt seed={book.id} title={book.title} />
        ) : (
          <img
            src={book.coverUrl}
            alt={`${book.title} 封面`}
            className="h-full w-full object-cover"
          />
        )}
        {book.percent > 0 ? (
          <span className="absolute top-2 left-2 rounded-full bg-black/45 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            已读 {book.percent}%
          </span>
        ) : null}
      </span>
      <span className="mt-2 block min-w-0">
        <span className="line-clamp-2 block text-sm leading-tight font-medium">
          <HighlightText text={book.title} query={query} />
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          <HighlightText text={book.author} query={query} />
        </span>
      </span>
    </button>
  );
}

/**
 * One horizontal row of matching books. "查看全部" keeps the notes section in
 * place: desktop opens a centered dialog, narrow screens open a bottom sheet.
 */
export function SearchBookShelf({
  results,
  query,
  onOpenBook,
}: SearchBookShelfProps) {
  const [open, setOpen] = useState(false);
  const { width } = useViewportSize();
  const isNarrow = width > 0 && width < 640;

  const openBook = (book: BookshelfBook) => {
    setOpen(false);
    onOpenBook(book);
  };

  const grid = (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-5">
      {results.map((match) => (
        <SearchBookCard
          key={match.book.id}
          match={match}
          query={query}
          onOpen={() => openBook(match.book)}
          grid
        />
      ))}
    </div>
  );

  return (
    <section
      id="search-books-section"
      tabIndex={-1}
      className="flex scroll-mt-32 flex-col gap-3 outline-none sm:scroll-mt-16"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          书籍
          <span className="text-muted-foreground text-xs font-normal">
            {results.length} 本
          </span>
        </h2>
        {results.length > 0 ? (
          <button
            type="button"
            className="text-primary-button text-sm hover:underline"
            onClick={() => setOpen(true)}
          >
            查看全部 {results.length} 本
          </button>
        ) : null}
      </div>

      {results.length === 0 ? (
        <p className="border-line bg-card text-muted-foreground rounded-xl border border-dashed px-4 py-5 text-sm">
          没有匹配的书籍。
        </p>
      ) : (
        <div className="flex snap-x [scrollbar-width:none] gap-3 overflow-x-auto pb-2 sm:gap-4 [&::-webkit-scrollbar]:hidden">
          {results.map((match) => (
            <div
              key={match.book.id}
              className="w-[104px] shrink-0 snap-start sm:w-[120px]"
            >
              <SearchBookCard
                match={match}
                query={query}
                onOpen={() => openBook(match.book)}
              />
            </div>
          ))}
        </div>
      )}

      {isNarrow ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-0 p-0">
            <SheetHeader className="border-line border-b p-4">
              <SheetTitle>书籍结果</SheetTitle>
              <p className="text-muted-foreground text-xs">
                匹配「{query}」 · {results.length} 本
              </p>
            </SheetHeader>
            <div className="overflow-y-auto p-4">{grid}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] gap-4 sm:max-w-4xl">
            <div>
              <DialogTitle>书籍结果</DialogTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                匹配「{query}」 · {results.length} 本
              </p>
            </div>
            <div className="max-h-[65vh] overflow-y-auto pr-1">{grid}</div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
