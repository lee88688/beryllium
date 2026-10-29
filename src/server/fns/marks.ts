import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { pdfAnchorSchema, type AnchorType } from "@/lib/reader-anchor";
import { getDb } from "@/server/db/client";
import { Book, Mark, type MarkSelect } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import { userHasBook } from "@/server/services/book";
import { userHasMark } from "@/server/services/mark";
import { requireSession } from "@/server/session";
import { inputValidator } from "./input";

/** Book-scoped marks of the logged-in user. */
export const getMarks = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ bookId: z.number().int() })))
  .handler(async ({ data }): Promise<MarkSelect[]> => {
    const { user } = await requireSession();
    const db = getDb();
    if (!userHasBook(db, user.id, data.bookId)) {
      throw new RequestError("NOT_FOUND", "书籍不存在");
    }

    return db
      .select()
      .from(Mark)
      .where(and(eq(Mark.bookId, data.bookId), eq(Mark.userId, user.id)))
      .orderBy(Mark.id)
      .all();
  });

const newMarkSchema = z.object({
  bookId: z.number().int(),
  type: z.enum(["bookmark", "highlight"]),
  anchorType: z.enum(["cfi", "pdf"]),
  anchor: z
    .string()
    .min(1)
    .max(64 * 1024),
  color: z.string().max(32).default(""),
  title: z.string().max(500).default(""),
  content: z.string().max(10_000).default(""),
  selectedString: z.string().max(20_000).default(""),
});

/** Format-aware anchor validation; the client sends the storage string. */
function assertAnchorMatchesBook(
  book: { format: "epub" | "pdf"; content: unknown },
  anchorType: AnchorType,
  anchor: string,
): void {
  if (book.format === "epub") {
    if (anchorType !== "cfi") {
      throw new RequestError("BAD_REQUEST", "PDF 锚点不能用于 EPUB 标记");
    }
    return;
  }
  if (anchorType !== "pdf") {
    throw new RequestError("BAD_REQUEST", "CFI 不能用于 PDF 标记");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(anchor);
  } catch {
    throw new RequestError("BAD_REQUEST", "PDF 锚点不是合法 JSON");
  }
  const result = pdfAnchorSchema.safeParse(parsed);
  if (!result.success) {
    throw new RequestError("BAD_REQUEST", "PDF 锚点格式不合法");
  }
  const pageCount =
    typeof book.content === "object" &&
    book.content !== null &&
    "kind" in book.content &&
    book.content.kind === "pdf" &&
    "pageCount" in book.content &&
    typeof book.content.pageCount === "number"
      ? book.content.pageCount
      : null;
  if (
    pageCount !== null &&
    result.data.pages.some((page) => page.page >= pageCount)
  ) {
    throw new RequestError("BAD_REQUEST", "PDF 锚点页码超出总页数");
  }
}

/** Creates a bookmark or highlight on one of the caller's books. */
export const addMark = createServerFn({ method: "POST" })
  .validator(inputValidator(newMarkSchema))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { user } = await requireSession();
    const db = getDb();
    if (!userHasBook(db, user.id, data.bookId)) {
      throw new RequestError("FORBIDDEN", "只能标记自己的书籍");
    }

    const book = db
      .select({
        format: Book.format,
        content: Book.content,
      })
      .from(Book)
      .where(and(eq(Book.id, data.bookId), eq(Book.userId, user.id)))
      .get();
    if (!book) throw new RequestError("NOT_FOUND", "书籍不存在");
    assertAnchorMatchesBook(book, data.anchorType, data.anchor);

    const mark = db
      .insert(Mark)
      .values({ ...data, userId: user.id })
      .returning({ id: Mark.id })
      .get();

    return { id: mark.id };
  });

const markPatchSchema = z.object({
  id: z.number().int(),
  color: z.string().max(32).optional(),
  title: z.string().max(500).optional(),
  content: z.string().max(10_000).optional(),
  selectedString: z.string().max(20_000).optional(),
});

/** Applies the fields present in the patch; an empty patch writes nothing. */
export const updateMark = createServerFn({ method: "POST" })
  .validator(inputValidator(markPatchSchema))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { user } = await requireSession();
    const db = getDb();
    if (!userHasMark(db, user.id, data.id)) {
      throw new RequestError("NOT_FOUND", "标记不存在");
    }

    const patch: Partial<Omit<MarkSelect, "id" | "bookId" | "userId">> = {};
    if (data.color !== undefined) patch.color = data.color;
    if (data.title !== undefined) patch.title = data.title;
    if (data.content !== undefined) patch.content = data.content;
    if (data.selectedString !== undefined) {
      patch.selectedString = data.selectedString;
    }

    if (Object.keys(patch).length > 0) {
      db.update(Mark).set(patch).where(eq(Mark.id, data.id)).run();
    }

    return { id: data.id };
  });

/** Deletes one of the caller's marks (D15 rollback path). */
export const removeMark = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ id: z.number().int() })))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();
    if (!userHasMark(db, user.id, data.id)) {
      throw new RequestError("NOT_FOUND", "标记不存在");
    }

    db.delete(Mark).where(eq(Mark.id, data.id)).run();
    return { id: data.id };
  });
