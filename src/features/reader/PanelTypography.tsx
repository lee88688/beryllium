import type * as React from "react";

import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { setReaderPrefs, useReaderPrefs, type ReaderFont } from "@/lib/prefs";

/**
 * 侧栏里的「排版」页签：正文的字体 / 字号 / 行距 / 栏宽 / 版式 / 对齐。
 *
 * 改的就是设置页那一组偏好（`lib/prefs.ts` 的 `reader-prefs`），所以两边永远
 * 一致 —— 阅读器里调完，设置页读到的是同一份值；`useReaderAdapter` 订阅同一
 * 个 store，改完当前章节立刻重排。
 */

const FONT_OPTIONS: { value: ReaderFont; label: string }[] = [
  { value: "serif", label: "宋" },
  { value: "sans", label: "黑" },
  { value: "kai", label: "楷" },
];

const FONT_NAME: Record<ReaderFont, string> = {
  serif: "衬线",
  sans: "黑体",
  kai: "楷体",
};

/** 一行：左边标题、右边控件（面板窄，说明文字留给设置页）。 */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-base">{label}</span>
      {children}
    </div>
  );
}

/** 滑杆行：读放在行尾（等宽对齐），滑杆占满下一行。 */
function RangeRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-base">{label}</span>
        <output className="text-muted-foreground text-sm tabular-nums">
          {format(value)}
        </output>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 py-3">
      <h3 className="text-muted-foreground text-sm font-semibold tracking-[0.04em]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function PanelTypography() {
  const prefs = useReaderPrefs();

  return (
    <div className="divide-line flex flex-col divide-y px-3 pt-1 pb-3">
      <Group title="文字">
        <Row label="字体">
          <Segmented
            aria-label={`正文字体（当前：${FONT_NAME[prefs.font]}）`}
            value={prefs.font}
            options={FONT_OPTIONS}
            onValueChange={(font) => setReaderPrefs({ font })}
          />
        </Row>
        <RangeRow
          label="字号"
          value={prefs.size}
          min={14}
          max={28}
          step={1}
          format={(value) => `${value} px`}
          onChange={(size) => setReaderPrefs({ size })}
        />
        <RangeRow
          label="行距"
          value={prefs.leading}
          min={1.3}
          max={2.2}
          step={0.02}
          format={(value) => value.toFixed(2)}
          onChange={(leading) => setReaderPrefs({ leading })}
        />
        <RangeRow
          label="栏宽"
          value={prefs.columnWidth}
          min={480}
          max={1000}
          step={20}
          format={(value) => `${value} px`}
          onChange={(columnWidth) => setReaderPrefs({ columnWidth })}
        />
      </Group>
      <Group title="版式">
        <Row label="版式">
          <Segmented
            aria-label="版式"
            value={prefs.layout}
            options={[
              { value: "paged", label: "分页" },
              { value: "scrolled", label: "滚动" },
            ]}
            onValueChange={(layout) => setReaderPrefs({ layout })}
          />
        </Row>
        <Row label="对齐">
          <Segmented
            aria-label="正文对齐"
            value={prefs.align}
            options={[
              { value: "justify", label: "两端" },
              { value: "start", label: "靠左" },
            ]}
            onValueChange={(align) => setReaderPrefs({ align })}
          />
        </Row>
      </Group>
    </div>
  );
}
