import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { User } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import {
  changePassword as changeStoredPassword,
  createUser,
  deleteUser,
} from "@/server/services/user";
import { requireAdmin, requireSession } from "@/server/session";
import { inputValidator } from "./input";

/** All accounts; the password column never leaves the server. */
export const getUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return getDb()
    .select({ id: User.id, username: User.username, isAdmin: User.isAdmin })
    .from(User)
    .orderBy(User.id)
    .all();
});

const newUserSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(6),
  isAdmin: z.boolean().optional(),
});

/** Creates an account (admin only). */
export const addUser = createServerFn({ method: "POST" })
  .validator(inputValidator(newUserSchema))
  .handler(async ({ data }) => {
    await requireAdmin();
    const db = getDb();

    const existing = db
      .select({ id: User.id })
      .from(User)
      .where(eq(User.username, data.username))
      .get();
    if (existing) {
      throw new RequestError("BAD_REQUEST", `用户名 ${data.username} 已存在`);
    }

    const user = createUser(db, {
      username: data.username,
      password: data.password,
      isAdmin: data.isAdmin ?? false,
    });
    return { id: user.id, username: user.username, isAdmin: user.isAdmin };
  });

/** Deletes an account and everything it owns (admin only, service cleanup). */
export const removeUser = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ id: z.number().int() })))
  .handler(async ({ data }) => {
    await requireAdmin();
    const db = getDb();

    const user = db
      .select({ id: User.id, isAdmin: User.isAdmin })
      .from(User)
      .where(and(eq(User.id, data.id)))
      .get();
    if (!user) throw new RequestError("NOT_FOUND", "用户不存在");
    // An administrator account is never deletable (B4): the target would
    // otherwise include the caller and the last admin, locking the instance out
    // of `/setting` with no way back in through the UI.
    if (user.isAdmin) {
      throw new RequestError("FORBIDDEN", "无法删除管理员账号");
    }

    await deleteUser(db, user.id);
    return { id: user.id };
  });

const passwordSchema = z.object({
  newPassword: z.string(),
  confirmPassword: z.string(),
});

/**
 * Changes the caller's own password. The service hashes it and compares the
 * two entries (D2/D3), so both failures arrive as `BAD_REQUEST`.
 */
export const changePassword = createServerFn({ method: "POST" })
  .validator(inputValidator(passwordSchema))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    changeStoredPassword(getDb(), user.id, data);
    return { ok: true as const };
  });
