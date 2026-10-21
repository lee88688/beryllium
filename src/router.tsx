import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

/**
 * The concrete router type for this route tree, published for consumers
 * (route registration, typed navigation) instead of leaking the factory.
 */
export type AppRouter = typeof router;

export function getRouter(): AppRouter {
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
