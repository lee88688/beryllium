import { expect, test } from "./fixtures";
import {
  HOSTILE_BOOK_TITLE,
  HOSTILE_CHAPTER_TEXT,
  HOSTILE_EXTERNAL_LINK_TEXT,
  HOSTILE_EXTERNAL_URL,
  HOSTILE_INLINE_IMAGE_ALT,
  HOSTILE_SCRIPT_FLAG,
  chapterFrame,
  expectChapterText,
  openHostileBook,
  sectionFlag,
  sectionProbe,
} from "./helpers";

/**
 * A1/A2 regression: a book must not be able to run code in the reader, and the
 * two interactions a chapter legitimately needs (image preview, external links)
 * must keep working through the parent document instead of an injected script.
 *
 * The reader moved from epubjs to foliate-js, which renders every section from
 * a `blob:` URL in an iframe whose sandbox is fixed to
 * `allow-same-origin allow-scripts` — the flag epubjs used to withhold. Two
 * other layers carry the guarantee now, and both are asserted here: the section
 * markup is sanitised before it becomes a document (so a chapter's own script
 * never exists), and the document-level CSP the blob document inherits refuses
 * to execute any inline script that still reaches it.
 */
test.describe("A1 chapter scripts never run", () => {
  test("renders the book with the chapter script removed", async ({ page }) => {
    await openHostileBook(page, "e2e-reader-script");
    await expectChapterText(page, HOSTILE_CHAPTER_TEXT);
    await expect(
      page.getByRole("heading", { name: HOSTILE_BOOK_TITLE }),
    ).toBeVisible();

    const sections = await sectionProbe(page);

    // The hostile fixture has a single spine item: one section, never two.
    expect(sections).toHaveLength(1);
    expect(sections[0]?.sandbox).toBe("allow-same-origin allow-scripts");
    // Sanitised markup: neither the chapter's `<script>` nor its `on*`
    // attributes survive into the rendered document.
    expect(sections[0]?.scripts).toBe(0);
    expect(sections[0]?.handlers).toBe(0);

    // The flag is read from the section's own window.
    expect(await sectionFlag(page, HOSTILE_SCRIPT_FLAG)).toEqual([undefined]);
  });

  test("blocks a script that is injected into the section document", async ({
    page,
  }) => {
    // Defence in depth: even with the script *in* the document (as if the
    // sanitiser had missed a vector), the CSP the blob document inherits from
    // the reader page must refuse to run it. The deliberate violation is
    // allowlisted in `fixtures.ts`.
    await openHostileBook(page, "e2e-reader-csp");
    // The view is appended once the book is built, so wait for the first render.
    await expectChapterText(page, HOSTILE_CHAPTER_TEXT);

    await page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as {
        renderer: { getContents(): { doc: Document }[] };
      };
      const doc = view.renderer.getContents()[0]?.doc;
      if (!doc) throw new Error("no rendered section");
      const script = doc.createElement("script");
      script.textContent = "window.__csp_probe = true";
      doc.body.append(script);
    });

    // Give the (blocked) script every chance to run before reading the flag.
    await page.waitForTimeout(200);
    expect(await sectionFlag(page, "__csp_probe")).toEqual([undefined]);
  });

  test("still previews an in-chapter image without a script in the section", async ({
    page,
  }) => {
    await openHostileBook(page, "e2e-reader-script-image");

    const chapter = await chapterFrame(page, HOSTILE_CHAPTER_TEXT);
    await chapter
      .locator(`role=img[name="${HOSTILE_INLINE_IMAGE_ALT}"]`)
      .click();

    const viewer = page.getByRole("dialog", { name: "图片预览" });
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "关闭" }).click();
    await expect(viewer).toBeHidden();
  });
});

test.describe("A2 external links open a real tab", () => {
  test("opens the in-book external link in a new page", async ({ page }) => {
    await openHostileBook(page, "e2e-reader-external");
    const readerUrl = page.url();

    // Keep the popup deterministic and offline: the target is fulfilled
    // locally instead of reaching the network.
    await page.context().route(`${HOSTILE_EXTERNAL_URL}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>external probe</h1>",
      }),
    );

    const chapter = await chapterFrame(page, HOSTILE_CHAPTER_TEXT);
    const popupPromise = page.context().waitForEvent("page");
    await chapter
      .locator(`role=link[name="${HOSTILE_EXTERNAL_LINK_TEXT}"]`)
      .click();
    const popup = await popupPromise;

    await popup.waitForLoadState();
    expect(popup.url()).toBe(HOSTILE_EXTERNAL_URL);
    // The reader opens the tab itself, so the book never gets a handle on it.
    // `noopener` really took effect: the tab cannot reach the reader through
    // `window.opener` (Playwright's own `opener()` reports the relationship at
    // the browser level, which is not what the book could abuse).
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    // The reader itself stayed on the same page.
    expect(page.url()).toBe(readerUrl);
    await expect(popup.getByRole("heading")).toHaveText("external probe");
    await popup.close();
  });
});
