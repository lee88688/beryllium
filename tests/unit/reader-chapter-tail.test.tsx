// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterTail } from "@/features/reader/ChapterTail";
import {
  READER_TEXT_COLUMN_RATIO,
  READER_TAIL_SPACE,
} from "@/features/reader/epub/theme";
import type { ReaderBoundary } from "@/features/reader/epub/types";

afterEach(cleanup);

function boundary(overrides: Partial<ReaderBoundary> = {}): ReaderBoundary {
  return { atEnd: true, hasNext: true, nextLabel: "Chapter 2", ...overrides };
}

function renderTail(
  overrides: Partial<React.ComponentProps<typeof ChapterTail>> = {},
) {
  const onNext = vi.fn();
  const result = render(
    <ChapterTail
      boundary={boundary()}
      columnWidth={720}
      failed={false}
      onNext={onNext}
      {...overrides}
    />,
  );
  const container = document.querySelector<HTMLElement>(
    '[data-slot="chapter-tail"]',
  );
  if (!container) throw new Error("chapter tail did not render");
  return { ...result, container, onNext };
}

describe("ChapterTail", () => {
  it("stays inert and out of the a11y tree while closed", () => {
    const { container } = renderTail({ boundary: boundary({ atEnd: false }) });

    expect(container).toHaveAttribute("data-open", "false");
    expect(container).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveAttribute("inert");
    // 收起时不可聚焦，也不能被当成可点控件读到。
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("jumps to the next chapter and names it", () => {
    const { onNext } = renderTail();

    const row = screen.getByRole("button", { name: "下一章：Chapter 2" });
    expect(row).toHaveTextContent("下一章 · Chapter 2");
    fireEvent.click(row);

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bare action when the TOC has no title", () => {
    renderTail({ boundary: boundary({ nextLabel: undefined }) });

    expect(screen.getByRole("button", { name: "下一章" })).toHaveTextContent(
      "下一章",
    );
  });

  it("ends the book without offering a second exit", () => {
    renderTail({ boundary: boundary({ hasNext: false }) });

    expect(screen.getByText("全书完")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the retry reachable after a failed jump", () => {
    // 加载失败的章节会把分页器的索引弄坏，这时 hasNext 不可信：失败态要独立生效。
    const { onNext } = renderTail({
      boundary: boundary({ hasNext: false }),
      failed: true,
    });

    // 可达名称必须包含可见文字（WCAG 2.5.3）。
    const retry = screen.getByRole("button", { name: "加载失败 · 重试" });
    expect(retry).toHaveTextContent("加载失败 · 重试");
    fireEvent.click(retry);

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("matches the reading column and reserves the tail by construction", () => {
    const { container } = renderTail();
    const column = container.firstElementChild as HTMLElement;

    expect(column.style.width).toBe(
      `${String(READER_TEXT_COLUMN_RATIO * 100)}%`,
    );
    expect(column.style.maxWidth).toBe("720px");
    // 留白够一个 44px 的行加上分隔线与安全区。
    expect(READER_TAIL_SPACE).toBeGreaterThan(44);
  });
});
