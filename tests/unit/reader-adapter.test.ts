// @vitest-environment jsdom
import { Overlayer } from "foliate-js/overlayer.js";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  CHAPTER_TAIL_HIDE_PX,
  CHAPTER_TAIL_SHOW_PX,
  createReaderAdapter,
} from "@/features/reader/epub/adapter";
import {
  CHAPTER_TAIL_ROW_PX,
  READER_TAIL_SPACE,
} from "@/features/reader/epub/theme";
import type {
  CreateReaderAdapterOptions,
  ReaderAdapter,
  ReaderBoundary,
  ReadingMark,
  RelocatedEvent,
  SelectedEvent,
} from "@/features/reader/epub/types";

const SECTION_ONE = "epubcfi(/6/2!/4/2,/1:0,/1:5)";

const state = vi.hoisted(() => ({
  loader: undefined as unknown,
  book: undefined as unknown,
}));

// The custom element is provided by this test: the real `view.js` registers it
// for the browser, and the real `epub.js` talks HTTP to the archive.
vi.mock("foliate-js/view.js", () => ({}));
vi.mock("foliate-js/epub.js", () => ({
  EPUB: class {
    constructor(loader: unknown) {
      state.loader = loader;
    }
    async init() {
      return state.book;
    }
  },
}));

/** `foliate-view.goTo`, which reports `undefined` when a target cannot resolve. */
type GoToFn = (
  target: unknown,
) => Promise<{ index: number; anchor: number; target?: unknown } | undefined>;

type FakeContent = {
  index: number;
  doc: Document;
  overlayer?: Overlayer;
};

/** 连续滚动的几何（`paginator.js:775-792`）：内容总长、视口长度、已滚过的距离。 */
type FakeGeometry = { viewSize: number; size: number; start: number };

/** `renderer.goTo`：章末入口换 section 走的是这一条。 */
type RendererGoTo = (target: {
  index: number;
  anchor?: unknown;
}) => Promise<void>;

