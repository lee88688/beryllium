import { buildPng } from "./sample-book.ts";
import { buildZip, type ZipEntry } from "./zip.ts";

/**
 * Adversarial-but-valid EPUB used by the reader isolation specs (A1/A2): the
 * single chapter ships an inline `<script>` and an external link, i.e. exactly
 * the two things a book is not allowed to do on its own.
 */
export const HOSTILE_BOOK_TITLE = "Hostile Book";
const HOSTILE_BOOK_OPF_PATH = "OEBPS/content.opf";
export const HOSTILE_CHAPTER_TITLE = "Hostile Chapter";
export const HOSTILE_CHAPTER_TEXT = "Body of the hostile chapter.";
export const HOSTILE_INLINE_IMAGE_ALT = "hostile-inline";
export const HOSTILE_EXTERNAL_LINK_TEXT = "External probe";
export const HOSTILE_EXTERNAL_URL = "https://example.com/hostile";
/** Global the chapter tries to set from its own inline script (A1). */
export const HOSTILE_SCRIPT_FLAG = "__pwned";

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${HOSTILE_BOOK_OPF_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:hostile-book-fixture</dc:identifier>
    <dc:title>${HOSTILE_BOOK_TITLE}</dc:title>
    <dc:creator>Beryllium Fixture Author</dc:creator>
    <dc:description>Fixture whose chapter tries to run a script (A1) and link out of the book (A2).</dc:description>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="inline-image" href="images/inline.png" media-type="image/png"/>
    <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;
}

function navXhtml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
        <li><a href="text/chapter.xhtml">${HOSTILE_CHAPTER_TITLE}</a></li>
      </ol>
    </nav>
  </body>
</html>`;
}

function chapterXhtml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${HOSTILE_CHAPTER_TITLE}</title></head>
  <body>
    <h1>${HOSTILE_CHAPTER_TITLE}</h1>
    <p>${HOSTILE_CHAPTER_TEXT}</p>
    <script>window.${HOSTILE_SCRIPT_FLAG} = true;</script>
    <img src="../images/inline.png" alt="${HOSTILE_INLINE_IMAGE_ALT}"/>
    <p><a href="${HOSTILE_EXTERNAL_URL}">${HOSTILE_EXTERNAL_LINK_TEXT}</a></p>
  </body>
</html>`;
}

/** Entry list of the hostile fixture, for tests that need to drop entries. */
function hostileEpubEntries(): ZipEntry[] {
  return [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/", data: "" },
    { name: "META-INF/container.xml", data: containerXml() },
    { name: "OEBPS/", data: "" },
    { name: "OEBPS/content.opf", data: contentOpf() },
    { name: "OEBPS/nav.xhtml", data: navXhtml() },
    { name: "OEBPS/images/inline.png", data: buildPng(1, 1, [20, 120, 200]) },
    { name: "OEBPS/text/chapter.xhtml", data: chapterXhtml() },
  ];
}

/** The hostile EPUB as ZIP bytes. */
export function buildHostileEpub(): Buffer {
  return buildZip(hostileEpubEntries());
}
