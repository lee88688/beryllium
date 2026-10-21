// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { PasswordCard } from "@/features/setting/PasswordCard";

/**
 * N9: the two password fields are checked *client side* before anything is
 * sent. The server also compares them (D3), but the interesting property here
 * is that a mismatch never reaches the network — asserted by watching the
 * `changePassword` server function instead of a request spy.
 */
const { changePassword } = vi.hoisted(() => ({
  changePassword: vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true })),
}));

vi.mock("@/server/fns/users", () => ({ changePassword }));

function renderCard() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<PasswordCard />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("the password card has no form");
  fireEvent.submit(form);
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  changePassword.mockClear();
});

afterEach(cleanup);

describe("PasswordCard (D3/N9)", () => {
  it("refuses mismatching passwords without calling the server", async () => {
    const { container } = renderCard();

    fill("新密码", "abcdef");
    fill("再次输入", "abcdefg");
    submit(container);

    expect(await screen.findByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses a password under six characters without calling the server", async () => {
    const { container } = renderCard();

    fill("新密码", "abcde");
    fill("再次输入", "abcde");
    submit(container);

    expect(await screen.findByText("密码至少 6 位")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("sends the matching pair once", async () => {
    const { container } = renderCard();

    fill("新密码", "abcdef");
    fill("再次输入", "abcdef");
    submit(container);

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        data: { newPassword: "abcdef", confirmPassword: "abcdef" },
      }),
    );
    expect(changePassword).toHaveBeenCalledTimes(1);
  });
});