/** Index a CFI points at, mirroring `CFI.fake.toIndex` (`/6/2n` → n - 1). */
function indexFromCfi(cfi: string): number {
  const step = Number(/^epubcfi\(\/6\/(\d+)/.exec(cfi)?.[1] ?? "2");
  return step / 2 - 1;
}

class FakeFoliateView extends HTMLElement {
  contents: FakeContent[] = [];
  lastLocation: Record<string, unknown> | null = null;
  /** 适配器用 `viewSize - (start + size)` 判断「离文档末尾还有多远」。 */
  geometry: FakeGeometry = { viewSize: 0, size: 0, start: 0 };
  /** `view.getProgressOf`：section index → 目录项（不渲染就能拿到标题）。 */
  tocByIndex = new Map<number, { label?: string; href?: string }>();
  renderer: {
    attributes: Map<string, string>;
    styles: unknown;
    setAttribute: (name: string, value: string) => void;
    getAttribute: (name: string) => string | null;
    getContents: () => FakeContent[];
    setStyles: (styles?: unknown) => void;
    readonly viewSize: number;
    readonly size: number;
    readonly start: number;
    readonly end: number;
    goTo: Mock<RendererGoTo>;
    // 真实的 renderer 是元素（`foliate-paginator`）；适配器在它身上挂「连续滚动」
    // 的 scroll 监听，测试用 `emit("scroll")` 触发。
    addEventListener: (name: string, handler: () => void) => void;
    removeEventListener: (name: string, handler: () => void) => void;
    emit: (name: string) => void;
    remove: () => void;
  };
  goTo = vi.fn<GoToFn>(async (target) => ({ index: 0, anchor: 0, target }));
  next = vi.fn(async () => {});
  prev = vi.fn(async () => {});
  close = vi.fn();
  getCFI = vi.fn(() => SECTION_ONE);
  resolveCFI = vi.fn((cfi: string) => ({
    index: indexFromCfi(cfi),
    anchor: (doc: Document) => {
      const range = doc.createRange();
      range.selectNodeContents(doc.body);
      return range;
    },
  }));
  addAnnotation = vi.fn(async () => ({ index: 0, label: "label" }));
  deleteAnnotation = vi.fn(async () => ({ index: 0, label: "label" }));
  open = vi.fn(async () => {});

  constructor() {
    super();
    const attributes = new Map<string, string>();
    const listeners = new Map<string, Set<() => void>>();
    // 几何对象的**引用**（测试改它的字段，不整体替换）。
    const { geometry } = this;
    this.renderer = {
      attributes,
      styles: undefined,
      setAttribute: (name, value) => {
        attributes.set(name, value);
      },
      getAttribute: (name) => attributes.get(name) ?? null,
      getContents: () => this.contents,
      setStyles: (styles) => {
        this.renderer.styles = styles;
      },
      get viewSize() {
        return geometry.viewSize;
      },
      get size() {
        return geometry.size;
      },
      get start() {
        return geometry.start;
      },
      get end() {
        return geometry.start + geometry.size;
      },
      // 换 section：适配器用**文档身份**判定换章成功，所以换 index 时给一份新文档；
      // 同一个 index 只调位置（失败恢复走这条）。
      goTo: vi.fn<RendererGoTo>(async ({ index }) => {
        const [current] = this.contents;
        if (!current) return;
        if (current.index === index) {
          this.contents = [{ ...current, index }];
          return;
        }
        this.contents = [section(index)];
      }),
      addEventListener: (name, handler) => {
        const set = listeners.get(name) ?? new Set();
        set.add(handler);
        listeners.set(name, set);
      },
      removeEventListener: (name, handler) => {
        listeners.get(name)?.delete(handler);
      },
      emit: (name) => {
        for (const handler of listeners.get(name) ?? []) handler();
      },
      // 真实的 renderer 是 `foliate-paginator` 元素，`View.close()` 会把它摘掉。
      remove: vi.fn(),
    };
  }

  getProgressOf = (index: number) => ({
    tocItem: this.tocByIndex.get(index) ?? null,
  });
}

customElements.define("foliate-view", FakeFoliateView);

function mark(overrides: Partial<ReadingMark> = {}): ReadingMark {
  return {
    id: 1,
    bookId: 1,
    type: "highlight",
    color: "red",
    content: "",
    anchor: { type: "cfi", cfi: SECTION_ONE },
    selectedString: "hello",
    title: "Chapter 1",
    ...overrides,
  };
}

/**
 * A rendered section: an iframe document (so it has a window, exactly like the
 * one foliate-js creates) plus a real overlayer to draw into.
 */
function section(index = 0): FakeContent {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = `<h2>Chapter ${index + 1}</h2><p><img src="../images/a.png"/></p>`;
  const overlayer = new Overlayer();
  document.body.append(overlayer.element);
  return { index, doc, overlayer };
}

/** A built rendition, still detached: mounting is the caller's job. */
async function build(
  options: Partial<CreateReaderAdapterOptions> = {},
): Promise<ReaderAdapter> {
  return createReaderAdapter({
    filesBaseUrl: "/api/books/1/files/",
    sizes: new Map([["OEBPS/text/chapter1.xhtml", 483]]),
    startCfi: "",
    initialHighlights: [],
    ...options,
  });
}

async function adapter(options: Partial<CreateReaderAdapterOptions> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const created = await build(options);
  // 容器由调用方接管（`useReaderAdapter` 就是这么做的）。
  container.replaceChildren(created.element);
  const view = created.element as FakeFoliateView;
  return { adapter: created, container, view };
}

afterEach(() => {
  document.body.innerHTML = "";
  state.loader = undefined;
  state.book = undefined;
  vi.restoreAllMocks();
});

function useBook() {
  const transformTarget = new EventTarget();
  state.book = {
    sections: [
      { id: "OEBPS/text/chapter1.xhtml" },
      { id: "OEBPS/text/chapter2.xhtml" },
    ],
    transformTarget,
    destroy: vi.fn(),
  };
  return { transformTarget };
}

describe("createReaderAdapter", () => {
  it("renders into the container with the paginator's reader defaults", async () => {
    useBook();
    const { adapter: created, container, view } = await adapter();

    expect(container.children).toHaveLength(1);
    expect(view.style.width).toBe("100%");
    expect([...view.renderer.attributes]).toEqual([["flow", "paginated"]]);
    created.destroy();
  });

  it("lets a caller override the paginator attributes", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled", gap: "5%", "max-inline-size": "600px" },
    });

    expect(view.renderer.attributes.get("flow")).toBe("scrolled");
    expect(view.renderer.attributes.get("gap")).toBe("5%");
    expect(view.renderer.attributes.get("max-inline-size")).toBe("600px");
    created.destroy();
  });

  it("builds the book from our loader, with the spine sizes", async () => {
    useBook();
    const { adapter: created } = await adapter();
    const loader = state.loader as {
      getSize: (name: string) => number;
      loadText: (name: string) => Promise<string | null>;
    };

    // foliate-js reads a section's size synchronously, so it has to be known
    // before the book exists.
    expect(loader.getSize("OEBPS/text/chapter1.xhtml")).toBe(483);
    expect(loader.getSize("OEBPS/text/chapter2.xhtml")).toBe(0);
    created.destroy();
  });

  it("arms the script guards on the book", async () => {
    const { transformTarget } = useBook();
    const { adapter: created } = await adapter();

    const detail = { isScript: true, allow: true };
    transformTarget.dispatchEvent(new CustomEvent("load", { detail }));

    expect(detail.allow).toBe(false);
    created.destroy();
  });

  it("draws the initial highlights when their section renders", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      initialHighlights: [mark()],
    });

    view.dispatchEvent(
      new CustomEvent("create-overlay", { detail: { index: 0 } }),
    );

    expect(view.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: SECTION_ONE, color: "red", id: 1 }),
    );
    created.destroy();
  });

  it("navigates to a saved CFI, and to the first section without one", async () => {
    useBook();
    const { adapter: created, view } = await adapter();

    await created.display("epubcfi(/6/2!/4/2/1:0)");
    await created.display("");
    await created.next();
    await created.prev();

    expect(view.goTo.mock.calls.map(([target]) => target)).toEqual([
      "epubcfi(/6/2!/4/2/1:0)",
      0,
    ]);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).toHaveBeenCalledTimes(1);
    created.destroy();
  });

  it("falls back to the section a stale CFI points at", async () => {
    // foliate-js swallows a resolution failure inside the renderer, so a jump
    // that silently does nothing is the failure mode to guard against.
    useBook();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { adapter: created, view } = await adapter();
    view.goTo.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      index: 1,
      anchor: 0,
      target: 1,
    });

    await created.display("epubcfi(/6/4!/4/2/1:0)");

    expect(view.goTo.mock.calls.map(([target]) => target)).toEqual([
      "epubcfi(/6/4!/4/2/1:0)",
      1,
    ]);
    expect(warn).toHaveBeenCalled();
    created.destroy();
  });

  it("opens the first section when nothing resolves", async () => {
    useBook();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { adapter: created, view } = await adapter();
    view.goTo.mockRejectedValue(new Error("IndexSizeError"));

    await created.display("epubcfi(/6/4!/4/2/1:9999)");

    expect(view.goTo.mock.calls.at(-1)?.[0]).toBe(0);
    created.destroy();
  });

  it("reports a relocation with the collapsed position and the TOC item", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    const events: RelocatedEvent[] = [];
    created.on("relocated", (event) => events.push(event));
    view.lastLocation = {
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:20)",
      fraction: 0.21,
      location: { current: 115, next: 116, total: 553 },
      tocItem: { label: "2.1 古城", href: "OEBPS/text/chapter2.xhtml" },
    };

    view.dispatchEvent(
      new CustomEvent("relocate", { detail: { index: 1, fraction: 0.21 } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.href).toBe("OEBPS/text/chapter2.xhtml");
    expect(events[0]?.anchor).toEqual({
      type: "cfi",
      cfi: "epubcfi(/6/4!/4/2/1:0)",
    });
    expect(events[0]?.location.start).toMatchObject({
      index: 1,
      location: 115,
      percentage: 0.21,
    });
    created.destroy();
  });

  it("wires the section document for images and reports the display", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    const images: string[] = [];
    let displayed = 0;
    created.on("imageClicked", (event) => images.push(event.src));
    created.on("displayed", () => {
      displayed += 1;
    });
    const rendered = section(1);
    view.contents = [rendered];

    view.dispatchEvent(
      new CustomEvent("load", { detail: { doc: rendered.doc, index: 1 } }),
    );
    rendered.doc
      .querySelector("img")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(images).toHaveLength(1);
    expect(images[0]).toContain("images/a.png");
    await vi.waitFor(() => expect(displayed).toBe(1));
    created.destroy();
  });

  it("reports a press inside a section so the selection bubble can dismiss", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    let pressed = 0;
    created.on("pointerDown", () => {
      pressed += 1;
    });
    const rendered = section(0);
    view.contents = [rendered];
    view.dispatchEvent(
      new CustomEvent("load", { detail: { doc: rendered.doc, index: 0 } }),
    );
    // The probe must be gone before the click that follows: the overlayer's hit
    // test would otherwise return the probe's key and swallow a mark click.
    const remove = vi.spyOn(rendered.overlayer!, "remove");

    rendered.doc.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );

    expect(pressed).toBe(1);
    expect(remove).toHaveBeenCalledWith("bery-selection");
    created.destroy();
    // The listener belonged to the section document and goes with it.
    rendered.doc.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(pressed).toBe(1);
  });

  it("reports a selection as a CFI once the gesture settles", async () => {
    vi.useFakeTimers();
    try {
      useBook();
      const { adapter: created, view } = await adapter();
      const selected: SelectedEvent[] = [];
      created.on("selected", (event) => selected.push(event));
      const rendered = section(0);
      view.contents = [rendered];
      view.lastLocation = { cfi: SECTION_ONE };
      view.dispatchEvent(
        new CustomEvent("load", { detail: { doc: rendered.doc, index: 0 } }),
      );
      const range = rendered.doc.createRange();
      range.selectNodeContents(rendered.doc.querySelector("h2")!);
      // jsdom does not implement `Range.getClientRects` /
      // `getBoundingClientRect`, which the library's overlay reads.
      Object.defineProperty(range, "getClientRects", {
        configurable: true,
        value: () => [],
      });
      Object.defineProperty(range, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
        }),
      });
      // jsdom's Selection does not track ranges, so the section window is
      // stubbed with the shape the adapter reads.
      Object.defineProperty(rendered.doc.defaultView, "getSelection", {
        configurable: true,
        value: () => ({ rangeCount: 1, getRangeAt: () => range }),
      });
      rendered.doc.dispatchEvent(new Event("selectionchange"));
      expect(selected).toHaveLength(0);

      vi.advanceTimersByTime(250);

      expect(selected).toHaveLength(1);
      expect(selected[0]?.anchor).toEqual({ type: "cfi", cfi: SECTION_ONE });
      expect(selected[0]?.text).toBe("Chapter 1");
      expect(selected[0]?.heading).toBe("Chapter 1");
      // The anchor is the probe the renderer draws, so it is a rect, not a
      // hand-computed offset of the section iframe.
      expect(selected[0]?.rect).toBeDefined();
      expect(typeof selected[0]?.measure).toBe("function");
      created.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves a mark click to the whole row", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    created.rememberHighlights([mark({ id: 41 })]);
    const clicks: { mark: ReadingMark; measure: () => unknown }[] = [];
    created.on("markClicked", (event) => clicks.push(event));

    view.dispatchEvent(
      new CustomEvent("show-annotation", {
        detail: { value: SECTION_ONE, index: 0, range: null },
      }),
    );

    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.mark.id).toBe(41);
    expect(clicks[0]?.measure()).toBeUndefined();
    created.destroy();
  });

  it("anchors a mark click to the range the click carries", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    created.rememberHighlights([mark({ id: 42 })]);
    const clicks: { measure: () => unknown }[] = [];
    created.on("markClicked", (event) => clicks.push(event));

    // 记着的绘制节点可能已经随重绘被摘掉（那时量出来是全 0 矩形），所以锚点取
    // 这次点击带来的 range —— 它总是连着当前渲染的章节。
    const range = document.createRange();
    range.selectNodeContents(document.body);
    // jsdom 的 Range 没有 `getBoundingClientRect`，直接在实例上给一个。
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 10,
          top: 20,
          width: 100,
          height: 24,
          right: 110,
          bottom: 44,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    view.dispatchEvent(
      new CustomEvent("show-annotation", {
        detail: { value: SECTION_ONE, index: 0, range },
      }),
    );

    // 没有 iframe（宿主文档里）时偏移为 0，矩形原样透传。
    expect(clicks[0]?.measure()).toMatchObject({
      left: 10,
      top: 20,
      width: 100,
      height: 24,
    });
    created.destroy();
  });

  it("opens an external link itself, without handing over the opener", async () => {
    useBook();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { adapter: created, view } = await adapter();

    const event = new CustomEvent("external-link", {
      detail: { a: document.createElement("a"), href_: "https://example.com/" },
      cancelable: true,
    });
    view.dispatchEvent(event);

    // Cancelling keeps foliate-js' own `window.open` from running.
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/",
      "_blank",
      "noopener,noreferrer",
    );
    created.destroy();
  });

  it("resolves a CFI only against the rendered section (D5)", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    view.contents = [section(1)];

    const range = created.getRange?.({
      type: "cfi",
      cfi: "epubcfi(/6/4!/4/2/1:0)",
    });
    expect(range?.startContainer).toBe(view.contents[0]?.doc.body);

    expect(
      created.getRange?.({ type: "cfi", cfi: "epubcfi(/6/8!/4/2/1:0)" }),
    ).toBeUndefined();
    created.destroy();
    expect(
      created.getRange?.({ type: "cfi", cfi: "epubcfi(/6/4!/4/2/1:0)" }),
    ).toBeUndefined();
  });

  it("applies section styles through the renderer", async () => {
    useBook();
    const { adapter: created, view } = await adapter();

    created.setStyles!("body { color: white; }");

    expect(view.renderer.styles).toBe("body { color: white; }");
    created.destroy();
  });

  it("destroys once and stops emitting", async () => {
    useBook();
    const { adapter: created, container, view } = await adapter();
    const events: RelocatedEvent[] = [];
    created.on("relocated", (event) => events.push(event));
    // 有章节渲染过：销毁时走的是 foliate-js 自己的拆解。
    view.contents = [section()];

    created.destroy();
    created.destroy();
    view.lastLocation = { cfi: SECTION_ONE };
    view.dispatchEvent(
      new CustomEvent("relocate", { detail: { index: 0, fraction: 0 } }),
    );

    expect(events).toHaveLength(0);
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(container.children).toHaveLength(0);
  });

  /**
   * 容器归调用方（`useReaderAdapter`）：构建**不能**自己去写它，销毁一个已经被
   * 接手的旧构建也不能碰它。
   *
   * 同一个容器上会有两次构建同时在飞（React 会对活着的阅读器先清理副作用再重跑），
   * 落地的先后还不由启动的先后决定 —— 上面那份「活的」可能先落地，旧构建随后才
   * resolve。旧构建那时若是自己去占容器，就会把已经在渲染的那份挤出去，自己又马上
   * 被销毁，读者看到的是一片空白。
   */
  it("leaves the container to the caller that mounted the live rendition", async () => {
    useBook();
    const { adapter: live, container } = await adapter();

    // 旧构建随后落地并立刻被丢弃。
    const stale = await build();
    stale.destroy();

    expect([...container.children]).toEqual([live.element]);
    live.destroy();
    expect([...container.children]).toHaveLength(0);
  });

  /**
   * React 会对着一个**活着的**阅读器先跑副作用清理、再重跑（StrictMode 的双调用；
   * TanStack Router 在 pending match 上抛 promise，让已经就绪的子树先隐藏、再
   * 显示），所以 `createReaderAdapter` 还在飞的时候就会被销毁 —— 一个章节都没渲染
   * 过。foliate-js 撑不住这条路径：分页器把内层 view 推迟到第一次渲染才建
   * （`paginator.js:667`），`destroy()` 却直接调 `this.#view.destroy()`
   * （`paginator.js:1121`），于是抛
   * `Cannot read properties of undefined (reading 'destroy')`。
   */
  it("tears down a rendition that never rendered a section", async () => {
    useBook();
    const { adapter: created, container, view } = await adapter();
    // 复刻上游那句没有防空判断的调用。
    view.close.mockImplementation(() => {
      throw new TypeError(
        "Cannot read properties of undefined (reading 'destroy')",
      );
    });

    created.destroy();

    expect(view.close).not.toHaveBeenCalled();
    expect(view.renderer.remove).toHaveBeenCalledTimes(1);
    expect(container.children).toHaveLength(0);
  });
});

