/**
 * Hand-written typings for the vendored foliate-js submodule.
 *
 * `vendor/foliate-js` ships plain ESM with no declarations, and `allowJs` is
 * off, so every specifier this feature imports is declared here — deliberately
 * narrow: only the members our wrapper actually calls are typed, and the
 * shapes below are the *upstream* ones (`epub.js`, `view.js`, `paginator.js`,
 * `overlayer.js`, `epubcfi.js` at submodule commit `78914ae`). Nothing checks
 * these against the JavaScript; `e2e/reader.spec.ts` is what keeps them honest.
 */

declare module "foliate-js/epub.js" {
  /** Loader contract `epub.js` requires (`epub.js:936`). */
  export interface BookLoader {
    /** `null` for a member the archive does not contain. */
    loadText(name: string): Promise<string | null>;
    loadBlob(name: string): Promise<Blob | null>;
    /** Called synchronously while building `.sections` (`epub.js:991`). */
    getSize(name: string): number;
    /** SHA-1 for IDPF font obfuscation; defaults to Web Crypto. */
    sha1?(text: string): Promise<ArrayBuffer>;
  }

  export interface BookSection {
    /** Archive-relative member path. */
    id: string;
    load(): Promise<string> | string;
    unload?(): void;
    createDocument(): Promise<Document>;
    size: number;
    /** Base CFI of the section, e.g. `epubcfi(/6/2)`. */
    cfi: string;
    linear?: string;
    pageSpread?: string;
  }

  export interface BookTocItem {
    label: string;
    href: string;
    subitems?: BookTocItem[] | null;
  }

  export interface BookLocation {
    index: number;
    /** `Range` in the section document, an element, or a fraction. */
    anchor: ((doc: Document) => Range | Element | number) | Range | number;
  }

  export class EPUB {
    constructor(loader: BookLoader);
    init(): Promise<EpubBook>;
  }

  export interface EpubBook {
    sections: BookSection[];
    toc?: BookTocItem[] | null;
    pageList?: BookTocItem[] | null;
    landmarks?: { href: string; type?: string }[] | null;
    dir?: string;
    metadata?: { title?: unknown; language?: unknown };
    rendition?: { layout?: string } | null;
    transformTarget?: EventTarget;
    resolveCFI(cfi: string): BookLocation | undefined;
    resolveHref(href: string): BookLocation | null;
    isExternal(href: string): boolean;
    destroy?(): void;
  }
}

declare module "foliate-js/view.js" {
  import type { EpubBook } from "foliate-js/epub.js";
  import type { Overlayer } from "foliate-js/overlayer.js";

  /** A rendered section as `getContents()` reports it. */
  export interface ViewContent {
    index: number;
    doc: Document;
    overlayer?: Overlayer | undefined;
  }

  export interface RelocateDetail {
    /** One of `page`, `scroll`, `snap`, `anchor`, `navigation`, `selection`. */
    reason?: string;
    index: number;
    range: Range;
    /** Within the section, 0–1 (can exceed 1 in edge cases). */
    fraction: number;
    /** Present in scrolled mode / when the section is paged. */
    size?: number;
  }

  export interface LastLocation {
    cfi: string;
    fraction?: number;
    range?: Range;
    location?: { current: number; next: number; total: number } | null;
    tocItem?: { label?: string; href?: string } | null;
    pageItem?: { label?: string; href?: string } | null;
  }

  /**
   * The paginator/fixed-layout element `view.renderer`. Only the members the
   * wrapper uses are declared; it is reachable only after `open()`.
   */
  export interface Renderer extends HTMLElement {
    setAttribute(name: string, value: string): void;
    getContents(): ViewContent[];
    /** Stores the CSS and re-applies it to every section as it renders. */
    setStyles?(styles: string | [string, string] | undefined): void;
  }

  /** `foliate-view` custom element. Must be sized by the host. */
  export class View extends HTMLElement {
    book: EpubBook;
    renderer: Renderer;
    lastLocation: LastLocation | null;
    open(book: EpubBook): Promise<void>;
    init(options: {
      lastLocation?: string | number | { fraction: number };
      showTextStart?: boolean;
    }): Promise<void>;
    close(): void;
    goTo(
      target: string | number | { fraction: number } | { index: number },
    ): Promise<{ index: number; anchor: unknown } | undefined>;
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    /** `index` of the rendered section, `range` in that section's document. */
    getCFI(index: number, range?: Range): string;
    resolveCFI(cfi: string): {
      index: number;
      anchor: (doc: Document) => unknown;
    };
    resolveNavigation(target: unknown): { index: number; anchor: unknown };
    addAnnotation(
      annotation: { value: string } & Record<string, unknown>,
      remove?: boolean,
    ): Promise<{ index: number; label: string } | undefined>;
    deleteAnnotation(
      annotation: { value: string } & Record<string, unknown>,
    ): Promise<{ index: number; label: string } | undefined>;
  }
}

declare module "foliate-js/paginator.js" {
  import type { ViewContent } from "foliate-js/view.js";

  /**
   * Layout attributes the wrapper sets; upstream exposes no JS property API
   * (README: "there's no JS property API, use `.setAttribute()`").
   */
  export interface PaginatorElement extends HTMLElement {
    getContents(): ViewContent[];
    setStyles(styles: string | [string, string] | undefined): void;
  }
}

declare module "foliate-js/overlayer.js" {
  export interface OverlayerInstance {
    element: SVGSVGElement;
    add(
      key: string,
      range: Range | ((root: Node) => Range),
      draw: (rects: DOMRectList, options?: Record<string, unknown>) => Element,
      options?: Record<string, unknown>,
    ): void;
    remove(key: string): void;
    redraw(): void;
    hitTest(event: { x: number; y: number }): [string, Range] | [];
  }

  export class Overlayer {
    constructor();
    element: SVGSVGElement;
    add(
      key: string,
      range: Range | ((root: Node) => Range),
      draw: (rects: DOMRectList, options?: Record<string, unknown>) => Element,
      options?: Record<string, unknown>,
    ): void;
    remove(key: string): void;
    redraw(): void;
    hitTest(event: { x: number; y: number }): [string, Range] | [];
    static highlight(
      rects: DOMRectList | DOMRect[],
      options?: { color?: string; writingMode?: string },
    ): SVGGElement;
  }
}

declare module "foliate-js/epubcfi.js" {
  /** A CFI is either a range (`parent`/`start`/`end`) or a collapsed path. */
  export type CfiPart = {
    index?: number;
    id?: string | null;
    offset?: number;
    text?: string | null;
    side?: string | null;
  };
  export type ParsedCfi =
    | CfiPart[][]
    | {
        parent: CfiPart[][];
        start: CfiPart[][];
        end: CfiPart[][];
      };

  export const isCFI: RegExp;
  export function parse(cfi: string): ParsedCfi;
  /** `toEnd` false → the start of the range, true → its end. */
  export function collapse(cfi: string, toEnd?: boolean): string;
  export function collapse(cfi: ParsedCfi, toEnd?: boolean): ParsedCfi;
  export function compare(a: string, b: string): number;
  /** Range → CFI string (`epubcfi(...)`, range form when not collapsed). */
  export function fromRange(
    range: Range,
    filter?: (node: Node) => number,
  ): string;
  export function toRange(
    doc: Document,
    parts: ParsedCfi,
    filter?: (node: Node) => number,
  ): Range;
  export function joinIndir(...cfis: string[]): string;
  /** Index-based CFIs for books without a package document. */
  export const fake: {
    fromIndex(index: number): string;
    toIndex(parts: CfiPart[] | null | undefined): number;
  };
}
