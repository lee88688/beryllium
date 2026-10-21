import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { Mark } from "@/server/db/schema";

/** Ownership check used before every mark read/update/delete. */
export function userHasMark(
  db: Database,
  userId: number,
  markId: number,
): boolean {
  return (
    db
      .select({ id: Mark.id })
      .from(Mark)
      .where(and(eq(Mark.userId, userId), eq(Mark.id, markId)))
      .limit(1)
      .get() !== undefined
  );
}
