import { expect, test } from "@playwright/test";
import {
  CHAPTER_ONE_TEXT,
  expectChapterText,
  openFreshBook,
  signOut,
} from "./helpers";

/**
 * Cache behaviour is deliberately kept out of `e2e/fixtures.ts`: this spec
 * provokes a real 401 after logout, which the shared fixture would flag as an
 * unexpected failed response. The scenarios here are about what the browser
 * does with the member route's validators, so they use the plain Playwright
 * test object.
 */

const CHAPTER_PATH = "OEBPS/text/chapter1.xhtml";
const COVER_PATH = "OEBPS/images/cover.png";

function chapterUrl(bookId: number): string {
  return `/api/books/${bookId}/files/${CHAPTER_PATH}`;
}

test("answers 304 to a matching validator issued by the browser context", async ({
  page,
  context,
}) => {
  const bookId = await openFreshBook(page, "e2e-cache-304");
  const url = chapterUrl(bookId);

  const first = await context.request.get(url);
  expect(first.status()).toBe(200);
  const etag = first.headers()["etag"] ?? "";
  expect(etag).not.toBe("");
  expect(first.headers()["cache-control"]).toBe("private,no-cache");
  expect(first.headers()["vary"]).toBe("cookie");

  // `context.request` shares the page's cookies but bypasses the browser HTTP
  // cache, so this is the server's 304 seen directly.
  const second = await context.request.get(url, {
    headers: { "if-none-match": etag },
  });
  expect(second.status()).toBe(304);
  expect(second.headers()["etag"]).toBe(etag);
  expect(second.headers()["cache-control"]).toBe("private,no-cache");
  expect(await second.body()).toHaveLength(0);
});

test("a forced revalidation keeps the chapter readable after reload", async ({
  page,
  context,
}) => {
  const bookId = await openFreshBook(page, "e2e-cache-revalidate");
  const url = chapterUrl(bookId);
  await expectChapterText(page, CHAPTER_ONE_TEXT);

  // Playwright's request events hide the browser's cache-validation headers,
  // so read them from CDP. Both events are recorded because their order is not
  // guaranteed; the pair identifies the revalidated request.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const requestUrls = new Map<string, string>();
  const requestHeaders = new Map<string, Record<string, string>>();
  const conditionalUrls = new Set<string>();
  const record = (requestId: string) => {
    const requestUrl = requestUrls.get(requestId);
    const headers = requestHeaders.get(requestId);
    if (requestUrl !== undefined && headers?.["If-None-Match"] !== undefined) {
      conditionalUrls.add(requestUrl);
    }
  };
  cdp.on("Network.requestWillBeSent", (event) => {
    requestUrls.set(event.requestId, event.request.url);
    record(event.requestId);
  });
  cdp.on("Network.requestWillBeSentExtraInfo", (event) => {
    requestHeaders.set(event.requestId, event.headers);
    record(event.requestId);
  });

  // `cache: "no-cache"` makes the browser revalidate the stored response; the
  // page still receives the cached body once the server answers 304.
  const body = await page.evaluate(
    (chapter) =>
      fetch(chapter, { cache: "no-cache" }).then((response) => response.text()),
    url,
  );
  expect(body).toContain(CHAPTER_ONE_TEXT);
  expect(
    [...conditionalUrls].some((requestUrl) => requestUrl.endsWith(url)),
    "the browser sent If-None-Match for the chapter",
  ).toBe(true);
  await cdp.detach();

  await page.reload();
  await expectChapterText(page, CHAPTER_ONE_TEXT);
});

test("a logged-out browser cannot replay a cached chapter", async ({
  page,
}) => {
  const bookId = await openFreshBook(page, "e2e-cache-logout");
  const url = chapterUrl(bookId);
  await expectChapterText(page, CHAPTER_ONE_TEXT);

  // The reader has no logout control; the shelf drawer owns it.
  await page.goto("/bookshelf");
  await signOut(page);

  // Default cache mode: the response's `no-cache` directive and the cookie
  // change both make this a network request, so the assertion covers the
  // actual policy rather than a forced revalidation.
  const result = await page.evaluate(async (chapter) => {
    const response = await fetch(chapter);
    return { status: response.status, body: await response.text() };
  }, url);

  expect(result.status).toBe(401);
  expect(result.body).not.toContain(CHAPTER_ONE_TEXT);
});

test("a logged-out browser cannot replay a cached raster", async ({ page }) => {
  const bookId = await openFreshBook(page, "e2e-cache-logout-image");
  const url = `/api/books/${bookId}/files/${COVER_PATH}`;

  // Warm the immutable tier through the page so the test does not depend on
  // the shelf's cover timing.
  const warmed = await page.evaluate(
    async (cover) => (await fetch(cover)).status,
    url,
  );
  expect(warmed).toBe(200);

  await page.goto("/bookshelf");
  await signOut(page);

  const result = await page.evaluate(async (cover) => {
    const response = await fetch(cover);
    return {
      status: response.status,
      type: response.headers.get("content-type"),
    };
  }, url);

  // `Vary: Cookie` changes the cache key when the session disappears; without
  // it the one-year immutable entry would answer 200 from disk with no request.
  expect(result.status).toBe(401);
  expect(result.type).toContain("application/json");
});
