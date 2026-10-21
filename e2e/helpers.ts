import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type Frame, type Page } from "@playwright/test";

interface Credentials {
  username: string;
  password: string;
}

export const ADMIN_CREDENTIALS = {
  username: "admin",
  password: "admin123",
} as const;

export const READER_PASSWORD = "reader123";

/**
 * Mirrors `tests/fixtures/sample-book.ts` (the E2E specs must not import the
 * vitest fixture module). Values are asserted against the uploaded book.
 */
export const SAMPLE_BOOK_TITLE = "Sample Book";
export const SAMPLE_BOOK_AUTHOR = "Beryllium Fixture Author";
export const CHAPTER_ONE_TEXT = "Body of chapter one.";
export const CHAPTER_TWO_TEXT = "Body of chapter two.";
export const SECTION_TWO_ONE_TEXT = "Body of section 2.1.";
export const INTERNAL_LINK_TEXT = "Go to chapter two";
export const INLINE_IMAGE_ALT = "inline";

const SAMPLE_EPUB_PATH = path.resolve("tests/fixtures/sample-book.epub");
/** Adversarial archive: a valid EPUB shell containing a `../escaped.txt` entry. */
export const ZIP_SLIP_EPUB_PATH = path.resolve("tests/fixtures/zip-slip.epub");

/**
 * Reader isolation fixture (A1/A2): one chapter that ships an inline script and
 * an external link. Mirrors `tests/fixtures/hostile-book.ts`.
 */
const HOSTILE_EPUB_PATH = path.resolve("tests/fixtures/hostile-book.epub");
export const HOSTILE_BOOK_TITLE = "Hostile Book";
export const HOSTILE_CHAPTER_TITLE = "Hostile Chapter";
export const HOSTILE_CHAPTER_TEXT = "Body of the hostile chapter.";
export const HOSTILE_INLINE_IMAGE_ALT = "hostile-inline";
export const HOSTILE_EXTERNAL_LINK_TEXT = "External probe";
export const HOSTILE_EXTERNAL_URL = "https://example.com/hostile";
/** Global the chapter tries to set from its own inline script. */
export const HOSTILE_SCRIPT_FLAG = "__pwned";

function readerCredentials(username: string): Credentials {
  return { username, password: READER_PASSWORD };
}

export async function fillLoginForm(
  page: Page,
  credentials: Credentials,
): Promise<void> {
  await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  // The submit button's label is "登 陆" — a space in the middle.
  await page.getByRole("button", { name: /登\s*陆/ }).click();
}

/** Opens `/login` and submits the form; asserts nothing about the outcome. */
export async function login(
  page: Page,
  credentials: Credentials = ADMIN_CREDENTIALS,
): Promise<void> {
  await page.goto("/login");
  await fillLoginForm(page, credentials);
}

export async function signIn(
  page: Page,
  credentials: Credentials,
): Promise<void> {
  await login(page, credentials);
  await expect(page).toHaveURL(/\/bookshelf$/);
}

export async function signOut(page: Page): Promise<void> {
  const logout = page.getByRole("button", { name: "退出登陆" });
  const menu = page.getByRole("button", { name: "打开菜单" });
  // Wait for the shell to settle before deciding which layout is on screen: a
  // bookshelf that is still rendering looks "mobile" (no visible logout) and
  // the desktop layout has no 打开菜单 button to click.
  await expect(logout.or(menu).first()).toBeVisible();
  // Below `sm` the drawer is a sheet that has to be opened first.
  if (!(await logout.isVisible())) {
    await menu.click();
  }
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Creates a reader account through the admin UI and signs in as it, so the spec
 * starts from an empty library (every spec shares one database).
 *
 * The account name carries a unique suffix (F2). Playwright's `retries` reuse
 * the server process *and its database*, so a retry that re-used the same
 * account would open onto the previous attempt's library and the strict
 * `getByRole` selectors would match two book cards ("strict mode violation")
 * instead of testing the retried case. A unique account per call gives every
 * attempt the same empty shelf the first one started from.
 */
export async function signInAsFreshReader(
  page: Page,
  username: string,
): Promise<void> {
  const account = `${username}-${randomUUID().slice(0, 8)}`;
  await signIn(page, ADMIN_CREDENTIALS);
  // `/setting` 是分区页面：用户表只在「用户」分区里挂载。
  await page.goto("/setting#users");

  const users = page.getByRole("table", { name: "user table" });
  await page.getByLabel("用户名", { exact: true }).fill(account);
  await page.getByLabel("密码", { exact: true }).fill(READER_PASSWORD);
  await page.getByRole("button", { name: "新增" }).click();
  await expect(users.getByText(account, { exact: true })).toBeVisible();

  await page.goto("/bookshelf");
  await signOut(page);
  await signIn(page, readerCredentials(account));
}

/**
 * Creates a fresh reader account, uploads the sample book and opens it in the
 * reader, returning the book id. Each test seeds its own account so no test
 * depends on another test's library or reading position.
 */
export async function openFreshBook(
  page: Page,
  username: string,
): Promise<number> {
  await signInAsFreshReader(page, username);
  await uploadSampleBook(page);
  return openBook(page);
}

/**
 * Same as `openFreshBook`, with the hostile fixture (A1/A2): its single chapter
 * carries an inline `<script>` and an external link.
 */
export async function openHostileBook(
  page: Page,
  username: string,
): Promise<number> {
  await signInAsFreshReader(page, username);
  await uploadEpub(page, HOSTILE_EPUB_PATH);
  await expectBookCard(page, HOSTILE_BOOK_TITLE);
  return openBook(page, HOSTILE_BOOK_TITLE);
}

export async function uploadEpub(
  page: Page,
  filePath: string = SAMPLE_EPUB_PATH,
): Promise<void> {
  await page.setInputFiles('input[type="file"]', filePath);
}

export async function expectBookCard(
  page: Page,
  title: string = SAMPLE_BOOK_TITLE,
): Promise<void> {
  await expect(
    page.getByRole("button", { name: `${title} 更多操作` }),
  ).toBeVisible({ timeout: 20_000 });
}

export async function uploadSampleBook(page: Page): Promise<void> {
  await uploadEpub(page);
  await expectBookCard(page);
}

/** Sonner toast element of a given type. */
export function toast(page: Page, type: "error" | "success" | "loading") {
  return page.locator(`[data-sonner-toast][data-type="${type}"]`);
}

/**
 * Clicks the book card (its accessible name starts with the title; the card
 * button precedes the ⋮ trigger in DOM order) and returns the book id.
 */
export async function openBook(
  page: Page,
  title: string = SAMPLE_BOOK_TITLE,
): Promise<number> {
  await page
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/reader\/\d+$/);
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  expect(Number.isInteger(id)).toBe(true);
  return id;
}

