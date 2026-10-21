import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingPage } from "@/features/setting/SettingPage";
import { me } from "@/server/fns/session";

export const Route = createFileRoute("/setting")({
  /**
   * Guard + identity in one round trip: the resolved account decides whether the
   * admin-only user card is rendered (PRD §2/§5.6).
   */
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login", replace: true });
    return { user };
  },
  component: SettingRoute,
});

function SettingRoute() {
  const { user } = Route.useRouteContext();
  return <SettingPage user={user} />;
}
