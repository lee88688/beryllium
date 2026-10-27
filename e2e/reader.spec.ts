import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  CHAPTER_ONE_TEXT,
  CHAPTER_TWO_TEXT,
  INLINE_IMAGE_ALT,
  INTERNAL_LINK_TEXT,
  SAMPLE_BOOK_TITLE,
  SECTION_TWO_ONE_TEXT,
  chapterFrame,
  currentSection,
  dragSelectText,
  expectChapterText,
  openBook,
  openFreshBook,
  overlays,
  sectionIndex,
} from "./helpers";

/**
 * Creates a dedicated reader for this test, uploads the sample book and makes
 * chapter 1 the current chapter: every case owns its library, its reading
 * position and its marks.
 */
async function openAtChapterOne(page: Page, username: string): Promise<void> {
  await openFreshBook(page, username);
  await toc(page)
    .getByRole("button", { name: /^Chapter\s*1$/ })
    .click();
  await expect.poll(() => sectionIndex(page)).toBe(0);
  await expectChapterText(page, CHAPTER_ONE_TEXT);
}

function toc(page: Page) {
  return page.getByRole("navigation", { name: "目录" });
}

/** Presses blank space at the bottom of the rendered section (inside its iframe). */
async function pressBody(page: Page): Promise<void> {
  const section = await currentSection(page);
  if (!section?.box) throw new Error("no rendered section box");
  await page.mouse.click(
    section.box.x + section.box.width / 2,
    section.box.y + section.box.height - 12,
  );
}

