import { z } from "zod";

/**
 * Reader anchors are the format-independent identity of a mark.
 *
 * EPUB stores a CFI string; PDF stores normalized quads per page. The database
 * keeps both as text (`Mark.anchor` + `Mark.anchorType`), and this module is the
 * only place that knows how to turn one into the other. Keeping the DB
 * representation opaque means the server functions never parse CFIs and the UI
 * never has to know how a PDF anchor is serialized.
 */

/** Normalized `[x, y, width, height]` relative to one rendered PDF page box. */
export type PdfQuad = readonly [number, number, number, number];

/** One page of a PDF selection. Bookmarks use an empty `quads` array. */
export type PdfPageAnchor = {
  /** 0-based page index, matching `book.sections[index]`. */
  page: number;
  quads: readonly PdfQuad[];
};

/** PDF mark anchor. `pages` is an array so a cross-page selection is one mark. */
export type PdfAnchor = {
  v: 1;
  pages: readonly PdfPageAnchor[];
};

export type ReaderAnchor =
  | { type: "cfi"; cfi: string }
  | ({ type: "pdf" } & PdfAnchor);

export type AnchorType = ReaderAnchor["type"];

export type StoredAnchor = {
  anchorType: AnchorType;
  /** CFI string for EPUB, `JSON.stringify(PdfAnchor)` for PDF. */
  anchor: string;
};

const MAX_PAGES_PER_ANCHOR = 200;
const MAX_QUADS_PER_PAGE = 1_000;
const NORMALIZED_TOLERANCE = 0.001;

const normalized = z
  .number()
  .finite()
  .min(-NORMALIZED_TOLERANCE)
  .max(1 + NORMALIZED_TOLERANCE);

const pdfQuadSchema = z.tuple([normalized, normalized, normalized, normalized]);

export const pdfPageAnchorSchema = z.object({
  page: z.number().int().min(0).max(10_000_000),
  quads: z.array(pdfQuadSchema).max(MAX_QUADS_PER_PAGE),
});

export const pdfAnchorSchema = z.object({
  v: z.literal(1),
  pages: z.array(pdfPageAnchorSchema).min(1).max(MAX_PAGES_PER_ANCHOR),
});

/** Clamp tiny floating-point overshoot from `getBoundingClientRect()`. */
function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizePdfQuad(quad: PdfQuad): PdfQuad {
  return [
    clampNormalized(quad[0]),
    clampNormalized(quad[1]),
    clampNormalized(quad[2]),
    clampNormalized(quad[3]),
  ];
}

/** `Mark.anchorType === "pdf"` → the structured anchor, or `undefined`. */
export function parseStoredAnchor(
  anchorType: AnchorType,
  stored: string,
): ReaderAnchor | undefined {
  if (anchorType === "cfi") {
    return stored === "" ? undefined : { type: "cfi", cfi: stored };
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    const result = pdfAnchorSchema.safeParse(parsed);
    if (!result.success) return undefined;
    return {
      type: "pdf",
      v: 1,
      pages: result.data.pages.map((page) => ({
        page: page.page,
        quads: page.quads.map((quad) => normalizePdfQuad(quad as PdfQuad)),
      })),
    };
  } catch {
    return undefined;
  }
}

/** The DB representation of a structured anchor. */
export function serializeAnchor(anchor: ReaderAnchor): StoredAnchor {
  if (anchor.type === "cfi") {
    return { anchorType: "cfi", anchor: anchor.cfi };
  }
  return {
    anchorType: "pdf",
    anchor: JSON.stringify({ v: anchor.v, pages: anchor.pages }),
  };
}
