import * as React from "react";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useThemeMode, type ThemeMode } from "./theme-provider";

const MODE_ORDER: readonly ThemeMode[] = ["auto", "dark", "light"];

const MODE_LABELS: Record<ThemeMode, string> = {
  auto: "跟随系统",
  dark: "深色",
  light: "浅色",
};

const MODE_ICONS: Record<
  ThemeMode,
  React.ComponentType<{ className?: string }>
> = {
  auto: SunMoon,
  dark: Moon,
  light: Sun,
};

export type ThemeModeButtonProps = {
  className?: string;
};

/**
 * Three-state theme switcher (`auto` / `dark` / `light`). The active mode is
 * rendered disabled, mirroring the legacy `themeModeIconButton`.
 * Requires a `<ThemeModeProvider>` ancestor.
 */
export function ThemeModeButton({ className }: ThemeModeButtonProps) {
  const { mode, setMode } = useThemeMode();
  const CurrentIcon = MODE_ICONS[mode];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={className}
            aria-label={`主题：${MODE_LABELS[mode]}`}
          />
        }
      >
        <CurrentIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {MODE_ORDER.map((option) => {
          const Icon = MODE_ICONS[option];
          const isActive = option === mode;
          return (
            <DropdownMenuItem
              key={option}
              disabled={isActive}
              onClick={() => setMode(option)}
            >
              <Icon className="size-4" />
              <span>{MODE_LABELS[option]}</span>
              {isActive ? (
                <Check className="ml-auto size-4" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
