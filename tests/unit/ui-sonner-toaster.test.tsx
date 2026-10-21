// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "@/components/sonner-toaster";
import { ThemeModeProvider } from "@/components/theme-provider";

beforeEach(() => {
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
  toast.dismiss();
  vi.unstubAllGlobals();
});

describe("Toaster", () => {
  it("renders module-level toasts (notistack replacement)", async () => {
    render(
      <ThemeModeProvider initialMode="dark">
        <Toaster />
      </ThemeModeProvider>,
    );

    act(() => {
      toast.error("上传失败");
    });

    expect(await screen.findByText("上传失败")).toBeInTheDocument();
  });
});
