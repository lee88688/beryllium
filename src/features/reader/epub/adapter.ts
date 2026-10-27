import * as CFI from "foliate-js/epubcfi.js";
import type { EpubBook } from "foliate-js/epub.js";
import type { RelocateDetail, View, ViewContent } from "foliate-js/view.js";

import {
  frameForDocument,
  getElementHeading,
  getSelectionRange,
  toHostSpace,
} from "./dom";
import { createReaderEmitter } from "./emitter";
import { createHighlights } from "./highlights";
import { createBookLoader } from "./loader";
import { toReaderLocation } from "./location";
import { attachLoadGuards } from "./sanitize";
import { attachImagePreview } from "./section-interactions";
import { describeSelection, removeSelectionProbe } from "./selection";
import type {
  CreateReaderAdapterOptions,
  ReaderAdapter,
  ReaderLocation,
} from "./types";

/**
 * Paginated is what the reader has always rendered (PRD §5.4: 分页渲染); the
 * rest of the paginator's geometry stays at upstream's defaults so the layout
 * matches what foliate-js itself ships.
 */
const DEFAULT_LAYOUT = { flow: "paginated" } as const;

/**
 * epubjs settled a selection 250 ms after `selectionchange`, and both the
 * editor and the e2e suite depend on that gesture boundary: it is also what
 * keeps a drag from opening the popover halfway through.
 */
const SELECTION_DEBOUNCE_MS = 250;

type LoadDetail = { doc: Document; index: number };
type OverlayDetail = { index: number };
type AnnotationDetail = { value: string; index: number; range: Range };
type ExternalLinkDetail = { a: Element; href_: string };

/**
 * Structural `Range` test. A range created by the section document belongs to
 * another realm, where `instanceof Range` never matches; foliate-js can also
 * answer with an element or a fraction for an href target.
 */
function isRange(value: unknown): value is Range {
  return (
    typeof value === "object" &&
    value !== null &&
    "startContainer" in value &&
    "collapsed" in value
  );
}

/**
 * Creates the reader's rendering layer on top of foliate-js.
 *
 * The book is built from our own loader (the archive is an ASAR of the
 * unzipped EPUB tree, never a zip), rendered by the library's paginator, and
 * every foliate-js detail — its closed shadow roots, its blob-URL sections, the
 * overlayer — stays behind this module and `highlights.ts`. Nothing renders
 * until the caller subscribes and calls `display`, so no event can be missed.
 */
