import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  SAMPLE_BOOK_AUTHOR,
  SAMPLE_BOOK_TITLE,
  expectBookCard,
  signInAsFreshReader,
  toast,
  uploadSampleBook,
} from "./helpers";

const EDITED_TITLE = "修复后的书名";
const EDITED_AUTHOR = "修复后的作者";

function cardMenu(page: Page, title: string) {
  return page.getByRole("button", { name: `${title} 更多操作` });
}

/** The card itself (the menu trigger follows it in DOM order). */
function bookCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) }).first();
}

test("edits a book title and author from the card menu", async ({ page }) => {
  await signInAsFreshReader(page, "rename");
  await uploadSampleBook(page);

  await cardMenu(page, SAMPLE_BOOK_TITLE).click();
  await page.getByRole("menuitem", { name: "编辑信息" }).click();

  const dialog = page.getByRole("dialog", { name: "编辑书籍信息" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("书名", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("书名", { exact: true })).toHaveValue(
    SAMPLE_BOOK_TITLE,
  );
  await expect(dialog.getByLabel("作者", { exact: true })).toHaveValue(
    SAMPLE_BOOK_AUTHOR,
  );
  await dialog.getByLabel("书名", { exact: true }).fill(EDITED_TITLE);
  await dialog.getByLabel("作者", { exact: true }).fill(EDITED_AUTHOR);
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(toast(page, "success")).toContainText("已更新书籍信息");
  await expect(dialog).toBeHidden();
  await expect(bookCard(page, EDITED_TITLE)).toBeVisible();
  await expect(
    bookCard(page, EDITED_TITLE).getByText(EDITED_AUTHOR, { exact: true }),
  ).toBeVisible();

  // The rename is persisted, not just an optimistic cache update.
  await page.reload();
  await expectBookCard(page, EDITED_TITLE);
  await expect(
    bookCard(page, EDITED_TITLE).getByText(EDITED_AUTHOR, { exact: true }),
  ).toBeVisible();
});

test("requires a non-blank title and can clear the author", async ({
  page,
}) => {
  await signInAsFreshReader(page, "rename-validate");
  await uploadSampleBook(page);

  await cardMenu(page, SAMPLE_BOOK_TITLE).click();
  await page.getByRole("menuitem", { name: "编辑信息" }).click();

  const dialog = page.getByRole("dialog", { name: "编辑书籍信息" });
  const titleInput = dialog.getByLabel("书名", { exact: true });
  const save = dialog.getByRole("button", { name: "保存" });

  await titleInput.fill("   ");
  await expect(save).toBeDisabled();

  await titleInput.fill(SAMPLE_BOOK_TITLE);
  await dialog.getByLabel("作者", { exact: true }).fill("");
  await save.click();

  await expect(dialog).toBeHidden();
  await expect(toast(page, "success")).toContainText("已更新书籍信息");

  const card = bookCard(page, SAMPLE_BOOK_TITLE);
  await expect(card).toBeVisible();
  await expect(card.getByText(SAMPLE_BOOK_AUTHOR, { exact: true })).toHaveCount(
    0,
  );

  await page.reload();
  await expectBookCard(page, SAMPLE_BOOK_TITLE);
  await expect(
    bookCard(page, SAMPLE_BOOK_TITLE).getByText(SAMPLE_BOOK_AUTHOR, {
      exact: true,
    }),
  ).toHaveCount(0);
});
