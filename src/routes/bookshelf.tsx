import { createFileRoute, redirect } from "@tanstack/react-router";
import { BookshelfPage } from "@/features/bookshelf/BookshelfPage";
import { me } from "@/server/fns/session";

export const Route = createFileRoute("/bookshelf")({
  /** Guard (PRD §2): the shelf is only reachable with a session. */
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login", replace: true });
  },
  component: BookshelfPage,
});
