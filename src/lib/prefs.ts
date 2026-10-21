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

export const READER_PREFS_DEFAULT: ReaderPrefs = {
  font: "serif",
  size: 18,
  leading: 1.72,
  align: "justify",
  columnWidth: 720,
  layout: "paged",
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
  (value) => ({
    font: pickEnum(value.font, ["serif", "kai", "sans"] as const, "serif"),
    size: clampNumber(value.size, 14, 28, READER_PREFS_DEFAULT.size),
    leading: clampNumber(value.leading, 1.3, 2.2, READER_PREFS_DEFAULT.leading),
    align: pickEnum(value.align, ["justify", "start"] as const, "justify"),
    columnWidth: clampNumber(
      value.columnWidth,
      480,
      1000,
      READER_PREFS_DEFAULT.columnWidth,
    ),
    layout: pickEnum(value.layout, ["paged", "scrolled"] as const, "paged"),
    columns: pickEnum(value.columns, ["auto", "1"] as const, "auto"),
    panelMode: pickEnum(value.panelMode, ["float", "docked"] as const, "float"),
  }),
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
