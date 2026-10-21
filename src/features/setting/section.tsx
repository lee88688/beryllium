import * as React from "react";
import { cn } from "cn";
import { Slider } from "@/components/ui/slider";

/**
 * 设置页的排版原语：分区 → 分组（卡片）→ 设置行。
 * 原型 `data/prototype/settings.html` 的结构：每行左边是「标题 + 一句说明」，
 * 右边是控件；说明占一行时用 `stack`。
 */

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description ? (
          <p className="text-muted-foreground max-w-[68ch] text-base leading-[1.7]">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** 一张设置卡片：行之间只有一根发丝线，不投影。 */
export function SettingsGroup({
  caption,
  children,
}: {
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {caption ? (
        <p className="text-muted-foreground text-sm font-medium">{caption}</p>
      ) : null}
      <div className="divide-line border-line bg-card flex flex-col divide-y rounded-xl border px-4">
        {children}
      </div>
    </div>
  );
}

export function SettingRow({
  label,
  hint,
  children,
  stack = false,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  /** 控件换到说明下面（配色卡、预览这类块级控件）。 */
  stack?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 py-3",
        stack ? "flex-col" : "flex-wrap items-center justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-base font-semibold">{label}</strong>
        {hint ? (
          <span className="text-muted-foreground text-sm">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** 分区末尾的一句补充说明。 */
export function SettingsNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground max-w-[68ch] text-sm leading-[1.7]">
      {children}
    </p>
  );
}

/** 区间行：滑杆 + 右侧读数（原型把读数放在行尾，等宽对齐好比较）。 */
export function RangeRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  return (
    <SettingRow label={label} hint={hint}>
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
        <Slider
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output className="text-muted-foreground w-[52px] shrink-0 text-right text-sm tabular-nums">
          {format(value)}
        </output>
      </div>
    </SettingRow>
  );
}
