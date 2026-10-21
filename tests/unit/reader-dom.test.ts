// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  frameForDocument,
  getElementHeading,
  getSelectionRange,
  toHostSpace,
  truncateText,
} from "@/features/reader/epub/dom";
import { describeCfi } from "@/features/reader/epub/cfi";
import { createRect } from "@/features/reader/geometry";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("truncateText", () => {
  it("keeps short text and trims the edges", () => {
    expect(truncateText("  hello  ")).toBe("hello");
  });

  it("appends the omission once the text is longer than the limit", () => {
    const result = truncateText("a".repeat(50));

    expect(result).toHaveLength(30);
    expect(result).toBe(`${"a".repeat(27)}...`);
  });

  it("honours a custom length and omission", () => {
    expect(truncateText("abcdef", 5, "…")).toBe("abcd…");
  });
});

describe("getElementHeading", () => {
  it("walks up to the nearest heading, not just the parent", () => {
    document.body.innerHTML =
      "<h2>第一章</h2><div><p><span id='deep'>正文</span></p></div>";

    expect(getElementHeading(document.getElementById("deep"))).toBe("第一章");
  });

  it("falls back to the node's own text when there is no heading", () => {
    document.body.innerHTML = "<p id='only'>正文内容</p>";

    expect(getElementHeading(document.getElementById("only"))).toBe("正文内容");
  });

  it("does not treat other h-prefixed tags as headings", () => {
    document.body.innerHTML = "<hr><p id='only'>正文内容</p>";

    expect(getElementHeading(document.getElementById("only"))).toBe("正文内容");
  });

  it("reads nodes from another realm (the epub iframe)", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = "<h3>第二章</h3><p>iframe 正文</p>";

    expect(getElementHeading(doc.querySelector("p"))).toBe("第二章");
  });

  it("tolerates a missing node", () => {
    expect(getElementHeading(undefined)).toBe("");
  });
});

describe("frameForDocument", () => {
  it("finds the section frame through the document's own window", () => {
    // foliate-js builds its DOM inside closed shadow roots, so the section
    // document is the only handle on the iframe that owns it.
    const container = document.createElement("div");
    const frame = document.createElement("iframe");
    container.append(frame);
    document.body.append(container);

    expect(frameForDocument(frame.contentDocument)).toBe(frame);
  });

  it("answers undefined for a top-level document", () => {
    expect(frameForDocument(document)).toBeUndefined();
    expect(frameForDocument(null)).toBeUndefined();
  });
});

describe("toHostSpace", () => {
  /** 章节文档里量到的矩形 → 宿主视口坐标。 */
  const insideFrame = () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    // 连续滚动时容器把整节内容推上去：iframe 自己是负的 top。
    frame.getBoundingClientRect = () =>
      ({
        left: 12,
        top: -500,
        width: 800,
        height: 5000,
        right: 812,
        bottom: 4500,
        x: 12,
        y: -500,
        toJSON: () => ({}),
      }) as DOMRect;
    const doc = frame.contentDocument;
    if (!doc) throw new Error("jsdom did not create the frame document");
    return doc;
  };

  it("adds the owning frame's offset", () => {
    // 选区在章节自己坐标系里的位置；少了这一步浮窗会被挤到容器角落。
    const rect = createRect(20, 940, 100, 20);
    expect(toHostSpace(rect, insideFrame())).toMatchObject({
      left: 32,
      top: 440,
      width: 100,
      height: 20,
    });
  });

  it("leaves the rect alone outside a frame", () => {
    const rect = createRect(20, 940, 100, 20);
    expect(toHostSpace(rect, document)).toMatchObject({ left: 20, top: 940 });
  });
});

describe("getSelectionRange", () => {
  it("returns no range for a missing or empty selection", () => {
    expect(getSelectionRange(null)).toBeUndefined();
    expect(getSelectionRange(document.getSelection())).toBeUndefined();
  });

  it("returns no range when getRangeAt throws IndexSizeError", () => {
    const selection = document.getSelection();
    Object.defineProperty(selection, "rangeCount", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(selection, "getRangeAt", {
      configurable: true,
      value: () => {
        throw new DOMException("IndexSizeError", "IndexSizeError");
      },
    });
    expect(getSelectionRange(selection)).toBeUndefined();
  });

  it("returns the range the selection reports", () => {
    const range = document.createRange();
    const selection = document.getSelection();
    Object.defineProperty(selection, "rangeCount", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(selection, "getRangeAt", {
      configurable: true,
      value: () => range,
    });

    expect(getSelectionRange(selection)).toBe(range);
  });
});

describe("describeCfi", () => {
  it("describes the range the resolver returns, in the matched section", () => {
    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML =
      "<h2>Chapter 1</h2><p>Body of chapter one.</p><p>Body of chapter two.</p>";
    const paragraph = doc.querySelectorAll("p")[1];
    if (!paragraph) throw new Error("fixture paragraph missing");
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    // The resolver is the adapter's section-aware `getRange` (D5): a
    // chapter-two CFI must not be described with chapter one's heading.
    expect(describeCfi("epubcfi(/6/4!/4/4)", () => range)).toEqual({
      heading: "Chapter 1",
      selectedString: "Body of chapter two.",
    });
  });

  it("degrades to empty strings when the CFI cannot be resolved", () => {
    const cfi = "epubcfi(/6/2!/4/2)";
    const resolve = vi.fn(() => undefined);

    expect(describeCfi(cfi, resolve)).toEqual({
      heading: "",
      selectedString: "",
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(cfi);
  });
});
