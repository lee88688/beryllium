import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  SAMPLE_BOOK_TITLE,
  signInAsFreshReader,
  uploadSampleBook,
} from "./helpers";

const CATEGORY_NAME = "测试分类";

function moreButton(page: Page) {
  return page.getByRole("button", { name: `${SAMPLE_BOOK_TITLE} 更多操作` });
}

test.describe("E6 categories", () => {
  test("creates a category, filters by it, removes the book and deletes it again", async ({
    page,
  }) => {
    await signInAsFreshReader(page, "e2e-categories");
    await uploadSampleBook(page);

    // 1. create the category from the drawer.
    await page.getByRole("button", { name: "创建分类" }).click();
    await page.getByLabel("输入类别名称").fill(CATEGORY_NAME);
    await page.getByRole("button", { name: "创建" }).click();

    // The permanent sidebar (`aside`) holds the navigation.
    const drawer = page.getByRole("complementary");
    const category = drawer.getByRole("button", { name: CATEGORY_NAME });
    await expect(category).toBeVisible();

    // 2. add the book to it.
    await moreButton(page).click();
    await page.getByRole("menuitem", { name: "添加到分类" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: CATEGORY_NAME })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("添加成功")).toBeVisible();

    // 3. filter: only that book, no upload tile.
    await category.click();
    await expect(category).toHaveAttribute("aria-current", "true");
    await expect(moreButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "上传书籍" })).toHaveCount(0);

    // 4. remove it from the category (confirmed).
    await moreButton(page).click();
    await page.getByRole("menuitem", { name: "从分类中删除" }).click();
    const removeDialog = page.getByRole("alertdialog");
    await expect(removeDialog).toContainText("移除书籍");
    await expect(removeDialog).toContainText("是否从当前分类中移除书籍？");
    await removeDialog.getByRole("button", { name: "确定" }).click();
    await expect(moreButton(page)).toHaveCount(0);

    // 5. delete the category, falling back to 我的书籍 (confirmed).
    await page.getByRole("button", { name: "分类操作" }).click();
    await page.getByRole("menuitem", { name: "删除类别" }).click();
    const deleteDialog = page.getByRole("alertdialog");
    await expect(deleteDialog).toContainText("删除分类");
    await expect(deleteDialog).toContainText("是否删除当前分类？");
    await deleteDialog.getByRole("button", { name: "确定" }).click();

    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();
    await expect(moreButton(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "我的书籍" }),
    ).toHaveAttribute("aria-current", "true");
  });
});

test.describe("E7 delete a book", () => {
  test("asks for confirmation, removes the card and keeps it removed after a reload", async ({
    page,
  }) => {
    await signInAsFreshReader(page, "e2e-delete");
    await uploadSampleBook(page);

    await moreButton(page).click();
    await page.getByRole("menuitem", { name: "删除书籍" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("删除书籍");
    await expect(dialog).toContainText("删除书籍会移除书籍相关标记和书签");
    await dialog.getByRole("button", { name: "确定" }).click();

    await expect(moreButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "上传书籍" })).toBeVisible();
    await expect(moreButton(page)).toHaveCount(0);
  });
});
