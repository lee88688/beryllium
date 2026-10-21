import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MenuIcon, MoreVerticalIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ConfirmCanceledError,
  useConfirmDialog,
  type ConfirmDialogOptions,
} from "@/components/confirm-dialog";
import { toast } from "@/components/sonner-toaster";
import { ThemeModeButton } from "@/components/theme-mode-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { setShelfPrefs, useShelfPrefs } from "@/lib/prefs";
import { errorMessage } from "@/lib/utils";
import { deleteBook } from "@/server/fns/books";
import {
  addBooksToCategory,
  removeBooksFromCategory,
  removeCategory,
} from "@/server/fns/categories";
import { BookGrid } from "./BookGrid";
import { BookshelfDrawer } from "./BookshelfDrawer";
import { ShelfHero } from "./ShelfHero";
import {
  BOOKS_QUERY_KEY,
  booksQueryOptions,
  categoriesQueryOptions,
  invalidateBookshelf,
} from "./queries";
import type { BookshelfBook, BookshelfCategory } from "./types";
import { UPLOAD_TOAST_ID, uploadEpub } from "./upload";

/** Stable identities so the `useMemo` deps below never change per render. */
const NO_BOOKS: readonly BookshelfBook[] = [];
const NO_CATEGORIES: readonly BookshelfCategory[] = [];

/** 侧栏宽度：原型 264px（抽屉与移动端抽屉共用）。 */
const SIDEBAR_WIDTH = "264px";

/**
 * `/bookshelf` (PRD §5.2)：常驻侧栏 + 顶部（搜索 / 排序）+「继续阅读」+ 卡片网格。
 * 搜索与排序都在本地做（不动服务端返回顺序），排序偏好存在 `ShelfPrefs`。
 */
