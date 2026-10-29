import * as React from "react";

/**
 * 本地 UI 偏好（阅读器排版 / 书架外观）。
 *
 * 存在 localStorage 而不是数据库：与既有的 `theme`（`theme-provider.tsx`）和
 * `palette`（`lib/palette.ts`）同一个约定 —— 这类偏好是「这台设备上怎么显示」，
 * 不是账号数据，因此不需要迁移与服务端往返。
 *
 * 每个 store 都是：读一次缓存 + 写时派发 + 跨标签 `storage` 同步，React 侧用
 * `useSyncExternalStore` 订阅（快照必须稳定，否则会无限重渲染）。
 */

export type ReaderFont = "serif" | "kai" | "sans";

export interface ReaderPrefs {
  /** 正文字体族：`font-serif` / `font-kai` / `font-sans`。 */
  font: ReaderFont;
  /** 正文字号（px）。 */
  size: number;
  /** 行高倍数。 */
  leading: number;
  /** 对齐方式；`start` 即左对齐（不两端对齐）。 */
  align: "justify" | "start";
  /** 正文栏宽（px），映射到 foliate paginator 的 `max-inline-size`（越窄两侧留白越多）。 */
  columnWidth: number;
  /** 版式：分页 / 连续滚动（foliate 的 `flow`）。 */
  layout: "paged" | "scrolled";
  /** PDF: continuous scrolling or one page per screen. */
  pdfLayout: "scroll" | "page";
  /** 分栏：`auto` 由宽度决定，`1` 强制单栏。 */
  columns: "auto" | "1";
  /**
   * 侧栏形态：`docked` 常驻（默认：正文让位、跳转后不收起）/ `float` 浮层
   * （盖在正文上，带遮罩，跳转或点遮罩即收起）。
   */
  panelMode: "float" | "docked";
}

/**
 * 排版里**只影响正文渲染**的字段：改面板形态这类界面状态不该触发重新分页。
 */
export type ReaderTypography = Pick<
  ReaderPrefs,
  "font" | "size" | "leading" | "align" | "columnWidth" | "layout" | "columns"
>;

/**
 * 单书覆盖只存排版字段：`panelMode` 是“这台设备上侧栏长什么样”，不是书的属性，
 * 跟着全局走。
 */
export type ReaderTypographyOverride = Partial<ReaderTypography> & {
  /** PDF page mode; EPUB ignores it. */
  pdfLayout?: ReaderPrefs["pdfLayout"];
};

export const READER_PREFS_DEFAULT: ReaderPrefs = {
  font: "serif",
  size: 18,
  leading: 1.72,
  align: "justify",
  columnWidth: 720,
  layout: "paged",
  pdfLayout: "scroll",
  columns: "auto",
  panelMode: "docked",
};

export const READER_PREFS_KEY = "reader-prefs";

export type ShelfCoverSize = "sm" | "md" | "lg";

export interface ShelfPrefs {
  /** 封面尺寸；卡片最小宽度 112 / 140 / 176。 */
  cover: ShelfCoverSize;
  /** 排序：最近阅读（按 lastReadAt）/ 最近添加（服务端顺序）/ 书名 / 作者。 */
  sort: "recent" | "added" | "title" | "author";
  /** 顶部「继续阅读」卡。 */
  hero: boolean;
}

export const SHELF_PREFS_DEFAULT: ShelfPrefs = {
  cover: "md",
  sort: "recent",
  hero: true,
};

export const SHELF_PREFS_KEY = "shelf-prefs";

const clampNumber = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const pickEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

const pickOptionalEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined);

const clampOptionalNumber = (
  value: unknown,
  min: number,
  max: number,
): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;

const READER_FONTS = ["serif", "kai", "sans"] as const;
const READER_ALIGNS = ["justify", "start"] as const;
const READER_LAYOUTS = ["paged", "scrolled"] as const;
const READER_COLUMNS = ["auto", "1"] as const;

