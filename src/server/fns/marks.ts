import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { Mark, type MarkSelect } from "@/server/db/schema";
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
  epubcfi: z.string().min(1),
  color: z.string().default(""),
  title: z.string().default(""),
  content: z.string().default(""),
  selectedString: z.string().default(""),
});

/** Creates a bookmark or highlight on one of the caller's books. */
export const addMark = createServerFn({ method: "POST" })
  .validator(inputValidator(newMarkSchema))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { user } = await requireSession();
    const db = getDb();
    if (!userHasBook(db, user.id, data.bookId)) {
      throw new RequestError("FORBIDDEN", "只能标记自己的书籍");
    }

    const mark = db
      .insert(Mark)
      .values({ ...data, userId: user.id })
      .returning({ id: Mark.id })
      .get();

    return { id: mark.id };
  });

const markPatchSchema = z.object({
  id: z.number().int(),
  color: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  selectedString: z.string().optional(),
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
