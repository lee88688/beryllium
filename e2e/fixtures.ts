import { expect, test as base } from "@playwright/test";

/**
 * Console messages the suite provokes on purpose:
 * - `400` — E5 deliberately uploads an archive the server must reject.
 * - `404` — the reader probes files a book may not have, and foliate-js asks for
 *   its optional documents on every open (`META-INF/encryption.xml`, the
 *   iBooks/Kobo display-options files). A book that ships none answers 404 (the
 *   URLs are pinned by `ALLOWED_FAILED_RESPONSES`).
 * - `net::ERR_ABORTED` — a test-driven `page.reload()` cancels in-flight
 *   fetches of book assets.
 * - CSP violation — the isolation spec injects a script into a section document
 *   to prove the *policy* still stops it. Seeing that message is the policy
 *   working: the markup itself is sanitised before it ever becomes a document
 *   (`src/features/reader/epub/sanitize.ts`), so this is the second layer, and
 *   the spec asserts the script did not run.
 */
const EXPECTED_CONSOLE_ERRORS: readonly RegExp[] = [
  /the server responded with a status of 400 \(/,
  /the server responded with a status of 404 \(/,
  /net::ERR_ABORTED/,
  /Executing inline script violates the following Content Security Policy directive/,
];

/**
 * Every `>= 400` response the suite may produce, by URL. Anything else (a cover
 * or chapter that 404s, a 500 from a broken server function) fails the test —
 * this is what keeps the console allowlist above from hiding real regressions.
 */
const ALLOWED_FAILED_RESPONSES: readonly RegExp[] = [
  // E5: the rejected upload.
  /^400 POST http:\/\/[^/]+\/api\/books$/,
  // The optional documents foliate-js probes for (see above).
  /^404 GET http:\/\/[^/]+\/api\/books\/\d+\/files\/META-INF\/(?:encryption\.xml|com\.(?:apple\.ibooks|kobobooks)\.display-options\.xml)$/,
];

interface ConsoleFixtures {
  /** Every console error / uncaught exception the page produced. */
  consoleErrors: string[];
}

/**
 * `test` with the E2E-spec contract built in: console errors, page errors and
 * failed requests are collected and asserted empty during teardown (so the
 * assertion runs "at the end" of every case).
 */
export const test = base.extend<ConsoleFixtures>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const failedResponses: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`);
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        failedResponses.push(
          `${String(response.status())} ${response.request().method()} ${response.url()}`,
        );
      });

      await use(errors);

      expect(
        errors.filter(
          (text) =>
            !EXPECTED_CONSOLE_ERRORS.some((pattern) => pattern.test(text)),
        ),
        "unexpected browser console errors",
      ).toEqual([]);
      expect(
        failedResponses.filter(
          (failure) =>
            !ALLOWED_FAILED_RESPONSES.some((pattern) => pattern.test(failure)),
        ),
        "unexpected failed responses",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
