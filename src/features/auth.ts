/**
 * The signed-in account, as returned by the `me()` server function
 * (`src/server/fns/session.ts`). Declared client-side because route guards must
 * not reach into server-only modules; `me()` returns exactly this shape.
 */
export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}
