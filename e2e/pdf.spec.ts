import { expect, test } from "./fixtures";
import { openBook, signInAsFreshReader, uploadPdf } from "./helpers";

test("uploads, renders, navigates and zooms a PDF", async ({ page }) => {
  const rangeStatuses: number[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      response.url().includes("/pdf")
    ) {
      rangeStatuses.push(response.status());
    }
  });
  await signInAsFreshReader(page, "pdf-reader");
  await uploadPdf(page);
  await expect(
    page.getByRole("button", { name: "Sample PDF 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });

  await openBook(page, "Sample PDF");
  await expect(page.getByRole("heading", { name: "Sample PDF" })).toBeVisible();
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".pdf-textLayer span").first()).toBeVisible({
    timeout: 20_000,
  });

  // Continuous mode: the page counter follows the topmost page.
  await expect(page.getByText("1 / 3")).toBeVisible();
  await page.locator(".pdf-scroll").evaluate((element) => {
    const second = element.querySelector<HTMLElement>(
      '.pdf-page-shell[data-page="1"]',
    );
    element.scrollTo({
      top: second?.offsetTop ?? element.clientHeight,
      behavior: "auto",
    });
  });
  await expect(page.getByText("2 / 3")).toBeVisible({ timeout: 10_000 });

  // Zoom controls are desktop-only and sit next to the bookmark button.
  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.getByLabel("缩放比例")).toContainText("%");

  // Switch to paged mode; its bottom bar has explicit page buttons.
  const panel = page.locator('[data-slot="reader-panel"]');
  await panel.getByRole("tab", { name: "显示" }).click();
  await expect(panel.getByRole("tab", { name: "显示" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await panel.getByRole("button", { name: "单页分页" }).click();
  await expect(page.getByRole("button", { name: "下一页" })).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => rangeStatuses.some((status) => status === 206))
    .toBe(true);
});

test("restores the last PDF page after reload", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-progress");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 20_000 });

  await page.locator('.pdf-page-shell[data-page="1"]').scrollIntoViewIfNeeded();
  await expect(page.getByText("2 / 3")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByText("2 / 3")).toBeVisible({ timeout: 20_000 });
});

test("jumps through the PDF outline", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-toc");
  await uploadPdf(page);
  await openBook(page, "Sample PDF");
  const panel = page.locator('[data-slot="reader-panel"]');
  await expect(panel.getByRole("button", { name: "Page three" })).toBeVisible({
    timeout: 20_000,
  });
  await panel.getByRole("button", { name: "Page three" }).click();
  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 10_000 });
});
