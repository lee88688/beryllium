import { describe, expect, it } from "vitest";

import { PALETTES } from "@/lib/palette";
import { READER_PREFS_DEFAULT, type ReaderPrefs } from "@/lib/prefs";
import {
  buildReaderStyles,
  CHAPTER_TAIL_ROW_PX,
  readerLayout,
  READER_TAIL_SPACE,
} from "@/features/reader/epub/theme";

const prefs = (overrides: Partial<ReaderPrefs> = {}): ReaderPrefs => ({
  ...READER_PREFS_DEFAULT,
  ...overrides,
});

describe("buildReaderStyles", () => {
  it("injects the typography preferences and uses the palette background and foreground in light mode", () => {
    const styles = buildReaderStyles({
      theme: "light",
      prefs: prefs({ font: "kai", size: 22, leading: 1.9, align: "start" }),
      palette: "sepia",
    });

    expect(styles).toContain("font-size: 22px !important");
    expect(styles).toContain("line-height: 1.9 !important");
    expect(styles).toContain("text-align: start !important");
    expect(styles).toContain(`background-color: ${PALETTES.sepia.light[0]}`);
    expect(styles).toContain(`color: ${PALETTES.sepia.light[1]}`);
    // 明色下不压平书自己的配色。
    expect(styles).not.toContain("box-shadow: none");
  });

  it("paints the page with the default dark palette", () => {
    const styles = buildReaderStyles({
      theme: "dark",
      prefs: prefs(),
      palette: "default",
    });
    expect(styles).toContain(`background-color: ${PALETTES.default.dark[0]}`);
    expect(styles).toContain(`color: ${PALETTES.default.dark[1]}`);
  });

  it("themes the chapter scrollbar from the same palette seeds", () => {
    const [background, foreground, accent] = PALETTES.sepia.light;
    const light = buildReaderStyles({
      theme: "light",
      prefs: prefs(),
      palette: "sepia",
    });
    // 章节文档是独立 document，拿不到宿主的 `--scrollbar-thumb`：这里要按种子
    // 把同一条推导（前景混主色，再压到 34%）重新写一遍。
    expect(light).toContain("scrollbar-width: thin");
    expect(light).toContain(
      `scrollbar-color: color-mix(in oklab, color-mix(in oklab, ${foreground} 58%, ${accent}) 34%, transparent) transparent`,
    );
    // 暗色换的是暗色那一套种子，不会沿用明色的把手。
    const dark = buildReaderStyles({
      theme: "dark",
      prefs: prefs(),
      palette: "sepia",
    });
    expect(dark).toContain(
      `color-mix(in oklab, color-mix(in oklab, ${PALETTES.sepia.dark[1]} 58%, ${PALETTES.sepia.dark[2]}) 34%, transparent)`,
    );
    expect(dark).not.toContain(
      `color-mix(in oklab, color-mix(in oklab, ${PALETTES.sepia.light[1]} 58%, ${PALETTES.sepia.light[2]}) 34%, transparent)`,
    );
    // 底色仍由同一个种子来，别让滚动条规则盖掉正文配色。
    expect(light).toContain(`background-color: ${background} !important`);
  });

  it("normalises author surfaces and link colours in dark mode", () => {
    const styles = buildReaderStyles({
      theme: "dark",
      prefs: prefs(),
      palette: "sepia",
    });
    expect(styles).toContain(`color: ${PALETTES.sepia.dark[1]}`);
    expect(styles).toContain(
      `a:link, a:visited { color: ${PALETTES.sepia.dark[2]} !important; }`,
    );
    expect(styles).toContain("background-color: transparent !important");
    expect(styles).toContain("box-shadow: none !important");
    expect(styles).toContain("color: inherit !important");
  });

  it("reserves the chapter-tail space only in the scrolled flow", () => {
    // 章末分隔行浮在阅读区底部，靠这段留白才压不到最后一行：留白至少要装得下
    // 一行 44px 的入口再加上进入阈值。
    expect(READER_TAIL_SPACE).toBeGreaterThanOrEqual(CHAPTER_TAIL_ROW_PX);

    const bodyRules = (styles: string) => styles.match(/body \{[^}]*\}/g) ?? [];
    const scrolled = buildReaderStyles({
      theme: "light",
      prefs: prefs({ layout: "scrolled" }),
      palette: "default",
    });
    expect(
      bodyRules(scrolled).some((rule) =>
        rule.includes(`padding-bottom: ${String(READER_TAIL_SPACE)}px`),
      ),
    ).toBe(true);

    // 分栏模式下同一段留白会变成一整栏空白。
    const paged = buildReaderStyles({
      theme: "light",
      prefs: prefs({ layout: "paged" }),
      palette: "default",
    });
    expect(
      bodyRules(paged).some((rule) => rule.includes("padding-bottom")),
    ).toBe(false);
  });
});

describe("readerLayout", () => {
  it("maps the preferences onto paginator attributes", () => {
    expect(
      readerLayout(
        prefs({ columnWidth: 640, layout: "scrolled", columns: "1" }),
      ),
    ).toEqual({
      "max-inline-size": "640px",
      "max-column-count": "1",
      flow: "scrolled",
    });
  });

  it("applies flow last so the preceding variables are already in place", () => {
    // `setAttribute` 每次都会触发 attributeChangedCallback；只有 flow 会重排，
    // 其余只更新 CSS 变量 —— 顺序反了就会用旧值重排一次（见 `paginator.js:628`）。
    expect(Object.keys(readerLayout(prefs())).at(-1)).toBe("flow");
  });
});
