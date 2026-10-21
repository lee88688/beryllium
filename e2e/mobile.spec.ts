import { expect, test } from "./fixtures";
import {
  ADMIN_CREDENTIALS,
  CHAPTER_ONE_TEXT,
  expectChapterText,
  installVirtualKeyboardStub,
  openFreshBook,
  showVirtualKeyboard,
  signIn,
} from "./helpers";

test.describe("E14 mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bookshelf: the drawer opens from the hamburger and closes again", async ({
    page,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);
    await expect(page.getByRole("button", { name: "打开菜单" })).toBeVisible();
    // The permanent sidebar is not part of the mobile layout.
    await expect(page.getByRole("button", { name: "我的书籍" })).toBeHidden();

    await page.getByRole("button", { name: "打开菜单" }).click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByRole("button", { name: "我的书籍" }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "退出登陆" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("reader: the page arrows are hidden and the panel lives in a drawer", async ({
    page,
  }) => {
    await openFreshBook(page, "e2e-mobile-panel");

    await expect(page.getByRole("button", { name: "上一页" })).toBeHidden();
    await expect(page.getByRole("button", { name: "下一页" })).toBeHidden();

    await page.getByRole("button", { name: "打开目录" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("tab", { name: "目录" })).toBeVisible();
    await drawer.getByRole("tab", { name: "书签" }).click();
    await expect(drawer.getByRole("tab", { name: "书签" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("docks a dialog above the virtual keyboard", async ({ page }) => {
    // The Virtual Keyboard API is absent in desktop Chromium and headless
    // Chromium never shows a real keyboard, so the API is stubbed (see
    // `installVirtualKeyboardStub`) and driven through the same
    // `geometrychange` contract the hook consumes.
    await installVirtualKeyboardStub(page);
    await openFreshBook(page, "e2e-mobile-keyboard");
    await expectChapterText(page, CHAPTER_ONE_TEXT);

    await page.getByRole("button", { name: "添加书签" }).click();
    const dialog = page.locator('[data-slot="dialog-kb"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-docked", "true");

    await showVirtualKeyboard(page, 300);
    await expect(dialog).toHaveAttribute("data-docked", "true");
    await expect(dialog).toHaveCSS("bottom", "300px");

    await showVirtualKeyboard(page, 0);
    await expect(dialog).not.toHaveAttribute("data-docked", "true");
  });
});
