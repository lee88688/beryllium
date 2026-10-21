import type { ReactNode } from "react";
// Server-function registration anchor: TanStack Start only emits the provider
// chunks for server functions that a client-graph module references. This file
// is that module — see local://migration-plan.md §5.1 and src/server/fns/registry.ts.
import "@/server/fns/registry";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import appCss from "@/styles/app.css?url";
import { Toaster } from "@/components/sonner-toaster";
import {
  ThemeModeProvider,
  themeInitScript,
} from "@/components/theme-provider";
import { queryClient } from "@/lib/query-client";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Beryllium" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    // Pre-paint <script>: sets <html class="dark"> before the first paint so a
    // dark-mode reload never flashes white (migration plan §7).
    scripts: [{ children: themeInitScript }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <ThemeModeProvider>
          <Outlet />
          <Toaster position="bottom-center" />
        </ThemeModeProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
