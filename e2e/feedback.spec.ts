import { expect, test } from "./fixtures";
import {
  ADMIN_CREDENTIALS,
  CHAPTER_ONE_TEXT,
  READER_PASSWORD,
  SAMPLE_BOOK_TITLE,
  expectChapterText,
  openBook,
  signIn,
  signInAsFreshReader,
  toast,
  uploadSampleBook,
} from "./helpers";

test.describe("E15 feedback", () => {
  test("turns a server error into a toast (acting on an already deleted book)", async ({
    page,
    context,
  }) => {
    await signInAsFreshReader(page, "e2e-feedback");
    await uploadSampleBook(page);
    await openBook(page);
    await expectChapterText(page, CHAPTER_ONE_TEXT);

    // Another tab of the same session deletes the book.
    const shelf = await context.newPage();
    await shelf.goto("/bookshelf");
    await shelf
      .getByRole("button", { name: `${SAMPLE_BOOK_TITLE} 更多操作` })
      .click();
    await shelf.getByRole("menuitem", { name: "删除书籍" }).click();
    await shelf
      .getByRole("alertdialog")
      .getByRole("button", { name: "确定" })
      .click();
    await expect(
      shelf.getByRole("button", { name: `${SAMPLE_BOOK_TITLE} 更多操作` }),
    ).toHaveCount(0);
    await shelf.close();

    // The reader still shows the book: adding a bookmark for it must fail visibly.
    await page.getByRole("button", { name: "添加书签" }).click();
    await page.getByRole("button", { name: "确定" }).click();
    await expect(toast(page, "error")).toBeVisible();
  });

  test("asks for confirmation before an admin deletes a user (取消 keeps the row)", async ({
    page,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);
    await page.goto("/setting#users");

    // A unique account per attempt (F2): a Playwright retry reuses the server
    // database, and re-creating an existing username answers an error toast
    // instead of 用户已添加.
    const account = `e2e-delete-me-${Math.random().toString(36).slice(2, 8)}`;
    await page.getByLabel("用户名", { exact: true }).fill(account);
    await page.getByLabel("密码", { exact: true }).fill(READER_PASSWORD);
    await page.getByRole("button", { name: "新增" }).click();
    await expect(page.getByText("用户已添加")).toBeVisible();

    const removeButton = page.getByRole("button", {
      name: `删除用户 ${account}`,
    });
    await removeButton.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("删除用户");
    await expect(dialog).toContainText(`是否删除${account}?`);

    // 取消 leaves the account alone.
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(removeButton).toBeVisible();

    // 确定 removes it.
    await removeButton.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确定" })
      .click();
    await expect(removeButton).toHaveCount(0);
  });
});
