import { useNavigate } from "@tanstack/react-router";
import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "@/components/sonner-toaster";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewportSize } from "@/hooks/use-viewport-size";
import { COVER_MIN, useShelfPrefs } from "@/lib/prefs";
import { CoverArt } from "./CoverArt";
import type { BookshelfBook, BookshelfCategory } from "./types";

export type BookGridProps = {
  books: readonly BookshelfBook[];
  categories: readonly BookshelfCategory[];
  /** `0` = 我的书籍 (all books); otherwise the selected category. */
  selectedCategory: number;
  onSelectFile: (file: File) => void;
  onAddToCategory: (bookId: number, categoryId: number) => void;
  onRemoveFromCategory: (book: BookshelfBook) => void;
  onDeleteBook: (book: BookshelfBook) => void;
};

type BookCardProps = {
  book: BookshelfBook;
  selectedCategory: number;
  onOpen: () => void;
  onAddToCategory: () => void;
  onRemoveFromCategory: () => void;
  onDeleteBook: () => void;
};

/**
 * 原型 `.card`，但文字压在封面上：封面本身是卡片，标题与作者落在封面底部的
 * 渐变暗角里。
 *
 * 为什么用渐变而不是纯色条：封面可能是浅色（白底设计稿）也可能是深色照片，
 * 底部一段 `black/75 → 透明` 能让白字在两种情况下都有对比；文字固定用白色，
 * 不跟随主题（封面不是界面的一部分）。长标题两行截断，并把完整标题放进
 * `title`，悬停可看全。
 */
function BookCard({
  book,
  selectedCategory,
  onOpen,
  onAddToCategory,
  onRemoveFromCategory,
  onDeleteBook,
}: BookCardProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={book.title}
        className="flex w-full flex-col text-left outline-none"
      >
        <span className="bg-surface-2 shadow-soft group-hover:shadow-lift relative block aspect-[2/3] w-full overflow-hidden rounded-sm transition-[transform,box-shadow] duration-200 outline-none group-focus-within:-translate-y-1 group-hover:-translate-y-1">
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
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-black/90 via-black/75 to-transparent px-2.5 pt-7 pb-2 backdrop-blur-[3px] [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]">
            <span className="line-clamp-2 text-sm leading-tight font-semibold text-white max-sm:text-base">
              {book.title}
            </span>
            <span className="truncate text-xs text-white/75">
              {book.author}
            </span>
          </span>
        </span>
      </button>

      <div className="absolute top-2 right-2 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                size="sm"
                aria-label={`${book.title} 更多操作`}
                className="bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 max-sm:size-9"
              />
            }
          >
            <MoreVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddToCategory}>
              添加到分类
            </DropdownMenuItem>
            {selectedCategory === 0 ? null : (
              <DropdownMenuItem onClick={onRemoveFromCategory}>
                从分类中删除
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={onDeleteBook}>
              删除书籍
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * The main area of the shelf: the upload tile (only in "我的书籍"), one card per
 * book, and the "选择类别" dialog behind each card's "添加到分类" entry.
 */
export function BookGrid({
  books,
  categories,
  selectedCategory,
  onSelectFile,
  onAddToCategory,
  onRemoveFromCategory,
  onDeleteBook,
}: BookGridProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [addTargetId, setAddTargetId] = useState<number | undefined>();
  const { cover } = useShelfPrefs();
  const { width } = useViewportSize();
  // 窄屏给封面尺寸封顶：否则「大」在 390px 上只剩一列（原型同样把窄屏钉在固定值）。
  const minCover =
    width > 0 && width < 640
      ? Math.min(COVER_MIN[cover], COVER_MIN.md)
      : COVER_MIN[cover];

  /** Every category except the one currently filtered on. */
  const candidates = useMemo(
    () => categories.filter((category) => category.id !== selectedCategory),
    [categories, selectedCategory],
  );

  const openAddDialog = (bookId: number) => {
    if (candidates.length === 0) {
      toast.error("暂无其他类别，请添加后重试！");
      return;
    }
    setAddTargetId(bookId);
  };

  return (
    <>
      <div
        className="grid gap-x-3 gap-y-4 sm:gap-x-5 sm:gap-y-5"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCover}px, 1fr))`,
        }}
      >
        {selectedCategory === 0 ? (
          <button
            type="button"
            aria-label="上传书籍"
            onClick={() => inputRef.current?.click()}
            className="border-line-strong text-muted-foreground hover:bg-hover focus-visible:ring-ring/40 flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed outline-none focus-visible:ring-2"
          >
            <PlusIcon className="size-6" />
            <span className="text-sm">添加书籍</span>
          </button>
        ) : null}

        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            selectedCategory={selectedCategory}
            onOpen={() => {
              void navigate({
                to: "/reader/$id",
                params: { id: String(book.id) },
              });
            }}
            onAddToCategory={() => openAddDialog(book.id)}
            onRemoveFromCategory={() => onRemoveFromCategory(book)}
            onDeleteBook={() => onDeleteBook(book)}
          />
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/epub+zip,application/pdf"
        aria-label="选择 EPUB 或 PDF 文件"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first so re-picking the same file fires `change` again.
          event.target.value = "";
          if (!file) return;
          onSelectFile(file);
        }}
      />

      <Dialog
        open={addTargetId !== undefined}
        onOpenChange={(open) => {
          if (!open) setAddTargetId(undefined);
        }}
      >
        <DialogContent className="gap-2">
          <DialogTitle>选择类别</DialogTitle>
          <div className="-mx-1 flex flex-col">
            {candidates.map((category) => (
              <button
                key={category.id}
                type="button"
                className="hover:bg-hover focus-visible:ring-ring/40 rounded-md px-5 py-2 text-left text-base outline-none focus-visible:ring-2"
                onClick={() => {
                  const bookId = addTargetId;
                  setAddTargetId(undefined);
                  if (bookId === undefined) return;
                  onAddToCategory(bookId, category.id);
                }}
              >
                {category.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
