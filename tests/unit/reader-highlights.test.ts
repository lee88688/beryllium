// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHighlights } from "@/features/reader/epub/highlights";
import type { ReadingMark } from "@/features/reader/epub/types";

const SECTION_TWO = "epubcfi(/6/4!/4/2,/1:0,/1:10)";
const SECTION_FOUR = "epubcfi(/6/8!/4/2,/1:0,/1:10)";

/**
 * Stand-in for `foliate-view`, reduced to what the highlight controller uses:
 * annotations are keyed by CFI, only draw into the section that is currently
 * rendered (foliate-js no-ops otherwise), and adding one emits
 * `draw-annotation` with a `draw` callback whose element the library inserts
 * into the section overlay.
 */
function fakeView(renderedIndex = 1) {
  const target = new EventTarget();
  const annotations = new Map<string, Record<string, unknown>>();
  const removed: string[] = [];
  let indexOf: (cfi: string) => number = (cfi) =>
    /^epubcfi\(\/6\/(\d+)/.exec(cfi)?.[1] === "8" ? 3 : 1;

  return {
    target,
    annotations,
    removed,
    setIndexResolver: (resolver: (cfi: string) => number) => {
      indexOf = resolver;
    },
    view: {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      // Throws for a CFI the library cannot place, exactly like `Resources
      // .resolveCFI` does for malformed input.
      resolveCFI: (cfi: string) => {
        const index = indexOf(cfi);
        if (index < 0) throw new Error("bad CFI");
        return { index, anchor: () => null };
      },
      addAnnotation: async (annotation: { value: string }) => {
        const index = indexOf(annotation.value);
        if (index === renderedIndex) {
          annotations.set(annotation.value, annotation);
          const draw = vi.fn(
            (
              fn: (rects: DOMRectList) => Element,
              options?: Record<string, unknown>,
            ) => {
              void options;
              return fn([] as unknown as DOMRectList);
            },
          );
          target.dispatchEvent(
            new CustomEvent("draw-annotation", {
              detail: { annotation, draw, doc: document, range: null },
            }),
          );
        }
        return { index, label: "label" };
      },
      deleteAnnotation: async (annotation: { value: string }) => {
        removed.push(annotation.value);
        annotations.delete(annotation.value);
        return { index: indexOf(annotation.value), label: "label" };
      },
    },
  };
}

function mark(overrides: Partial<ReadingMark> = {}): ReadingMark {
  return {
    id: 1,
    bookId: 7,
    type: "highlight",
    color: "red",
    content: "",
    epubcfi: SECTION_TWO,
    selectedString: "hello",
    title: "Chapter 1",
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createHighlights", () => {
  it("annotates a mark and tags the drawn element", async () => {
    const { view, annotations } = fakeView();
    const highlights = createHighlights({ view: view as never });

    highlights.add(mark());

    await vi.waitFor(() => expect(annotations.size).toBe(1));
    expect(annotations.get(SECTION_TWO)).toMatchObject({
      value: SECTION_TWO,
      color: "red",
      id: 1,
    });

    const element = highlights.findElement(SECTION_TWO);
    // The contract the editor and the e2e suite read: the overlay group carries
    // the CFI, the stored palette name and the palette's fill.
    expect(element?.tagName.toLowerCase()).toBe("g");
    expect((element as SVGGElement).dataset.epubcfi).toBe(SECTION_TWO);
    expect((element as SVGGElement).dataset.color).toBe("red");
    expect(element?.getAttribute("fill")).toBe("#F44336");
  });

  it("falls back to the raw colour, then to the library default", async () => {
    const { view } = fakeView(3);
    const highlights = createHighlights({ view: view as never });

    highlights.add(mark({ id: 2, epubcfi: SECTION_FOUR, color: "#123456" }));
    await vi.waitFor(() =>
      expect(highlights.findElement(SECTION_FOUR)).toBeDefined(),
    );
    expect(highlights.findElement(SECTION_FOUR)?.getAttribute("fill")).toBe(
      "#123456",
    );

    highlights.add(mark({ id: 3, epubcfi: SECTION_FOUR, color: "" }));
    await vi.waitFor(() =>
      expect(
        highlights.findElement(SECTION_FOUR)?.getAttribute("fill"),
      ).not.toBe("#123456"),
    );
    expect(highlights.findElement(SECTION_FOUR)?.getAttribute("fill")).toBe(
      "red",
    );
  });

  it("re-annotates only the marks of the section that just rendered", async () => {
    const first = fakeView(1);
    const highlightsForFirst = createHighlights({ view: first.view as never });
    highlightsForFirst.remember([
      mark(),
      mark({ id: 2, epubcfi: SECTION_FOUR, color: "blue" }),
    ]);

    highlightsForFirst.renderSection(1);

    // A mark of a section that is not rendered is skipped, not drawn elsewhere.
    await vi.waitFor(() =>
      expect(first.annotations.has(SECTION_TWO)).toBe(true),
    );
    expect(first.annotations.has(SECTION_FOUR)).toBe(false);

    const later = fakeView(3);
    const highlightsForLater = createHighlights({ view: later.view as never });
    highlightsForLater.remember([
      mark(),
      mark({ id: 2, epubcfi: SECTION_FOUR, color: "blue" }),
    ]);

    highlightsForLater.renderSection(3);

    await vi.waitFor(() =>
      expect(later.annotations.has(SECTION_FOUR)).toBe(true),
    );
    expect(later.annotations.has(SECTION_TWO)).toBe(false);
  });
  it("redraws the overlay when a mark is updated", async () => {
    const { view, annotations } = fakeView();
    const highlights = createHighlights({ view: view as never });
    highlights.add(mark());
    await vi.waitFor(() => expect(annotations.has(SECTION_TWO)).toBe(true));

    highlights.update(mark({ color: "blue-grey" }));

    await vi.waitFor(() =>
      expect(highlights.findElement(SECTION_TWO)?.getAttribute("fill")).toBe(
        "#607D8B",
      ),
    );
    expect(annotations.get(SECTION_TWO)).toMatchObject({ color: "blue-grey" });
  });

  it("removes the annotation and drops the drawn element", async () => {
    const { view, removed } = fakeView();
    const highlights = createHighlights({ view: view as never });
    highlights.add(mark());
    await vi.waitFor(() =>
      expect(highlights.findElement(SECTION_TWO)).toBeDefined(),
    );

    highlights.remove(SECTION_TWO);

    expect(removed).toEqual([SECTION_TWO]);
    expect(highlights.findElement(SECTION_TWO)).toBeUndefined();
    expect(highlights.markForClick(SECTION_TWO)).toBeUndefined();
  });

  it("resolves a click by id first, then by CFI (W12)", async () => {
    const { view } = fakeView();
    const highlights = createHighlights({ view: view as never });
    highlights.remember([mark({ id: 41 })]);

    expect(highlights.markForClick("epubcfi(/6/2!/4/99)", 41)?.id).toBe(41);
    // The overlay survived a refetch that renumbered the row: the CFI still
    // finds the mark instead of the editor silently doing nothing.
    expect(highlights.markForClick(SECTION_TWO, 999)?.id).toBe(41);
    expect(highlights.markForClick("epubcfi(/6/2!/4/99)")).toBeUndefined();
  });

  it("keeps one entry per mark when its CFI moves", async () => {
    const { view } = fakeView();
    const highlights = createHighlights({ view: view as never });
    highlights.remember([mark()]);
    highlights.remember([mark({ epubcfi: SECTION_FOUR })]);

    expect(highlights.markForClick(SECTION_TWO)).toBeUndefined();
    expect(highlights.markForClick(SECTION_FOUR)?.id).toBe(1);
  });

  it("keeps a CFI belonging to no rendered section clickable but undrawn", async () => {
    const { view, setIndexResolver } = fakeView();
    setIndexResolver(() => -1);
    const highlights = createHighlights({ view: view as never });

    highlights.add(mark());
    highlights.renderSection(0);

    // Nothing to draw, nothing to complain about: the row is intact, its
    // section simply is not on screen.
    expect(highlights.findElement(SECTION_TWO)).toBeUndefined();
    expect(highlights.markForClick(SECTION_TWO)?.id).toBe(1);
  });

  it("stops drawing and forgets everything once disposed", async () => {
    const { view, annotations, target } = fakeView();
    const highlights = createHighlights({ view: view as never });
    highlights.add(mark());
    await vi.waitFor(() => expect(annotations.size).toBe(1));

    highlights.dispose();

    expect(highlights.findElement(SECTION_TWO)).toBeUndefined();
    expect(highlights.markForClick(SECTION_TWO)).toBeUndefined();
    // A late `draw-annotation` must not resurrect anything.
    target.dispatchEvent(new CustomEvent("draw-annotation", { detail: {} }));

    expect(highlights.findElement(SECTION_TWO)).toBeUndefined();
  });
});
