import { MAX_PDF_SIZE_MB, type PdfPackage } from "@/lib/pdf-package";
import { PdfFileError, parsePdfMetadata } from "../upload/pdf-metadata";

/**
 * Sonner id of the "upload in progress" toast. A fixed id makes the sticky
 * progress toast a singleton: selecting a second file while the first upload is
 * still running updates the same toast instead of stacking.
 */
export const UPLOAD_TOAST_ID = "book-upload";

/** Optional multipart field carrying the browser-parsed PDF description. */
const PDF_FIELD = "pdf";

function readMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("message" in payload)) return undefined;
  const message = payload.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

function looksLikePdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * `POST /api/books` — multipart field `file` plus an optional `pdf` field.
 * Resolves with nothing on a 2xx (the shelf refetches) and throws the server's
 * `message` otherwise, so the caller can surface it (PRD D5).
 */
export async function uploadBook(file: File): Promise<void> {
  const isPdf = looksLikePdf(file);
  let pdfPackage: PdfPackage | undefined;

  if (isPdf) {
    if (file.size > MAX_PDF_SIZE_MB * 1024 * 1024) {
      throw new Error(`PDF 超过 ${MAX_PDF_SIZE_MB}MB 上限`);
    }
    try {
      pdfPackage = await parsePdfMetadata(file);
    } catch (error) {
      if (error instanceof PdfFileError) throw error;
      // Timeouts/OOM are not fatal: the server writes a degraded package and
      // the reader can still fetch page count/outline after opening.
      console.warn("[upload] PDF metadata parse skipped", error);
    }
  }

  const body = new FormData();
  body.append("file", file);
  if (pdfPackage) body.append(PDF_FIELD, JSON.stringify(pdfPackage));

  const response = await fetch("/api/books", { method: "POST", body });
  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  throw new Error(
    readMessage(payload) ?? `上传失败（HTTP ${String(response.status)}）`,
  );
}
