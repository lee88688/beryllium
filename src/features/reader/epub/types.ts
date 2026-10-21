/**
 * Public contract of the reader's rendering layer (D13).
 *
 * Everything outside `src/features/reader/epub/**` talks to the reader through
 * these types only. foliate-js internals (its closed shadow roots, the
 * `blob:`-URL sections, the overlayer's private map) never leak past
 * `adapter.ts` / `highlights.ts`.
 */

/**
 * Paginator layout overrides. foliate-js takes them as attributes
 * (`paginator.js:425`) because it exposes no JS property API; the defaults are
 * upstream's (`gap: 7%`, `margin: 48px`, `max-inline-size: 720px`) and the
 * reader pins neither, so a test can drive a specific geometry.
 */
export type ReaderLayout = {
  flow?: "paginated" | "scrolled";
  gap?: string;
  margin?: string;
  "max-inline-size"?: string;
  "max-block-size"?: string;
  "max-column-count"?: string;
};

/** `Mark.type` values stored server-side. */
export const MARK_TYPE = {
  highlight: "highlight",
  bookmark: "bookmark",
} as const;

export type MarkType = (typeof MARK_TYPE)[keyof typeof MARK_TYPE];

/**
 * Structural mirror of a `Mark` row (PascalCase server column names are
 * camelCase already). Extra server fields are tolerated.
 */
export type ReadingMark = {
  id: number;
  bookId: number;
  type: MarkType | string;
  color: string;
  content: string;
  epubcfi: string;
  selectedString: string;
  title: string;
};

/** Payload for creating a mark. */
export type NewReadingMark = Omit<ReadingMark, "id">;

/** Payload for updating an existing mark. */
export type ReadingMarkPatch = { id: number } & Partial<
  Omit<ReadingMark, "id" | "bookId">
>;

/** Axis-aligned rectangle in parent-document coordinates. */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Anchors accepted by Base UI's positioner. Virtual anchors are plain objects,
 * which is why we return `Rect`-shaped values instead of a `DOMRect` instance.
 */
export type VirtualAnchor = { getBoundingClientRect: () => Rect };

/** Nested TOC node, as produced by `parseToc` (EPUB3 nav or NCX). */
export type TocNode = {
  label: string;
  src: string;
  children?: TocNode[];
};

/** The subset of a relocation the reader UI consumes. */
export type DisplayedLocation = {
  cfi?: string;
  href?: string;
  index?: number;
  location?: number;
  percentage?: number;
};

export type ReaderLocation = {
  start: DisplayedLocation;
  end: DisplayedLocation;
};

/** Rendered in parent-document coordinates, ready for a popover anchor. */
export type SelectedEvent = {
  epubcfi: string;
  rect: Rect;
  text: string;
  /** Nearest heading text above the selection, used as the mark title. */
  heading: string;
  /**
   * Re-measures the selection while the popover is open (iframe scroll,
   * window resize, page flip). Returns `undefined` once the selection is gone.
   */
  measure: () => Rect | undefined;
  /** The epub iframe that owns the selection, for scroll subscription. */
  frame: HTMLIFrameElement | undefined;
};

export type MarkClickedEvent = {
  epubcfi: string;
  mark: ReadingMark;
  /** `undefined` when the overlay element is not attached (e.g. after a flip). */
  rect: Rect | undefined;
  measure: () => Rect | undefined;
  frame: HTMLIFrameElement | undefined;
};

export type RelocatedEvent = {
  href: string;
  cfi: string;
  location: ReaderLocation;
};

export type DisplayedEvent = {
  location: ReaderLocation;
};

/**
 * An in-chapter `<img>` was clicked (A1: the section runs no script, so the
 * parent document detects the click on the same-origin section document).
 */
export type ImageClickedEvent = {
  /** Already resolved against the section's base URL. */
  src: string;
};

export const READER_EVENTS = [
  "selected",
  "markClicked",
  "relocated",
  "displayed",
  "scrolled",
  "imageClicked",
] as const;

export type ReaderEventName = (typeof READER_EVENTS)[number];

export type ReaderEventPayload = {
  selected: SelectedEvent;
  markClicked: MarkClickedEvent;
  relocated: RelocatedEvent;
  displayed: DisplayedEvent;
  /**
   * 连续滚动下的用户滚动（翻页模式的程序化滚动按 flow 过滤掉了，见
   * `epub/adapter.ts#handleScroll`）。
   */
  scrolled: undefined;
  imageClicked: ImageClickedEvent;
};

export type ReaderEventHandler<E extends ReaderEventName> = (
  payload: ReaderEventPayload[E],
) => void;

/**
 * The complete surface the reader UI is allowed to use (D13).
 * Callbacks passed to `on` return an unsubscribe function, so React effects
 * are StrictMode-safe (D12).
 */
export interface ReaderAdapter {
  /**
   * 阅读器自己的宿主元素（`foliate-view`）：**调用方**负责把它挂进容器，而且
   * 必须赶在 `display()` 之前 —— 分页器要量得到尺寸才排得出版。
   *
   * 容器只有一个写入者，这是刻意的：构建是异步的，而 React 会对一个活着的阅读器
   * 「先清理副作用、再重跑」（StrictMode 的双调用；TanStack Router 在 pending
   * match 上抛 promise，让已就绪的子树先隐藏、再显示）。于是同一个容器上可能出现
   * 两个构建，落地的先后也不由启动的先后决定：取消掉的那个若也去写容器，就会把已
   * 经在渲染的那一份挤出去，自己随后又被销毁 —— 读者看到的是一片空白。
   */
  element: HTMLElement;
  display(target?: string | number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  currentLocation(): Promise<ReaderLocation>;
  /**
   * DOM `Range` for a CFI, resolved against the *rendered* section only (D5):
   * foliate-js resolves the CFI's spine position itself (`epub.js:688`), and
   * this returns `undefined` when the CFI belongs to another section, so a
   * chapter-two CFI can never be described with chapter one's heading.
   */
  getRange(cfi: string): Range | undefined;
  on<E extends ReaderEventName>(
    event: E,
    handler: ReaderEventHandler<E>,
  ): () => void;
  /** Section CSS (foliate-js `renderer.setStyles`), applied on every render. */
  setStyles(styles: string): void;
  /**
   * 分页器几何（foliate-js 的属性：`flow` / `margin` / `max-column-count` …）。
   * 排版偏好里的页边距与版式走这条路径，不走 `setStyles`。
   */
  setLayout(layout: Record<string, string>): void;
  addHighlight(mark: ReadingMark): void;
  /**
   * Re-index the marks of a (re)fetched list (A3) without touching the
   * rendered overlays.
   */
  rememberHighlights(marks: readonly ReadingMark[]): void;
  removeHighlight(epubcfi: string): void;
  /** `mark` is the whole persisted row: the click index is updated from it. */
  updateHighlight(mark: ReadingMark): void;
  destroy(): void;
}

/** Options accepted by `createReaderAdapter`. */
export type CreateReaderAdapterOptions = {
  /** Member-URL prefix for this book: `bookFileUrl(bookId, "")`. */
  filesBaseUrl: string;
  /** Spine member path → byte size, read from the asar index server-side. */
  sizes: ReadonlyMap<string, number>;
  /** Saved position; `""` starts at the first linear section. */
  startCfi: string;
  /** Marks drawn as soon as the section they belong to renders. */
  initialHighlights: readonly ReadingMark[];
  /** Paginator attribute overrides, mainly for tests. */
  layout?: ReaderLayout;
  /** `fetch` seam for tests. */
  fetch?: typeof globalThis.fetch;
};
