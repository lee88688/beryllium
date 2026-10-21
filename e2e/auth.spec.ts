import { expect, test } from "./fixtures";
import { ADMIN_CREDENTIALS, fillLoginForm, signIn, signOut } from "./helpers";

test.describe("E3 login and logout", () => {
  test("rejects a wrong password with a visible message and stays on /login (D4)", async ({
    page,
  }) => {
    await page.goto("/login");
    await fillLoginForm(page, {
      username: "admin",
      password: "wrong-password",
    });

    await expect(page).toHaveURL(/\/login$/);
    // Scoped to the form: the same string is also raised as a toast.
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "用户名或密码不正确",
    );
  });

  test("signs in, keeps a signed-in visitor off /login (D7) and logs out again", async ({
    page,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);
    await expect(page.getByRole("heading", { name: "书架" })).toBeVisible();

    // D7 — /login is unreachable while authenticated.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/bookshelf$/);

    // Logout lives in the bookshelf drawer.
    await signOut(page);

    // The guard owns /bookshelf again.
    await page.goto("/bookshelf");
    await expect(page).toHaveURL(/\/login$/);
  });
});
