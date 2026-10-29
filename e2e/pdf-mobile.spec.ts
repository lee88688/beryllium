import { expect, test } from "./fixtures";
import { openBook, signInAsFreshReader, uploadPdf } from "./helpers";

test.describe("PDF mobile page indicator", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hides on scroll down and returns on scroll up", async ({ page }) => {
    await signInAsFreshReader(page, "pdf-mobile-indicator");
    await uploadPdf(page);
    await openBook(page, "Sample PDF");
    await expect(page.locator(".pdf-page-shell")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect(page.locator(".pdf-textLayer span").first()).toBeVisible();

    const indicator = page.locator('[data-slot="pdf-page-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 20_000 });
    const opacity = () =>
      indicator.evaluate((element) => getComputedStyle(element).opacity);

    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 700);
    await expect.poll(opacity).toBe("0");

    await page.mouse.wheel(0, -700);
    await expect.poll(opacity).toBe("1");
  });
});

test.describe("PDF mobile horizontal pan", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a zoomed page can scroll to both horizontal edges", async ({
    page,
  }) => {
    await signInAsFreshReader(page, "pdf-mobile-horizontal");
    await uploadPdf(page);
    await openBook(page, "Sample PDF");
    await expect(page.locator(".pdf-textLayer span").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.mouse.move(200, 400);
    await page.keyboard.down("Control");
    for (let step = 0; step < 4; step += 1) {
      await page.mouse.wheel(0, -120);
    }
    await page.keyboard.up("Control");

    const scroller = page.locator(".pdf-scroll");
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThan(0);

    const gaps = await scroller.evaluate((el) => {
      const pageEl = el.querySelector<HTMLElement>(".pdf-page");
      if (!pageEl) throw new Error("missing page");
      el.scrollLeft = 0;
      const scroll = el.getBoundingClientRect();
      const left = pageEl.getBoundingClientRect().left - scroll.left;
      el.scrollLeft = el.scrollWidth;
      const right = scroll.right - pageEl.getBoundingClientRect().right;
      return { left, right };
    });
    expect(gaps.left).toBeGreaterThanOrEqual(-1);
    expect(gaps.right).toBeGreaterThanOrEqual(-1);
  });
});
