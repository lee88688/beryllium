// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NestedList, type NestedItem } from "@/components/nested-list";

afterEach(cleanup);

const ITEMS: NestedItem[] = [
  {
    id: "chapter-1",
    label: "Chapter 1",
    children: [
      { id: "section-1", label: "Section 1" },
      {
        id: "chapter-1-1",
        label: "Chapter 1.1",
        children: [{ id: "section-2", label: "Section 2" }],
      },
    ],
  },
  { id: "chapter-2", label: "Chapter 2" },
];

describe("NestedList", () => {
  it("renders the top level collapsed and expands on demand", () => {
    render(<NestedList items={ITEMS} onSelect={() => {}} />);

    expect(screen.getByText("Chapter 1")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    expect(screen.queryByText("Section 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Chapter 1" }));

    expect(screen.getByText("Section 1")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1.1")).toBeInTheDocument();
    // one level deeper stays collapsed
    expect(screen.queryByText("Section 2")).not.toBeInTheDocument();
  });

  it("collapses an expanded node again", () => {
    render(<NestedList items={ITEMS} onSelect={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "展开 Chapter 1" }));
    expect(screen.getByText("Section 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠 Chapter 1" }));
    expect(screen.queryByText("Section 1")).not.toBeInTheDocument();
  });

  it("calls onSelect with the clicked node", () => {
    const onSelect = vi.fn();
    render(<NestedList items={ITEMS} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Chapter 2"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "chapter-2", label: "Chapter 2" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "展开 Chapter 1" }));
    fireEvent.click(screen.getByText("Section 1"));

    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "section-1" }),
    );
  });

  it("highlights selectedId and auto-opens its ancestors", () => {
    render(
      <NestedList items={ITEMS} selectedId="section-2" onSelect={() => {}} />,
    );

    const selected = screen.getByRole("button", { name: "Section 2" });
    expect(selected).toBeInTheDocument();
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected).toHaveAttribute("data-selected", "true");

    expect(
      screen.getByRole("button", { name: "Chapter 1.1" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the clicked node as current when uncontrolled", () => {
    render(<NestedList items={ITEMS} onSelect={() => {}} />);

    fireEvent.click(screen.getByText("Chapter 2"));

    expect(screen.getByRole("button", { name: "Chapter 2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
