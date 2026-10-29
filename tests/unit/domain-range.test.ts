import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/server/domain/range";

describe("parseByteRange", () => {
  it("returns undefined without a usable header", () => {
    expect(parseByteRange(null, 100)).toBeUndefined();
    expect(parseByteRange("bytes=0-9,20-29", 100)).toBeUndefined();
  });

  it("parses closed, open and suffix ranges", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("clamps an end past the file instead of rejecting it", () => {
    expect(parseByteRange("bytes=90-9999999", 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it("rejects malformed or unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=abc", 100)).toBe("invalid");
    expect(parseByteRange("bytes=-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=-0", 100)).toBe("invalid");
    expect(parseByteRange("bytes=100-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseByteRange("bytes=-10", 0)).toBe("invalid");
    expect(parseByteRange("bytes=0-0", 0)).toBe("invalid");
  });
});
