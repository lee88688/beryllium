import { useEffect, useMemo, useRef } from "react";

import { useThemeMode } from "@/components/theme-provider";
import { useBookReaderPrefs, type ReaderTypography } from "@/lib/prefs";
import { createReaderAdapter } from "../epub/adapter";
import { applyReaderStyles, resolveReaderTheme } from "../epub/theme";
import type {
  ImageClickedEvent,
  MarkClickedEvent,
  ReaderAdapter,
  ReaderLayout,
  ReaderLocation,
  ReadingMark,
  RelocatedEvent,
  SelectedEvent,
} from "../epub/types";

export type ReaderAdapterHandlers = {
  onSelected?: (event: SelectedEvent) => void;
  onMarkClicked?: (event: MarkClickedEvent) => void;
  /** 正文里的一次按下（父文档收不到 iframe 内的事件）；浮窗据此收起。 */
  onPointerDown?: () => void;
  onRelocated?: (event: RelocatedEvent) => void;
  onDisplayed?: () => void;
  /**
   * 连续滚动下的用户滚动（翻页模式不触发：那里的滚动是程序化的，由 `relocated`
   * 负责）。锚点类 UI（编辑浮窗）靠它重新测量。
   */
  onScrolled?: () => void;
  /** In-chapter image clicked; the owner opens the full-screen preview. */
  onImageClicked?: (event: ImageClickedEvent) => void;
};

export type UseReaderAdapterOptions = {
  /**
   * Element the rendition renders into (must be empty and stable).
   *
   * 容器归调用方：构建是异步的，而 React 会对一个**活着的**阅读器先跑副作用清理
   * 再重跑（StrictMode 的双调用；TanStack Router 在 pending match 上抛 promise，
   * 让已就绪的子树先隐藏、再显示），所以同一个容器上可能挂着两个仍在飞的构建 ——
   * 落地的先后还不由启动的先后决定。容器只有一个写入者：这个 effect 在确认自己
   * 那次构建还活着之后才挂上去。
   */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 当前书 id：排版偏好按书解析（全局默认 + 本书覆盖）。 */
  bookId: number;
  /** Member-URL prefix of the book's archive. */
  filesBaseUrl: string;
  /** Spine member path → byte size, read from the asar index server-side. */
  spineSizes: Record<string, number>;
  /** Saved CFI; `""` starts at the beginning of the book. */
  startCfi: string;
  /** Marks drawn as soon as the section they belong to renders. */
  initialHighlights: readonly ReadingMark[];
  /** Paginator attribute overrides, mainly for tests. */
  layout?: ReaderLayout;
  handlers: ReaderAdapterHandlers;
};

export type ReaderAdapterController = {
  addHighlight: (mark: ReadingMark) => void;
  removeHighlight: (epubcfi: string) => void;
  updateHighlight: (mark: ReadingMark) => void;
  display: (target: string | number) => void;
  /**
   * 翻页。返回的 promise 在分页器真正翻完之后才 resolve（它内部有一把
   * `#locked` 锁：翻页期间新的请求会被丢掉），所以调用方可以把连续翻页排队。
   */
  next: () => Promise<void>;
  prev: () => Promise<void>;
  currentLocation: () => Promise<ReaderLocation | undefined>;
  /** Section-aware CFI → `Range` lookup (D5). */
  getRange: (cfi: string) => Range | undefined;
};

/**
 * Owns the reader adapter for the lifetime of the reader (D12/D13).
 *
 * The adapter is created once per mount; handlers, marks and the initial CFI
 * are read through a ref so they never re-create it. Cleanup unsubscribes every
 * listener, destroys the rendition and empties the container, which makes
 * StrictMode's mount → cleanup → mount cycle idempotent.
 */
