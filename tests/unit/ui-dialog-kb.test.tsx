// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DialogKb } from "@/components/dialog-kb";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "virtualKeyboard");
});

class FakeVirtualKeyboard extends EventTarget {
  boundingRect: DOMRect = new DOMRect(0, 0, 0, 0);
  overlaysContent = false;
}

function installVirtualKeyboard() {
  const virtualKeyboard = new FakeVirtualKeyboard();
  Object.defineProperty(navigator, "virtualKeyboard", {
    value: virtualKeyboard,
    configurable: true,
  });
  return virtualKeyboard;
}

describe("DialogKb", () => {
  it("renders a centered dialog when the keyboard is closed", () => {
    installVirtualKeyboard();

    render(
      <DialogKb open onOpenChange={() => {}} title="批注">
        内容
      </DialogKb>,
    );

    const popup = screen.getByRole("dialog");
    expect(popup).toHaveAttribute("data-slot", "dialog-kb");
    expect(popup).not.toHaveAttribute("data-docked");
    expect(popup.className).toContain("fixed");
    expect(screen.getByText("批注")).toBeInTheDocument();
  });

  it("docks above the virtual keyboard and enables overlaysContent", () => {
    const virtualKeyboard = installVirtualKeyboard();

    render(
      <DialogKb open onOpenChange={() => {}}>
        内容
      </DialogKb>,
    );

    act(() => {
      virtualKeyboard.boundingRect = new DOMRect(0, 500, 400, 300);
      virtualKeyboard.dispatchEvent(new Event("geometrychange"));
    });

    const popup = screen.getByRole("dialog");
    expect(popup).toHaveAttribute("data-docked", "true");
    expect(popup.className).toContain("absolute");
    expect(popup.style.bottom).toBe("300px");
    expect(virtualKeyboard.overlaysContent).toBe(true);
  });
});
