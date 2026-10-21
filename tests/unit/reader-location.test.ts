import { describe, expect, it } from "vitest";

import { toReaderLocation, toStoredCfi } from "@/features/reader/epub/location";

describe("toStoredCfi", () => {
  it("collapses the visible-range CFI to its start point", () => {
    // foliate-js reports the range of the visible page; `Book.current` has
    // always been a single position, and both round-trip through `goTo`.
    expect(
      toStoredCfi("epubcfi(/6/26!/4/6,/200,/218[footnote]/2/2/1:67)"),
    ).toBe("epubcfi(/6/26!/4/6/200)");
  });

  it("collapses to the end when asked", () => {
    expect(toStoredCfi("epubcfi(/6/2!/4/2,/1:0,/1:5)", true)).toBe(
      "epubcfi(/6/2!/4/2/1:5)",
    );
  });
  it("degrades instead of throwing on a string that is not a CFI", () => {
    // foliate-js' parser never rejects; it answers with an empty CFI, which the
    // adapter's navigation fallback turns into the section it points at (or the
    // first section). Nothing here may throw: this value is a stored row.
    expect(toStoredCfi("not-a-cfi")).toBe("epubcfi()");
    expect(toStoredCfi("")).toBe("epubcfi()");
  });
});

describe("toReaderLocation", () => {
  it("maps a foliate-js relocation onto the reader's location shape", () => {
    const location = toReaderLocation(
      {
        cfi: "epubcfi(/6/4!/4/2,/1:0,/1:20)",
        fraction: 0.21,
        location: { current: 115, next: 116, total: 553 },
        tocItem: {
          label: "2.1 古城",
          href: "EPUB/xhtml/Section0001_0011.xhtml",
        },
      },
      12,
    );

    expect(location.start).toEqual({
      cfi: "epubcfi(/6/4!/4/2/1:0)",
      href: "EPUB/xhtml/Section0001_0011.xhtml",
      index: 12,
      location: 115,
      percentage: 0.21,
    });
    expect(location.end.location).toBe(116);
  });

  it("returns an empty location when nothing has been rendered yet", () => {
    expect(toReaderLocation(null)).toEqual({ start: {}, end: {} });
  });

  it("omits what the relocation does not carry", () => {
    const location = toReaderLocation({ cfi: "epubcfi(/6/2!/4/2)" });

    expect(location.start).toEqual({ cfi: "epubcfi(/6/2!/4/2)" });
    expect(location.end.cfi).toBe("epubcfi(/6/2!/4/2)");
  });
});
