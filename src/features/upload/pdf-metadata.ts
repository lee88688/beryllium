import type * as PdfJsModule from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfPackage, PdfTocItem } from "@/lib/pdf-package";
import {
  PDF_METADATA_PARSE_LIMIT_MB,
  PDF_METADATA_TIMEOUT_MS,
  PDF_MAX_OUTLINE_DEPTH,
  PDF_MAX_OUTLINE_NODES,
} from "@/lib/pdf-package";

interface RawOutlineItem {
  title: string;
  dest: unknown;
  items?: RawOutlineItem[];
}

type PdfJs = typeof PdfJsModule;

let pdfjsPromise: Promise<PdfJs> | undefined;

/** pdf.js is only loaded when the user picks a PDF, never on first paint. */
async function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.mjs";
    return module;
  });
  return pdfjsPromise;
}

export class PdfFileError extends Error {
  constructor(
    message: string,
    readonly kind: "password" | "invalid",
  ) {
    super(message);
    this.name = "PdfFileError";
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("PDF metadata parsing timed out"));
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** `D:YYYYMMDDHHmmSSOHH'mm'` → ISO-ish string, or `null` when unparseable. */
function normalizePdfDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(
    value,
  );
  if (!match) return null;
  const [
    ,
    year,
    month = "01",
    day = "01",
    hour = "00",
    minute = "00",
    second = "00",
  ] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 2_000) : "";
}

function optionalText(value: unknown): string | null {
  const result = text(value);
  return result === "" ? null : result.slice(0, 2_000);
}

async function resolveOutline(
  pdf: PDFDocumentProxy,
  items: readonly RawOutlineItem[] | null,
): Promise<PdfTocItem[] | null> {
  if (!items || items.length === 0) return null;

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    let target = dest;
    if (typeof target === "string") target = await pdf.getDestination(target);
    if (!Array.isArray(target) || target.length === 0) return null;
    try {
      return await pdf.getPageIndex(target[0]);
    } catch {
      return null;
    }
  };

  let nodes = 0;
  const convert = async (
    source: readonly RawOutlineItem[],
    depth: number,
  ): Promise<PdfTocItem[]> => {
    if (depth > PDF_MAX_OUTLINE_DEPTH) return [];
    const result: PdfTocItem[] = [];
    for (const item of source) {
      nodes += 1;
      if (nodes > PDF_MAX_OUTLINE_NODES) break;
      const page = await resolvePage(item.dest);
      if (page === null) continue;
      const children = item.items?.length
        ? await convert(item.items, depth + 1)
        : undefined;
      result.push({
        label: text(item.title) || `第 ${page + 1} 页`,
        page,
        ...(children && children.length > 0 ? { children } : {}),
      });
    }
    return result;
  };

  const result = await convert(items, 0);
  return result.length > 0 ? result : null;
}

/**
 * Best-effort upload-time parse. Returns `undefined` when the file is too large,
 * the parse timed out, or the worker ran out of memory. `PasswordException` and
 * invalid PDFs throw `PdfFileError` so the caller can refuse the upload.
 */
export async function parsePdfMetadata(
  file: File,
): Promise<PdfPackage | undefined> {
  if (file.size > PDF_METADATA_PARSE_LIMIT_MB * 1024 * 1024) return undefined;

  const pdfjs = await loadPdfJs();
  const transport = new pdfjs.PDFDataRangeTransport(
    file.size,
    new Uint8Array(0),
  );
  transport.requestDataRange = (begin, end) => {
    void file
      .slice(begin, end)
      .arrayBuffer()
      .then((buffer) => {
        transport.onDataRange(begin, new Uint8Array(buffer));
      })
      .catch((error: unknown) => {
        console.warn("[pdf-metadata] range read failed", error);
      });
  };

  const task = pdfjs.getDocument({
    range: transport,
    cMapUrl: "/vendor/pdfjs/cmaps/",
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/wasm/",
    isEvalSupported: false,
    disableAutoFetch: true,
  });

  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await withTimeout(task.promise, PDF_METADATA_TIMEOUT_MS, () => {
      void task.destroy();
    });
    const [{ info, metadata }, outline] = await Promise.all([
      pdf.getMetadata(),
      pdf.getOutline(),
    ]);
    const normalizedOutline = await resolveOutline(pdf, outline);
    const pageCount = pdf.numPages;
    const infoRecord = (info ?? {}) as Record<string, unknown>;

    return {
      kind: "pdf",
      v: 1,
      parsed: true,
      pageCount,
      outline: normalizedOutline,
      metadata: {
        title: text(metadata?.get("dc:title") ?? infoRecord.Title),
        author: text(metadata?.get("dc:creator") ?? infoRecord.Author),
        description: text(
          metadata?.get("dc:description") ?? infoRecord.Subject,
        ),
        language: optionalText(
          metadata?.get("dc:language") ?? infoRecord.Language,
        ),
        publisher: optionalText(metadata?.get("dc:publisher")),
        rights: optionalText(metadata?.get("dc:rights")),
        identifier: optionalText(metadata?.get("dc:identifier")),
        keywords: optionalText(infoRecord.Keywords),
        creator: optionalText(infoRecord.Creator),
        producer: optionalText(infoRecord.Producer),
        creationDate: normalizePdfDate(infoRecord.CreationDate),
        modDate: normalizePdfDate(infoRecord.ModDate),
        pdfVersion: optionalText(infoRecord.PDFFormatVersion),
      },
    };
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException" || name === "InvalidPDFException") {
      throw new PdfFileError(
        name === "PasswordException"
          ? "暂不支持加密 PDF"
          : "PDF 文件损坏或无法解析",
        name === "PasswordException" ? "password" : "invalid",
      );
    }
    console.warn("[pdf-metadata] parse skipped", error);
    return undefined;
  } finally {
    await pdf?.destroy().catch(() => undefined);
    if (!pdf) await task.destroy().catch(() => undefined);
  }
}