export function useReaderAdapter(
  options: UseReaderAdapterOptions,
): ReaderAdapterController {
  const adapterRef = useRef<ReaderAdapter | null>(null);
  const optionsRef = useRef(options);
  const prefs = useBookReaderPrefs(options.bookId);
  const { palette, resolvedTheme } = useThemeMode();
  /**
   * 只有排版字段参与正文渲染：侧栏开关、面板形态也在同一个 store 里，直接订阅
   * 整份偏好会让每次开关侧栏都重排一遍全书（还会打断面板滑出动画）。
   */
  const typography = useMemo<ReaderTypography>(
    () => ({
      font: prefs.font,
      size: prefs.size,
      leading: prefs.leading,
      align: prefs.align,
      columnWidth: prefs.columnWidth,
      layout: prefs.layout,
      columns: prefs.columns,
    }),
    [
      prefs.font,
      prefs.size,
      prefs.leading,
      prefs.align,
      prefs.columnWidth,
      prefs.layout,
      prefs.columns,
    ],
  );
  const styleRef = useRef({ prefs: typography, palette, theme: resolvedTheme });

  useEffect(() => {
    styleRef.current = { prefs: typography, palette, theme: resolvedTheme };
  });

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const element = optionsRef.current.containerRef.current;
    if (!element) return;
    const initial = optionsRef.current;

    let cancelled = false;
    let adapter: ReaderAdapter | null = null;
    let unsubscribes: (() => void)[] = [];

    // Building the book is asynchronous (container.xml and the package
    // document are fetched), so StrictMode's mount → cleanup → mount cycle can
    // cross it: a cancellation that lands mid-flight destroys the adapter as
    // soon as it exists instead of leaking a rendition into the caller's
    // detached container.
    void createReaderAdapter({
      filesBaseUrl: initial.filesBaseUrl,
      sizes: new Map(Object.entries(initial.spineSizes)),
      startCfi: initial.startCfi,
      initialHighlights: initial.initialHighlights,
      layout: initial.layout,
    })
      .then((created) => {
        if (cancelled) {
          // 这次构建没写过容器（见 `containerRef` 的注释），销毁只涉及它自己的
          // 元素，所以不必（也不该）清空容器：这里的 promise 可能比「重挂载」的
          // 那个 effect 晚 resolve，清屏会连后建的那份 rendition 一起抹掉。
          created.destroy();
          return;
        }
        // 容器唯一的一次写入：在确认这次构建还活着之后。分页器要量尺寸，所以先挂
        // 上再 `display()`。
        element.replaceChildren(created.element);
        adapter = created;
        adapterRef.current = created;
        unsubscribes = [
          created.on("displayed", () => {
            optionsRef.current.handlers.onDisplayed?.();
          }),
          created.on("selected", (event) => {
            optionsRef.current.handlers.onSelected?.(event);
          }),
          created.on("markClicked", (event) => {
            optionsRef.current.handlers.onMarkClicked?.(event);
          }),
          created.on("pointerDown", () => {
            optionsRef.current.handlers.onPointerDown?.();
          }),
          created.on("relocated", (event) => {
            optionsRef.current.handlers.onRelocated?.(event);
          }),
          created.on("scrolled", () => {
            optionsRef.current.handlers.onScrolled?.();
          }),
          created.on("imageClicked", (event) => {
            optionsRef.current.handlers.onImageClicked?.(event);
          }),
        ];
        const current = styleRef.current;
        applyReaderStyles(created, {
          theme: resolveReaderTheme(current.theme),
          prefs: current.prefs,
          palette: current.palette,
        });
        void created.display(initial.startCfi || 0);
      })
      .catch((error: unknown) => {
        console.error("[reader] 打开书籍失败", error);
      });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      adapter?.destroy();
      adapterRef.current = null;
      // 容器是这次 effect 挂上去的（见 `containerRef`）：它也是唯一清空容器的
      // 地方，这样重挂载总从一个干净的元素开始。React 保证这一步排在下一个
      // effect 之前，所以清掉的不会是别人的 rendition。
      element.replaceChildren();
    };
  }, []);

  // 排版偏好 / 配色 / 明暗变了就地重套：`setStyles` 会立刻改写当前章节的
  // `<style>`，分页器属性也会触发重新分页，阅读位置由 foliate 自己保持。
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    applyReaderStyles(adapter, {
      theme: resolveReaderTheme(resolvedTheme),
      prefs: typography,
      palette,
    });
  }, [typography, palette, resolvedTheme]);

  // A3: after a refetch (`router.invalidate()` following a mutation) the
  // rendered overlays stay as they are, but the click index must follow the
  // fresh rows — otherwise reopening the editor reads the pre-edit values.
  useEffect(() => {
    adapterRef.current?.rememberHighlights(options.initialHighlights);
  }, [options.initialHighlights]);

  return useMemo<ReaderAdapterController>(
    () => ({
      addHighlight: (mark) => adapterRef.current?.addHighlight(mark),
      removeHighlight: (epubcfi) =>
        adapterRef.current?.removeHighlight(epubcfi),
      updateHighlight: (mark) => adapterRef.current?.updateHighlight(mark),
      display: (target) => {
        void adapterRef.current?.display(target);
      },
      next: () => adapterRef.current?.next() ?? Promise.resolve(),
      prev: () => adapterRef.current?.prev() ?? Promise.resolve(),
      currentLocation: async () => adapterRef.current?.currentLocation(),
      getRange: (cfi) => adapterRef.current?.getRange(cfi),
    }),
    [],
  );
}
