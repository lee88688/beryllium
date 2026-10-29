import { describe, expect, it } from "vitest";
import {
  parseStoredAnchor,
  serializeAnchor,
  type PdfAnchor,
} from "@/lib/reader-anchor";

const pdfAnchor: PdfAnchor = {
  v: 1,
  pages: [
    { page: 1, quads: [[0.1, 0.2, 0.3, 0.04]] },
    { page: 2, quads: [[0, 0, 1, 0.1]] },
  ],
};

describe("reader anchors", () => {
  it("round-trips a PDF anchor through the storage string", () => {
    const stored = serializeAnchor({ type: "pdf", ...pdfAnchor });
    expect(stored.anchorType).toBe("pdf");
    expect(parseStoredAnchor(stored.anchorType, stored.anchor)).toEqual({
      type: "pdf",
      ...pdfAnchor,
    });
  });

  it("round-trips a CFI without touching it", () => {
    const stored = serializeAnchor({ type: "cfi", cfi: "epubcfi(/6/2!/4/2)" });
    expect(stored).toEqual({
      anchorType: "cfi",
      anchor: "epubcfi(/6/2!/4/2)",
    });
    expect(parseStoredAnchor("cfi", stored.anchor)).toEqual({
      type: "cfi",
      cfi: "epubcfi(/6/2!/4/2)",
    });
  });

  it("rejects malformed PDF anchors instead of throwing", () => {
    expect(parseStoredAnchor("pdf", "{")).toBeUndefined();
    expect(
      parseStoredAnchor("pdf", JSON.stringify({ v: 2, pages: [] })),
    ).toBeUndefined();
    expect(
      parseStoredAnchor(
        "pdf",
        JSON.stringify({ v: 1, pages: [{ page: -1, quads: [] }] }),
      ),
    ).toBeUndefined();
  });

  it("clamps tiny floating-point overshoot", () => {
    const parsed = parseStoredAnchor(
      "pdf",
      JSON.stringify({
        v: 1,
        pages: [{ page: 0, quads: [[-0.0001, 0, 1.0001, 0.2]] }],
      }),
    );
    expect(parsed).toEqual({
      type: "pdf",
      v: 1,
      pages: [{ page: 0, quads: [[0, 0, 1, 0.2]] }],
    });
  });
});
