import { BookIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookshelfBook } from "./types";

/**
 * 原型的「继续阅读」卡：左边封面、中间书名与作者、右边「继续阅读」。
 *
 * 真实数据里没有阅读进度（`Book.current` 是 CFI，服务端没存百分比与最后阅读
 * 时间），所以这里不画进度条，也不编「上次阅读」——位置信息只在阅读器内部有效。
 */
export function ShelfHero({
  book,
  hint,
  onContinue,
}: {
  book: BookshelfBook;
  /** 例如「我的书籍」或分类名。 */
  hint: string;
  onContinue: () => void;
}) {
  return (
    <section className="shadow-soft border-line bg-background mb-7 flex items-center gap-5 rounded-xl border p-[18px] max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-4 max-sm:w-full sm:gap-5">
        <span className="bg-surface-2 relative block w-[72px] shrink-0 overflow-hidden rounded-sm">
          <span className="block aspect-[2/3] w-full">
            {book.coverUrl === "" ? (
              <span className="text-faint flex h-full w-full items-center justify-center">
                <BookIcon className="size-6" />
              </span>
            ) : (
              <img
                src={book.coverUrl}
                alt={`${book.title} 封面`}
                className="h-full w-full object-cover"
              />
            )}
          </span>
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-faint text-xs tracking-wide">继续阅读</span>
          <h2 className="truncate text-xl font-semibold max-sm:text-lg">
            {book.title}
          </h2>
          <p className="text-muted-foreground truncate text-base">
            {book.author}
            {book.categories.length > 0
              ? ` · ${book.categories.map((link) => link.name).join(" · ")}`
              : ""}
          </p>
          <p className="text-faint truncate text-sm">{hint}</p>
          {book.percent > 0 ? (
            <span className="mt-1 flex items-center gap-2">
              <span className="bg-line h-1 w-full max-w-[220px] flex-1 overflow-hidden rounded-full">
                <span
                  className="bg-primary block h-full rounded-full"
                  style={{ width: `${book.percent}%` }}
                />
              </span>
              <span className="text-faint text-xs tabular-nums">
                已读 {book.percent}%
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <Button onClick={onContinue} className="max-sm:w-full">
        <PlayIcon className="size-4" />
        继续阅读
      </Button>
    </section>
  );
}
