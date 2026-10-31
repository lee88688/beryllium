// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMarkSearch } from "@/features/bookshelf/search/use-mark-search";
import { searchMarks } from "@/server/fns/search";

vi.mock("@/server/fns/search", () => ({
  searchMarks: vi.fn(),
  searchMarkHits: vi.fn(),
}));

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMarkSearch debounce", () => {
  it("does not query short or unsettled input", async () => {
    vi.mocked(searchMarks).mockResolvedValue({
      groups: [],
      totals: { books: 0, notes: 0, bookmarks: 0 },
    });

    const { rerender } = renderHook(
      ({ query }: { query: string }) => useMarkSearch(query),
      { initialProps: { query: "三" }, wrapper },
    );

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(searchMarks).not.toHaveBeenCalled();

    rerender({ query: "三体" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(searchMarks).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(searchMarks).toHaveBeenCalledTimes(1);
    expect(searchMarks).toHaveBeenCalledWith({
      data: { query: "三体", groupOffset: 0, groupLimit: 30 },
    });
  });
});
