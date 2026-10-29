import { PALETTES, type PaletteName } from "@/lib/palette";
import type { ReaderTypography } from "@/lib/prefs";
import type { ReaderAdapter } from "./types";

export const READER_THEME = {
  light: "light",
  dark: "dark",
} as const;

export type ReaderThemeName = (typeof READER_THEME)[keyof typeof READER_THEME];

/**
 * 连续滚动时正文末尾的留白（px）。
 *
 * 章末分隔行（`ChapterTail`）浮在阅读区底部，这段留白保证它压不到最后一行，
 * 同时决定显隐阈值能开多大：`adapter.ts` 的隐藏阈值 = 这里 − 分隔行高度 − 8，
 * 所以「回收时仍不盖字」是算出来的，不是估的。
 */
export const READER_TAIL_SPACE = 200;

/**
 * 章末分隔行实际占的高度：1px 分隔线 + 44px 行 + 8px 下内边距，再加上最坏情况下
 * （iPhone 34px）的安全区，取整 80。`READER_TAIL_SPACE` 必须厚于它。
 */
export const CHAPTER_TAIL_ROW_PX = 80;

/**
 * 正文字栏占阅读区宽度的比例：foliate 的滚动布局给 `html` 加了 `--_gap`（默认 7%）
 * 的左右内边距并在中间放一栏（`paginator.js:292-307,467`），所以正文宽度是
 * `宽 × (1 − 2×7%)`。分隔行按这个比例收窄，才和正文同宽而不是铺满阅读区。
 */
export const READER_TEXT_COLUMN_RATIO = 0.86;

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
 * 配色必须写进**章节文档**：正文渲染在 `blob:` 的 iframe 里，宿主页面的
 * `--bg` / `--fg` 不会继承进去。之前只改了 `body` 的文字色，于是暗色下
 * 页面仍是浏览器默认的白底（深色文字或白字压白底），书的浅色底框、链接色
 * 也原样保留 —— 配色看起来「只换了外壳」。
 *
 * 三条规则：
 *  1. `html, body` 明暗都取配色的背景/前景，页面底色真正跟着配色走；
 *  2. 暗色下作者写死的浅色面（`#DCDCDC` 底框、白色卡片、黑边阴影）全部
 *     压平：背景透明、阴影去掉、文字继承正文色、链接换成配色的主色。图片
 *     不在选择器里，封面和插图不受影响；
 *  3. 用户排版偏好用 `!important` 覆盖书的字号/行距/字体/对齐（书里写死在
 *     元素上的 `font-size` 也要被盖掉），但只碰这几项，段落结构、段首缩进、
 *     图注都留给书本身。
 */
export function buildReaderStyles({
  theme,
  prefs,
  palette,
}: ReaderStyleInput): string {
  const seeds =
    theme === READER_THEME.dark
      ? PALETTES[palette].dark
      : PALETTES[palette].light;
  const [background, foreground, accent] = seeds;
  const rules: string[] = [
    [
      "html, body {",
      `  background-color: ${background} !important;`,
      `  color: ${foreground} !important;`,
      `  color-scheme: ${theme} !important;`,
      // 章节在 iframe 里，宿主页面的 touch-action 管不到它：只保留纵向滚动，
      // 双指缩放与横向原生平移都关掉（左右翻页由分页器的触摸处理完成）。
      "  touch-action: pan-y;",
      "}",
    ].join("\n"),
  ];

  if (theme === READER_THEME.dark) {
    // 作者写死的配色（Kindle 转制的书尤其多）：所有块级/行内元素的底色与
    // 阴影压平，文字回到正文色；只有图片保留原样。
    const painted = [
      "div",
      "section",
      "article",
      "aside",
      "header",
      "footer",
      "blockquote",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "p",
      "span",
      "li",
      "ul",
      "ol",
      "dl",
      "dt",
      "dd",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "code",
      "font",
      "b",
      "i",
      "u",
      "s",
      "strong",
      "em",
      "small",
      "big",
      "sub",
      "sup",
      "cite",
      "q",
      "mark",
      "abbr",
      "time",
    ].join(", ");
    rules.push(
      [
        `:where(${painted}) {`,
        "  background-color: transparent !important;",
        "  box-shadow: none !important;",
        "  text-shadow: none !important;",
        `  border-color: color-mix(in srgb, ${foreground} 22%, transparent) !important;`,
        "}",
      ].join("\n"),
      `:where(${painted}) { color: inherit !important; }`,
      // 书的链接色通常是深蓝（`#0000CC`），暗底上几乎不可读。
      `a:link, a:visited { color: ${accent} !important; }`,
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
  // 连续滚动才有章末入口可以垫在下面；分栏模式下这段留白会变成一整栏空白。
  if (prefs.layout === "scrolled") {
    rules.push(
      [
        "body {",
        `  padding-bottom: ${READER_TAIL_SPACE}px !important;`,
        "}",
      ].join("\n"),
    );
  }
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
  adapter.setStyles?.(buildReaderStyles(input));
  adapter.setLayout?.(readerLayout(input.prefs));
}
