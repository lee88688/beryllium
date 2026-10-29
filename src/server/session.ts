import type { CookieStore, IronSession, SessionOptions } from "iron-session";
import { getIronSession } from "iron-session";
import { eq } from "drizzle-orm";
import { getCookie, getCookies, setCookie } from "@tanstack/react-start/server";
import { getDb } from "./db/client";
import { User } from "./db/schema";
import { RequestError } from "./domain/errors";
import { isAdmin } from "./services/user";
import { getEnv } from "./env";

/** What the sealed cookie carries. Deliberately one number, nothing else. */
export interface SessionData {
  user: {
    id: number;
  };
}

/** Cookie name from the legacy app (`sealed`), kept for compatibility. */
export const SESSION_COOKIE_NAME = "sealed";

/** Session lifetime; iron-session re-seals the cookie on every request. */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * iron-session config. `SESSION_COOKIE_SECURE` (default `false`) decides the
 * cookie's `Secure` attribute: iron-session defaults it to `true`,
 * which browsers silently drop over plain HTTP, so it must be explicit.
 *
 * `ttl` is spelled out (7 days, refreshed by each request) instead of relying
 * on iron-session's 14-day default, so the session window is a decision this
 * codebase makes rather than a library default (B5).
 */
export function sessionOptions(): SessionOptions {
  const env = getEnv();
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: env.SESSION_SECRET,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      secure: env.SESSION_COOKIE_SECURE,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  };
}

/**
 * Adapts Start's request-scoped cookie helpers to the `CookieStore` shape
 * iron-session v9 expects. `getCookie` reads the incoming `Cookie` header and
 * `setCookie` records `Set-Cookie` on the outgoing response, so a server
 * function or a route handler both read and write the same session.
 */
function startCookieStore(): CookieStore {
  return {
    get: (name) => {
      const value = getCookie(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () =>
      Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
    // iron-session owns the cookie name/value and hands over only attributes,
    // which are the same subset Start's `setCookie` serializes. Its `expires`
    // is typed `number | Date` (a legacy `cookie@2` allowance) while we only
    // ever set `maxAge`, so a numeric expiry is simply dropped.
    set: (name, value, cookie) =>
      setCookie(name, value, {
        ...cookie,
        expires: cookie.expires instanceof Date ? cookie.expires : undefined,
      }),
  };
}

/** Reads the sealed session; may be empty when nobody is logged in. */
export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(startCookieStore(), sessionOptions());
}

/**
 * Session data of the logged-in user, or `UNAUTHORIZED`.
 *
 * The cookie alone is not enough (B5): a sealed session for a since-deleted
 * account would otherwise satisfy every guard and only fail later, deep in a
 * query that has no row to update. Checking the row here turns that into a
 * clean 401 (and the UI treats it as "signed out").
 */
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  const userId = session.user?.id;
  if (typeof userId !== "number") {
    throw new RequestError("UNAUTHORIZED", "请先登录");
  }

  const exists = getDb()
    .select({ id: User.id })
    .from(User)
    .where(eq(User.id, userId))
    .get();
  if (exists === undefined) {
    session.destroy();
    throw new RequestError("UNAUTHORIZED", "登录状态已失效，请重新登录");
  }
  return { user: { id: userId } };
}

/** Session data of a logged-in administrator (`FORBIDDEN` otherwise). */
export async function requireAdmin(): Promise<SessionData> {
  const session = await requireSession();
  if (!isAdmin(getDb(), session.user.id)) {
    throw new RequestError("FORBIDDEN", "该操作需要管理员权限");
  }
  return session;
}

/** Seals `user` into the session cookie (the login path). */
export async function loginSession(user: { id: number }): Promise<void> {
  const session = await getSession();
  session.user = { id: user.id };
  await session.save();
}

/** Clears the session cookie (the logout path). */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
