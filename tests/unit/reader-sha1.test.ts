import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha1Bytes } from "@/features/reader/epub/sha1";

const encode = (text: string) => new TextEncoder().encode(text);

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

describe("sha1Bytes", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(hex(sha1Bytes(encode("")))).toBe(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
    expect(hex(sha1Bytes(encode("abc")))).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
    expect(
      hex(
        sha1Bytes(
          encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        ),
      ),
    ).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });

  it("agrees with the platform implementation around block boundaries", () => {
    // Independent implementation (node:crypto), so this pins the padding rules
    // rather than re-running ours: 55/56 bytes straddle the length field, and
    // the longer inputs exercise several blocks.
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const text = "a".repeat(length);
      expect(hex(sha1Bytes(encode(text)))).toBe(
        createHash("sha1").update(text).digest("hex"),
      );
    }
  });

  it("returns exactly 20 bytes", () => {
    expect(sha1Bytes(encode("abc"))).toHaveLength(20);
  });
});