/**
 * The reader renders one section at a time into a sandboxed `<iframe>`, so a
 * chapter is located through the frames of the page rather than the top-level
 * DOM — foliate-js builds that frame inside a closed shadow root, where no
 * selector can reach it.
 */
async function chapterFrames(page: Page, text: string): Promise<Frame[]> {
  const matches: Frame[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    // `Frame` has no `getBy*` helpers (only `locator`), so the text engine is
    // used directly.
    const count = await frame
      .locator(`text=${text}`)
      .count()
      .catch(() => 0);
    if (count > 0) matches.push(frame);
  }
  return matches;
}

export async function expectChapterText(
  page: Page,
  text: string,
): Promise<void> {
  await expect
    .poll(async () => (await chapterFrames(page, text)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
}

/** The frame currently rendering `text` (e.g. `CHAPTER_ONE_TEXT`). */
export async function chapterFrame(page: Page, text: string): Promise<Frame> {
  await expectChapterText(page, text);
  const [frame] = await chapterFrames(page, text);
  if (!frame) throw new Error(`no section frame renders "${text}"`);
  return frame;
}

/**
 * How long to wait for Chromium to acknowledge the mouse move that starts a
 * text-selection drag. It never acknowledges it inside a section frame (see
 * `dragSelectText`), so this is a settle delay, not a retry budget.
 */
const DRAG_ACK_TIMEOUT_MS = 500;

/**
 * Drags across a text line inside a section frame to create a native text
 * selection (the way a reader does it), which the adapter turns into a
 * `selected` event after its own 250 ms `selectionchange` debounce.
 *
 * Chromium does not always acknowledge the CDP `mouseMoved` that starts a drag
 * inside a sandboxed section frame — it is deciding about drag-and-drop — so
 * that move is raced against a short timeout and the drag is finished with
 * `mouse.up()`, which does answer. The selection itself is complete with a
 * single move, so no `steps` interpolation is needed.
 */
export async function dragSelectText(page: Page, text: string): Promise<void> {
  const frame = await chapterFrame(page, text);
  const box = await frame.locator(`text=${text}`).boundingBox();
  if (!box) throw new Error(`no bounding box for "${text}"`);

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  const dragged = page.mouse
    .move(box.x + box.width - 2, y)
    // The unacknowledged move rejects when the page closes; that is expected.
    .catch(() => undefined);
  await Promise.race([dragged, page.waitForTimeout(DRAG_ACK_TIMEOUT_MS)]);
  await page.mouse.up();
}

interface VirtualKeyboardStub {
  __show: (height: number) => void;
}

/**
 * Replaces `navigator.virtualKeyboard` with a stub that satisfies the API
 * contract `use-virtual-keyboard` consumes (`boundingRect`, `overlaysContent`,
 * `geometrychange`). Headless Chromium never shows a real on-screen keyboard,
 * so without this the docking branch of `DialogKb` would be unreachable in
 * E2E. Must be installed before the page loads.
 */
export async function installVirtualKeyboardStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = new EventTarget();
    const keyboard = Object.assign(target, {
      overlaysContent: false,
      boundingRect: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 844,
        right: 390,
        bottom: 844,
        left: 0,
      },
      __show(height: number) {
        keyboard.boundingRect = {
          x: 0,
          y: 844 - height,
          width: height > 0 ? 390 : 0,
          height,
          top: 844 - height,
          right: 390,
          bottom: 844,
          left: 0,
        };
        target.dispatchEvent(new Event("geometrychange"));
      },
    });
    Object.defineProperty(navigator, "virtualKeyboard", {
      value: keyboard,
      configurable: true,
    });
  });
}

