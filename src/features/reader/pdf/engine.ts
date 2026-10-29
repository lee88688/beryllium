import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PdfQuad, ReaderAnchor } from "@/lib/reader-anchor";
import {
  PDF_MAX_OUTLINE_DEPTH,
  PDF_MAX_OUTLINE_NODES,
  PDF_MAX_PAGES,
  type PdfTocItem,
} from "@/lib/pdf-package";
import type { ReadingMark } from "@/lib/reader-mark";
import { createReaderEmitter } from "../epub/emitter";
import type {
  MarkClickedEvent,
  ReaderEventName,
  ReaderEventHandler,
  ReaderLocation,
  Rect,
  SelectedEvent,
} from "../epub/types";
import { getMarkColorValue } from "@/components/color-radio";
import { loadPdfJs, PDF_ASSETS } from "./pdfjs";

export type PdfMode = "scroll" | "page";
export type PdfZoom = "fit-width" | "fit-page" | number;

type PdfReaderAnchor = Extract<ReaderAnchor, { type: "pdf" }>;

export type PdfEngineErrorKind =
  | "auth"
  | "not-found"
  | "password"
  | "invalid"
  | "memory"
  | "network";

export class PdfEngineError extends Error {
  constructor(
    message: string,
    readonly kind: PdfEngineErrorKind,
  ) {
    super(message);
    this.name = "PdfEngineError";
  }
}

export interface PdfEngineOptions {
  url: string;
  mode: PdfMode;
  zoom: PdfZoom;
  initialPage: number;
  marks: readonly ReadingMark[];
  onError: (error: PdfEngineError) => void;
  onOutline: (outline: PdfTocItem[]) => void;
  onZoomChange: (zoom: PdfZoom) => void;
}

interface PdfLinkServiceLike {
  goToDestination: (dest: unknown) => void;
  getDestinationHash: (dest: unknown) => string;
  addLinkAttributes: (link: HTMLAnchorElement, url: string) => void;
  getAnchorUrl: () => string;
  executeNamedAction: (action: string) => void;
  executeSetOCGState: (state: unknown) => void;
}

interface RawPdfOutlineItem {
  title?: string;
  dest: unknown;
  items?: RawPdfOutlineItem[];
}

interface PageSlot {
  index: number;
  shell: HTMLDivElement;
  page: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  annotationLayer: HTMLDivElement;
  highlightLayer: HTMLDivElement;
  size: { width: number; height: number };
  task?: RenderTask;
  renderedScale?: number;
  pageProxy?: PDFPageProxy;
  rendering?: Promise<void>;
}

const MAX_CANVAS_SCALE = 4;
const PAGE_GAP = 16;
const MAX_RENDERED_PAGES = 5;
const MAX_PAGE_WIDTH = 1000;
const SELECTION_DEBOUNCE_MS = 250;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pdfAnchor(page: number): ReaderAnchor {
  return { type: "pdf", v: 1, pages: [{ page, quads: [] }] };
}

/**
 * The PDF page layer: one scroll container, page placeholders, lazy canvases and
 * text/annotation layers. It owns only document rendering and geometry; React
 * owns chrome, panels, marks UI and persistence.
 */
export class PdfEngine {
  readonly element: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
  private readonly options: PdfEngineOptions;
  private readonly emitter = createReaderEmitter();
  private readonly slots: PageSlot[] = [];
  private readonly rendered = new Set<number>();
  private readonly marksByPage = new Map<number, ReadingMark[]>();
  private readonly aborts = new Set<AbortController>();
  private pdf: PDFDocumentProxy | undefined;
  private observer: IntersectionObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private firstSize = { width: 612, height: 792 };
  private mode: PdfMode;
  private zoom: PdfZoom;
  private currentPage = 0;
  private lastLocation: ReaderLocation = { start: {}, end: {} };
  private selectionTimer: number | undefined;
  private pointerDown = false;
  private destroyed = false;
  private scrollFrame: number | undefined;
  private scrollSettleTimer: number | undefined;
  private suppressLazyRender = false;
  private previewFactor = 1;
  private touchStartDistance: number | undefined;