/** 连续滚动到某处：`remaining` = 内容总长 − (scrollTop + 视口长度)。 */
function scrollTo(view: FakeFoliateView, remaining: number): void {
  // 内容 1200、视口 600 → scrollTop = 600 − remaining。
  Object.assign(view.geometry, {
    viewSize: 1200,
    size: 600,
    start: 600 - remaining,
  });
  view.renderer.emit("scroll");
}

describe("连续滚动的章末边界", () => {
  it("reserves enough tail space that the row never covers the last line", () => {
    // 隐藏阈值与尾部留白必须一起算：入口在回滞区间里也要压在空白上。
    expect(READER_TAIL_SPACE - CHAPTER_TAIL_HIDE_PX).toBeGreaterThanOrEqual(
      CHAPTER_TAIL_ROW_PX,
    );
    expect(CHAPTER_TAIL_HIDE_PX).toBeGreaterThan(CHAPTER_TAIL_SHOW_PX);
  });

  it("opens at the show threshold and only closes past the hide threshold", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    scrollTo(view, 600);
    scrollTo(view, CHAPTER_TAIL_SHOW_PX + 8); // 还没到
    scrollTo(view, CHAPTER_TAIL_SHOW_PX); // 进入
    scrollTo(view, CHAPTER_TAIL_HIDE_PX - 8); // 回滞区内，保持
    scrollTo(view, CHAPTER_TAIL_HIDE_PX + 8); // 离开

    // 只在变化时派发：中间两次滚动不产生事件。
    expect(boundaries.map((event) => event.atEnd)).toEqual([
      false,
      true,
      false,
    ]);
    created.destroy();
  });

  it("names the next section from foliate's own TOC mapping", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    view.tocByIndex.set(0, { label: "Chapter 1", href: "a" });
    view.tocByIndex.set(1, { label: "  Chapter 2  ", href: "b" });
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    scrollTo(view, 0);

    expect(boundaries.at(-1)).toEqual({
      atEnd: true,
      hasNext: true,
      nextLabel: "Chapter 2",
    });
    created.destroy();
  });

  it("drops the label when the next document continues the same chapter", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    // foliate 会把同一章拆出来的后续文件归到同一个目录项上
    // （`progress.js:37-56`）：两份文档拿到的是同一个对象。
    const chapter = { label: "Chapter 2", href: "b" };
    view.tocByIndex.set(0, chapter);
    view.tocByIndex.set(1, chapter);
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    scrollTo(view, 0);

    expect(boundaries.at(-1)?.nextLabel).toBeUndefined();
    created.destroy();
  });

  it("treats the last readable section as the end of the book", async () => {
    state.book = {
      sections: [
        { id: "OEBPS/text/chapter1.xhtml" },
        // 不可读的文档不是终点。
        { id: "OEBPS/text/notes.xhtml", linear: "no" },
      ],
      transformTarget: new EventTarget(),
      destroy: vi.fn(),
    };
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    scrollTo(view, 0);

    expect(boundaries.at(-1)).toEqual({ atEnd: true, hasNext: false });
    created.destroy();
  });

  it("counts a document that fits on one screen as already at the end", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    const rendered = section(0);
    view.contents = [rendered];
    Object.assign(view.geometry, { viewSize: 300, size: 600, start: 0 });
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    // 不用滚动：换章节本身就要重算一次。
    view.dispatchEvent(
      new CustomEvent("load", { detail: { doc: rendered.doc, index: 0 } }),
    );

    expect(boundaries.at(-1)?.atEnd).toBe(true);
    created.destroy();
  });

  it("jumps to the top of the next readable section", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];

    await expect(created.nextSection!()).resolves.toBe(true);
    expect(view.renderer.goTo).toHaveBeenCalledWith({ index: 1, anchor: 0 });
    created.destroy();
  });

  it("recomputes when the layout switches, the window resizes or the section relocates", async () => {
    useBook();
    // 分栏模式起来：章末判定本来不成立。
    const { adapter: created, view } = await adapter();
    view.contents = [section(0)];
    Object.assign(view.geometry, { viewSize: 1200, size: 600, start: 600 });
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    // 切到连续滚动，几何已经量好 → 立刻按几何给出边界。
    created.setLayout!({ flow: "scrolled" });
    expect(boundaries.at(-1)?.atEnd).toBe(true);

    // 视窗变大后「到底了」不再成立。
    Object.assign(view.geometry, { start: 0 });
    window.dispatchEvent(new Event("resize"));
    expect(boundaries.at(-1)?.atEnd).toBe(false);

    // 换章节之后 relocate 也要重算，而不是停在上一章的答案上。
    Object.assign(view.geometry, { start: 600 });
    view.contents = [section(1)];
    view.dispatchEvent(
      new CustomEvent("relocate", { detail: { index: 1, fraction: 0 } }),
    );
    expect(boundaries.at(-1)?.atEnd).toBe(true);
    created.destroy();
  });

  it("waits for measured geometry instead of flashing the row", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    // 章节刚挂上、字体还没落定：viewSize 为 0 不是「到底了」，是「还没量」。
    Object.assign(view.geometry, { viewSize: 0, size: 600, start: 0 });
    view.renderer.emit("scroll");
    expect(boundaries.at(-1)?.atEnd).toBe(false);

    Object.assign(view.geometry, { viewSize: 1200, size: 600, start: 600 });
    view.renderer.emit("scroll");
    expect(boundaries.at(-1)?.atEnd).toBe(true);
    created.destroy();
  });

  it("reports a failed jump and puts the reader back where they were", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(0)];
    // foliate 自己吞掉加载错误（`paginator.js:1004-1020`）：文档没换就是失败。
    view.renderer.goTo.mockImplementation(async () => {});

    await expect(created.nextSection!()).resolves.toBe(false);
    // 最后一次调用是把读者放回原 section（`#display` 会把旧文档滚到顶部）。
    expect(view.renderer.goTo).toHaveBeenLastCalledWith({
      index: 0,
      anchor: 0,
    });
    created.destroy();
  });

  it("refuses to jump past the last readable section", async () => {
    useBook();
    const { adapter: created, view } = await adapter({
      layout: { flow: "scrolled" },
    });
    view.contents = [section(1)];

    await expect(created.nextSection!()).resolves.toBe(false);
    expect(view.renderer.goTo).not.toHaveBeenCalled();
    created.destroy();
  });

  it("does not report a boundary outside the scrolled flow", async () => {
    useBook();
    const { adapter: created, view } = await adapter();
    view.contents = [section(0)];
    Object.assign(view.geometry, { viewSize: 1200, size: 600, start: 600 });
    const boundaries: ReaderBoundary[] = [];
    created.on("boundary", (event) => boundaries.push(event));

    view.renderer.emit("scroll");

    // 分栏模式没有「章末」这件事：翻页本身就是章内导航。
    expect(boundaries).toHaveLength(0);
    created.destroy();
  });
});