function normalizeReaderPrefs(value: ReaderPrefs): ReaderPrefs {
  return {
    font: pickEnum(value.font, READER_FONTS, "serif"),
    size: clampNumber(value.size, 14, 28, READER_PREFS_DEFAULT.size),
    leading: clampNumber(value.leading, 1.3, 2.2, READER_PREFS_DEFAULT.leading),
    align: pickEnum(value.align, READER_ALIGNS, "justify"),
    columnWidth: clampNumber(
      value.columnWidth,
      480,
      1000,
      READER_PREFS_DEFAULT.columnWidth,
    ),
    layout: pickEnum(value.layout, READER_LAYOUTS, "paged"),
    pdfLayout: pickEnum(value.pdfLayout, ["scroll", "page"] as const, "scroll"),
    columns: pickEnum(value.columns, READER_COLUMNS, "auto"),
    panelMode: pickEnum(value.panelMode, ["float", "docked"] as const, "float"),
  };
}

/**
 * 覆盖值是“差量”：只保留显式出现且合法的字段，坏字段直接丢弃，让这一项回落到
 * 全局值。数值越界按范围夹紧，而不是取消覆盖。
 */
function normalizeReaderOverride(value: unknown): ReaderTypographyOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const stored = value as Record<string, unknown>;
  const next: ReaderTypographyOverride = {};

  const font = pickOptionalEnum(stored.font, READER_FONTS);
  if (font) next.font = font;
  const size = clampOptionalNumber(stored.size, 14, 28);
  if (size !== undefined) next.size = size;
  const leading = clampOptionalNumber(stored.leading, 1.3, 2.2);
  if (leading !== undefined) next.leading = leading;
  const align = pickOptionalEnum(stored.align, READER_ALIGNS);
  if (align) next.align = align;
  const columnWidth = clampOptionalNumber(stored.columnWidth, 480, 1000);
  if (columnWidth !== undefined) next.columnWidth = columnWidth;
  const layout = pickOptionalEnum(stored.layout, READER_LAYOUTS);
  if (layout) next.layout = layout;
  const columns = pickOptionalEnum(stored.columns, READER_COLUMNS);
  const pdfLayout = pickOptionalEnum(stored.pdfLayout, [
    "scroll",
    "page",
  ] as const);
  if (pdfLayout) next.pdfLayout = pdfLayout;
  if (columns) next.columns = columns;

  return next;
}

/** 封面的三个档位，与 `data/prototype/app.js#COVER_MIN` 一致。 */
export const COVER_MIN: Record<ShelfCoverSize, number> = {
  sm: 112,
  md: 140,
  lg: 176,
};

function createPrefsStore<T extends object>(
  key: string,
  defaults: T,
  normalize: (value: T) => T,
) {
  const parse = (raw: string | null): T => {
    if (raw) {
      try {
        const stored: unknown = JSON.parse(raw);
        if (stored && typeof stored === "object")
          return normalize({ ...defaults, ...stored });
      } catch {
        // 坏数据（手改 / 旧版本）：退回默认值
      }
    }
    return normalize({ ...defaults });
  };

  let snapshot: T =
    typeof window === "undefined"
      ? { ...defaults }
      : parse(window.localStorage.getItem(key));
  const listeners = new Set<() => void>();
  let storageBound = false;

  const publish = (next: T) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!storageBound && typeof window !== "undefined") {
      storageBound = true;
      window.addEventListener("storage", (event) => {
        if (event.key === key) publish(parse(event.newValue));
      });
    }
    return () => {
      listeners.delete(listener);
    };
  };

  const set = (patch: Partial<T>) => {
    const next = normalize({ ...snapshot, ...patch });
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 受限存储（隐私模式）：保留内存中的偏好
    }
    publish(next);
  };

  const reset = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 同上
    }
    publish(normalize({ ...defaults }));
  };

  return {
    set,
    reset,
    subscribe,
    read: () => snapshot,
    // 第三个参数是服务端快照：React 在 SSR 下缺它就直接抛错。服务端 `snapshot`
    // 是默认值（localStorage 不可用），水合后由客户端快照接管。
    use: () =>
      React.useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => snapshot,
      ),
  };
}

const readerStore = createPrefsStore(
  READER_PREFS_KEY,
  READER_PREFS_DEFAULT,
  normalizeReaderPrefs,
);

export const BOOK_READER_PREFS_KEY = "reader-book-prefs";

interface BookReaderOverrides {
  /** bookId（十进制字符串）→ 该书显式改过的排版字段。 */
  books: Record<string, ReaderTypographyOverride>;
}

const BOOK_READER_OVERRIDES_DEFAULT: BookReaderOverrides = { books: {} };

