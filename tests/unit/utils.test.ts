import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names and drops falsy values", () => {
    expect(cn("px-2", false, undefined, "text-sm")).toBe("px-2 text-sm");
  });

  it("lets the last conflicting utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional maps", () => {
    expect(cn({ block: true, hidden: false })).toBe("block");
  });
});
