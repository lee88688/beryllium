import { createFileRoute } from "@tanstack/react-router";
import Busboy from "busboy";
import { createReadStream, createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { mkdirp } from "mkdirp";
import { v4 as uuidv4 } from "uuid";
import {
  degradedPdfPackage,
  PDF_FIELD_MAX_BYTES,
  pdfPackageSchema,
  titleFromFilename,
  type PdfPackage,
} from "@/lib/pdf-package";
import { getDb } from "@/server/db/client";
import { isRequestError, RequestError } from "@/server/domain/errors";
import { getEnv } from "@/server/env";
import { methodNotAllowed } from "@/server/method-not-allowed";
import { assertSameOrigin } from "@/server/origin";
import {
  epubStorageFromEnv,
  saveEpubFile,
  savePdfFile,
} from "@/server/services/file";
import { requireSession } from "@/server/session";

/** Name of the multipart field carrying the book file. */
const UPLOAD_FIELD = "file";
/** Optional browser-parsed `PdfPackage` JSON. */
const PDF_FIELD = "pdf";

/**
 * One message for every way a multipart body can fail to parse (D2): an empty
 * body when one was declared, a part that ends mid-stream, a boundary that
 * never shows up. busboy's parse errors are all request-side, so they answer
 * 400 with this text while the underlying error stays in the log.
 */
const MALFORMED_MULTIPART = "multipart 请求体不完整或格式错误";

interface UploadState {
  sawFile: boolean;
  overLimit: boolean;
  partError: unknown;
  originalName: string;
  pdfField: string | undefined;
}

interface ReceivedUpload {
  originalName: string;
  pdfField: string | undefined;
}

/**
 * Streams one multipart file part to `tempPath`, never buffering the whole
 * upload. busboy's `fileSize` limit stops feeding the write stream the
 * moment the budget is reached (one byte past the cap, see `receiveUpload`), and
 * the aborted upload is *not* drained: the part is torn down and the request
 * body dropped, so a 200 MB upload is rejected without reading it to the end.
 */
async function writePart(
  part: Readable,
  tempPath: string,
  maxBytes: number,
  onOverLimit: () => void,
): Promise<void> {
  const out = createWriteStream(tempPath);
  let overLimit = false;
  // Which stream failed decides the verdict: `part` failing is a malformed
  // upload (400, malformed message), `out` failing is a local write fault
  // (the generic 500 stays, so a disk error never looks like a bad request).
  let writeFailed = false;
  out.on("error", () => {
    writeFailed = true;
  });
  part.on("limit", () => {
    overLimit = true;
    onOverLimit();
    out.destroy();
  });

  try {
    await pipeline(part, out);
  } catch (error) {
    await finished(out).catch(() => undefined);
    // Destroying the write stream is the expected shape of "too large"; any
    // other failure is either a local write fault or a truncated part.
    if (!overLimit) {
      if (writeFailed) throw error;
      console.error("[api/books] multipart part could not be read", error);
      throw new RequestError("BAD_REQUEST", MALFORMED_MULTIPART);
    }
  }
  if (overLimit) {
    throw new RequestError(
      "PAYLOAD_TOO_LARGE",
      `文件超过 ${Math.round(maxBytes / (1024 * 1024))}MB 上限`,
    );
  }
}

/** Consumes the request body into `tempPath`, or throws a `RequestError`. */
async function receiveUpload(
  request: Request,
  tempPath: string,
  maxBytes: number,
): Promise<ReceivedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new RequestError("BAD_REQUEST", "请以 multipart/form-data 上传文件");
  }
  const body = request.body;
  if (body === null) {
    throw new RequestError("BAD_REQUEST", "请求体为空");
  }

  const busboy = Busboy({
    headers: { "content-type": contentType },
    // busboy emits `limit` the instant a part *reaches* its budget, so the
    // parser budget sits one byte past the cap: exactly `maxBytes` is accepted
    // and the first byte over it is refused (D6).
    limits: {
      fileSize: maxBytes + 1,
      files: 1,
      fields: 5,
      fieldSize: PDF_FIELD_MAX_BYTES,
    },
  });
  const state: UploadState = {
    sawFile: false,
    overLimit: false,
    partError: undefined,
    originalName: "",
    pdfField: undefined,
  };
  const parts: Promise<void>[] = [];
  const raw = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

  const drained = new Promise<void>((resolve, reject) => {
    busboy.on("field", (fieldName, value) => {
      if (fieldName === PDF_FIELD) state.pdfField = value;
    });
    busboy.on("file", (fieldName, part, info) => {
      if (fieldName !== UPLOAD_FIELD || state.sawFile) {
        part.resume();
        return;
      }
      state.sawFile = true;
      state.originalName = info.filename ?? "";
      parts.push(
        writePart(part, tempPath, maxBytes, () => {
          // The 413 verdict is already decided: stop parsing instead of
          // draining the oversized body.
          state.overLimit = true;
          busboy.destroy();
          raw.destroy();
        }).catch((error: unknown) => {
          state.partError = error;
        }),
      );
    });
    busboy.on("error", reject);
    busboy.on("close", resolve);
    raw.on("error", reject).pipe(busboy);
  });

  try {
    await drained;
  } catch (error) {
    // Tearing the parse down is how "too large" ends; that error is expected.
    if (!state.overLimit) {
      // Everything else here is request-side: a truncated body, a boundary that
      // never arrives, or a client that hung up mid-upload. busboy's error text
      // is internal, so it only reaches the log and the caller gets a 400 (D2).
      console.error("[api/books] could not parse the multipart body", error);
      throw new RequestError("BAD_REQUEST", MALFORMED_MULTIPART);
    }
  }
  await Promise.all(parts);

  if (state.overLimit) {
    throw new RequestError(
      "PAYLOAD_TOO_LARGE",
      `文件超过 ${Math.round(maxBytes / (1024 * 1024))}MB 上限`,
    );
  }
  if (state.partError !== undefined) throw state.partError;
  if (!state.sawFile) {
    throw new RequestError("BAD_REQUEST", "缺少 multipart 字段 `file`");
  }

  return { originalName: state.originalName, pdfField: state.pdfField };
}

