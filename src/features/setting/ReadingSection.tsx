import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { READER_SHORTCUTS } from "@/features/reader/shortcuts";
import { setReaderPrefs, useReaderPrefs, type ReaderFont } from "@/lib/prefs";
import {
  RangeRow,
  SettingsGroup,
  SettingsNote,
  SettingsSection,
  SettingRow,
} from "./section";

const FONT_OPTIONS: { value: ReaderFont; label: string }[] = [
  { value: "serif", label: "衬线" },
  { value: "sans", label: "黑体" },
  { value: "kai", label: "楷体" },
];

const FONT_CLASS: Record<ReaderFont, string> = {
  serif: "font-serif",
  sans: "font-sans",
  kai: "font-kai",
};

/** 「阅读」：正文的全局默认排版 + 实时预览（所有未单独调整的书都跟着变）。 */
export function ReadingSection() {
  const prefs = useReaderPrefs();

  return (
    <SettingsSection
      id="reading"
      title="阅读"
      description="这里是全局默认排版：新书和没有单独调整过的书都用它；阅读器里对某本书的调整只影响那本书，不会回写到这里。"
    >
      <SettingsGroup>
        <SettingRow
          label="字体"
          hint="中文正文惯例：长阅读用衬线，短段落与屏幕阅读用黑体。"
        >
          <Segmented
            aria-label="正文字体"
            value={prefs.font}
            options={FONT_OPTIONS}
            onValueChange={(font) => setReaderPrefs({ font })}
          />
        </SettingRow>
        <RangeRow
          label="字号"
          hint="14–28 px"
          value={prefs.size}
          min={14}
          max={28}
          step={1}
          format={(value) => `${value} px`}
          onChange={(size) => setReaderPrefs({ size })}
        />
        <RangeRow
          label="行距"
          hint="正文建议 1.6–1.8"
          value={prefs.leading}
          min={1.3}
          max={2.2}
          step={0.02}
          format={(value) => value.toFixed(2)}
          onChange={(leading) => setReaderPrefs({ leading })}
        />
        <RangeRow
          label="正文栏宽"
          hint="分页时每栏的最大宽度；越窄两侧留白越多"
          value={prefs.columnWidth}
          min={480}
          max={1000}
          step={20}
          format={(value) => `${value} px`}
          onChange={(columnWidth) => setReaderPrefs({ columnWidth })}
        />
        <SettingRow label="版式" hint="分页会按窗口宽度重新分栏。">
          <Segmented
            aria-label="版式"
            value={prefs.layout}
            options={[
              { value: "paged", label: "分页" },
              { value: "scrolled", label: "连续滚动" },
            ]}
            onValueChange={(layout) => setReaderPrefs({ layout })}
          />
        </SettingRow>
        <SettingRow label="对齐" hint="两端对齐会启用中文标点压缩与避头尾。">
          <Segmented
            aria-label="正文对齐"
            value={prefs.align}
            options={[
              { value: "justify", label: "两端对齐" },
              { value: "start", label: "左对齐" },
            ]}
            onValueChange={(align) => setReaderPrefs({ align })}
          />
        </SettingRow>
        <SettingRow
          label="预览"
          hint="这段用的就是当前的字体、字号、行距与对齐。"
          stack
        >
          <div
            className={`border-line bg-background w-full rounded-xl border px-5 py-4 ${FONT_CLASS[prefs.font]}`}
            style={{
              fontSize: `${prefs.size}px`,
              lineHeight: prefs.leading,
              textAlign: prefs.align === "justify" ? "justify" : "start",
            }}
          >
            <p>
              天黑得很慢，云把最后一点光留在河面上。我沿着堤岸走，脚下的碎石发出细碎的响声。
            </p>
            <p>
              灯是在第七个转弯之后才出现的。那是一盏很旧的灯，玻璃罩上有一层洗不掉的烟痕。
            </p>
          </div>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup caption="快捷键（阅读器内）">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 py-3 sm:grid-cols-2">
          {READER_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-3"
            >
              <dt className="text-muted-foreground text-sm">
                {shortcut.label}
              </dt>
              <dd className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>
      <SettingsNote>
        排版只覆盖书籍自带的字号与行距，不动它的段落结构（段首缩进、段间距、图注都由
        书本身决定），因此诗歌、图表类 EPUB 不会被改坏。
      </SettingsNote>
    </SettingsSection>
  );
}
