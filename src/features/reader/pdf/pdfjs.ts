import type * as PdfJs from "pdfjs-dist";

export const PDF_ASSETS = {
  worker: "/vendor/pdfjs/pdf.worker.mjs",
  cmaps: "/vendor/pdfjs/cmaps/",
  standardFonts: "/vendor/pdfjs/standard_fonts/",
  wasm: "/vendor/pdfjs/wasm/",
} as const;

let pdfjsPromise: Promise<typeof PdfJs> | undefined;

/**
 * pdf.js is imported lazily: the EPUB reader and the bookshelf must not pay for
 * the ~800 KB core or its worker. Only the PDF viewer and the upload metadata
 * parser call this.
 */
export function loadPdfJs(): Promise<typeof PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = PDF_ASSETS.worker;
    return module;
  });
  return pdfjsPromise;
}
