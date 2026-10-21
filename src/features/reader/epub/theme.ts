import { DEFAULT_PALETTE, PALETTES, type PaletteName } from "@/lib/palette";
import type { ReaderTypography } from "@/lib/prefs";
import type { ReaderAdapter } from "./types";

export const READER_THEME = {
  light: "light",
  dark: "dark",
} as const;

export type ReaderThemeName = (typeof READER_THEME)[keyof typeof READER_THEME];

/**
 * 正文字体栈。
 *
 * 必须在这里写死：正文渲染在 `blob:` 章节文档里，是**另一个 document**，
 * 拿不到宿主页面的 CSS 变量（`src/styles/app.css` 的 `--font-*`）。改动这里
 * 时要同步那边，否则设置页的预览与正文会不一致。
 */
const FONT_STACKS: Record<ReaderTypography["font"], string> = {
  serif:
    '"Source Han Serif SC", "Noto Serif SC", "Songti SC", SimSun, Georgia, serif',
  kai: '"LXGW WenKai", KaiTi, STKaiti, "Kaiti SC", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export function resolveReaderTheme(mode: string | undefined): ReaderThemeName {
  return mode === READER_THEME.dark ? READER_THEME.dark : READER_THEME.light;
}

export interface ReaderStyleInput {
  /** `auto` 已在路由里解析过，这里只收 `light` / `dark`。 */
  theme: ReaderThemeName;
  prefs: ReaderTypography;
  palette: PaletteName;
}

/**
 * 注入到每个章节文档的 CSS（foliate-js `renderer.setStyles`）。
 *
 * 两条规则：
 *  1. 明色下不动书自己的颜色；暗色下必须改文字色，否则深底黑字不可读。
 *     **默认配色沿用旧行为（纯白）**，其余配色用该配色的前景色 —— e2e
 *     （`theme.spec.ts`）把默认暗色下的正文颜色钉在 `rgb(255,255,255)`。
 *  2. 用户排版偏好用 `!important` 覆盖书的字号/行距/字体/对齐（书里写死在
 *     元素上的 `font-size` 也要被盖掉），但只碰这几项，段落结构、段首缩进、
 *     图注都留给书本身。
 */
export function buildReaderStyles({
  theme,
  prefs,
  palette,
}: ReaderStyleInput): string {
  const rules: string[] = [];
  if (theme === READER_THEME.dark) {
    rules.push(
      palette === DEFAULT_PALETTE
        ? "body { color: white; }"
        : `body { color: ${PALETTES[palette].dark[1]}; }`,
    );
  }
  rules.push(
    [
      "body {",
      `  font-family: ${FONT_STACKS[prefs.font]} !important;`,
      `  font-size: ${prefs.size}px !important;`,
      `  line-height: ${prefs.leading} !important;`,
      `  text-align: ${prefs.align === "justify" ? "justify" : "start"} !important;`,
      "}",
    ].join("\n"),
  );
  return rules.join("\n");
}

/**
 * 排版偏好里属于**分页器几何**的部分（foliate-js 的属性，见
 * `vendor/foliate-js/paginator.js#observedAttributes`）。
 *
 * 横向留白在分页器里没有「左右边距」这个旋钮：`margin` 是**页眉/页脚高度**
 * （`vendor/foliate-js/README.md`「The height of the header and footer」），
 * 横向由正文栏宽（`max-inline-size`，默认 720px，居中）与 `gap` 决定。所以偏好
 * 里给的是**正文栏宽**，不是一个它控制不了的「边距」。
 *
 * `flow` 必须放最后：只有它触发 `render()`，其余属性仅仅更新 CSS 变量，而
 * `setAttribute` 每次都会回调 —— 先设变量再重排，这一次改动才会立刻可见。
 */
export function readerLayout(prefs: ReaderTypography): Record<string, string> {
  return {
    "max-inline-size": `${prefs.columnWidth}px`,
    "max-column-count": prefs.columns === "1" ? "1" : "2",
    flow: prefs.layout === "scrolled" ? "scrolled" : "paginated",
  };
}

type StyleSink = Pick<ReaderAdapter, "setStyles" | "setLayout">;

/** 一次把正文样式与分页几何都套上（偏好改动后可以重复调用）。 */
export function applyReaderStyles(
  adapter: StyleSink,
  input: ReaderStyleInput,
): void {
  adapter.setStyles(buildReaderStyles(input));
  adapter.setLayout(readerLayout(input.prefs));
}
