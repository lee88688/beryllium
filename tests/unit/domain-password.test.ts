import { describe, expect, it } from "vitest";
import { getPasswordHash } from "@/server/domain/password";

describe("getPasswordHash", () => {
  it("returns the sha256 hex digest of the password", () => {
    expect(getPasswordHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable and differentiates inputs", () => {
    expect(getPasswordHash("admin123")).toBe(getPasswordHash("admin123"));
    expect(getPasswordHash("admin123")).not.toBe(getPasswordHash("admin124"));
    expect(getPasswordHash("admin123")).toMatch(/^[0-9a-f]{64}$/);
  });
});
