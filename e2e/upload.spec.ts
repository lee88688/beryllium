import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "./fixtures";
import {
  SAMPLE_BOOK_AUTHOR,
  SAMPLE_BOOK_TITLE,
  ZIP_SLIP_EPUB_PATH,
  expectBookCard,
  signInAsFreshReader,
  toast,
  uploadEpub,
} from "./helpers";

test.describe("E4 upload", () => {
  test("shows the sticky progress toast, the OPF metadata and a decoded cover (D1)", async ({
    page,
  }) => {
    await signInAsFreshReader(page, "e2e-upload");
    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();

    // Hold the request so the sticky toast is observable instead of racing the
    // (fast) local upload.
    await page.route("**/api/books", async (route) => {
      await delay(1500);
      await route.continue();
    });

    await uploadEpub(page);
    await expect(
      page.getByText("正在上传文件，请不进行其他操作"),
    ).toBeVisible();

    await expectBookCard(page);
    await expect(page.getByText("正在上传文件，请不进行其他操作")).toHaveCount(
      0,
    );
    await page.unroute("**/api/books");

    await expect(
      page.getByText(SAMPLE_BOOK_TITLE, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(SAMPLE_BOOK_AUTHOR)).toBeVisible();

    // D1 regression: the cover has to be a real, decodable image. The fixture
    // ships a 2×2 PNG, so a decoded size is an exact assertion — `naturalWidth
    // > 0` would also pass for a 1×1 placeholder (W14).
    const cover = page.getByAltText(`${SAMPLE_BOOK_TITLE} 封面`, {
      exact: true,
    });
    await expect(cover).toBeVisible();
    await expect
      .poll(() =>
        cover.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete
            ? `${String(image.naturalWidth)}x${String(image.naturalHeight)}`
            : "loading";
        }),
      )
      .toBe("2x2");
  });
});

test.describe("E5 upload failure", () => {
  test("surfaces the error and adds no card (D5)", async ({ page }) => {
    await signInAsFreshReader(page, "e2e-upload-invalid");
    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();

    await uploadEpub(page, ZIP_SLIP_EPUB_PATH);

    const failure = toast(page, "error").first();
    await expect(failure).toBeVisible({ timeout: 15_000 });
    await expect(failure).toHaveText(/traversal|not a readable EPUB/);

    // No book was added and the upload tile is still the only tile.
    await expect(
      page.getByRole("button", { name: `${SAMPLE_BOOK_TITLE} 更多操作` }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();
  });
});
