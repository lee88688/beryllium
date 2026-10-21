// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfirmDialog } from "@/components/confirm-dialog";

afterEach(cleanup);

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function Harness() {
  const { dialog, openDialog, closeDialog } = useConfirmDialog();
  const [status, setStatus] = React.useState("idle");

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          openDialog({ title: "删除书籍", content: "此操作不可撤销" }).then(
            () => setStatus("confirmed"),
            () => setStatus("canceled"),
          );
        }}
      >
        open
      </button>
      <button type="button" onClick={closeDialog}>
        programmatic close
      </button>
      <span data-testid="status">{status}</span>
      {dialog}
    </div>
  );
}

describe("useConfirmDialog", () => {
  it("resolves the promise when confirmed", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));

    expect(await screen.findByText("删除书籍")).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("confirmed"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("rejects the promise when cancelled", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByText("删除书籍");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("canceled"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("rejects the pending promise when closed programmatically", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByText("删除书籍");

    fireEvent.click(
      screen.getByRole("button", {
        name: "programmatic close",
        // the open dialog marks outside content inert/aria-hidden
        hidden: true,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("canceled"),
    );
  });
});
