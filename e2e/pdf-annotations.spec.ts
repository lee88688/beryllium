import { expect, test } from "./fixtures";
import { openBook, signInAsFreshReader, uploadPdf } from "./helpers";

test("selects text, creates a PDF highlight and persists it", async ({
  page,
}) => {
  await signInAsFreshReader(page, "pdf-annotations");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");

  const textLayer = page.locator(".pdf-textLayer").first();
  await expect(textLayer.locator("span").first()).toBeVisible({
    timeout: 20_000,
  });
  await textLayer.evaluate((layer) => {
    const range = document.createRange();
    range.selectNodeContents(layer);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const red = page.getByRole("radio", { name: "red" });
  await expect(red).toBeVisible();
  await red.click();
  await expect(page.locator(".pdf-highlight").first()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".pdf-highlight").first()).toBeVisible({
    timeout: 10_000,
  });

  // Click the element itself: a previously computed bounding box goes stale
  // when the PDF layer scrolls/reflows, and the old `if (box)` silently skipped
  // the click, making the editor assertion fail for the wrong reason.
  const highlight = page.locator(".pdf-highlight").first();
  await expect(highlight).toBeVisible({ timeout: 10_000 });
  // The highlight layer is `pointer-events: none` by design; the reader maps
  // the click by page coordinates. A normal click is blocked by the text layer
  // above it, so click the highlight's current centre with actionability off.
  await highlight.scrollIntoViewIfNeeded();
  await highlight.click({ force: true });
  await expect(
    page.getByRole("radio", { name: "red", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await page.reload();
  await expect(page.locator(".pdf-highlight").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("adds a page bookmark", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-bookmark");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "添加书签" }).click();
  await expect(page.getByRole("dialog", { name: "书签标题" })).toBeVisible();
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("书签已添加")).toBeVisible({ timeout: 10_000 });

  const panel = page.locator('[data-slot="reader-panel"]');
  await panel.getByRole("tab", { name: "书签" }).click();
  await expect(panel.getByText("第 1 页")).toBeVisible();
});

test("creates a cross-page PDF highlight", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-cross-page");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");

  const layers = page.locator(".pdf-textLayer");
  await expect(layers.nth(1).locator("span").first()).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(() => {
    const layers = document.querySelectorAll(".pdf-textLayer");
    const first = layers[0]?.querySelector("span");
    const second = layers[1]?.querySelector("span");
    if (!first || !second || !first.firstChild || !second.firstChild) return;
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, second.firstChild.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.getByRole("radio", { name: "red", exact: true }).click();
  await expect
    .poll(() => page.locator(".pdf-highlight").count())
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "确定" }).click();
  await page.reload();
  await expect
    .poll(() => page.locator(".pdf-highlight").count())
    .toBeGreaterThan(1);
});