  constructor(options: PdfEngineOptions) {
    this.options = options;
    this.mode = options.mode;
    this.zoom = options.zoom;
    this.currentPage = Math.max(0, options.initialPage);
    this.remember(options.marks);

    this.element = document.createElement("div");
    this.element.className = "relative h-full w-full";
    this.scroller = document.createElement("div");
    this.scroller.className = "pdf-scroll";
    this.scroller.dataset.mode = this.mode;
    this.element.append(this.scroller);

    this.scroller.addEventListener("scroll", this.handleScroll, {
      passive: true,
    });
    this.scroller.addEventListener("scrollend", this.handleScrollEnd);
    this.scroller.addEventListener("pointerdown", this.handlePointerDown, {
      passive: true,
    });
    this.scroller.addEventListener("click", this.handleClick);
    this.scroller.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
    this.scroller.addEventListener("touchstart", this.handleTouchStart, {
      passive: false,
    });
    this.scroller.addEventListener("touchmove", this.handleTouchMove, {
      passive: false,
    });
    this.scroller.addEventListener("touchend", this.handleTouchEnd);
    document.addEventListener("selectionchange", this.handleSelectionChange);
    document.addEventListener("pointerup", this.handlePointerUp);
    document.addEventListener("pointercancel", this.handlePointerCancel);
  }

  get pageCount(): number {
    return this.slots.length;
  }

  get page(): number {
    return this.currentPage;
  }

  get currentMode(): PdfMode {
    return this.mode;
  }

  get scaleValue(): number {
    return this.scale();
  }

  get currentZoom(): PdfZoom {
    return this.zoom;
  }

