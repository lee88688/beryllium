/**
 * Sonner id of the "upload in progress" toast. A fixed id makes the sticky
 * progress toast a singleton: selecting a second file while the first upload is
 * still running updates the same toast instead of stacking.
 */
export const UPLOAD_TOAST_ID = "book-upload";

function readMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("message" in payload)) return undefined;
  const message = payload.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

/**
 * `POST /api/books` — multipart field `file` (localhost://migration-plan.md §5.2).
 * Resolves with nothing on a 2xx (the shelf refetches) and throws the server's
 * `message` otherwise, so the caller can surface it (PRD D5).
 */
export async function uploadEpub(file: File): Promise<void> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/books", { method: "POST", body });
  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  throw new Error(
    readMessage(payload) ?? `上传失败（HTTP ${String(response.status)}）`,
  );
}
