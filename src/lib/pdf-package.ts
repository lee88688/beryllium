import { z } from "zod";

/**
 * Parsed description of a PDF, stored in `Book.content` next to the EPUB OPF
 * package. It contains only immutable, upload-time facts: page count, outline
 * and document-info metadata. Reader state (position, zoom, marks) never lives
 * here.
 */

export interface PdfTocItem {
  label: string;
  /** 0-based page index resolved from the outline destination. */
  page: number;
  children?: PdfTocItem[];
}

export interface PdfMetadata {
  title: string;
  author: string;
  description: string;
  language: string | null;
  publisher: string | null;
  rights: string | null;
  identifier: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modDate: string | null;
  pdfVersion: string | null;
}

export interface PdfPackage {
  kind: "pdf";
  v: 1;
  /** `false` when the upload-time parse was skipped or failed. */
  parsed: boolean;
  pageCount: number | null;
  outline: PdfTocItem[] | null;
  metadata: PdfMetadata;
}

/** Client-side guards; the server repeats the limit from its own env. */
export const MAX_PDF_SIZE_MB = 100;
export const PDF_METADATA_PARSE_LIMIT_MB = 64;
export const PDF_METADATA_TIMEOUT_MS = 8_000;
export const PDF_FIELD_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_MAX_OUTLINE_NODES = 5_000;
export const PDF_MAX_OUTLINE_DEPTH = 20;
export const PDF_MAX_PAGES = 5_000;

const shortText = z.string().max(2_000);
const optionalText = shortText.nullable();

const pdfMetadataSchema = z.object({
  title: shortText,
  author: shortText,
  description: shortText,
  language: optionalText,
  publisher: optionalText,
  rights: optionalText,
  identifier: optionalText,
  keywords: optionalText,
  creator: optionalText,
  producer: optionalText,
  creationDate: optionalText,
  modDate: optionalText,
  pdfVersion: optionalText,
});

export const pdfTocItemSchema: z.ZodType<PdfTocItem> = z.lazy(() =>
  z.object({
    label: shortText,
    page: z.number().int().min(0).max(10_000_000),
    children: z.array(pdfTocItemSchema).optional(),
  }),
);

/** Walk the outline once; used for the node/depth caps and page checks. */
function outlineFits(items: readonly PdfTocItem[], pageCount: number): boolean {
  let nodes = 0;

  const visit = (
    nodesToVisit: readonly PdfTocItem[],
    depth: number,
  ): boolean => {
    if (depth > PDF_MAX_OUTLINE_DEPTH) return false;
    for (const item of nodesToVisit) {
      nodes += 1;
      if (nodes > PDF_MAX_OUTLINE_NODES) return false;
      if (item.page >= pageCount) return false;
      if (item.children && !visit(item.children, depth + 1)) return false;
    }
    return true;
  };

  return visit(items, 0);
}

export const pdfPackageSchema = z
  .object({
    kind: z.literal("pdf"),
    v: z.literal(1),
    parsed: z.boolean(),
    pageCount: z.number().int().min(0).max(PDF_MAX_PAGES).nullable(),
    outline: z.array(pdfTocItemSchema).nullable(),
    metadata: pdfMetadataSchema,
  })
  .superRefine((value, context) => {
    if (!value.parsed) {
      if (value.pageCount !== null || value.outline !== null) {
        context.addIssue({
          code: "custom",
          path: ["parsed"],
          message:
            "a degraded PDF package cannot carry a page count or outline",
        });
      }
      return;
    }
    if (value.pageCount === null) {
      context.addIssue({
        code: "custom",
        path: ["pageCount"],
        message: "parsed PDF package requires a page count",
      });
      return;
    }
    if (
      value.outline !== null &&
      !outlineFits(value.outline, value.pageCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outline"],
        message: "outline is too large, too deep, or references a missing page",
      });
    }
  });

export function emptyPdfMetadata(): PdfMetadata {
  return {
    title: "",
    author: "",
    description: "",
    language: null,
    publisher: null,
    rights: null,
    identifier: null,
    keywords: null,
    creator: null,
    producer: null,
    creationDate: null,
    modDate: null,
    pdfVersion: null,
  };
}

/**
 * The package written when the upload-time parse did not produce a full
 * description. `content` is NOT NULL, so this is the explicit degraded value.
 */
export function degradedPdfPackage(title: string): PdfPackage {
  return {
    kind: "pdf",
    v: 1,
    parsed: false,
    pageCount: null,
    outline: null,
    metadata: { ...emptyPdfMetadata(), title: title.slice(0, 2_000) },
  };
}

/** Title fallback for uploads without parsed metadata. */
export function titleFromFilename(filename: string): string {
  const withoutDirectory = (filename.split(/[\\/]/).pop() ?? "").trim();
  const withoutSuffix = withoutDirectory.replace(/\.pdf$/i, "");
  let cleaned = "";
  for (const character of withoutSuffix) {
    if ((character.codePointAt(0) ?? 0) >= 0x20) cleaned += character;
  }
  cleaned = cleaned.trim();
  return cleaned === "" ? "未命名文档" : cleaned.slice(0, 2_000);
}
