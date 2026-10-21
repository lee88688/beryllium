import * as React from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "cn";

/**
 * The seven highlight colours persisted in `Mark.color` (PRD §4/§5.3).
 * NOTE: the legacy palette lived in the MUI `highlightEditor.tsx`;
 * `src/utils/constants.ts` only holds `MarkType`/`ThemeMode`.
 */
export type MarkColor =
  | "red"
  | "purple"
  | "blue"
  | "cyan"
  | "teal"
  | "orange"
  | "blue-grey";

export const MARK_COLORS = [
  { name: "red", value: "#F44336" },
  { name: "purple", value: "#9C27B0" },
  { name: "blue", value: "#2196F3" },
  { name: "cyan", value: "#00BCD4" },
  { name: "teal", value: "#009688" },
  { name: "orange", value: "#FF9800" },
  { name: "blue-grey", value: "#607D8B" },
] as const satisfies ReadonlyArray<{ name: MarkColor; value: string }>;

export const MARK_COLOR_VALUES = Object.fromEntries(
  MARK_COLORS.map((color) => [color.name, color.value]),
) as Record<MarkColor, string>;

/** Hex for a stored colour name; `undefined` for unknown/empty values. */
export function getMarkColorValue(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(MARK_COLOR_VALUES, name)
    ? MARK_COLOR_VALUES[name as MarkColor]
    : undefined;
}

export type ColorRadioProps = {
  /** Currently selected colour name (controlled). */
  value?: string;
  onChange?: (value: MarkColor) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * Single-choice swatch row for highlight colours (7 colours,
 * replaces `RadioGroup + FormControlLabel + ColorRadio` from MUI).
 */
export function ColorRadio({
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel = "高亮颜色",
}: ColorRadioProps) {
  return (
    <RadioGroup<string>
      value={value ?? ""}
      onValueChange={(next) => onChange?.(next as MarkColor)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("flex items-center gap-1", className)}
    >
      {MARK_COLORS.map((color) => (
        <Radio.Root
          key={color.name}
          value={color.name}
          aria-label={color.name}
          data-color={color.name}
          className="focus-visible:ring-ring/50 data-checked:ring-foreground/60 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 outline-none focus-visible:ring-3 data-checked:ring-2 data-disabled:pointer-events-none data-disabled:opacity-50"
        >
          <span
            data-slot="color-radio-dot"
            className="block size-4 rounded-full"
            style={{ backgroundColor: color.value }}
          />
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
