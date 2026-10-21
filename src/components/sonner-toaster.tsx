import * as React from "react";
import { toast, type ToasterProps } from "sonner";
import { Toaster as BaseToaster } from "./ui/sonner";
import { useThemeModeOptional } from "./theme-provider";

/**
 * Notistack replacement. Mount `<Toaster />` once (root route) and call
 * `toast` from anywhere — including non-React modules (`utils/request.ts`
 * style), since `sonner`'s `toast` is a module-level singleton:
 *
 * ```tsx
 * // __root.tsx
 * <Toaster position="top-center" richColors />
 * // anywhere
 * import { toast } from "@/components/sonner-toaster";
 * toast.error(message);
 * ```
 */
export { toast };
export type { ToasterProps };

/**
 * Theme-aware wrapper around the shadcn `Toaster`. Reads the resolved theme
 * from `<ThemeModeProvider>` when present, otherwise defers to the OS.
 */
export function Toaster(props: ToasterProps) {
  const theme = useThemeModeOptional();
  return <BaseToaster {...props} theme={theme?.resolvedTheme ?? "system"} />;
}