export async function createReaderAdapter(
  options: CreateReaderAdapterOptions,
): Promise<ReaderAdapter> {
  // Lazy imports: both modules touch `document`/`customElements` at import
  // time and must never reach the server bundle.
  await import("foliate-js/view.js");
  const { EPUB } = await import("foliate-js/epub.js");

  const emitter = createReaderEmitter();
  const book: EpubBook = await new EPUB(
    createBookLoader({
      filesBaseUrl: options.filesBaseUrl,
      sizes: options.sizes,
      fetch: options.fetch,
    }),
  ).init();

  // Guards go on before anything is rendered: a scripted manifest item is
  // denied and every section's markup is sanitised on its way to a blob URL.
  const detachGuards = book.transformTarget
    ? attachLoadGuards(book.transformTarget)
    : () => {};

  const view = document.createElement("foliate-view") as View;
  // foliate-js sizes nothing itself — its shadow roots are closed and the host
  // element is the only thing the app can lay out. The element stays detached
  // until the caller mounts it: the container has exactly one writer (see
  // `ReaderAdapter.element`).
  view.style.cssText = "display:block;width:100%;height:100%";
  await view.open(book);

  const renderer = view.renderer;
  for (const [name, value] of Object.entries({
    ...DEFAULT_LAYOUT,
    ...options.layout,
  })) {
    renderer.setAttribute(name, value);
  }

  /**
   * 连续滚动（`flow="scrolled"`）下滚动发生在分页器**关闭的影子根**里的容器上
   * （`paginator.js:511`），宿主页面既看不到容器也拿不到它的 scroll 冒泡。分页器
   * 把这个事件重新派发到自己身上（`paginator.js:559`），所以唯一的入口就是在
   * renderer 上直接监听 —— 浮窗、进度、位置标签都要靠它跟随滚动。
   *
   * 翻页模式也会派发：翻页本身就是对同一个容器的程序化滚动。那种情况已经有
   * `relocated` 负责重排后的通知，所以按 flow 过滤，让这个名字只表示「用户滚动」。
   */
  const handleScroll = () => {
    if (destroyed) return;
    if (renderer.getAttribute("flow") !== "scrolled") return;
    emitter.emit("scrolled", undefined);
  };
  renderer.addEventListener("scroll", handleScroll);

  const highlights = createHighlights({ view });
  highlights.remember(options.initialHighlights);

  let destroyed = false;
  /** One cleanup per rendered section document (foliate-js replaces views). */
  const sectionCleanups = new Map<Document, () => void>();

  const contents = (): ViewContent | undefined => renderer.getContents()[0];

  const currentLocation = async (): Promise<ReaderLocation> =>
    toReaderLocation(view.lastLocation, contents()?.index);

  /** Spine index a CFI points at, from its leading `/6/2n` step. */
  const indexFromCfi = (cfi: string): number | undefined => {
    try {
      const parts = CFI.parse(cfi);
      const [top] = Array.isArray(parts) ? parts : parts.parent;
      const index = CFI.fake.toIndex(top ?? null);
      return Number.isInteger(index) && index >= 0
        ? Math.min(index, book.sections.length - 1)
        : undefined;
    } catch {
      return undefined;
    }
  };

  const tryGoTo = async (target: string | number): Promise<boolean> => {
    try {
      return (await view.goTo(target)) !== undefined;
    } catch {
      return false;
    }
  };

  /**
   * Jumps, with a fallback chain.
   *
   * foliate-js resolves CFIs inside the renderer, which swallows a failure — a
   * stale CFI whose offset no longer exists throws `IndexSizeError` and the
   * jump silently does nothing. Falling back to the section the CFI points at
   * (then to the first section) keeps a bookmark or a saved position from
   * becoming a no-op.
   */
  const goToVisible = async (target: string | number): Promise<void> => {
    if (await tryGoTo(target)) return;
    console.warn(`[reader] could not go to ${String(target)}`);
    if (typeof target === "string") {
      const index = indexFromCfi(target);
      if (index !== undefined && (await tryGoTo(index))) return;
    }
    await tryGoTo(0);
  };

  const attachSection = (doc: Document, index: number) => {
    if (sectionCleanups.has(doc)) return;
    const detachImage = attachImagePreview(doc, (src) => {
      if (!destroyed) emitter.emit("imageClicked", { src });
    });

    let timer: number | undefined;
    const publishSelection = () => {
      const range = getSelectionRange(doc.defaultView?.getSelection());
      if (destroyed || !range || range.collapsed) return;
      const epubcfi = view.getCFI(index, range);
      const measured = describeSelection(range, contents()?.overlayer);
      // A selection outside the rendered section cannot be anchored; the
      // editor needs the rect, so there is nothing to publish.
      if (!epubcfi || !measured.rect) return;
      emitter.emit("selected", {
        epubcfi,
        rect: measured.rect,
        text: range.toString(),
        heading: getElementHeading(range.commonAncestorContainer),
        frame: measured.frame,
        measure: measured.measure,
      });
    };
    const onSelectionChange = () => {
      clearTimeout(timer);
      const range = getSelectionRange(doc.defaultView?.getSelection());
      if (!range || range.collapsed) {
        const overlayer = renderer
          .getContents()
          .find((entry) => entry.doc === doc)?.overlayer;
        if (overlayer) removeSelectionProbe(overlayer);
        return;
      }
      timer = window.setTimeout(publishSelection, SELECTION_DEBOUNCE_MS);
    };

    /**
     * The parent document's outside-press handling stops at the iframe
     * boundary, so a press that dismisses the native selection would leave the
     * editor bubble behind. Forward the press instead of reacting to the
     * (asynchronous) collapsed `selectionchange`: a click on a highlight also
     * collapses the selection, but its `markClicked` must open the new editor,
     * not have an already-queued collapse close it again.
     *
     * The probe is dropped here, before the `click` that follows: the click's
     * hit test walks the overlayer in reverse draw order, so a probe drawn over
     * the same range would answer with its own key and swallow the mark click.
     */
    const onPointerDown = () => {
      if (destroyed) return;
      const overlayer = renderer
        .getContents()
        .find((entry) => entry.doc === doc)?.overlayer;
      if (overlayer) removeSelectionProbe(overlayer);
      emitter.emit("pointerDown", undefined);
    };

    /**
     * 章节正文在自己的 iframe 里：点过正文之后键盘焦点就在那个文档上，键事件不会
     * 冒泡到宿主文档，阅读器的快捷键监听（`use-reader-shortcuts`）就收不到。
     * 这里把事件原样转发给宿主；宿主处理了（`preventDefault`）就顺势把 iframe 里
     * 的默认行为也挡掉（空格滚屏、方向键移动光标）。
     */
    const onKeyDown = (event: KeyboardEvent) => {
      const forwarded = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      // `dispatchEvent` 返回 false 表示宿主的处理器调用了 `preventDefault`。
      if (!document.dispatchEvent(forwarded)) event.preventDefault();
    };

    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("keydown", onKeyDown);
    sectionCleanups.set(doc, () => {
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
      detachImage();
    });
  };

  const handleLoad = (event: Event) => {
    const { doc, index } = (event as CustomEvent<LoadDetail>).detail;
    attachSection(doc, index);
    // Read after the relocation that follows this load, so `displayed` always
    // reports the fresh position (the promise settles behind the sync render).
    void currentLocation().then((location) => {
      if (!destroyed) emitter.emit("displayed", { location });
    });
  };

  const handleRelocate = (event: Event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;
    const location = toReaderLocation(view.lastLocation, detail.index);
    emitter.emit("relocated", {
      href: location.start.href ?? "",
      cfi: location.start.cfi ?? "",
      location,
    });
  };

  const handleCreateOverlay = (event: Event) => {
    // Marks belong to a section that has just been rendered.
    highlights.renderSection(
      (event as CustomEvent<OverlayDetail>).detail.index,
    );
  };

  const handleShowAnnotation = (event: Event) => {
    const { value, range } = (event as CustomEvent<AnnotationDetail>).detail;
    const mark = highlights.markForClick(value);
    if (!mark) return;
    // 用这次点击带过来的 range 量锚点，而不是 `highlights.findElement()` 里
    // 记着的那个绘制节点：章节重绘过（滚动/占位/翻页）之后，表里可能还是已经
    // 摘除的旧节点，量出来是全 0 矩形 —— 浮窗就会被挤到容器角落。range 总是连着
    // 当前渲染的章节；`toHostSpace` 再把章节视口坐标换算成宿主坐标。
    const measure = () =>
      range
        ? toHostSpace(
            range.getBoundingClientRect(),
            range.startContainer.ownerDocument,
          )
        : undefined;
    emitter.emit("markClicked", {
      epubcfi: value,
      mark,
      rect: measure(),
      measure,
      frame: range
        ? frameForDocument(range.startContainer.ownerDocument)
        : undefined,
    });
  };

  const handleExternalLink = (event: Event) => {
    // Cancelling keeps foliate-js' own `window.open` from running: the reader
    // opens the tab itself, without handing over `window.opener` (A2).
    event.preventDefault();
    const { href_ } = (event as CustomEvent<ExternalLinkDetail>).detail;
    window.open(href_, "_blank", "noopener,noreferrer");
  };

  view.addEventListener("load", handleLoad);
  view.addEventListener("relocate", handleRelocate);
  view.addEventListener("create-overlay", handleCreateOverlay);
  view.addEventListener("show-annotation", handleShowAnnotation);
  view.addEventListener("external-link", handleExternalLink);

  return {
    element: view,

    async display(target) {
      if (destroyed) return;
      // `""` means "no saved progress": the library then opens at the text
      // start (skipping front matter such as the cover).
      if (target === undefined || target === "") {
        await tryGoTo(0);
        return;
      }
      await goToVisible(target);
    },

    async next() {
      if (destroyed) return;
      await view.next();
    },

    async prev() {
      if (destroyed) return;
      await view.prev();
    },

    currentLocation,

    getRange(cfi) {
      if (destroyed) return undefined;
      const content = contents();
      if (!content) return undefined;
      try {
        const resolved = view.resolveCFI(cfi);
        if (resolved.index !== content.index) return undefined;
        const anchor = resolved.anchor(content.doc);
        // Cross-realm `Range`: `instanceof` against the parent's constructor
        // never matches a range created by the section document, and `anchor`
        // can also be an element or a fraction (an href target), so the check
        // is structural.
        return isRange(anchor) ? anchor : undefined;
      } catch {
        return undefined;
      }
    },

    on(event, handler) {
      if (destroyed) return () => {};
      return emitter.on(event, handler);
    },

    setStyles(styles) {
      if (destroyed) return;
      renderer.setStyles?.(styles);
    },

    setLayout(layout) {
      if (destroyed) return;
      for (const [name, value] of Object.entries(layout)) {
        renderer.setAttribute(name, value);
      }
    },

    addHighlight(mark) {
      if (destroyed) return;
      highlights.add(mark);
    },

    rememberHighlights(marks) {
      if (destroyed) return;
      highlights.remember(marks);
    },

    removeHighlight(epubcfi) {
      if (destroyed) return;
      highlights.remove(epubcfi);
    },

    updateHighlight(mark) {
      if (destroyed) return;
      highlights.update(mark);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      emitter.removeAll();
      view.removeEventListener("load", handleLoad);
      view.removeEventListener("relocate", handleRelocate);
      view.removeEventListener("create-overlay", handleCreateOverlay);
      view.removeEventListener("show-annotation", handleShowAnnotation);
      view.removeEventListener("external-link", handleExternalLink);
      renderer.removeEventListener("scroll", handleScroll);
      for (const cleanup of sectionCleanups.values()) cleanup();
      sectionCleanups.clear();
      detachGuards();
      highlights.dispose();
      /**
       * 分页器把内层 view 推迟到第一次渲染章节时才建（`paginator.js:667`），
       * 它的 `destroy()` 却直接调 `this.#view.destroy()`（`paginator.js:1121`）：
       * 没有 view 时上游抛 `Cannot read properties of undefined` 而不是跳过。
       * 「还没渲染就被销毁」并非理论情形 —— React 会对一个活着的阅读器跑完副作用
       * 清理再重跑（StrictMode 的双调用；TanStack Router 在 pending match 上抛
       * promise 让已就绪的子树先隐藏、再显示），此时 `createReaderAdapter` 还在飞。
       *
       * `View.close()` 是唯一走到那段代码的入口，所以只在分页器真有内层 view
       * （`getContents()` 非空 ⇔ `#view` 已建，`paginator.js:1093`）时才找它；
       * 否则摘掉 renderer 就是全部收尾工作。
       */
      if (renderer.getContents().length) view.close();
      else renderer.remove();
      view.remove();
      book.destroy?.();
    },
  };
}
