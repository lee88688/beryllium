import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { User } from "@/server/db/schema";
import { getPasswordHash } from "@/server/domain/password";
import { createSlidingWindowLimiter } from "@/server/domain/rate-limit";
import { destroySession, getSession, loginSession } from "@/server/session";
import { inputValidator } from "./input";

export const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Throttle budget per `username + IP` (B2): 20 failed attempts per 15 minutes. */
const LOGIN_FAILURE_LIMIT = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = createSlidingWindowLimiter(
  LOGIN_FAILURE_LIMIT,
  LOGIN_WINDOW_MS,
);

/**
 * Where the request came from, for throttling. `server.mjs` stamps
 * `x-client-ip` from the TCP peer before the Start handler sees the request
 * (overwriting anything the client sent), so that value is trustworthy;
 * `x-forwarded-for` is the fallback for tests and for deployments that put a
 * proxy in front without the stamp.
 */
function clientIp(request: Request): string {
  const stamped = request.headers.get("x-client-ip");
  if (stamped !== null && stamped !== "") return stamped;

  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : "unknown";
}

/**
 * Signs a user in. Bad credentials are a *result*, not a throw: the
 * login form must be able to show the message it gets back.
 *
 * Throttled per `username + IP` (B2): after 20 *failed* attempts in 15 minutes
 * the answer is a 429 with a "try later" message instead of unlimited guessing.
 * Only failures are counted, so a busy legitimate session (and the e2e suite,
 * which signs in repeatedly) never throttles itself. Every failure is audited
 * to the server log.
 */
export const login = createServerFn({ method: "POST" })
  .validator(inputValidator(credentialsSchema))
  .handler(async ({ data }) => {
    const ip = clientIp(getRequest());
    const throttleKey = `${data.username}|${ip}`;

    if (loginFailures.count(throttleKey) >= LOGIN_FAILURE_LIMIT) {
      setResponseStatus(429);
      console.warn(
        `[auth] throttled login for ${data.username} from ${ip}: more than ${LOGIN_FAILURE_LIMIT} failed attempts in ${LOGIN_WINDOW_MS / 60000} minutes`,
      );
      return {
        ok: false as const,
        message: "登录尝试过于频繁，请 15 分钟后再试",
      };
    }

    const user = getDb()
      .select({
        id: User.id,
        username: User.username,
        isAdmin: User.isAdmin,
      })
      .from(User)
      .where(
        and(
          eq(User.username, data.username),
          eq(User.password, getPasswordHash(data.password)),
        ),
      )
      .get();

    if (!user) {
      loginFailures.record(throttleKey);
      console.warn(`[auth] failed login for ${data.username} from ${ip}`);
      return { ok: false as const, message: "用户名或密码不正确" };
    }

    // A legitimate sign-in clears its own budget; guessing is keyed by username
    // anyway, so one account's success cannot un-throttle another's.
    loginFailures.reset(throttleKey);
    await loginSession({ id: user.id });
    return { ok: true as const, user };
  });

/** Clears the session cookie; safe to call without a session. */
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
  return { ok: true as const };
});

/**
 * Session probe for the client-side route guards. `null` means "not signed
 * in" — this is a question, not a protected resource, so it does not throw
 * `UNAUTHORIZED` like `requireSession` does.
 */
export const me = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getSession();
  const userId = session.user?.id;
  if (typeof userId !== "number") return null;

  return (
    getDb()
      .select({
        id: User.id,
        username: User.username,
        isAdmin: User.isAdmin,
      })
      .from(User)
      .where(eq(User.id, userId))
      .get() ?? null
  );
});