  on<E extends ReaderEventName>(
    event: E,
    handler: ReaderEventHandler<E>,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  async open(): Promise<void> {
    await this.ensurePdfCss();
    const pdfjs = await loadPdfJs();
    const head = await fetch(this.options.url, {
      method: "HEAD",
      credentials: "same-origin",
    });
    if (head.status === 401 || head.status === 403) {
      throw new PdfEngineError(
        head.status === 401 ? "登录已过期" : "无权访问这本书",
        "auth",
      );
    }
    if (head.status === 404) {
      throw new PdfEngineError("PDF 文件不存在", "not-found");
    }
    if (!head.ok) {
      throw new PdfEngineError(
        `无法读取 PDF（HTTP ${head.status}）`,
        "network",
      );
    }
    const size = Number(head.headers.get("content-length") ?? "");
    if (!Number.isFinite(size) || size <= 0) {
      throw new PdfEngineError("PDF 文件为空或长度未知", "invalid");
    }

    const transport = new pdfjs.PDFDataRangeTransport(size, new Uint8Array(0));
    transport.requestDataRange = (begin, end) => {
      const load = async (attempt: number): Promise<void> => {
        try {
          const chunk = await this.fetchRange(begin, end);
          transport.onDataRange(begin, chunk);
        } catch (error: unknown) {
          if (this.destroyed) return;
          const authFailure =
            error instanceof PdfEngineError && error.kind === "auth";
          if (attempt === 0 && !authFailure) {
            window.setTimeout(() => void load(1), 150);
            return;
          }
          this.options.onError(
            error instanceof PdfEngineError
              ? error
              : new PdfEngineError(
                  error instanceof Error ? error.message : "PDF 读取失败",
                  "network",
                ),
          );
        }
      };
      void load(0);
    };
    transport.abort = () => {
      for (const controller of this.aborts) controller.abort();
      this.aborts.clear();
    };

    try {
      this.pdf = await pdfjs.getDocument({
        range: transport,
        cMapUrl: PDF_ASSETS.cmaps,
        standardFontDataUrl: PDF_ASSETS.standardFonts,
        wasmUrl: PDF_ASSETS.wasm,
        isEvalSupported: false,
        disableAutoFetch: true,
      }).promise;
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "";
      if (name === "PasswordException") {
        throw new PdfEngineError("暂不支持加密 PDF", "password");
      }
      if (name === "InvalidPDFException") {
        throw new PdfEngineError("PDF 文件损坏或无法解析", "invalid");
      }
      throw new PdfEngineError("PDF 打开失败", "memory");
    }
    if (this.destroyed) {
      void this.pdf.destroy();
      this.pdf = undefined;
      return;
    }
    if (this.pdf.numPages > PDF_MAX_PAGES) {
      throw new PdfEngineError("PDF 页数过多，暂不支持", "invalid");
    }

    const first = await this.pdf.getPage(1);
    if (this.destroyed) {
      void this.pdf.destroy();
      this.pdf = undefined;
      return;
    }
    const firstViewport = first.getViewport({ scale: 1 });
    this.firstSize = {
      width: firstViewport.width,
      height: firstViewport.height,
    };
    this.buildSlots(this.pdf.numPages);
    this.resizeObserver = new ResizeObserver(() => {
      this.layout();
      this.renderVisible();
    });
    this.resizeObserver.observe(this.scroller);
    this.layout();
    this.observeSlots();
    await this.scrollToPage(this.currentPage, false);
    this.emitLocation(true);
    void this.loadOutline();
  }

  private async fetchRange(begin: number, end: number): Promise<Uint8Array> {
    const controller = new AbortController();
    this.aborts.add(controller);
    try {
      const response = await fetch(this.options.url, {
        headers: { Range: `bytes=${begin}-${end - 1}` },
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new PdfEngineError("登录已过期", "auth");
      }
      if (!response.ok) {
        throw new PdfEngineError(
          `PDF 分片读取失败（HTTP ${response.status}）`,
          "network",
        );
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength === end - begin) return bytes;
      // A proxy ignored Range and returned 200 with the whole file.
      return bytes.slice(begin, end);
    } finally {
      this.aborts.delete(controller);
    }
  }

  private async ensurePdfCss(): Promise<void> {
    if (document.querySelector("style[data-pdfjs-layer-css]")) return;
    try {
      const [text, annotation] = await Promise.all([
        fetch("/vendor/pdfjs/text_layer_builder.css").then((r) => r.text()),
        fetch("/vendor/pdfjs/annotation_layer_builder.css").then((r) =>
          r.text(),
        ),
      ]);
      const style = document.createElement("style");
      style.dataset.pdfjsLayerCss = "true";
      style.textContent = `${text}\n${annotation}`;
      document.head.append(style);
    } catch {
      // The page still renders without text selection if the CSS is missing.
      console.warn("[pdf] layer CSS unavailable");
    }
  }

  private buildSlots(count: number): void {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const shell = document.createElement("div");
      shell.className = "pdf-page-shell";
      shell.dataset.page = String(index);
      const page = document.createElement("div");
      page.className = "pdf-page";
      page.dataset.page = String(index);
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      const highlightLayer = document.createElement("div");
      highlightLayer.className = "pdf-highlightLayer";
      const textLayer = document.createElement("div");
      textLayer.className = "pdf-textLayer textLayer";
      const annotationLayer = document.createElement("div");
      annotationLayer.className = "pdf-annotationLayer annotationLayer";
      page.append(canvas, highlightLayer, textLayer, annotationLayer);
      shell.append(page);
      fragment.append(shell);
      this.slots.push({
        index,
        shell,
        page,
        canvas,
        textLayer,
        annotationLayer,
        highlightLayer,
        size: this.firstSize,
      });
    }
    this.scroller.replaceChildren(fragment);
  }

  private observeSlots(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(
            (entry.target as HTMLElement).dataset.page ?? "-1",
          );
          if (index < 0) continue;
          if (this.suppressLazyRender) continue;
          if (entry.isIntersecting) void this.renderPage(index);
        }
      },
      { root: this.scroller, rootMargin: "100% 0px" },
    );
    for (const slot of this.slots) this.observer.observe(slot.shell);
  }

  private scale(): number {
    const availableWidth = Math.max(
      1,
      this.scroller.clientWidth - PAGE_GAP * 2,
    );
    if (typeof this.zoom === "number") return this.zoom;
    const widthScale =
      Math.min(availableWidth, MAX_PAGE_WIDTH) / this.firstSize.width;
    if (this.zoom === "fit-width") return widthScale;
    const availableHeight = Math.max(
      1,
      this.scroller.clientHeight - PAGE_GAP * 2,
    );
    return Math.min(widthScale, availableHeight / this.firstSize.height);
  }

  private layout(): void {
    if (this.destroyed) return;
    const scale = this.scale();
    const pageMode = this.mode === "page";
    this.scroller.dataset.mode = this.mode;
    this.scroller.style.scrollSnapType =
      pageMode && this.zoom === "fit-page" ? "y mandatory" : "none";
    for (const slot of this.slots) {
      const width = slot.size.width * scale;
      const height = slot.size.height * scale;
      slot.page.style.width = `${width}px`;
      slot.page.style.height = `${height}px`;
      slot.page.style.setProperty("--scale-factor", String(scale));
      slot.shell.style.height = pageMode
        ? `${Math.max(this.scroller.clientHeight, height)}px`
        : `${height + PAGE_GAP * 2}px`;
      slot.shell.style.paddingTop = pageMode ? "0" : `${PAGE_GAP}px`;
      slot.shell.style.paddingBottom = pageMode ? "0" : `${PAGE_GAP}px`;
    }
  }

  private renderPage(index: number): Promise<void> {
    const slot = this.slots[index];
    if (!slot || this.destroyed) return Promise.resolve();
    if (slot.rendering) return slot.rendering;
    const rendering = this.renderPageNow(index).finally(() => {
      slot.rendering = undefined;
      if (
        !this.destroyed &&
        slot.renderedScale !== undefined &&
        slot.renderedScale !== this.scale()
      ) {
        void this.renderPage(index);
      }
    });
    slot.rendering = rendering;
    return rendering;
  }

  private async renderPageNow(index: number): Promise<void> {
    const slot = this.slots[index];
    if (!this.pdf || !slot || this.destroyed) return;
    const scale = this.scale();
    if (slot.renderedScale !== undefined && slot.renderedScale === scale) {
      this.renderHighlights(index);
      return;
    }

    slot.task?.cancel();
    try {
      const page = await this.pdf.getPage(index + 1);
      if (this.destroyed) {
        page.cleanup();
        return;
      }
      slot.pageProxy = page;
      const size = page.getViewport({ scale: 1 });
      slot.size = { width: size.width, height: size.height };
      this.layout();

      const cssViewport = page.getViewport({ scale });
      const renderingScale = Math.min(
        scale * Math.min(devicePixelRatio || 1, 2),
        MAX_CANVAS_SCALE,
      );
      const renderViewport = page.getViewport({ scale: renderingScale });
      const canvas = slot.canvas;
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const context = canvas.getContext("2d");
      if (!context) return;

      slot.task = page.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
      });
      await slot.task.promise;

      slot.textLayer.replaceChildren();
      slot.annotationLayer.replaceChildren();
      const pdfjs = await loadPdfJs();
      const textLayer = new pdfjs.TextLayer({
        textContentSource: await page.streamTextContent(),
        container: slot.textLayer,
        viewport: cssViewport,
      });
      await textLayer.render();

      const annotations = (await page.getAnnotations()).filter(
        (annotation) => annotation.subtype !== "Widget",
      );
      if (annotations.length > 0) {
        try {
          const linkService = this.createLinkService();
          const annotationLayer = new pdfjs.AnnotationLayer({
            page,
            viewport: cssViewport,
            div: slot.annotationLayer,
            linkService: linkService as never,
            accessibilityManager: null,
            annotationCanvasMap: null,
            annotationEditorUIManager: null,
            structTreeLayer: null,
            commentManager: null,
            annotationStorage: null,
          });
          await annotationLayer.render({
            annotations,
            viewport: cssViewport,
            div: slot.annotationLayer,
            page,
            linkService: linkService as never,
            renderForms: false,
          });
        } catch (error) {
          // A bad annotation must not discard an otherwise usable text layer.
          console.warn(`[pdf] annotations on page ${index + 1} failed`, error);
          slot.annotationLayer.replaceChildren();
        }
      }

      slot.renderedScale = scale;
      this.rendered.add(index);
      this.renderHighlights(index);
      this.evictPages();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "RenderingCancelledException" || this.destroyed)
      ) {
        return;
      }
      console.warn(`[pdf] page ${index + 1} failed to render`, error);
      slot.renderedScale = undefined;
      slot.textLayer.replaceChildren();
      slot.annotationLayer.replaceChildren();
    }
  }

  private createLinkService(): PdfLinkServiceLike {
    return {
      goToDestination: (dest) => {
        void this.resolveDestination(dest).then((page) => {
          if (page !== null) void this.scrollToPage(page, true);
        });
      },
      getDestinationHash: (dest) =>
        `#pdf-dest=${encodeURIComponent(JSON.stringify(dest))}`,
      getAnchorUrl: () => "#",
      executeNamedAction: () => undefined,
      executeSetOCGState: () => undefined,
      addLinkAttributes: (link, url) => {
        if (/^(https?:|mailto:)/i.test(url)) {
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          return;
        }
        if (url.startsWith("#pdf-dest=")) {
          link.href = "#";
          link.addEventListener("click", (event) => {
            event.preventDefault();
            try {
              const dest: unknown = JSON.parse(
                decodeURIComponent(url.slice("#pdf-dest=".length)),
              );
              void this.resolveDestination(dest).then((page) => {
                if (page !== null) void this.scrollToPage(page, true);
              });
            } catch {
              // Malformed destination: leave the link inert.
            }
          });
          return;
        }
        link.removeAttribute("href");
      },
    };
  }

  private async resolveDestination(dest: unknown): Promise<number | null> {
    if (!this.pdf) return null;
    let target = dest;
    if (typeof target === "string") {
      target = await this.pdf.getDestination(target);
    }
    if (!Array.isArray(target) || target.length === 0) return null;
    try {
      return await this.pdf.getPageIndex(target[0]);
    } catch {
      return null;
    }
  }

  private evictPages(): void {
    if (this.rendered.size <= MAX_RENDERED_PAGES) return;
    const keep = new Set<number>();
    for (let offset = -1; offset <= 1; offset += 1) {
      keep.add(this.currentPage + offset);
    }
    const candidates = [...this.rendered]
      .filter((index) => !keep.has(index))
      .sort(
        (a, b) =>
          Math.abs(b - this.currentPage) - Math.abs(a - this.currentPage),
      );
    for (const index of candidates) {
      if (this.rendered.size <= MAX_RENDERED_PAGES) break;
      const slot = this.slots[index];
      if (!slot) continue;
      slot.task?.cancel();
      slot.task = undefined;
      slot.pageProxy?.cleanup();
      slot.pageProxy = undefined;
      slot.canvas.width = 1;
      slot.canvas.height = 1;
      slot.textLayer.replaceChildren();
      slot.annotationLayer.replaceChildren();
      slot.highlightLayer.replaceChildren();
      slot.renderedScale = undefined;
      this.rendered.delete(index);
    }
  }

  private renderVisible(): void {
    if (this.suppressLazyRender) return;
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    for (const slot of this.slots) {
      const slotTop = slot.shell.offsetTop;
      const slotBottom = slotTop + slot.shell.offsetHeight;
      if (
        slotBottom >= top - this.scroller.clientHeight &&
        slotTop <= bottom + this.scroller.clientHeight
      ) {
        void this.renderPage(slot.index);
      }
    }
  }

  private handleScroll = (): void => {
    if (this.scrollFrame !== undefined) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      if (!this.suppressLazyRender) {
        this.updateCurrentPage();
        this.renderVisible();
      } else {
        this.armScrollSettle();
      }
      this.emitLocation(false);
      this.emitter.emit("scrolled", {
        atEnd:
          this.scroller.scrollTop + this.scroller.clientHeight >=
          this.scroller.scrollHeight - 2,
        remaining:
          this.scroller.scrollHeight -
          this.scroller.scrollTop -
          this.scroller.clientHeight,
        scrollTop: this.scroller.scrollTop,
      });
    });
  };

  private handleScrollEnd = (): void => {
    this.finishProgrammaticScroll();
  };

  private armScrollSettle(): void {
    window.clearTimeout(this.scrollSettleTimer);
    this.scrollSettleTimer = window.setTimeout(() => {
      this.finishProgrammaticScroll();
    }, 200);
  }

  private finishProgrammaticScroll(): void {
    if (!this.suppressLazyRender) return;
    this.suppressLazyRender = false;
    window.clearTimeout(this.scrollSettleTimer);
    this.updateCurrentPage();
    void this.renderPage(this.currentPage);
    this.renderVisible();
  }

  private releaseLazySuppression(): void {
    if (!this.suppressLazyRender) return;
    this.suppressLazyRender = false;
    window.clearTimeout(this.scrollSettleTimer);
  }

  private handleWheel = (event: WheelEvent): void => {
    this.releaseLazySuppression();
    if (!event.ctrlKey) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = clamp(this.scale() * factor, 0.25, 8);
    this.setZoom(next);
    this.options.onZoomChange(next);
  };

  private touchDistance(touches: TouchList): number {
    const first = touches[0];
    const second = touches[1];
    if (!first || !second) return 0;
    return Math.hypot(
      first.clientX - second.clientX,
      first.clientY - second.clientY,
    );
  }

  private handleTouchStart = (event: TouchEvent): void => {
    this.releaseLazySuppression();
    if (event.touches.length !== 2) return;
    event.preventDefault();
    this.touchStartDistance = this.touchDistance(event.touches);
  };

  private handleTouchMove = (event: TouchEvent): void => {
    if (event.touches.length !== 2 || !this.touchStartDistance) return;
    event.preventDefault();
    this.previewZoom(
      clamp(
        this.touchDistance(event.touches) / this.touchStartDistance,
        0.25,
        8,
      ),
    );
  };

  private handleTouchEnd = (): void => {
    if (this.touchStartDistance === undefined) return;
    this.touchStartDistance = undefined;
    this.commitPreviewZoom();
    this.options.onZoomChange(this.zoom);
  };

  private updateCurrentPage(): void {
    const top = this.scroller.scrollTop + 8;
    let page = 0;
    for (const slot of this.slots) {
      if (slot.shell.offsetTop <= top) page = slot.index;
      else break;
    }
    this.currentPage = clamp(page, 0, this.slots.length - 1);
  }

  private emitLocation(force: boolean): void {
    const page = this.currentPage;
    const count = this.slots.length || 1;
    const percentage = (page + 1) / count;
    const anchor = pdfAnchor(page);
    const location: ReaderLocation = {
      start: {
        anchor,
        index: page,
        percentage,
        href: `page:${page}`,
        cfi: `page:${page}`,
      },
      end: {
        anchor,
        index: page,
        percentage,
        href: `page:${page}`,
        cfi: `page:${page}`,
      },
    };
    const changed =
      force ||
      this.lastLocation.start.anchor?.type !== "pdf" ||
      (this.lastLocation.start.anchor.type === "pdf" &&
        this.lastLocation.start.anchor.pages[0]?.page !== page) ||
      this.lastLocation.start.percentage !== percentage;
    this.lastLocation = location;
    if (!changed) return;
    this.emitter.emit("relocated", {
      href: `page:${page}`,
      anchor,
      location,
    });
    this.emitter.emit("displayed", { location });
  }

  currentLocation(): ReaderLocation {
    return this.lastLocation;
  }

  async display(target?: string | number): Promise<void> {
    if (target === undefined || target === "") {
      this.currentPage = 0;
      await this.scrollToPage(0, false);
      return;
    }
    if (typeof target === "number") {
      this.currentPage = target;
      await this.scrollToPage(target, true);
      return;
    }
    const match = /^page:(\d+)$/.exec(target);
    if (match) {
      const page = Number(match[1]);
      this.currentPage = page;
      await this.scrollToPage(page, true);
    }
  }

  async scrollToPage(index: number, smooth: boolean): Promise<void> {
    if (this.slots.length === 0) return;
    const page = clamp(Math.round(index), 0, this.slots.length - 1);
    this.currentPage = page;
    const slot = this.slots[page];
    if (!slot) return;
    const top =
      this.mode === "page"
        ? slot.shell.offsetTop
        : Math.max(0, slot.shell.offsetTop - 8);
    if (smooth) {
      // A TOC jump can cross hundreds of pages. Do not render every page the
      // viewport passes through; the target is rendered explicitly and the
      // intermediate shells stay as placeholders until the scroll settles.
      this.suppressLazyRender = true;
      this.armScrollSettle();
    } else {
      this.releaseLazySuppression();
    }
    this.scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    void this.renderPage(page);
    this.renderVisible();
    this.emitLocation(true);
  }

  async next(): Promise<void> {
    await this.scrollToPage(this.currentPage + 1, true);
  }

  async prev(): Promise<void> {
    await this.scrollToPage(this.currentPage - 1, true);
  }

  setMode(mode: PdfMode): void {
    if (this.mode === mode) return;
    const page = this.currentPage;
    this.mode = mode;
    this.layout();
    void this.scrollToPage(page, false);
    this.renderVisible();
  }

  setZoom(zoom: PdfZoom): void {
    const page = this.currentPage;
    this.zoom = typeof zoom === "number" ? clamp(zoom, 0.25, 8) : zoom;
    this.clearPreview();
    this.layout();
    void this.scrollToPage(page, false);
    this.renderVisible();
  }

  previewZoom(factor: number): void {
    this.previewFactor = factor;
    for (const slot of this.slots) {
      slot.page.style.transform = `scale(${factor})`;
    }
  }

  commitPreviewZoom(): void {
    const factor = this.previewFactor;
    if (factor === 1) return;
    const scale = this.scale() * factor;
    this.previewFactor = 1;
    this.clearPreview();
    this.setZoom(scale);
  }

  private clearPreview(): void {
    this.previewFactor = 1;
    for (const slot of this.slots) slot.page.style.transform = "";
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.releaseLazySuppression();
    this.pointerDown = true;
    window.clearTimeout(this.selectionTimer);
    const target = event.target as HTMLElement | null;
    const pageEl = target?.closest<HTMLElement>(".pdf-page");
    if (pageEl) {
      const index = Number(pageEl.dataset.page ?? "-1");
      const rect = pageEl.getBoundingClientRect();
      const mark = this.findMarkAt(
        index,
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      );
      if (mark) document.getSelection()?.removeAllRanges();
    }
    this.emitter.emit("pointerDown", undefined);
  };

  private handlePointerUp = (): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.scheduleSelection();
  };

  private handlePointerCancel = (): void => {
    this.pointerDown = false;
    window.clearTimeout(this.selectionTimer);
  };

  private handleClick = (event: MouseEvent): void => {
    const selection = document.getSelection();
    const target = event.target as HTMLElement | null;
    const pageEl = target?.closest<HTMLElement>(".pdf-page");
    if (!pageEl) return;
    const index = Number(pageEl.dataset.page ?? "-1");
    if (index < 0) return;
    const rect = pageEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const mark = this.findMarkAt(index, x, y);
    if (!mark) {
      // A click that ends a text-selection drag must not swallow the selection.
      return;
    }
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
    const page =
      mark.anchor.type === "pdf"
        ? mark.anchor.pages.find((item) => item.page === index)
        : undefined;
    const quad = page?.quads.find(
      ([qx, qy, qw, qh]) => x >= qx && x <= qx + qw && y >= qy && y <= qy + qh,
    );
    if (!quad) return;
    const measure = (): Rect | undefined => {
      const currentPage = document.querySelector<HTMLElement>(
        `.pdf-page[data-page="${index}"]`,
      );
      return currentPage ? this.rectForQuad(currentPage, quad) : undefined;
    };
    const clicked: MarkClickedEvent = {
      anchor: mark.anchor,
      mark,
      rect: measure(),
      measure,
      frame: undefined,
    };
    this.emitter.emit("markClicked", clicked);
  };

  private rectForQuad(pageEl: HTMLElement, quad: PdfQuad): Rect {
    const rect = pageEl.getBoundingClientRect();
    return {
      x: rect.left + quad[0] * rect.width,
      y: rect.top + quad[1] * rect.height,
      width: quad[2] * rect.width,
      height: quad[3] * rect.height,
      top: rect.top + quad[1] * rect.height,
      right: rect.left + (quad[0] + quad[2]) * rect.width,
      bottom: rect.top + (quad[1] + quad[3]) * rect.height,
      left: rect.left + quad[0] * rect.width,
    };
  }

  private findMarkAt(
    index: number,
    x: number,
    y: number,
  ): ReadingMark | undefined {
    for (const mark of this.marksByPage.get(index) ?? []) {
      if (mark.anchor.type !== "pdf") continue;
      const page = mark.anchor.pages.find((item) => item.page === index);
      if (!page) continue;
      if (
        page.quads.some(
          ([qx, qy, qw, qh]) =>
            x >= qx && x <= qx + qw && y >= qy && y <= qy + qh,
        )
      ) {
        return mark;
      }
    }
    return undefined;
  }

  private handleSelectionChange = (): void => {
    window.clearTimeout(this.selectionTimer);
    // While the pointer is down the selection keeps changing; publishing on the
    // debounce would cover the text with the popover before the drag is over.
    if (this.pointerDown) return;
    this.scheduleSelection();
  };

  private scheduleSelection = (): void => {
    window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (
        !this.scroller.contains(range.commonAncestorContainer) ||
        range.toString().trim() === ""
      ) {
        return;
      }
      const anchor = this.anchorFromRange(range);
      if (!anchor) return;
      const page = anchor.pages[0]?.page ?? 0;
      const selected: SelectedEvent = {
        anchor,
        rect: this.firstRectForRange(range),
        text: range.toString(),
        heading:
          anchor.pages.length > 1
            ? `第 ${page + 1}–${(anchor.pages.at(-1)?.page ?? page) + 1} 页`
            : `第 ${page + 1} 页`,
        frame: undefined,
        measure: () => this.firstRectForRange(range),
      };
      this.emitter.emit("selected", selected);
    }, SELECTION_DEBOUNCE_MS);
  };

  private firstRectForRange(range: Range): Rect {
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  }

  private anchorFromRange(range: Range): PdfReaderAnchor | undefined {
    const pages = new Map<number, { page: number; quads: PdfQuad[] }>();
    const pageRects = this.slots.map((slot) => ({
      index: slot.index,
      pageRect: slot.page.getBoundingClientRect(),
    }));

    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      let best:
        | {
            index: number;
            pageRect: DOMRect;
            left: number;
            top: number;
            right: number;
            bottom: number;
            area: number;
          }
        | undefined;
      for (const candidate of pageRects) {
        const { pageRect } = candidate;
        if (pageRect.width <= 0 || pageRect.height <= 0) continue;
        const left = Math.max(rect.left, pageRect.left);
        const top = Math.max(rect.top, pageRect.top);
        const right = Math.min(rect.right, pageRect.right);
        const bottom = Math.min(rect.bottom, pageRect.bottom);
        if (right <= left || bottom <= top) continue;
        const area = (right - left) * (bottom - top);
        if (!best || area > best.area) {
          best = { ...candidate, left, top, right, bottom, area };
        }
      }
      if (!best) continue;
      const pageRect = best.pageRect;
      const quad: PdfQuad = [
        clamp((best.left - pageRect.left) / pageRect.width, 0, 1),
        clamp((best.top - pageRect.top) / pageRect.height, 0, 1),
        clamp((best.right - best.left) / pageRect.width, 0, 1),
        clamp((best.bottom - best.top) / pageRect.height, 0, 1),
      ];
      const existing = pages.get(best.index);
      if (existing) existing.quads.push(quad);
      else pages.set(best.index, { page: best.index, quads: [quad] });
    }
    if (pages.size === 0) return undefined;
    return {
      type: "pdf",
      v: 1,
      pages: [...pages.values()].sort((a, b) => a.page - b.page),
    };
  }

  remember(marks: readonly ReadingMark[]): void {
    this.marksByPage.clear();
    for (const mark of marks) {
      if (mark.anchor.type !== "pdf") continue;
      for (const page of mark.anchor.pages) {
        const bucket = this.marksByPage.get(page.page);
        if (bucket) bucket.push(mark);
        else this.marksByPage.set(page.page, [mark]);
      }
    }
    for (const index of this.rendered) this.renderHighlights(index);
  }

  addHighlight(mark: ReadingMark): void {
    const marks = this.allMarks();
    this.remember(
      marks.some((item) => item.id === mark.id)
        ? marks.map((item) => (item.id === mark.id ? mark : item))
        : [...marks, mark],
    );
  }

  updateHighlight(mark: ReadingMark): void {
    this.remember(
      this.allMarks().map((item) => (item.id === mark.id ? mark : item)),
    );
  }

  removeHighlight(anchor: ReaderAnchor): void {
    const remaining = this.allMarks().filter(
      (mark) => JSON.stringify(mark.anchor) !== JSON.stringify(anchor),
    );
    this.remember(remaining);
  }

  private allMarks(): ReadingMark[] {
    const byId = new Map<number, ReadingMark>();
    for (const bucket of this.marksByPage.values()) {
      for (const mark of bucket) byId.set(mark.id, mark);
    }
    return [...byId.values()];
  }

  private renderHighlights(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    slot.highlightLayer.replaceChildren();
    for (const mark of this.marksByPage.get(index) ?? []) {
      if (mark.anchor.type !== "pdf") continue;
      const page = mark.anchor.pages.find((item) => item.page === index);
      if (!page) continue;
      const color = getMarkColorValue(mark.color) ?? mark.color ?? "red";
      for (const [x, y, width, height] of page.quads) {
        const element = document.createElement("div");
        element.className = "pdf-highlight";
        element.dataset.markId = String(mark.id);
        element.style.left = `${x * 100}%`;
        element.style.top = `${y * 100}%`;
        element.style.width = `${width * 100}%`;
        element.style.height = `${height * 100}%`;
        element.style.background = color;
        slot.highlightLayer.append(element);
      }
    }
  }

  private async loadOutline(): Promise<void> {
    if (!this.pdf) return;
    try {
      const outline = (await this.pdf.getOutline()) as
        | RawPdfOutlineItem[]
        | null;
      if (!outline || outline.length === 0) return;
      let nodes = 0;
      const convert = async (
        items: readonly RawPdfOutlineItem[],
        depth: number,
      ): Promise<PdfTocItem[]> => {
        if (depth > PDF_MAX_OUTLINE_DEPTH) return [];
        const result: PdfTocItem[] = [];
        for (const item of items) {
          nodes += 1;
          if (nodes > PDF_MAX_OUTLINE_NODES) break;
          const page = await this.resolveDestination(item.dest);
          if (page === null) continue;
          const children = item.items?.length
            ? await convert(item.items, depth + 1)
            : undefined;
          result.push({
            label: item.title?.trim() || `第 ${page + 1} 页`,
            page,
            ...(children && children.length > 0 ? { children } : {}),
          });
        }
        return result;
      };
      const result = await convert(outline, 0);
      if (result.length > 0) this.options.onOutline(result);
    } catch (error) {
      console.warn("[pdf] outline unavailable", error);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearTimeout(this.selectionTimer);
    window.clearTimeout(this.scrollSettleTimer);
    if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.scroller.removeEventListener("scroll", this.handleScroll);
    this.scroller.removeEventListener("scrollend", this.handleScrollEnd);
    this.scroller.removeEventListener("pointerdown", this.handlePointerDown);
    this.scroller.removeEventListener("click", this.handleClick);
    this.scroller.removeEventListener("wheel", this.handleWheel);
    this.scroller.removeEventListener("touchstart", this.handleTouchStart);
    this.scroller.removeEventListener("touchmove", this.handleTouchMove);
    this.scroller.removeEventListener("touchend", this.handleTouchEnd);
    document.removeEventListener("selectionchange", this.handleSelectionChange);
    document.removeEventListener("pointerup", this.handlePointerUp);
    document.removeEventListener("pointercancel", this.handlePointerCancel);
    for (const controller of this.aborts) controller.abort();
    this.aborts.clear();
    for (const slot of this.slots) slot.task?.cancel();
    this.emitter.removeAll();
    void this.pdf?.destroy();
    this.pdf = undefined;
    this.element.remove();
  }
}