const EMPTY_READER_OVERRIDE: ReaderTypographyOverride = Object.freeze({});

function normalizeBookReaderOverrides(
  value: BookReaderOverrides,
): BookReaderOverrides {
  const books: Record<string, ReaderTypographyOverride> = {};
  for (const [bookId, override] of Object.entries(value.books ?? {})) {
    if (!/^\d+$/.test(bookId)) continue;
    const next = normalizeReaderOverride(override);
    if (Object.keys(next).length > 0) books[bookId] = next;
  }
  return { books };
}

const bookReaderStore = createPrefsStore(
  BOOK_READER_PREFS_KEY,
  BOOK_READER_OVERRIDES_DEFAULT,
  normalizeBookReaderOverrides,
);

const shelfStore = createPrefsStore(
  SHELF_PREFS_KEY,
  SHELF_PREFS_DEFAULT,
  (value) => ({
    cover: pickEnum(value.cover, ["sm", "md", "lg"] as const, "md"),
    sort: pickEnum(
      value.sort,
      ["recent", "added", "title", "author"] as const,
      "recent",
    ),
    hero: value.hero !== false,
  }),
);

/** 阅读器排版偏好（当前值 / 订阅 / 写入 / 恢复默认）。 */
export const useReaderPrefs = readerStore.use;
export const setReaderPrefs = readerStore.set;
export const resetReaderPrefs = readerStore.reset;
export const readReaderPrefs = readerStore.read;

/** 某本书的显式排版差量；没有覆盖时返回空对象。 */
export function readBookReaderPrefs(
  bookId: number | string,
): ReaderTypographyOverride {
  return bookReaderStore.read().books[String(bookId)] ?? EMPTY_READER_OVERRIDE;
}

/** 订阅某本书的排版差量（用于判断“本书已单独调整”）。 */
export function useBookReaderOverrides(
  bookId: number | string,
): ReaderTypographyOverride {
  const id = String(bookId);
  return React.useSyncExternalStore(
    bookReaderStore.subscribe,
    () => bookReaderStore.read().books[id] ?? EMPTY_READER_OVERRIDE,
    () => EMPTY_READER_OVERRIDE,
  );
}

/** 全局默认 + 本书覆盖：阅读器实际用来排版的最终值。 */
export function useBookReaderPrefs(bookId: number | string): ReaderPrefs {
  const base = useReaderPrefs();
  const overrides = useBookReaderOverrides(bookId);
  return React.useMemo(() => ({ ...base, ...overrides }), [base, overrides]);
}

/** 写入本书覆盖：只合并传入的字段，其余字段继续沿用已有值 / 全局默认。 */
export function setBookReaderPrefs(
  bookId: number | string,
  patch: ReaderTypographyOverride,
): void {
  const id = String(bookId);
  const current = bookReaderStore.read();
  const next = normalizeReaderOverride({ ...current.books[id], ...patch });
  const books = { ...current.books };
  if (Object.keys(next).length > 0) books[id] = next;
  else delete books[id];
  bookReaderStore.set({ books });
}

/** 清掉本书覆盖，后续排版重新跟随设置页的全局默认。 */
export function resetBookReaderPrefs(bookId: number | string): void {
  const id = String(bookId);
  const current = bookReaderStore.read();
  if (!(id in current.books)) return;
  const books = { ...current.books };
  delete books[id];
  bookReaderStore.set({ books });
}

/** 书架外观偏好。 */
export const useShelfPrefs = shelfStore.use;
export const setShelfPrefs = shelfStore.set;
export const resetShelfPrefs = shelfStore.reset;
export const readShelfPrefs = shelfStore.read;

export const MOTION_PREFS_KEY = "motion-prefs";

export interface MotionPrefs {
  /** 「界面动效」；关闭后所有过渡立即完成（`<html class="reduce-motion">`）。 */
  animated: boolean;
}

export const MOTION_PREFS_DEFAULT: MotionPrefs = { animated: true };

const motionStore = createPrefsStore(
  MOTION_PREFS_KEY,
  MOTION_PREFS_DEFAULT,
  (value) => ({ animated: value.animated !== false }),
);

export const useMotionPrefs = motionStore.use;
export const setMotionPrefs = motionStore.set;
export const readMotionPrefs = motionStore.read;
