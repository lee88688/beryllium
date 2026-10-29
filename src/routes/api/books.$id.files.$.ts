import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { lookup } from "mime-types";
import { getDb } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import { isRequestError } from "@/server/domain/errors";
import { parseByteRange } from "@/server/domain/range";
import { methodNotAllowed } from "@/server/method-not-allowed";
import { assertSameOrigin } from "@/server/origin";
import {
  asarFileDir,
  epubStorageFromEnv,
  readAsarFile,
} from "@/server/services/file";
import { requireSession } from "@/server/session";

/**
 * Member types that execute when navigated to directly. The reader fetches
 * them and foliate-js re-serialises the markup into a `blob:` URL for a
 * sandboxed iframe, so a sandboxed CSP costs the reader nothing while defusing
 * "open this book file in a tab" (B8).
 */
const SANDBOXED_MEMBER_TYPES: Record<string, true> = {
  "text/html": true,
  "application/xhtml+xml": true,
  "image/svg+xml": true,
};

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Cache policy per member (B7). Text/fonts stay one hour: a logged-out reader
 * must not be able to replay whole chapters from the disk cache. Images (covers
 * and inline art) keep the immutable one-year cache the bookshelf relies on.
 */
function cacheControlFor(contentType: string): string {
  return contentType.startsWith("image/")
    ? "private,max-age=31536000,immutable"
    : "private,max-age=3600";
}

async function serveBookFile({
  request,
  params,
}: {
  request: Request;
  params: { id: string; _splat: string };
}): Promise<Response> {
  try {
    assertSameOrigin(request);

    // `requireSession` (not `getSession`): a cookie for a since-deleted account
    // must fail here as 401 rather than pass every guard and 404 later (B5).
    const { user } = await requireSession();
    const userId = user.id;

    const bookId = Number(params.id);
    const filePath = params._splat ?? "";
    if (!Number.isInteger(bookId) || filePath === "") {
      return jsonError("NOT_FOUND", "文件不存在", 404);
    }

    const book = getDb()
      .select({ id: Book.id, userId: Book.userId, fileName: Book.fileName })
      .from(Book)
      .where(eq(Book.id, bookId))
      .get();
    if (!book) return jsonError("NOT_FOUND", "书籍不存在", 404);
    // IDOR fix (migration plan §5.2): a book belongs to exactly one reader.
    if (book.userId !== userId) {
      return jsonError("FORBIDDEN", "无法访问他人的书籍", 403);
    }

    const file = await readAsarFile(
      asarFileDir(book.fileName, epubStorageFromEnv()),
      filePath,
    );

    const contentType = lookup(filePath) || "application/octet-stream";
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": cacheControlFor(contentType),
      "accept-ranges": "bytes",
    });
    if (
      Object.hasOwn(SANDBOXED_MEMBER_TYPES, contentType.split(";")[0] ?? "")
    ) {
      headers.set("content-security-policy", "default-src 'none'; sandbox");
    }

    const range = parseByteRange(request.headers.get("range"), file.byteLength);
    if (range === "invalid") {
      headers.set("content-range", `bytes */${file.byteLength}`);
      return new Response(null, { status: 416, headers });
    }

    const slice =
      range === undefined ? file : file.subarray(range.start, range.end + 1);
    headers.set("content-length", String(slice.byteLength));
    if (range !== undefined) {
      headers.set(
        "content-range",
        `bytes ${range.start}-${range.end}/${file.byteLength}`,
      );
    }

    // HEAD answers with the same headers and no body.
    const body =
      request.method === "HEAD"
        ? null
        : new Uint8Array(
            slice.buffer as ArrayBuffer,
            slice.byteOffset,
            slice.byteLength,
          );
    return new Response(body, {
      status: range === undefined ? 200 : 206,
      headers,
    });
  } catch (error) {
    if (isRequestError(error)) {
      return jsonError(error.code, error.message, error.status);
    }
    // Anything else is a genuine server fault; its message may name an absolute
    // path or SQLite internals, so only the log sees it (B9/B10).
    console.error("[api/books/files] read failed", error);
    return jsonError("INTERNAL", "文件读取失败，请稍后重试", 500);
  }
}

export const Route = createFileRoute("/api/books/$id/files/$")({
  server: {
    handlers: {
      // Any other method is a client error, never the SPA shell (D1).
      ANY: () => methodNotAllowed(["GET", "HEAD"]),
      GET: serveBookFile,
      HEAD: serveBookFile,
    },
  },
});
