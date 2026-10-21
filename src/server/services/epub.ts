import {
  getNavigationPath,
  getSpinePaths,
  getTocPath,
  parseToc,
} from "@/server/domain/epub";
import type { EpubPackage, TocItem } from "@/server/domain/epub";
import {
  asarFileDir,
  epubStorageFromEnv,
  readAsarFile,
  readAsarMemberSizes,
  type EpubStorage,
} from "./file";

/** Book columns needed to reach the payload inside its ASAR. */
export interface BookContentSource {
  fileName: string;
  contentPath: string;
  content: EpubPackage;
}

/**
 * Table of contents with the PRD D8 precedence: the EPUB3 navigation document
 * when the manifest declares one, otherwise the NCX. A nav document that is
 * declared but unreadable/unparsable — or that parses to *zero* entries (B15) —
 * also falls back to NCX instead of leaving the reader with an empty drawer.
 * Books with neither return an empty TOC.
 *
 * Both documents hand their hrefs over as archive-rooted member paths (B18),
 * so a nav/NCX tucked into a subdirectory still yields `src` values the reader
 * can jump to.
 */
export async function readBookToc(
  book: BookContentSource,
  storage: EpubStorage = epubStorageFromEnv(),
): Promise<TocItem[]> {
  const asarFile = asarFileDir(book.fileName, storage);

  const navPath = getNavigationPath(book);
  if (navPath) {
    try {
      const nav = await readAsarFile(asarFile, navPath);
      const toc = await parseToc(nav.toString("utf8"), "nav", {
        documentPath: navPath,
        contentPath: book.contentPath,
      });
      if (toc.length > 0) return toc;
      console.warn(
        `[readBookToc] navigation document ${navPath} lists no entries, falling back to NCX`,
      );
    } catch (error) {
      console.warn(
        `[readBookToc] navigation document ${navPath} is unusable, falling back to NCX`,
        error,
      );
    }
  }

  const ncxPath = getTocPath(book);
  if (!ncxPath) return [];
  const ncx = await readAsarFile(asarFile, ncxPath);
  return parseToc(ncx.toString("utf8"), "ncx", {
    documentPath: ncxPath,
    contentPath: book.contentPath,
  });
}

/**
 * Byte size of every spine member, keyed by the member path the reader's loader
 * asks for (archive-rooted and decoded — see `getSpinePaths`).
 *
 * Sizes only drive the reading progress, so an unreadable archive degrades to
 * "no sizes" instead of taking the reader page down: the failure surfaces when
 * the reader tries to load the members themselves, with a message about the
 * actual file.
 */
export async function readSpineSizes(
  book: BookContentSource,
  storage: EpubStorage = epubStorageFromEnv(),
): Promise<Record<string, number>> {
  const paths = getSpinePaths(book.content, book.contentPath);
  if (paths.length === 0) return {};
  try {
    const sizes = await readAsarMemberSizes(
      asarFileDir(book.fileName, storage),
      paths,
    );
    return Object.fromEntries(sizes);
  } catch (error) {
    console.warn(`[readSpineSizes] ${book.fileName} is unreadable`, error);
    return {};
  }
}
