// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SelectionPopover,
  selectionBubblePlacement,
} from "@/features/reader/editor/SelectionPopover";
import { createRect } from "@/features/reader/geometry";

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function stubPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("selectionBubblePlacement", () => {
  it("sits above the selection on precise pointers", () => {
    expect(selectionBubblePlacement(false)).toEqual({ side: "top", gap: 8 });
  });

  it("drops below the selection on touch, clearing the native handles", () => {
    // Android Chrome draws the action-mode toolbar directly above the selection
    // and the drag handles at its ends, so the bubble has to hang below with
    // enough room for both.
    expect(selectionBubblePlacement(true)).toEqual({ side: "bottom", gap: 32 });
  });
});

describe("SelectionPopover", () => {
  it("renders the bubble on the side the pointer type asks for", () => {
    stubPointer(true);
    render(
      <SelectionPopover
        open
        onOpenChange={() => {}}
        rect={createRect(100, 200, 120, 24)}
      >
        <button type="button">red</button>
      </SelectionPopover>,
    );

    const popup = document.querySelector("[data-slot='popover-content']");
    expect(popup).not.toBeNull();
    expect(popup).toHaveAttribute("data-side", "bottom");
    expect(popup).toHaveTextContent("red");
  });
});
