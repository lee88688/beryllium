import { describe, expect, it } from "vitest";

import { PALETTES } from "@/lib/palette";
import { READER_PREFS_DEFAULT, type ReaderPrefs } from "@/lib/prefs";
import { buildReaderStyles, readerLayout } from "@/features/reader/epub/theme";

const prefs = (overrides: Partial<ReaderPrefs> = {}): ReaderPrefs => ({
  ...READER_PREFS_DEFAULT,
  ...overrides,
});

describe("buildReaderStyles", () => {
  it("injects the typography preferences and leaves book colours alone in light mode", () => {
    const styles = buildReaderStyles({
      theme: "light",
      prefs: prefs({ font: "kai", size: 22, leading: 1.9, align: "start" }),
      palette: "default",
    });

    expect(styles).toContain("font-size: 22px !important");
    expect(styles).toContain("line-height: 1.9 !important");
    expect(styles).toContain("text-align: start !important");
    // 明色下不动书自己的颜色。
    expect(styles).not.toContain("color:");
  });

  it("keeps the legacy white text for the default dark palette", () => {
    // e2e 的主题用例把默认暗色下的正文钉在纯白（A 类基线）。
    expect(
      buildReaderStyles({ theme: "dark", prefs: prefs(), palette: "default" }),
    ).toContain("body { color: white; }");
  });

  it("uses the chosen palette's foreground in dark mode", () => {
    expect(
      buildReaderStyles({ theme: "dark", prefs: prefs(), palette: "sepia" }),
    ).toContain(`body { color: ${PALETTES.sepia.dark[1]}; }`);
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
