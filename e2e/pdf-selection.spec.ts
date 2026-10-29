import { expect, test } from "./fixtures";
import { openBook, signInAsFreshReader, uploadPdf } from "./helpers";

test("keeps the selection bubble closed until the mouse is released", async ({
  page,
}) => {
  await signInAsFreshReader(page, "pdf-selection-drag");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 20_000 });

  const spans = page.locator(".pdf-textLayer").first().locator("span");
  await expect(spans.first()).toBeVisible();
  const metrics = await spans.first().evaluate((el) => {
    const pageEl = el.closest<HTMLElement>(".pdf-page");
    const style = getComputedStyle(el);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      fontHeight: Number.parseFloat(style.getPropertyValue("--font-height")),
      scale: pageEl
        ? Number.parseFloat(
            getComputedStyle(pageEl).getPropertyValue("--scale-factor"),
          )
        : Number.NaN,
    };
  });
  // pdf.js positions glyphs with `--font-height` and scales them with
  // `--total-scale-factor`; if that variable is missing the transparent text
  // layer falls back to a tiny font and native selection no longer covers the
  // painted Chinese glyphs.
  expect(metrics.fontSize).toBeCloseTo(metrics.fontHeight * metrics.scale, 1);
  const first = await spans.nth(0).boundingBox();
  const last = await spans
    .nth(Math.min((await spans.count()) - 1, 3))
    .boundingBox();
  if (!first || !last) throw new Error("missing text spans");

  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    last.x + Math.max(2, last.width - 2),
    last.y + last.height / 2,
    { steps: 12 },
  );

  // A drag can pause for longer than the selection debounce; the bubble must
  // still wait for pointerup instead of covering the text being selected.
  await page.waitForTimeout(500);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain("Sample PDF");
  await expect(
    page.getByRole("radio", { name: "red", exact: true }),
  ).toHaveCount(0);

  await page.mouse.up();
  await expect(
    page.getByRole("radio", { name: "red", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});
