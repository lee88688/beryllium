/**
 * View contracts of the bookshelf screen. They mirror the server-function
 * payloads (`BookListItem` / `CategoryWithBooks` in `src/server/fns/queries.ts`
 * and `categories`) on purpose: client code must not import server modules, and
 * the `queryFn` return annotations in `queries.ts` turn any server-side drift
 * into a type error here.
 */
export interface BookshelfCategoryLink {
  id: number;
  name: string;
}

/** One book card: what `getBooks()` returns per row. */
export interface BookshelfBook {
  id: number;
  title: string;
  author: string;
  description: string;
  /** Cover path *inside* the archive; `""` when the OPF has no cover. */
  cover: string;
  /** Same-origin URL of the cover (D1), or `""`. */
  coverUrl: string;
  fileName: string;
  contentPath: string;
  current: string;
  /** `epub` | `pdf`; PDF cards use the generated background. */
  format: "epub" | "pdf";
  /** 已读百分比 0–100；0 表示还没读过。 */
  percent: number;
  /** 最后一次阅读的毫秒时间戳；0 表示没读过。 */
  lastReadAt: number;
  categories: BookshelfCategoryLink[];
}

/** Drawer entry: what `getCategories()` contributes (its `books` are unused). */
export interface BookshelfCategory {
  id: number;
  name: string;
}
