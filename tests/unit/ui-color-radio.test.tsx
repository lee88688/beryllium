// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARK_COLORS,
  MARK_COLOR_VALUES,
  ColorRadio,
  getMarkColorValue,
} from "@/components/color-radio";

afterEach(cleanup);

describe("ColorRadio", () => {
  it("renders the seven highlight colours with the checked one marked", () => {
    render(<ColorRadio value="red" onChange={() => {}} />);

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: "red" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "blue" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reports the newly selected colour", () => {
    const onChange = vi.fn();
    render(<ColorRadio value="red" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "orange" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("orange");
  });

  it("exposes the legacy palette and value lookup", () => {
    expect(MARK_COLORS).toHaveLength(7);
    expect(MARK_COLOR_VALUES).toMatchObject({
      red: "#F44336",
      purple: "#9C27B0",
      blue: "#2196F3",
      cyan: "#00BCD4",
      teal: "#009688",
      orange: "#FF9800",
      "blue-grey": "#607D8B",
    });
    expect(getMarkColorValue("teal")).toBe("#009688");
    expect(getMarkColorValue("not-a-colour")).toBeUndefined();
  });
});