/** Reports an on-screen keyboard of `height` px through the stub above. */
export async function showVirtualKeyboard(
  page: Page,
  height: number,
): Promise<void> {
  await page.evaluate((value) => {
    const keyboard = (
      navigator as Navigator & { virtualKeyboard?: VirtualKeyboardStub }
    ).virtualKeyboard;
    keyboard?.__show(value);
  }, height);
}

/**
 * The section foliate-js currently renders.
 *
 * Unlike epubjs' continuous manager — which kept every spine section mounted
 * side by side, so "the chapter is somewhere in the DOM" proved nothing — only
 * one section exists at a time here, which makes this the observable that
 * tells "the rendition moved" apart from "the text exists" (W3).
 *
 * Read through the library's public API: its shadow roots are closed, so no
 * selector can reach the section iframe from the page.
 */
export interface ReaderSection {
  /** Spine index of the rendered section. */
  index: number;
  /** Archive-relative href of the TOC entry the location maps to. */
  href: string | null;
  title: string;
  text: string;
  box: { x: number; y: number; width: number; height: number } | null;
}

interface FoliateViewElement extends HTMLElement {
  renderer: {
    getContents(): {
      index: number;
      doc: Document;
      overlayer?: { element: SVGSVGElement };
    }[];
  };
  lastLocation: { tocItem?: { href?: string } | null } | null;
}

export async function currentSection(
  page: Page,
): Promise<ReaderSection | null> {
  return page.evaluate(() => {
    const view = document.querySelector(
      "foliate-view",
    ) as FoliateViewElement | null;
    const contents = view?.renderer?.getContents?.()[0];
    if (!contents) return null;
    const frame = contents.doc.defaultView?.frameElement;
    const box = frame?.getBoundingClientRect();
    return {
      index: contents.index,
      href: view?.lastLocation?.tocItem?.href ?? null,
      title: contents.doc.title,
      text: contents.doc.body?.innerText ?? "",
      box: box
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : null,
    };
  });
}

/** Spine index of the rendered section, for `expect.poll` comparisons. */
export async function sectionIndex(page: Page): Promise<number | null> {
  return (await currentSection(page))?.index ?? null;
}

/**
 * The highlight overlays foliate-js currently draws, with the attributes the
 * reader's contract promises (`data-epubcfi`, `data-color`, `fill`) and their
 * on-screen boxes — `page.locator("g[data-epubcfi]")` cannot reach them, they
 * live inside a closed shadow root.
 */
export interface ReaderOverlay {
  cfi: string;
  color: string | null;
  fill: string | null;
  box: { x: number; y: number; width: number; height: number } | null;
}

export async function overlays(page: Page): Promise<ReaderOverlay[]> {
  return page.evaluate(() => {
    const view = document.querySelector(
      "foliate-view",
    ) as FoliateViewElement | null;
    const svg = view?.renderer?.getContents?.()[0]?.overlayer?.element;
    if (!svg) return [];
    return Array.from(svg.querySelectorAll("g[data-epubcfi]")).map((group) => {
      const box = group.getBoundingClientRect();
      return {
        cfi: (group as SVGGElement).dataset.epubcfi ?? "",
        color: (group as SVGGElement).dataset.color ?? null,
        fill: group.getAttribute("fill"),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    });
  });
}

/**
 * What the section iframe looks like from the outside: its sandbox flags and
 * the markup the sanitizer left behind.
 */
export async function sectionProbe(
  page: Page,
): Promise<{ sandbox: string | null; scripts: number; handlers: number }[]> {
  return page.evaluate(() => {
    const view = document.querySelector(
      "foliate-view",
    ) as FoliateViewElement | null;
    return (view?.renderer?.getContents?.() ?? []).map(({ doc }) => {
      const frame = doc.defaultView?.frameElement;
      return {
        sandbox: frame?.getAttribute("sandbox") ?? null,
        scripts: doc.querySelectorAll("script").length,
        handlers: Array.from(doc.querySelectorAll("*")).filter((element) =>
          Array.from(element.attributes).some((attribute) =>
            attribute.name.toLowerCase().startsWith("on"),
          ),
        ).length,
      };
    });
  });
}

/** The value of a global a chapter script would set, read from the session. */
export async function sectionFlag(
  page: Page,
  flag: string,
): Promise<unknown[]> {
  return page.evaluate((name) => {
    const view = document.querySelector(
      "foliate-view",
    ) as FoliateViewElement | null;
    return (view?.renderer?.getContents?.() ?? []).map(({ doc }) => {
      const scope = doc.defaultView as unknown as Record<
        string,
        unknown
      > | null;
      return scope?.[name];
    });
  }, flag);
}
