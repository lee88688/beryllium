import { describe, expect, it } from "vitest";
import {
  degradedPdfPackage,
  PDF_MAX_OUTLINE_DEPTH,
  PDF_MAX_PAGES,
  pdfPackageSchema,
  titleFromFilename,
} from "@/lib/pdf-package";

const metadata = {
  title: "Sample PDF",
  author: "Author",
  description: "Desc",
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

describe("PdfPackage", () => {
  it("builds a degraded package without a page count or outline", () => {
    expect(degradedPdfPackage("fallback")).toMatchObject({
      kind: "pdf",
      v: 1,
      parsed: false,
      pageCount: null,
      outline: null,
      metadata: { title: "fallback", author: "", description: "" },
    });
  });

  it("accepts a complete package with outline targets inside the document", () => {
    const result = pdfPackageSchema.safeParse({
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount: 3,
      outline: [
        { label: "Chapter 1", page: 1, children: [{ label: "1.1", page: 1 }] },
      ],
      metadata,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an outline page outside the page count", () => {
    const result = pdfPackageSchema.safeParse({
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount: 3,
      outline: [{ label: "Missing", page: 3 }],
      metadata,
    });
    expect(result.success).toBe(false);
  });

  it("derives a usable title from a filename", () => {
    expect(titleFromFilename("C:\\books\\My Book.pdf")).toBe("My Book");
    expect(titleFromFilename(" .pdf ")).toBe("未命名文档");
  });
});

describe("degraded package invariants", () => {
  it("rejects a page count or outline on a skipped parse", () => {
    for (const value of [
      { pageCount: 3, outline: null },
      { pageCount: null, outline: [{ label: "x", page: 0 }] },
    ]) {
      const result = pdfPackageSchema.safeParse({
        kind: "pdf",
        v: 1,
        parsed: false,
        metadata,
        ...value,
      });
      expect(result.success).toBe(false);
    }
  });
});

describe("package limits", () => {
  it("accepts the exact degraded package it writes", () => {
    expect(pdfPackageSchema.safeParse(degradedPdfPackage("x")).success).toBe(
      true,
    );
  });

  it("rejects a parsed package without a page count", () => {
    const result = pdfPackageSchema.safeParse({
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount: null,
      outline: null,
      metadata,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a page count above the rendering cap", () => {
    const result = pdfPackageSchema.safeParse({
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount: PDF_MAX_PAGES + 1,
      outline: null,
      metadata,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an outline deeper than the cap", () => {
    let item: { label: string; page: number; children?: unknown[] } = {
      label: "leaf",
      page: 1,
    };
    for (let index = 0; index <= PDF_MAX_OUTLINE_DEPTH; index += 1) {
      item = { label: `level ${index}`, page: 1, children: [item] };
    }
    const result = pdfPackageSchema.safeParse({
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount: 3,
      outline: [item],
      metadata,
    });
    expect(result.success).toBe(false);
  });
});