export function BookshelfPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { dialog, openDialog } = useConfirmDialog();
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { sort, hero } = useShelfPrefs();

  const booksQuery = useQuery(booksQueryOptions());
  const categoriesQuery = useQuery(categoriesQueryOptions());
  const books = booksQuery.data ?? NO_BOOKS;
  const categories = categoriesQuery.data ?? NO_CATEGORIES;

  const visibleBooks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scoped =
      selectedCategory === 0
        ? books
        : books.filter((book) =>
            book.categories.some((link) => link.id === selectedCategory),
          );
    const matched =
      needle === ""
        ? scoped
        : scoped.filter(
            (book) =>
              book.title.toLowerCase().includes(needle) ||
              book.author.toLowerCase().includes(needle) ||
              book.categories.some((link) =>
                link.name.toLowerCase().includes(needle),
              ),
          );
    if (sort === "title")
      return [...matched].sort((a, b) =>
        a.title.localeCompare(b.title, "zh-Hans-CN"),
      );
    if (sort === "author")
      return [...matched].sort(
        (a, b) =>
          a.author.localeCompare(b.author, "zh-Hans-CN") ||
          a.title.localeCompare(b.title, "zh-Hans-CN"),
      );
    if (sort === "recent")
      // 读过的那本排最前；都没读过时退化成「最近添加」（服务端顺序）。
      return [...matched].sort(
        (a, b) => b.lastReadAt - a.lastReadAt || b.id - a.id,
      );
    return matched;
  }, [books, selectedCategory, query, sort]);

  // 「继续阅读」只对**已经打开过**的书出现：`current` 是阅读位置，上传时为空串
  // （`src/server/services/file.ts`），所以空串 = 还没开始读。服务端没存最后阅读
  // 时间，顺序即最近添加。
  const heroBook = useMemo(
    () => books.find((book) => book.current !== ""),
    [books],
  );

  const refresh = () => {
    void invalidateBookshelf(client);
  };

  const deleteBookMutation = useMutation({
    mutationFn: (id: number) => deleteBook({ data: { id } }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const removeCategoryMutation = useMutation({
    mutationFn: (id: number) => removeCategory({ data: { id } }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const addBooksMutation = useMutation({
    mutationFn: (input: { bookId: number; categoryId: number }) =>
      addBooksToCategory({
        data: { categoryId: input.categoryId, bookIds: [input.bookId] },
      }),
    onSuccess: () => toast.success("添加成功"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const removeBooksMutation = useMutation({
    mutationFn: (input: { bookId: number; categoryId: number }) =>
      removeBooksFromCategory({
        data: { categoryId: input.categoryId, bookIds: [input.bookId] },
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  /** Resolves `true` on confirm, `false` on cancel / dismiss. */
  const ask = async (options: ConfirmDialogOptions): Promise<boolean> => {
    try {
      await openDialog(options);
      return true;
    } catch (error) {
      if (error instanceof ConfirmCanceledError) return false;
      throw error;
    }
  };

  const handleSelectFile = async (file: File) => {
    toast.loading("正在上传文件，请不进行其他操作", {
      id: UPLOAD_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
    });
    try {
      await uploadEpub(file);
      toast.dismiss(UPLOAD_TOAST_ID);
      await invalidateBookshelf(client);
    } catch (error) {
      toast.dismiss(UPLOAD_TOAST_ID);
      toast.error(errorMessage(error));
    }
  };

  const handleDeleteBook = async (book: BookshelfBook) => {
    const confirmed = await ask({
      title: "删除书籍",
      content: "删除书籍会移除书籍相关标记和书签",
    });
    if (!confirmed) return;
    deleteBookMutation.mutate(book.id);
  };

  const handleRemoveFromCategory = async (book: BookshelfBook) => {
    const confirmed = await ask({
      title: "移除书籍",
      content: "是否从当前分类中移除书籍？",
    });
    if (!confirmed) return;
    removeBooksMutation.mutate({
      bookId: book.id,
      categoryId: selectedCategory,
    });
  };

  const handleRemoveCategory = async () => {
    const confirmed = await ask({
      title: "删除分类",
      content: "是否删除当前分类？",
    });
    if (!confirmed) return;
    removeCategoryMutation.mutate(selectedCategory, {
      // The filtered category is gone: fall back to 我的书籍.
      onSuccess: () => setSelectedCategory(0),
    });
  };

  const drawer = (
    <BookshelfDrawer
      categories={categories}
      selected={selectedCategory}
      sort={sort}
      onSortChange={(value) => setShelfPrefs({ sort: value })}
      onSelect={(id) => {
        setSelectedCategory(id);
        setMobileDrawerOpen(false);
      }}
      onNavigate={() => setMobileDrawerOpen(false)}
    />
  );

  const searching = query.trim() !== "";
  const categoryName =
    selectedCategory === 0
      ? "我的书籍"
      : (categories.find((category) => category.id === selectedCategory)
          ?.name ?? "我的书籍");

  return (
    <div className="flex min-h-dvh">
      <aside
        className="border-line bg-card fixed inset-y-0 left-0 z-30 hidden border-r lg:block"
        style={{ width: SIDEBAR_WIDTH }}
      >
        {drawer}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[264px]">
        <header className="border-line bg-background/85 sm:h-bar sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-3 py-2 backdrop-blur sm:flex-nowrap sm:gap-2.5 sm:px-5 sm:py-0">
          <IconButton
            aria-label="打开菜单"
            className="lg:hidden"
            onClick={() => setMobileDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold">
            书架
          </h1>

          <div className="relative min-w-0 basis-full max-sm:order-last sm:max-w-[300px] sm:flex-1 sm:basis-auto">
            <SearchIcon
              aria-hidden="true"
              className="text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              aria-label="搜索书名、作者或分类"
              placeholder="搜索书名、作者或分类"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>

          <Segmented
            aria-label="排序"
            value={sort}
            options={[
              { value: "recent", label: "最近阅读" },
              { value: "added", label: "最近添加" },
              { value: "title", label: "书名" },
              { value: "author", label: "作者" },
            ]}
            onValueChange={(value) => setShelfPrefs({ sort: value })}
            className="max-md:hidden"
          />

          <ThemeModeButton />

          {selectedCategory === 0 ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<IconButton aria-label="分类操作" />}
              >
                <MoreVerticalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    void handleRemoveCategory();
                  }}
                >
                  删除类别
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        <main className="flex-1 px-4 pt-6 pb-16 sm:px-5">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col">
            {hero && !searching && selectedCategory === 0 && heroBook ? (
              <ShelfHero
                book={heroBook}
                hint={`${categoryName} · 共 ${books.length} 本`}
                onContinue={() => {
                  void navigate({
                    to: "/reader/$id",
                    params: { id: String(heroBook.id) },
                  });
                }}
              />
            ) : null}

            {booksQuery.isPending ? (
              <div className="flex justify-center py-16">
                <Spinner className="size-6" />
              </div>
            ) : booksQuery.isError ? (
              <div className="flex flex-col items-start gap-3 py-8">
                <p className="text-destructive" role="alert">
                  {errorMessage(booksQuery.error)}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    void client.invalidateQueries({
                      queryKey: BOOKS_QUERY_KEY,
                    });
                  }}
                >
                  重试
                </Button>
              </div>
            ) : visibleBooks.length === 0 && searching ? (
              <div className="flex flex-col items-start gap-3 py-10">
                <p className="text-muted-foreground text-base">
                  没有匹配「{query.trim()}」的书籍。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuery("")}
                >
                  清除搜索
                </Button>
              </div>
            ) : visibleBooks.length === 0 && selectedCategory !== 0 ? (
              <div className="flex flex-col items-start gap-3 py-10">
                <p className="text-muted-foreground text-base">
                  这个分类里还没有书。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCategory(0)}
                >
                  回到我的书籍
                </Button>
              </div>
            ) : (
              <BookGrid
                books={visibleBooks}
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectFile={(file) => {
                  void handleSelectFile(file);
                }}
                onAddToCategory={(bookId, categoryId) =>
                  addBooksMutation.mutate({ bookId, categoryId })
                }
                onRemoveFromCategory={(book) => {
                  void handleRemoveFromCategory(book);
                }}
                onDeleteBook={(book) => {
                  void handleDeleteBook(book);
                }}
              />
            )}
          </div>
        </main>
      </div>

      <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
        <SheetContent
          side="left"
          className="w-[264px] p-0"
          showCloseButton={false}
        >
          {drawer}
        </SheetContent>
      </Sheet>

      {dialog}
    </div>
  );
}
