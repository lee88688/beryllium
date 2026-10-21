import { describe, expect, it } from "vitest";

import {
  createRect,
  keyboardAnchorRect,
  rectFromClientRect,
  toVirtualAnchor,
} from "@/features/reader/geometry";

describe("reader geometry", () => {
  it("builds a rect with derived edges", () => {
    expect(createRect(10, 20, 100, 30)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      top: 20,
      right: 110,
      bottom: 50,
      left: 10,
    });
  });

  it("maps DOM rects (including jsdom's zero rects) to plain rects", () => {
    expect(
      rectFromClientRect({ left: 5, top: 6, width: 7, height: 8 }),
    ).toEqual(createRect(5, 6, 7, 8));
  });

  describe("virtual keyboard anchor", () => {
    it("docks a zero-width anchor just above the keyboard", () => {
      expect(
        keyboardAnchorRect({
          viewportWidth: 400,
          viewportHeight: 800,
          keyboardHeight: 300,
          anchorHeight: 40,
        }),
      ).toEqual(createRect(200, 460, 0, 40));
    });

    it("defaults the anchor height to zero", () => {
      expect(
        keyboardAnchorRect({
          viewportWidth: 400,
          viewportHeight: 800,
          keyboardHeight: 300,
        }),
      ).toEqual(createRect(200, 500, 0, 0));
    });

    it("never produces a negative offset when the keyboard exceeds the viewport", () => {
      expect(
        keyboardAnchorRect({
          viewportWidth: 400,
          viewportHeight: 800,
          keyboardHeight: 900,
          anchorHeight: 100,
        }),
      ).toEqual(createRect(200, 0, 0, 100));
    });
  });

  describe("virtual anchor", () => {
    it("is undefined without a rect", () => {
      expect(toVirtualAnchor(undefined)).toBeUndefined();
    });

    it("returns the very same rect on every measurement", () => {
      const rect = createRect(1, 2, 3, 4);
      const anchor = toVirtualAnchor(rect);

      expect(anchor?.getBoundingClientRect()).toBe(rect);
      expect(anchor?.getBoundingClientRect()).toEqual(rect);
    });
  });
});
