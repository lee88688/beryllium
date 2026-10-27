// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders the shadcn button slot with the default variant classes", () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveClass("bg-primary-button");
  });

  it("merges a caller className over the variant classes", () => {
    render(<Button className="bg-red-500">Delete</Button>);

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "bg-red-500",
    );
  });
});
