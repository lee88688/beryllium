export { cn } from "cn";

/**
 * Toast text for a failed server-function / REST call. TanStack Start rethrows
 * server `RequestError`s as `Error`s that carry the original `message`, which is
 * the only part the UI shows (migration plan §5.1).
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "操作失败，请重试";
}
