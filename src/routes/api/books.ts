import { createFileRoute } from "@tanstack/react-router";
import Busboy from "busboy";
import { createReadStream, createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { mkdirp } from "mkdirp";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/server/db/client";
import { isRequestError, RequestError } from "@/server/domain/errors";
import { getEnv } from "@/server/env";
import { methodNotAllowed } from "@/server/method-not-allowed";
import { assertSameOrigin } from "@/server/origin";
import { epubStorageFromEnv, saveEpubFile } from "@/server/services/file";
import { requireSession } from "@/server/session";

/** Name of the multipart field carrying the EPUB. */
const UPLOAD_FIELD = "file";

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
}

/**
 * Streams one multipart file part to `tempPath`, never buffering the whole
 * upload (PRD D5). busboy's `fileSize` limit stops feeding the write stream the
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
): Promise<void> {
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
    limits: { fileSize: maxBytes + 1, files: 1 },
  });
  const state: UploadState = {
    sawFile: false,
    overLimit: false,
    partError: undefined,
  };
  const parts: Promise<void>[] = [];
  const raw = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

  const drained = new Promise<void>((resolve, reject) => {
    busboy.on("file", (fieldName, part) => {
      if (fieldName !== UPLOAD_FIELD || state.sawFile) {
        part.resume();
        return;
      }
      state.sawFile = true;
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
}

/**
 * `POST /api/books` — multipart upload of one EPUB.
 *
 * Same-origin first (B3): a cross-site form post can carry the session cookie,
 * so it is refused before the body is even looked at. The file then lands in
 * `TEMP_DIR` (streamed, size-capped), is converted to an ASAR plus a `Book` row
 * by `saveEpubFile`, and is removed from `TEMP_DIR` on every path, success or
 * failure (D5). Unauthenticated calls never read the body.
 */
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
          const maxBytes = getEnv().MAX_UPLOAD_SIZE_MB * 1024 * 1024;
          await mkdirp(storage.tempDir);
          tempPath = path.join(storage.tempDir, `${uuidv4()}.upload`);

          await receiveUpload(request, tempPath, maxBytes);
          const book = await saveEpubFile(
            getDb(),
            userId,
            createReadStream(tempPath),
            storage,
          );
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
