import { expect, test } from "./fixtures";
import {
  ADMIN_CREDENTIALS,
  CHAPTER_ONE_TEXT,
  chapterFrame,
  openFreshBook,
  signIn,
} from "./helpers";

test.describe("E13 theme", () => {
  test("three-state menu, current state disabled, localStorage and cross-context persistence", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);

    const trigger = page.getByRole("button", { name: /^主题：/ });
    await expect(trigger).toHaveAttribute("aria-label", "主题：跟随系统");

    await trigger.click();
    await expect(
      page.getByRole("menuitem", { name: "跟随系统" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("menuitem", { name: "深色" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    await page.getByRole("menuitem", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(trigger).toHaveAttribute("aria-label", "主题：深色");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
      "dark",
    );

    // A second context restored from the same storage state is dark too.
    const state = await context.storageState();
    const second = await browser.newContext({ storageState: state });
    const other = await second.newPage();
    try {
      await other.goto("/bookshelf");
      await expect(other.locator("html")).toHaveClass(/dark/);
    } finally {
      await second.close();
    }
  });

  test("paints the book page with the dark palette colours", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });

    await openFreshBook(page, "e2e-theme-dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const frame = await chapterFrame(page, CHAPTER_ONE_TEXT);
    await expect
      .poll(() =>
        frame
          .locator("body")
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(224, 224, 224)");
    await expect
      .poll(() =>
        frame
          .locator("body")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe("rgb(34, 34, 34)");
  });
});
