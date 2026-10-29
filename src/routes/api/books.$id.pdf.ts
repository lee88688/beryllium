import { createFileRoute } from "@tanstack/react-router";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import { isRequestError } from "@/server/domain/errors";
import { parseByteRange } from "@/server/domain/range";
import { methodNotAllowed } from "@/server/method-not-allowed";
import { epubStorageFromEnv, pdfFileDir } from "@/server/services/file";
import { requireSession } from "@/server/session";

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * `GET/HEAD /api/books/:id/pdf` — the original PDF bytes, range-aware.
 *
 * pdf.js asks for 64 KiB chunks; the route never buffers the file. HEAD is
 * answered from `stat` so the client can learn the length before the first
 * range request.
 */
async function servePdf({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { user } = await requireSession();
    const bookId = Number(params.id);
    if (!Number.isInteger(bookId) || bookId <= 0) {
      return jsonError("NOT_FOUND", "书籍不存在", 404);
    }

    const book = getDb()
      .select({
        userId: Book.userId,
        fileName: Book.fileName,
        format: Book.format,
      })
      .from(Book)
      .where(eq(Book.id, bookId))
      .get();
    if (!book || book.format !== "pdf") {
      return jsonError("NOT_FOUND", "PDF 不存在", 404);
    }
    if (book.userId !== user.id) {
      return jsonError("FORBIDDEN", "无法访问他人的书籍", 403);
    }

    const filePath = pdfFileDir(book.fileName, epubStorageFromEnv());
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return jsonError("NOT_FOUND", "PDF 文件不存在", 404);
      }
      throw error;
    }

    const range = parseByteRange(request.headers.get("range"), size);
    const headers = new Headers({
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      "cache-control": "private,max-age=3600",
      vary: "cookie",
    });

    if (range === "invalid") {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(size - 1, 0);
    const length = size === 0 ? 0 : end - start + 1;
    headers.set("content-length", String(length));
    if (range !== undefined) {
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: range === undefined ? 200 : 206,
        headers,
      });
    }

    if (size === 0) {
      return new Response(null, { status: 200, headers });
    }

    const nodeStream = createReadStream(filePath, { start, end });
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: range === undefined ? 200 : 206,
      headers,
    });
  } catch (error) {
    if (isRequestError(error)) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("[api/books/pdf] read failed", error);
    return jsonError("INTERNAL", "文件读取失败，请稍后重试", 500);
  }
}

export const Route = createFileRoute("/api/books/$id/pdf")({
  server: {
    handlers: {
      ANY: () => methodNotAllowed(["GET", "HEAD"]),
      GET: servePdf,
      HEAD: servePdf,
    },
  },
});
