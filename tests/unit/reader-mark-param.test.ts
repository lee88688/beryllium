import { describe, expect, it } from "vitest";
import { parseMarkSearchParam } from "@/lib/reader-mark";

describe("parseMarkSearchParam", () => {
  it("accepts positive integer numbers and decimal strings", () => {
    expect(parseMarkSearchParam(12)).toEqual({ mark: 12 });
    expect(parseMarkSearchParam("12")).toEqual({ mark: 12 });
  });

  it("rejects zero, negatives, fractions, and non-numeric strings", () => {
    expect(parseMarkSearchParam(0)).toEqual({});
    expect(parseMarkSearchParam(-3)).toEqual({});
    expect(parseMarkSearchParam(1.5)).toEqual({});
    expect(parseMarkSearchParam("0")).toEqual({});
    expect(parseMarkSearchParam("-3")).toEqual({});
    expect(parseMarkSearchParam("12abc")).toEqual({});
    expect(parseMarkSearchParam("abc")).toEqual({});
    expect(parseMarkSearchParam(undefined)).toEqual({});
  });
});
