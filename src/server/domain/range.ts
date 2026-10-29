export interface ByteRange {
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte. */
  end: number;
}

/**
 * Parses a single-ranged `Range` header against the file size.
 * `undefined` means "no usable header, send the whole file"; `"invalid"` maps
 * to a 416 whose `Content-Range` carries the file size (RFC 9110 §14.2).
 *
 * A multi-range request (anything with a comma) is treated as "no usable
 * header" on purpose: RFC 9110 lets a server ignore `Range`, and answering 200
 * with the whole file is friendlier than 416 for a client that asked for
 * several slices.
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "invalid" | undefined {
  if (header === null) return undefined;

  const value = header.trim();
  if (value.includes(",")) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return "invalid";
  const [, rawStart = "", rawEnd = ""] = match;

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    if (rawEnd === "") return "invalid";
    const suffix = Number(rawEnd);
    if (suffix === 0 || size === 0) return "invalid";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "invalid";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "invalid";
  return { start, end };
}
