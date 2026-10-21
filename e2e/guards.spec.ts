import { expect, test } from "./fixtures";
import {
  ADMIN_CREDENTIALS,
  openFreshBook,
  signIn,
  signInAsFreshReader,
  signOut,
} from "./helpers";

// E1 — the guard is a client-side `beforeLoad` (SPA, no SSR), so it can only be
// observed in a real browser.
test.describe("E1 anonymous route guard", () => {
  test("bounces an anonymous visitor from every protected route to /login", async ({
    page,
  }) => {
    for (const route of ["/bookshelf", "/setting", "/reader/1"]) {
      await page.goto(route);

      await expect(page, `guard for ${route}`).toHaveURL(/\/login$/);
      await expect(
        page.getByRole("heading", { name: "用户登陆" }),
      ).toBeVisible();
    }
  });
});

test.describe("E2 redirects", () => {
  test("sends / and an unknown reader id to the bookshelf once signed in", async ({
    page,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);

    await page.goto("/");
    await expect(page).toHaveURL(/\/bookshelf$/);
    await expect(page.getByRole("heading", { name: "书架" })).toBeVisible();

    await page.goto("/reader/999999");
    await expect(page).toHaveURL(/\/bookshelf$/);
    await expect(page.getByRole("heading", { name: "书架" })).toBeVisible();
  });
});

test.describe("N1 authorization at the UI layer", () => {
  test("a normal reader gets no user table and no create-user entry on /setting", async ({
    page,
  }) => {
    await signInAsFreshReader(page, "e2e-setting-reader");
    // 直接点名管理员的那个分区：普通账号的分区列表里根本没有它，hash 不会命中，
    // 页面停在默认分区 —— 即使有人去掉 SettingPage 里的 `user.isAdmin` 判断，
    // 下面的断言也会失败（否则这几条就是空转的）。
    await page.goto("/setting#users");
    await expect(page.getByRole("heading", { name: "用户" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "user table" })).toHaveCount(
      0,
    );
    await expect(page.getByText("添加新用户")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新增" })).toHaveCount(0);
    // 分区导航本身也不该出现（那是更早的一道门）。
    await expect(page.getByRole("button", { name: "用户" })).toHaveCount(0);

    // 修改密码 is for every account.
    await page.getByRole("button", { name: "账号" }).click();
    await expect(page.getByText("修改密码")).toBeVisible();
  });

  test("another reader's book id falls back to the bookshelf", async ({
    page,
  }) => {
    const bookId = await openFreshBook(page, "e2e-reader-owner");

    // Hand the shelf to a second account: the reader loader must treat the
    // foreign id exactly like a missing one (migration plan §5.2).
    await page.goto("/bookshelf");
    await signOut(page);
    await signInAsFreshReader(page, "e2e-reader-intruder");

    await page.goto(`/reader/${String(bookId)}`);

    await expect(page).toHaveURL(/\/bookshelf$/);
    await expect(page.getByRole("heading", { name: "书架" })).toBeVisible();
  });
});

test.describe("N12 tampered session cookie", () => {
  test("bounces a tampered sealed cookie back to /login", async ({
    page,
    context,
  }) => {
    await signIn(page, ADMIN_CREDENTIALS);
    const sealed = (await context.cookies()).find(
      (cookie) => cookie.name === "sealed",
    );
    expect(sealed).toBeDefined();
    if (!sealed) throw new Error("no sealed cookie after sign-in");

    // Flip one character in the middle of the seal: iron-session's HMAC covers
    // the whole payload, so the server cannot unseal it any more.
    const index = Math.floor(sealed.value.length / 2);
    const flip = sealed.value[index] === "A" ? "B" : "A";
    await context.addCookies([
      {
        name: "sealed",
        value: `${sealed.value.slice(0, index)}${flip}${sealed.value.slice(index + 1)}`,
        domain: sealed.domain,
        path: sealed.path,
      },
    ]);

    await page.goto("/bookshelf");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "用户登陆" })).toBeVisible();
  });
});
