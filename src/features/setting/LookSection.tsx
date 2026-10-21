import * as React from "react";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { PALETTE_NAMES, PALETTES, type PaletteName } from "@/lib/palette";
import { setMotionPrefs, useMotionPrefs } from "@/lib/prefs";
import { useThemeMode, type ThemeMode } from "@/components/theme-provider";
import {
  SettingsGroup,
  SettingsNote,
  SettingsSection,
  SettingRow,
} from "./section";

const SCHEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "auto", label: "跟随系统" },
];

/** 配色卡自己的预览：用该配色真实的三个种子画，不是示意图。 */
function PaletteCard({
  name,
  selected,
  scheme,
  onSelect,
}: {
  name: PaletteName;
  selected: boolean;
  scheme: "light" | "dark";
  onSelect: (name: PaletteName) => void;
}) {
  const palette = PALETTES[name];
  const [bg, fg, primary] = palette[scheme];
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`配色 ${palette.label}`}
      onClick={() => onSelect(name)}
      className="focus-visible:ring-ring flex flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2"
    >
      <span
        aria-hidden="true"
        className="border-line flex h-20 w-full flex-col justify-between rounded-lg border p-2.5"
        style={{
          background: bg,
          color: fg,
          boxShadow: selected ? "inset 0 0 0 2px var(--primary)" : undefined,
        }}
      >
        <span className="text-xl leading-none font-semibold">Aa</span>
        <span className="flex items-center gap-1">
          <span
            className="size-2 rounded-full"
            style={{ background: primary }}
          />
          <span
            className="h-[3px] flex-1 rounded-full"
            style={{ background: fg, opacity: 0.25 }}
          />
        </span>
      </span>
      <span className="text-muted-foreground truncate text-sm">
        {palette.label}
      </span>
    </button>
  );
}

/** 「外观」：模式、配色、动效。 */
export function LookSection() {
  const { mode, setMode, palette, setPalette, resolvedTheme } = useThemeMode();
  const { animated } = useMotionPrefs();

  return (
    <SettingsSection
      id="look"
      title="外观"
      description="一套配色同时用于书架与正文：背景推导出两级面板色，文字推导出发丝线与分隔。"
    >
      <SettingsGroup>
        <SettingRow
          label="明暗"
          hint="跟随系统时，操作系统的深浅色变化会即时套用。"
        >
          <Segmented
            aria-label="明暗"
            value={mode}
            options={SCHEME_OPTIONS}
            onValueChange={setMode}
          />
        </SettingRow>
        <SettingRow label="阅读主题" hint="11 套配色，切换即时生效。" stack>
          <div className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {PALETTE_NAMES.map((name) => (
              <PaletteCard
                key={name}
                name={name}
                scheme={resolvedTheme}
                selected={name === palette}
                onSelect={setPalette}
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label="界面动效"
          hint="面板滑入、卡片过渡。关闭后所有过渡立即完成。"
        >
          <Switch
            aria-label="界面动效"
            checked={animated}
            onCheckedChange={(checked) => setMotionPrefs({ animated: checked })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsNote>
        配色只写三个种子（背景 / 文字 /
        主操作），其余层级由它们推导，因此每套配色
        的对比关系一致；「跟随系统」时明暗两套自动切换。
      </SettingsNote>
    </SettingsSection>
  );
}
