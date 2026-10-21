import { QueryClient } from "@tanstack/react-query";

/**
 * Module-level query client. This app is a single-page bundle (TanStack Start
 * SPA mode, no SSR pass), so one client per page load is exactly one client per
 * browser tab — sharing it through a module keeps server-function calls and
 * `useQuery` in the same cache without threading a provider value around.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data changes only through this tab's own mutations, which invalidate
      // explicitly; background refetches are noise.
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
