import path from "node:path";
import { RequestError } from "./errors";

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:[\\/]/;

/**
 * Joins `relativePath` onto `root` and guarantees the result stays inside
 * `root`. Throws `RequestError("BAD_REQUEST")` for absolute paths, `..`
 * traversal (zip-slip), UNC/Windows-drive prefixes and NUL bytes.
 *
 * Callers: EPUB extraction (untrusted archive entry names) and anything else
 * that turns a user supplied relative path into a filesystem path.
 */
export function safeJoin(root: string, relativePath: string): string {
  if (relativePath.length === 0) {
    throw new RequestError("BAD_REQUEST", "path must not be empty");
  }
  if (relativePath.includes("\0")) {
    throw new RequestError("BAD_REQUEST", "path must not contain NUL bytes");
  }
  if (
    WINDOWS_DRIVE_PREFIX.test(relativePath) ||
    relativePath.startsWith("\\")
  ) {
    throw new RequestError(
      "BAD_REQUEST",
      `absolute path is not allowed: ${relativePath}`,
    );
  }

  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    throw new RequestError(
      "BAD_REQUEST",
      `absolute path is not allowed: ${relativePath}`,
    );
  }

  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new RequestError(
      "BAD_REQUEST",
      `path traversal is not allowed: ${relativePath}`,
    );
  }

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, normalized);
  const rootPrefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootPrefix)) {
    throw new RequestError(
      "BAD_REQUEST",
      `path escapes the target directory: ${relativePath}`,
    );
  }

  return target;
}
