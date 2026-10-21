import { createFileRoute, redirect } from "@tanstack/react-router";
import type { SessionUser } from "@/features/auth";
import { LoginForm } from "@/features/login/LoginForm";
import { me } from "@/server/fns/session";

export const Route = createFileRoute("/login")({
  /**
   * D7: a signed-in visitor never sees the login screen again. A failing probe
   * (offline, stale CSRF token) is treated as "not signed in" — showing the form
   * is always the safe outcome here.
   */
  beforeLoad: async () => {
    let user: SessionUser | null = null;
    try {
      user = await me();
    } catch {
      user = null;
    }
    if (user) throw redirect({ to: "/bookshelf", replace: true });
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 px-6 pt-[20vh]">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        用户登陆
      </h1>
      <LoginForm />
    </main>
  );
}
