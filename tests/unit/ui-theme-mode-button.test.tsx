// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeModeButton } from "@/components/theme-mode-button";
import { ThemeModeProvider } from "@/components/theme-provider";

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeModeButton", () => {
  it("shows the current mode as disabled and switches on click", () => {
    render(
      <ThemeModeProvider initialMode="auto">
        <ThemeModeButton />
      </ThemeModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "主题：跟随系统" }));

    const dark = screen.getByRole("menuitem", { name: "深色" });
    const auto = screen.getByRole("menuitem", { name: "跟随系统" });
    expect(auto).toHaveAttribute("aria-disabled", "true");
    expect(auto).toHaveAttribute("data-disabled");
    expect(dark).not.toHaveAttribute("data-disabled");

    fireEvent.click(dark);

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
