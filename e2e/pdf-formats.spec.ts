import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { openBook, signInAsFreshReader, toast, uploadPdfFile } from "./helpers";

test("uses the filename when a PDF has no title metadata", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-no-outline");
  await uploadPdfFile(page, "no-outline.pdf");
  await expect(
    page.getByRole("button", { name: "no-outline 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "no-outline");
  await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 20_000 });
  const panel = page.locator('[data-slot="reader-panel"]');
  await panel.getByRole("tab", { name: "目录" }).click();
  await expect(panel.getByText("Page one")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "第 1 页" })).toBeVisible();
  await panel.getByRole("button", { name: "第 2 页" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible({ timeout: 10_000 });
});

test("renders a scanned page without a text layer", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-scanned");
  await uploadPdfFile(page, "scanned.pdf");
  await expect(
    page.getByRole("button", { name: "Scanned Page 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Scanned Page");
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".pdf-textLayer span")).toHaveCount(0);
});

test("rejects an encrypted PDF before upload", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-encrypted");
  await uploadPdfFile(page, "encrypted.pdf");
  await expect(toast(page, "error")).toContainText("加密", {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Encrypted PDF 更多操作" }),
  ).toHaveCount(0);
});

test("rejects a corrupt PDF before upload", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-corrupt");
  const corrupt = readFileSync(
    path.resolve("tests/fixtures/no-outline.pdf"),
  ).subarray(0, 40);
  await page.setInputFiles('input[type="file"]', {
    name: "corrupt.pdf",
    mimeType: "application/pdf",
    buffer: corrupt,
  });
  await expect(toast(page, "error")).toContainText("PDF", {
    timeout: 20_000,
  });
});

test("opens a 60-page PDF and keeps its page count", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-many");
  await uploadPdfFile(page, "many-pages.pdf");
  await expect(
    page.getByRole("button", { name: "Many Pages 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Many Pages");
  await expect(page.getByText("1 / 60")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-page-shell")).toHaveCount(60);
});

test("relayouts mixed page sizes", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-mixed");
  await uploadPdfFile(page, "mixed-pages.pdf");
  await expect(
    page.getByRole("button", { name: "Mixed Pages 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Mixed Pages");
  await expect(page.getByText("1 / 4")).toBeVisible({ timeout: 20_000 });
  await page.locator('.pdf-page-shell[data-page="1"]').scrollIntoViewIfNeeded();
  await expect(page.getByText("2 / 4")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".pdf-page canvas").nth(1)).toBeVisible();
});

test("opens a PDF whose first page is blank", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-blank-first");
  await uploadPdfFile(page, "blank-first.pdf");
  await expect(
    page.getByRole("button", { name: "Blank First Page 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Blank First Page");
  await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 20_000 });
  await page.locator('.pdf-page-shell[data-page="1"]').scrollIntoViewIfNeeded();
  await expect(page.getByText("2 / 2")).toBeVisible({ timeout: 10_000 });
});

test("jumps to an outline destination", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-outline-jump");
  await uploadPdfFile(page, "sample.pdf");
  await expect(
    page.getByRole("button", { name: "Sample PDF 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Sample PDF");
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 20_000 });

  const panel = page.locator('[data-slot="reader-panel"]');
  await panel.getByRole("tab", { name: "目录" }).click();
  await panel.getByRole("button", { name: "Page three" }).click();
  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 10_000 });
});

test("does not render pages crossed by a long TOC jump", async ({ page }) => {
  await signInAsFreshReader(page, "pdf-long-jump");
  await uploadPdfFile(page, "many-pages.pdf");
  await expect(
    page.getByRole("button", { name: "Many Pages 更多操作" }),
  ).toBeVisible({ timeout: 20_000 });
  await openBook(page, "Many Pages");
  await expect(page.getByText("1 / 60")).toBeVisible({ timeout: 20_000 });

  const panel = page.locator('[data-slot="reader-panel"]');
  await panel.getByRole("tab", { name: "目录" }).click();
  await panel.getByRole("button", { name: "第 60 页" }).click();

  // The smooth scroll passes page 30; its shell must stay a placeholder.
  await page.waitForTimeout(100);
  await expect(
    page.locator('.pdf-page-shell[data-page="30"] .pdf-textLayer span'),
  ).toHaveCount(0);
  await expect(page.getByText("60 / 60")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('.pdf-page-shell[data-page="59"] .pdf-textLayer span').first(),
  ).toBeVisible({ timeout: 10_000 });
});
