import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Beryllium mark: an opened book folded from four triangular faces, drawn
 * as SVG so it inherits the palette instead of shipping a raster asset.
 *
 * Geometry (viewBox 128×116): the top spine is 14 units below the outer top
 * corners, the bottom spine 23 units below the outer bottom corners — the
 * same 1321:1179 proportions as the design. Each face reads a `--mark-*`
 * custom property written by `applyPalette`, so the gem adopts the active
 * palette instead of forcing emerald onto every theme.
 */
export function BerylliumMark({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 128 116"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={cn("block h-auto w-auto", className)}
      {...props}
    >
      {/* Outer left (aquamarine) */}
      <path
        d="M0 0 64 14.16 0 91Z"
        fill="var(--mark-tint)"
        stroke="var(--mark-tint)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Inner left (emerald) */}
      <path
        d="M64 14.16 0 91 64 114.32Z"
        fill="var(--mark-core)"
        stroke="var(--mark-core)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Inner right (deep emerald) */}
      <path
        d="M64 14.16 64 114.32 128 91Z"
        fill="var(--mark-deep)"
        stroke="var(--mark-deep)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Outer right (turquoise) */}
      <path
        d="M64 14.16 128 0 128 91Z"
        fill="var(--mark-mid)"
        stroke="var(--mark-mid)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Spine crease */}
      <path
        d="M64 14.16V114.32"
        stroke="var(--mark-line)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

const LOCKUP_SIZES = {
  compact: {
    root: "gap-2.5",
    mark: "h-12",
    title: "text-[22px]",
    tagline: "text-[9px] tracking-[0.08em]",
  },
  hero: {
    root: "gap-4",
    mark: "h-20",
    title: "text-[32px]",
    tagline: "text-[10px] tracking-[0.12em]",
  },
} as const;

/** Mark + wordmark + tagline, matching the supplied lockup. */
export function BerylliumLockup({
  variant = "compact",
  className,
}: {
  variant?: keyof typeof LOCKUP_SIZES;
  className?: string;
}) {
  const sizes = LOCKUP_SIZES[variant];
  return (
    <div className={cn("flex items-center", sizes.root, className)}>
      <BerylliumMark className={cn("shrink-0", sizes.mark)} />
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={cn(
            "font-heading leading-none font-semibold tracking-tight",
            sizes.title,
          )}
        >
          <span className="text-mark-ink">B</span>eryllium
        </span>
        <span
          className={cn(
            "text-muted-foreground mt-1 leading-none whitespace-nowrap",
            sizes.tagline,
          )}
        >
          reader for yourself
        </span>
      </span>
    </div>
  );
}
