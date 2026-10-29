import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/` has no screen of its own: it is the entry point the deployment links to,
 * and every visitor is sent to the bookshelf.
 * SPA mode runs `beforeLoad` in the browser, so this is a client-side redirect;
 * the guarded destination bounces anonymous visitors on to `/login`.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/bookshelf", replace: true });
  },
});