/**
 * `POST /api/books` — multipart upload of one EPUB or PDF.
 *
 * Same-origin first (B3): a cross-site form post can carry the session cookie,
 * so it is refused before the body is even looked at. The file then lands in
 * `TEMP_DIR` (streamed, size-capped). EPUBs are converted to an ASAR plus a
 * `Book` row by `saveEpubFile`; PDFs are moved to `BOOKS_DIR` by `savePdfFile`.
 * The temp file is removed on every path, success or failure (D5).
 * Unauthenticated calls never read the body.
 */
/** Read enough bytes to distinguish an EPUB zip from a PDF header. */
async function sniffFormat(tempPath: string): Promise<"epub" | "pdf"> {
  const handle = await fsp.open(tempPath, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    // A ZIP local header is unambiguous and a valid EPUB can contain the string
    // `%PDF-` in its first entry name, so test the archive signature first.
    if (
      head.length >= 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      head[2] === 0x03 &&
      head[3] === 0x04
    ) {
      return "epub";
    }
    if (head.indexOf("%PDF-") !== -1) return "pdf";
    throw new RequestError("BAD_REQUEST", "文件不是有效的 EPUB 或 PDF");
  } finally {
    await handle.close();
  }
}

/**
 * The browser sends the parsed `PdfPackage`; the server validates its shape and
 * caps, then falls back to the explicit degraded package. A malformed field
 * never blocks an otherwise readable PDF.
 */
function readPdfPackage(
  pdfField: string | undefined,
  originalName: string,
): PdfPackage {
  if (pdfField === undefined || pdfField === "") {
    return degradedPdfPackage(titleFromFilename(originalName));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(pdfField);
  } catch {
    console.warn("[api/books] ignoring malformed `pdf` field");
    return degradedPdfPackage(titleFromFilename(originalName));
  }
  const result = pdfPackageSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      "[api/books] ignoring invalid `pdf` package",
      result.error.issues[0],
    );
    return degradedPdfPackage(titleFromFilename(originalName));
  }
  return result.data;
}

export const Route = createFileRoute("/api/books")({
  server: {
    handlers: {
      // Any other method is a client error, never the SPA shell (D1).
      ANY: () => methodNotAllowed(["POST"]),
      POST: async ({ request }: { request: Request }) => {
        let tempPath: string | undefined;

        try {
          assertSameOrigin(request);

          // `requireSession` (not `getSession`): a cookie for a since-deleted
          // account has to fail here as 401 instead of unpacking the whole
          // upload and only then failing the User foreign key (B5).
          const { user } = await requireSession();
          const userId = user.id;

          const storage = epubStorageFromEnv();
          const env = getEnv();
          const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
          await mkdirp(storage.tempDir);
          tempPath = path.join(storage.tempDir, `${uuidv4()}.upload`);

          const received = await receiveUpload(request, tempPath, maxBytes);
          const format = await sniffFormat(tempPath);

          let book;
          if (format === "pdf") {
            const size = (await fsp.stat(tempPath)).size;
            const maxPdfBytes = env.MAX_PDF_SIZE_MB * 1024 * 1024;
            if (size > maxPdfBytes) {
              throw new RequestError(
                "PAYLOAD_TOO_LARGE",
                `PDF 超过 ${env.MAX_PDF_SIZE_MB}MB 上限`,
              );
            }
            book = await savePdfFile(
              getDb(),
              userId,
              tempPath,
              received.originalName,
              readPdfPackage(received.pdfField, received.originalName),
              storage,
            );
          } else {
            book = await saveEpubFile(
              getDb(),
              userId,
              createReadStream(tempPath),
              storage,
            );
          }
          return Response.json({ book }, { status: 201 });
        } catch (error) {
          if (isRequestError(error)) {
            return Response.json(
              { error: error.code, message: error.message },
              { status: error.status },
            );
          }
          console.error("[api/books] upload failed", error);
          return Response.json(
            { error: "INTERNAL", message: "上传失败，请重试" },
            { status: 500 },
          );
        } finally {
          if (tempPath !== undefined) {
            await fsp.rm(tempPath, { force: true });
          }
        }
      },
    },
  },
});