test.describe("E8 reader basics", () => {
  test("moves the rendition and the TOC highlight when a chapter is chosen (W3)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-toc");

    await expect(
      page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
    ).toBeVisible();
    const chapterOne = toc(page).getByRole("button", {
      name: /^Chapter\s*1$/,
    });
    const chapterTwo = toc(page).getByRole("button", { name: /^Chapter\s*2$/ });
    await expect(chapterOne).toHaveAttribute("aria-current", "true");

    await chapterTwo.click();

    // foliate-js renders one section at a time, so the *rendered section* is
    // what proves the jump ran.
    await expect(chapterTwo).toHaveAttribute("aria-current", "true");
    await expect(chapterOne).not.toHaveAttribute("aria-current", "true");
    await expect.poll(() => sectionIndex(page)).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);
  });

  test("expands a nested entry and jumps to its section (W3)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-toc-nested");

    const chapterOne = toc(page).getByRole("button", {
      name: /^Chapter\s*1$/,
    });
    const chapterTwo = toc(page).getByRole("button", { name: /^Chapter\s*2$/ });
    await toc(page)
      .getByRole("button", { name: /^展开\s*Chapter\s*2$/ })
      .click();
    const section = toc(page).getByRole("button", {
      name: /^Section\s*2\.1$/,
    });
    await expect(section).toBeVisible();
    await section.click();

    await expect.poll(() => sectionIndex(page)).toBe(2);
    await expectChapterText(page, SECTION_TWO_ONE_TEXT);

    // D4: the entry the reader picked is the current one — section 2.1, not its
    // parent — and its ancestors stay expanded.
    await expect(section).toHaveAttribute("aria-current", "true");
    await expect(chapterTwo).not.toHaveAttribute("aria-current", "true");
    await expect(chapterOne).not.toHaveAttribute("aria-current", "true");
    await expect(
      toc(page).getByRole("button", { name: /^折叠\s*Chapter\s*2$/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("keeps the editor bubble on the selection while the section scrolls (连续滚动)", async ({
    page,
  }) => {
    // 连续滚动下，滚动发生在分页器**关闭的影子根**里的容器上（`paginator.js:511`）：
    // 宿主文档里什么都不动，`window`/`iframe` 上也收不到 scroll。浮窗长在宿主文档里，
    // 只能靠 renderer 重新派发的 scroll（`paginator.js:559`）重新测量 —— 否则它会
    // 停在选区原来的屏幕位置。
    await page.addInitScript(() => {
      localStorage.setItem(
        "reader-prefs",
        JSON.stringify({
          font: "serif",
          size: 18,
          leading: 1.72,
          align: "justify",
          columnWidth: 720,
          layout: "scrolled",
          columns: "auto",
          panelMode: "float",
        }),
      );
    });

    await openAtChapterOne(page, "e2e-reader-scroll");
    await dragSelectText(page, CHAPTER_ONE_TEXT);

    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();

    // 示例书这一章比视口还短，连续滚动本来没东西可滚 —— 在正文**后面**补一段占位
    // 高度，让分页器的容器真的能滚；选区在前面，位置不受影响。
    const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await frame.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "1600px";
      document.body.append(filler);
    });
    // 分页器靠 ResizeObserver 异步 `expand()`（`paginator.js:211`）：iframe 真的被撑高
    // 之前，滚轮会被整颗丢掉，而下面的 poll 只重试断言、不会重发滚轮。
    await expect
      .poll(async () => (await currentSection(page))?.box?.height ?? 0)
      .toBeGreaterThan(1600);

    /**
     * 选区的**页面坐标**：`getBoundingClientRect()` 在章节文档里量到的是「相对自己
     * 那个 iframe 视口」的位置，加上 frame 偏移才和浮窗（画在宿主文档里）可比。
     */
    const measure = async () => {
      const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
      const selection = await frame.evaluate(() => {
        const rect = window
          .getSelection()
          ?.getRangeAt(0)
          ?.getBoundingClientRect();
        const frameRect = window.frameElement?.getBoundingClientRect();
        return rect && frameRect
          ? {
              top: rect.top + frameRect.top,
              bottom: rect.bottom + frameRect.top,
            }
          : undefined;
      });
      const bubble = await editor.boundingBox();
      if (!selection || !bubble) throw new Error("浮窗或选区没有几何信息");
      return { selection, bubble };
    };

    /** 浮窗贴着选区那条边的间距（`side="top"` + 8px 间隙；翻转后贴下边）。 */
    const gap = async () => {
      const { selection, bubble } = await measure();
      return Math.min(
        Math.abs(selection.top - (bubble.y + bubble.height)),
        Math.abs(bubble.y - selection.bottom),
      );
    };

    // 浮窗该贴着选区：设计间隙 8px（`SelectionPopover.tsx#ANCHOR_GAP`），留一点
    // 翻转/入场动画的余量；入场动画没结束时 boundingBox 还在动，所以这里也要 poll。
    // （章节坐标 → 宿主坐标那一步由 tests/unit/reader-dom.test.ts#toHostSpace 管辖。）
    await expect.poll(gap).toBeLessThan(20);

    const before = await measure();
    const section = await currentSection(page);
    const viewport = page.viewportSize();
    if (!section?.box || !viewport) throw new Error("没有可滚动的章节框");
    // 落点从章节框推导：水平居中、贴近视口下沿，避开停在选区上方的浮窗，
    // 也不写死页面坐标。
    await page.mouse.move(
      section.box.x + section.box.width / 2,
      viewport.height - 24,
    );
    await page.mouse.wheel(0, 400);
    // 确认真的滚了：选区在页面坐标里向上移了一段（滚动发生在分页器的容器里）。
    await expect
      .poll(async () => (await measure()).selection.top)
      .toBeLessThan(before.selection.top - 100);

    // 滚动之后仍然贴着 —— 修好之前浮窗会留在选区的旧屏幕位置。
    await expect
      .poll(gap, { message: "浮窗在滚动后仍应贴着选区" })
      .toBeLessThan(20);
  });

  test("collapses the panel and switches between docked and floating (侧栏)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-panel");

    const panel = page.locator('[data-slot="reader-panel"]');
    const scrim = page.locator('[data-slot="panel-scrim"]');
    const viewport = page.viewportSize()?.width ?? 1280;
    /** 正文宽度是「面板有没有让位」的可见结果。 */
    const contentWidth = async () =>
      (await page.locator("main").boundingBox())?.width ?? 0;

    // 默认常驻：与正文并排、无遮罩，正文已经给面板让出宽度。
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-panel-mode", "docked");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(scrim).toHaveCount(0);
    await expect.poll(contentWidth).toBeLessThan(viewport - 300);

    // 可以收回：面板留在 DOM 里滑出右缘（有动画），正文补回整幅宽度。
    await panel.getByRole("button", { name: "关闭面板" }).click();
    await expect(panel).toHaveAttribute("data-open", "false");
    // 滑出去之后不可聚焦、不进可访问树。
    await expect(panel).toHaveJSProperty("inert", true);
    await expect.poll(contentWidth).toBeGreaterThan(viewport - 100);

    // 顶栏按钮把它开回来。
    await page.getByRole("button", { name: "打开目录" }).click();
    await expect(panel).toHaveAttribute("data-open", "true");

    // 图钉切成悬浮：盖在正文上（正文不再让位）、带遮罩。
    await panel.getByRole("button", { name: "切换为悬浮面板" }).click();
    await expect(panel).toHaveAttribute("data-panel-mode", "float");
    await expect(scrim).toHaveAttribute("data-open", "true");
    await expect.poll(contentWidth).toBeGreaterThan(viewport - 100);

    // 悬浮形态下跳转即收起（常驻形态不会）。
    await panel.getByRole("button", { name: /^Chapter\s*2$/ }).click();
    await expect(panel).toHaveAttribute("data-open", "false");
    await expect(scrim).toHaveAttribute("data-open", "false");
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    // 形态记在偏好里：再打开仍然是悬浮。
    await page.getByRole("button", { name: "打开目录" }).click();
    await expect(panel).toHaveAttribute("data-panel-mode", "float");
    // 同一个按钮也能再收起来。
    await page.getByRole("button", { name: "打开目录" }).click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("restores the panel state after leaving the reader (侧栏记忆)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-panel-state");

    const panel = page.locator('[data-slot="reader-panel"]');

    // 切到「排版」并调大字号：写的是本书覆盖值，正文当场重排。
    await panel.getByRole("tab", { name: "排版" }).click();
    await panel.getByRole("slider", { name: "字号" }).fill("26");
    await expect
      .poll(async () => {
        const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
        return frame.evaluate(() => getComputedStyle(document.body).fontSize);
      })
      .toBe("26px");

    // 收起之后再离开阅读器。
    await panel.getByRole("button", { name: "关闭面板" }).click();
    await expect(panel).toHaveAttribute("data-open", "false");
    await page.goto("/bookshelf");
    await openBook(page, SAMPLE_BOOK_TITLE);

    // 回来了：还是收起的样子，而不是自己弹开。
    await expect(panel).toHaveAttribute("data-open", "false");
    // 再展开仍是离开前那一屏（排版），字号也还在。
    await page.getByRole("button", { name: "打开目录" }).click();
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(panel.getByRole("tab", { name: "排版" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.getByRole("slider", { name: "字号" })).toHaveValue("26");
  });

  test("scopes typography to one book and restores the current global default (单书排版)", async ({
    page,
  }) => {
    const bookId = await openFreshBook(page, "e2e-reader-typography-scope");
    const panel = page.locator('[data-slot="reader-panel"]');

    await panel.getByRole("tab", { name: "排版" }).click();
    await panel.getByRole("slider", { name: "字号" }).fill("26");
    await expect(panel.getByText("本书已单独调整")).toBeVisible();

    // 设置页读到的仍是全局默认；把它改成 22。
    await page.goto("/setting#reading");
    const globalSize = page.getByRole("slider", { name: "字号" });
    await expect(globalSize).toHaveValue("18");
    await globalSize.fill("22");

    // 回到这本书：本书的 26 压过全局的 22。
    await page.goto(`/reader/${bookId}`);
    await expect(panel.getByRole("tab", { name: "排版" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.getByRole("slider", { name: "字号" })).toHaveValue("26");
    await expect(panel.getByText("本书已单独调整")).toBeVisible();

    // 恢复全局：清掉本书覆盖，落到刚刚改过的全局 22。
    await panel.getByRole("button", { name: "恢复本书为全局默认" }).click();
    await expect(panel.getByText("跟随设置页的全局默认")).toBeVisible();
    await expect(panel.getByRole("slider", { name: "字号" })).toHaveValue("22");
    await expect
      .poll(async () => {
        const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
        return frame.evaluate(() => getComputedStyle(document.body).fontSize);
      })
      .toBe("22px");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("reader-book-prefs") ?? "null"),
    );
    expect(stored.books[String(bookId)]).toBeUndefined();
  });

  test("cycles the panel with t, toggles 排版 with s and the top bar with m (快捷键)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-keys-panel");

    const panel = page.locator('[data-slot="reader-panel"]');
    const selectedTab = panel.locator('[role="tab"][aria-selected="true"]');

    // t：目录 → 备注 → 收起 → 目录。
    await expect(selectedTab).toHaveText("目录");
    await page.keyboard.press("t");
    await expect(selectedTab).toHaveText("备注");
    await page.keyboard.press("t");
    await expect(panel).toHaveAttribute("data-open", "false");
    await page.keyboard.press("t");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(selectedTab).toHaveText("目录");

    // s：排版面板（当前书的覆盖值，回落到全局默认），再按一次收起。
    await page.keyboard.press("s");
    await expect(selectedTab).toHaveText("排版");
    await expect(panel.getByRole("slider", { name: "字号" })).toBeVisible();
    await page.keyboard.press("s");
    await expect(panel).toHaveAttribute("data-open", "false");

    // m：顶栏收掉（同时不可聚焦），再按一次回来。
    const header = page.locator("header");
    await page.keyboard.press("m");
    await expect(header).toHaveJSProperty("inert", true);
    await expect
      .poll(async () => (await header.boundingBox())?.height ?? -1)
      .toBe(0);
    await page.keyboard.press("m");
    await expect(header).toHaveJSProperty("inert", false);
    await expect
      .poll(async () => (await header.boundingBox())?.height ?? 0)
      .toBeGreaterThan(20);
  });

  test("turns pages with the keyboard while the section owns the focus (快捷键)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-keys-page");

    // 点正文之后键盘焦点落在章节 iframe 里（宿主文档收不到键事件）：这正是
    // `adapter.ts#attachSection` 转发 `keydown` 的场景。
    const chapter = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await chapter.locator(`text=${CHAPTER_ONE_TEXT}`).click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe("FOLIATE-VIEW");

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => sectionIndex(page)).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => sectionIndex(page)).toBe(0);
    await expectChapterText(page, CHAPTER_ONE_TEXT);

    await page.keyboard.press(" ");
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    await page.keyboard.press("PageUp");
    await expectChapterText(page, CHAPTER_ONE_TEXT);

    // 连按两下：分页器翻页期间有一把锁，以前第二下会被静默丢掉（`turnPage` 排队）。
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => sectionIndex(page)).toBe(2);
    await expectChapterText(page, SECTION_TWO_ONE_TEXT);
  });

  test("opens the bookmark and shortcut dialogs from the keyboard (快捷键)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-keys-dialogs");

    await page.keyboard.press("b");
    const bookmark = page.getByRole("dialog", { name: "书签标题" });
    await expect(bookmark).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bookmark).toBeHidden();

    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "快捷键" });
    await expect(help).toBeVisible();
    // 说明开着的时候整块键盘让位：t 不该再动面板。
    const panel = page.locator('[data-slot="reader-panel"]');
    const selectedTab = panel.locator('[role="tab"][aria-selected="true"]');
    const tabBefore = await selectedTab.textContent();
    await page.keyboard.press("t");
    await expect(selectedTab).toHaveText(tabBefore ?? "目录");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });

  test("writes the reading progress the shelf shows (书架进度)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-progress");
    // 跳到第二章：书级 fraction 明确 > 0。
    await toc(page)
      .getByRole("button", { name: /^Chapter\s*2$/ })
      .click();
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    // 阅读器每秒轮询一次位置，把它（连同百分比）写进库里。
    await page.waitForTimeout(1500);
    await page.goto("/bookshelf");
    await expect(page.getByText(/^已读 \d+%$/).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("anchors the bubble to a clicked highlight (连续滚动)", async ({
    page,
  }) => {
    // 用户报的正是这条路径：连续滚动里**点已有高亮**，浮窗不在高亮旁边。
    await page.addInitScript(() => {
      localStorage.setItem(
        "reader-prefs",
        JSON.stringify({
          font: "serif",
          size: 18,
          leading: 1.72,
          align: "justify",
          columnWidth: 720,
          layout: "scrolled",
          columns: "auto",
          panelMode: "float",
        }),
      );
    });

    await openAtChapterOne(page, "e2e-reader-scroll-click");

    // 先造一条高亮（选色即创建），确定后它留在库里、浮窗关闭。
    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByRole("radio", { name: "red", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    await editor.getByRole("button", { name: "确定" }).click();
    await expect(editor).toHaveCount(0);

    // 让这一章能滚，然后滚一段（高亮仍在视口内）。
    const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await frame.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "1600px";
      document.body.append(filler);
    });
    await expect
      .poll(async () => (await currentSection(page))?.box?.height ?? 0)
      .toBeGreaterThan(1600);

    const section = await currentSection(page);
    const viewport = page.viewportSize();
    if (!section?.box || !viewport) throw new Error("没有可滚动的章节框");

    /** 高亮文字在**页面坐标**里的上下边（不依赖选区）。 */
    const textRect = async () => {
      const current = await chapterFrame(page, CHAPTER_ONE_TEXT);
      return current.evaluate((needle) => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null = null;
        while ((node = walker.nextNode())) {
          if (node.textContent?.includes(needle)) break;
          node = null;
        }
        if (!node) return undefined;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const frameRect = window.frameElement?.getBoundingClientRect();
        return frameRect
          ? {
              top: rect.top + frameRect.top,
              bottom: rect.bottom + frameRect.top,
            }
          : undefined;
      }, CHAPTER_ONE_TEXT);
    };

    const before = await textRect();
    if (!before) throw new Error("找不到高亮文字");
    await page.mouse.move(
      section.box.x + section.box.width / 2,
      viewport.height - 24,
    );
    await page.mouse.wheel(0, 120);
    await expect
      .poll(async () => before.top - ((await textRect())?.top ?? before.top))
      .toBeGreaterThan(60);

    // 点高亮：overlay 自身不接收指针事件（点击落到章节上，由库的命中测试路由
    // 回来），所以按 overlay 的页面坐标点。
    const overlay = (await overlays(page))[0]?.box;
    if (!overlay) throw new Error("高亮没有几何信息");
    await page.mouse.click(
      overlay.x + overlay.width / 2,
      overlay.y + overlay.height / 2,
    );
    await expect(editor).toBeVisible();

    const gap = async () => {
      const rect = await textRect();
      const bubble = await editor.boundingBox();
      if (!rect || !bubble) throw new Error("浮窗或高亮没有几何信息");
      return Math.min(
        Math.abs(rect.top - (bubble.y + bubble.height)),
        Math.abs(bubble.y - rect.bottom),
      );
    };
    await expect
      .poll(gap, { message: "浮窗应贴着被点击的高亮" })
      .toBeLessThan(20);
  });

  test("turns pages with the previous/next arrows", async ({ page }) => {
    await openAtChapterOne(page, "e2e-reader-paging");

    await page.getByRole("button", { name: "下一页" }).click();
    await expect.poll(() => sectionIndex(page)).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    await page.getByRole("button", { name: "上一页" }).click();
    await expect.poll(() => sectionIndex(page)).toBe(0);
    await expectChapterText(page, CHAPTER_ONE_TEXT);
  });

  test("restores the reading position after a reload", async ({ page }) => {
    await openAtChapterOne(page, "e2e-reader-progress");

    const chapterTwo = toc(page).getByRole("button", { name: /^Chapter\s*2$/ });
    await chapterTwo.click();
    await expect(chapterTwo).toHaveAttribute("aria-current", "true");
    await expect.poll(() => sectionIndex(page)).toBe(1);

    // The progress poll writes the CFI every second once it changed.
    await page.waitForTimeout(1600);
    await page.reload();

    // Without a restore the reader would open on chapter one again, so the
    // rendered section *is* the assertion.
    await expect.poll(() => sectionIndex(page), { timeout: 20_000 }).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);
    await expect(chapterTwo).toHaveAttribute("aria-current", "true");
  });

  test("keeps the expanded TOC entry when switching tabs (A5)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-tabs");

    const expand = toc(page).getByRole("button", {
      name: /^展开\s*Chapter\s*2$/,
    });
    await expand.click();
    await expect(
      toc(page).getByRole("button", { name: /^Section\s*2\.1$/ }),
    ).toBeVisible();

    // Away from 目录 and back: the panel stays mounted, so the manual expansion
    // survives (before A5 the list was unmounted and collapsed again).
    await page.getByRole("tab", { name: "备注" }).click();
    await page.getByRole("tab", { name: "目录" }).click();

    await expect(
      toc(page).getByRole("button", { name: /^Section\s*2\.1$/ }),
    ).toBeVisible();
    await expect(
      toc(page).getByRole("button", { name: /^折叠\s*Chapter\s*2$/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("E9 bookmarks", () => {
  test("creates a bookmark, jumps back to it, renames and deletes it", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-bookmark");

    // Put the reader somewhere the bookmark will have to come back to (a
    // no-op bookmark at the current position would prove nothing).
    const chapterOne = toc(page).getByRole("button", {
      name: /^Chapter\s*1$/,
    });
    const chapterTwo = toc(page).getByRole("button", { name: /^Chapter\s*2$/ });
    await chapterTwo.click();
    await expect(chapterTwo).toHaveAttribute("aria-current", "true");
    await expect.poll(() => sectionIndex(page)).toBe(1);

    // Create: the dialog is prefilled from the current location.
    await page.getByRole("button", { name: "添加书签" }).click();
    const title = page.getByLabel("请输入标题");
    const createdTitle = await title.inputValue();
    // D5: the prefill resolves the CFI against the section its spine position
    // names (chapter two), not against whichever document happens to accept the
    // element path — which used to be chapter one's.
    expect(createdTitle).toBe("Chapter 2");
    await page.getByRole("button", { name: "确定" }).click();
    await expect(page.getByText("书签已添加")).toBeVisible();

    // The 书签 tab lists it (row name = title + selected text). Both come from
    // chapter two: the stored bookmark CFI starts on chapter two's heading.
    await page.getByRole("tab", { name: "书签" }).click();
    await expect(page.getByRole("tab", { name: "书签" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const list = page.getByRole("tabpanel", { name: "书签" }).getByRole("list");
    const row = list.getByRole("button").first();
    await expect(row).toBeVisible();
    await expect(row.getByText(createdTitle, { exact: true })).toHaveCount(2);

    // Read on in chapter 1, then jump back with the bookmark.
    await page.getByRole("tab", { name: "目录" }).click();
    await expect(page.getByRole("tab", { name: "目录" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await chapterOne.click();
    await expect(chapterOne).toHaveAttribute("aria-current", "true");
    await expect.poll(() => sectionIndex(page)).toBe(0);

    await page.getByRole("tab", { name: "书签" }).click();
    await expect(page.getByRole("tab", { name: "书签" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await row.click();

    // The rendition must move even while the 目录 panel is hidden …
    await expect.poll(() => sectionIndex(page)).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);

    // … and the TOC highlight has to follow. It is only observable once 目录 is
    // selected again: an inactive tab panel is `hidden`, i.e. not part of the
    // accessibility tree `getByRole` queries.
    await page.getByRole("tab", { name: "目录" }).click();
    await expect(page.getByRole("tab", { name: "目录" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(chapterTwo).toHaveAttribute("aria-current", "true");

    await page.getByRole("tab", { name: "书签" }).click();
    await expect(page.getByRole("tab", { name: "书签" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Rename: the dialog is prefilled with the stored title.
    await page.getByRole("button", { name: "书签操作" }).click();
    await page.getByRole("menuitem", { name: "修改标题" }).click();
    await expect(page.getByLabel("请输入标题")).toHaveValue(createdTitle);
    await page.getByLabel("请输入标题").fill("我的书签");
    await page.getByRole("button", { name: "确定" }).click();
    await expect(page.getByText("标题已修改")).toBeVisible();
    await expect(list.getByText("我的书签")).toBeVisible();

    // Delete.
    await page.getByRole("button", { name: "书签操作" }).click();
    await page.getByRole("menuitem", { name: "删除" }).click();
    await expect(list.getByText("我的书签")).toHaveCount(0);
  });
});

test.describe("E10 highlights (D15)", () => {
  test("colour pick persists immediately, 确定 saves the annotation, 删除 clears it", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-highlight");

    await dragSelectText(page, CHAPTER_ONE_TEXT);

    // The bubble appears with the "pick a colour to create" hint.
    const editor = page.getByRole("dialog");
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();
    await expect(editor.getByText("选择颜色即可创建高亮")).toBeVisible();

    // D15: picking a colour creates the mark right away (server + overlay).
    await editor.getByRole("radio", { name: "red", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    expect((await overlays(page))[0]).toMatchObject({
      color: "red",
      fill: "#F44336",
    });
    await expect(editor.getByText("选择颜色即可创建高亮")).toHaveCount(0);

    // Annotate + change colour, then confirm.
    await editor.getByRole("radio", { name: "blue", exact: true }).click();
    await editor.getByPlaceholder("评论").fill("我的批注");
    await editor.getByRole("button", { name: "确定" }).click();
    await expect(editor).toHaveCount(0);
    expect((await overlays(page))[0]).toMatchObject({
      color: "blue",
      fill: "#2196F3",
    });

    // The 「备注」list reflects the stored row… (the tab has to be selected
    // before the panel — not the still-mounted 目录 list — is queried).
    const notes = page.getByRole("tab", { name: "备注" });
    await notes.click();
    await expect(notes).toHaveAttribute("aria-selected", "true");
    const list = page.getByRole("tabpanel", { name: "备注" }).getByRole("list");
    await expect(list.getByText(CHAPTER_ONE_TEXT)).toBeVisible();
    await expect(list.getByText("我的批注")).toBeVisible();

    // …and survives a reload, i.e. it really came back from the database.
    await page.reload();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    expect((await overlays(page))[0]).toMatchObject({ color: "blue" });
    await notes.click();
    await expect(notes).toHaveAttribute("aria-selected", "true");
    await expect(list.getByText("我的批注")).toBeVisible();

    // Delete from the list: DOM overlay and row disappear together.
    await page.getByRole("button", { name: "高亮操作" }).click();
    await page.getByRole("menuitem", { name: "删除" }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(0);
    await expect(list.getByText("我的批注")).toHaveCount(0);
  });

  test("a press elsewhere in the body dismisses the selection bubble", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-bubble-dismiss");

    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();

    // The bubble lives in the parent document and outside-press dismissal
    // cannot see presses inside the section iframe. Clicking the body collapses
    // the native selection, so the bubble has to go with it.
    await pressBody(page);

    await expect(editor).toHaveCount(0);

    // A press in the parent document (outside the bubble) is already handled by
    // Base UI's outside-press dismissal; keep both paths pinned.
    await dragSelectText(page, CHAPTER_ONE_TEXT);
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await expect(editor).toHaveCount(0);
  });

  test("a body press cancels the session, rolling back the colour-picked mark", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-bubble-cancel");

    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await editor.getByRole("radio", { name: "red", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);

    // Same path as 取消: the press is an outside press, so the draft this
    // session created must not survive it.
    await pressBody(page);
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await overlays(page)).length).toBe(0);
  });

  test("clicking a highlight while a selection bubble is open opens the mark editor", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-bubble-switch");

    // Persist a highlight with a note.
    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await editor.getByRole("radio", { name: "blue", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    await editor.getByPlaceholder("评论").fill("切换测试");
    await editor.getByRole("button", { name: "确定" }).click();
    await expect(editor).toHaveCount(0);

    // Open a *different* session first: the click on the mark arrives as
    // pointerdown (which dismisses this selection) followed by markClicked, and
    // the queued collapse of the native selection must not close the new one.
    // Confirm leaves the first selection in place; a new drag has to start
    // outside it or Chromium would drag-and-drop the selected text instead.
    await pressBody(page);
    await dragSelectText(page, CHAPTER_ONE_TEXT);
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();

    const overlay = (await overlays(page))[0]?.box;
    if (!overlay) throw new Error("the highlight overlay has no box");
    await page.mouse.click(
      overlay.x + overlay.width / 2,
      overlay.y + overlay.height / 2,
    );

    await expect(editor).toBeVisible();
    await expect(editor.getByPlaceholder("评论")).toHaveValue("切换测试");
    await expect(
      editor.getByRole("radio", { name: "blue", exact: true }),
    ).toBeChecked();
  });

  test("取消 rolls back the mark created by the colour pick (D15)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-rollback");

    // Baseline of the 「备注」 list *after* a fresh load, so a row left behind by
    // another test cannot be mistaken for the rolled-back mark. Wait for the tab
    // to actually be selected first: counting while 目录 is still mounted reads
    // the TOC's buttons instead of the mark rows.
    const notesTab = page.getByRole("tab", { name: "备注" });
    await notesTab.click();
    await expect(notesTab).toHaveAttribute("aria-selected", "true");
    const rows = page
      .getByRole("tabpanel", { name: "备注" })
      .getByRole("list")
      .getByRole("button");
    const before = await rows.count();

    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();

    await editor.getByRole("radio", { name: "teal", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);

    await editor.getByRole("button", { name: "取消" }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(0);

    // Nothing was left behind in the database either: a reload refetches the
    // list from the server.
    await page.reload();
    await notesTab.click();
    await expect(notesTab).toHaveAttribute("aria-selected", "true");
    await expect(rows).toHaveCount(before);
  });

  test("reopening a saved highlight reads the stored row and 确定 keeps it (A3)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-highlight-reopen");

    await dragSelectText(page, CHAPTER_ONE_TEXT);
    const editor = page.getByRole("dialog");
    await expect(
      editor.getByRole("radiogroup", { name: "高亮颜色" }),
    ).toBeVisible();

    // Create (red), annotate and recolour (blue), then confirm.
    await editor.getByRole("radio", { name: "red", exact: true }).click();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    await editor.getByPlaceholder("评论").fill("我的批注");
    await editor.getByRole("radio", { name: "blue", exact: true }).click();
    await editor.getByRole("button", { name: "确定" }).click();
    await expect(editor).toHaveCount(0);
    expect((await overlays(page))[0]).toMatchObject({ color: "blue" });

    // Reopen the editor from the highlight: it must show the stored row, not
    // the row this session started from. The overlay itself ignores pointer
    // events, so the click lands on the section underneath and the library's
    // hit test routes it back to the mark.
    const overlay = (await overlays(page))[0]?.box;
    if (!overlay) throw new Error("the highlight overlay has no box");
    await page.mouse.click(
      overlay.x + overlay.width / 2,
      overlay.y + overlay.height / 2,
    );
    await expect(editor).toBeVisible();
    await expect(editor.getByPlaceholder("评论")).toHaveValue("我的批注");
    await expect(
      editor.getByRole("radio", { name: "blue", exact: true }),
    ).toBeChecked();

    // 确定 writes the same row back: before A3 it wrote the stale colour and an
    // empty annotation, silently dropping the note.
    await editor.getByRole("button", { name: "确定" }).click();
    await expect(editor).toHaveCount(0);
    expect((await overlays(page))[0]).toMatchObject({
      color: "blue",
      fill: "#2196F3",
    });

    // The database still holds it (and the overlay renders it after a reload).
    await page.reload();
    await expect.poll(async () => (await overlays(page)).length).toBe(1);
    expect((await overlays(page))[0]).toMatchObject({ color: "blue" });
    const notes = page.getByRole("tab", { name: "备注" });
    await notes.click();
    await expect(notes).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("tabpanel", { name: "备注" })
        .getByRole("list")
        .getByText("我的批注"),
    ).toBeVisible();
  });
});

test.describe("E11 image preview", () => {
  test("opens a full-screen viewer for an in-chapter image and closes it", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-image");

    const chapterOne = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await chapterOne.locator(`role=img[name="${INLINE_IMAGE_ALT}"]`).click();

    const viewer = page.getByRole("dialog", { name: "图片预览" });
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "关闭" }).click();
    await expect(viewer).toBeHidden();
  });

  test("zooms continuously with the wheel instead of re-fitting (滚轮放大)", async ({
    page,
  }) => {
    await openAtChapterOne(page, "e2e-reader-image-zoom");

    const chapterOne = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await chapterOne.locator(`role=img[name="${INLINE_IMAGE_ALT}"]`).click();

    const viewer = page.getByRole("dialog", { name: "图片预览" });
    const photo = viewer.locator("img");
    /** 图片当前的 `scale()`（适配屏幕 = 1）。 */
    const scale = () =>
      photo.evaluate((el) => {
        const matrix = getComputedStyle(el).transform;
        return matrix === "none"
          ? 1
          : Number(/matrix\(([-\d.]+)/.exec(matrix)?.[1] ?? 1);
      });

    await expect.poll(scale).toBe(1);

    const box = await photo.boundingBox();
    if (!box) throw new Error("预览里没有图片");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -40);
    const once = await scale();
    await page.mouse.wheel(0, -40);
    const twice = await scale();

    // 一格滚轮只放大一点点（同一份状态上乘一次），而不是跳到某个档位重新适配。
    expect(once).toBeGreaterThan(1);
    expect(once).toBeLessThan(1.2);
    expect(twice).toBeGreaterThan(once);

    // 单击空白处（图片之外）关闭预览。
    await page.mouse.click(24, 24);
    await expect(viewer).toBeHidden();
  });
});

test.describe("E12 in-book links (D6)", () => {
  test("navigates in place for internal links", async ({ page }) => {
    await openAtChapterOne(page, "e2e-reader-links");
    const readerUrl = page.url();

    const chapterOne = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await chapterOne.locator(`role=link[name="${INTERNAL_LINK_TEXT}"]`).click();

    // The link targets chapter two and the library navigates the rendition
    // itself (the adapter leaves internal links alone).
    await expect.poll(() => sectionIndex(page)).toBe(1);
    await expectChapterText(page, CHAPTER_TWO_TEXT);
    await expect(
      toc(page).getByRole("button", { name: /^Chapter\s*2$/ }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      toc(page).getByRole("button", { name: /^Chapter\s*1$/ }),
    ).not.toHaveAttribute("aria-current", "true");

    expect(page.url()).toBe(readerUrl);
  });
});

test.describe("E13 current section", () => {
  test("reports the rendered section and its TOC entry", async ({ page }) => {
    await openAtChapterOne(page, "e2e-reader-section");

    const section = await currentSection(page);

    expect(section?.index).toBe(0);
    expect(section?.href).toBe("OEBPS/text/chapter1.xhtml");
    expect(section?.text).toContain(CHAPTER_ONE_TEXT);
  });
});
