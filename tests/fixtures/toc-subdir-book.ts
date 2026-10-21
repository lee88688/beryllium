import { buildZip, type ZipEntry } from "./zip.ts";

/**
 * An EPUB whose nav document and NCX live in a subdirectory (`nav/`), i.e. not
 * next to the OPF. Both dialects write hrefs relative to their own file, so a
 * TOC parsed without rebasing yields `../text/...` — a path no reader can jump
 * to (B18).
 */

const TOC_SUBDIR_BOOK_TITLE = "TOC Subdirectory";
export const TOC_SUBDIR_BOOK_OPF_PATH = "OEBPS/content.opf";
const TOC_SUBDIR_BOOK_NAV_PATH = "OEBPS/nav/nav.xhtml";
const TOC_SUBDIR_BOOK_NCX_PATH = "OEBPS/nav/toc.ncx";

/** Expected TOC from `OEBPS/nav/nav.xhtml`, archive-rooted: the reader hands
 * these straight to foliate-js, which matches them against manifest hrefs. */
export const TOC_SUBDIR_NAV_TOC = [
  { label: "Chapter 1", src: "OEBPS/text/chapter1.xhtml" },
  {
    label: "Chapter 2",
    src: "OEBPS/text/chapter2.xhtml",
    children: [{ label: "Section 2.1", src: "OEBPS/text/chapter2-1.xhtml" }],
  },
];

/** Expected TOC from `OEBPS/nav/toc.ncx`, archive-rooted. */
export const TOC_SUBDIR_NCX_TOC = [
  { label: "NCX Chapter 1", src: "OEBPS/text/chapter1.xhtml" },
  {
    label: "NCX Chapter 2",
    src: "OEBPS/text/chapter2.xhtml",
    children: [
      { label: "NCX Section 2.1", src: "OEBPS/text/chapter2-1.xhtml" },
    ],
  },
];

interface TocSubdirBookOptions {
  /** Include the nav document; `"empty"` keeps it but with no TOC entries. */
  navigationDocument?: "filled" | "empty" | "none";
  /** Include the NCX document. */
  ncx?: boolean;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${TOC_SUBDIR_BOOK_OPF_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf(options: Required<TocSubdirBookOptions>): string {
  const manifest = [
    options.navigationDocument === "none"
      ? ""
      : `<item id="nav" href="nav/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    options.ncx
      ? `<item id="ncx" href="nav/toc.ncx" media-type="application/x-dtbncx+xml"/>`
      : "",
    `<item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="chapter2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="chapter2-1" href="text/chapter2-1.xhtml" media-type="application/xhtml+xml"/>`,
  ].filter(Boolean);

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:toc-subdir-fixture</dc:identifier>
    <dc:title>${TOC_SUBDIR_BOOK_TITLE}</dc:title>
    <dc:creator>Fixture</dc:creator>
    <dc:description>Navigation document and NCX in a subdirectory.</dc:description>
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  ${options.ncx ? '<spine toc="ncx">' : "<spine>"}
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter2-1"/>
  </spine>
</package>`;
}

/** Nav document in `nav/`, so every href needs one `../` to reach the chapters. */
function navXhtml(withEntries: boolean): string {
  const toc = withEntries
    ? `<ol>
        <li><a href="../text/chapter1.xhtml">Chapter 1</a></li>
        <li>
          <a href="../text/chapter2.xhtml">Chapter 2</a>
          <ol><li><a href="../text/chapter2-1.xhtml">Section 2.1</a></li></ol>
        </li>
      </ol>`
    : "<ol></ol>";

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc"><h1>Contents</h1>${toc}</nav>
  </body>
</html>`;
}

function ncxXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:toc-subdir-fixture"/></head>
  <docTitle><text>${TOC_SUBDIR_BOOK_TITLE}</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>NCX Chapter 1</text></navLabel>
      <content src="../text/chapter1.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-2" playOrder="2">
      <navLabel><text>NCX Chapter 2</text></navLabel>
      <content src="../text/chapter2.xhtml"/>
      <navPoint id="navPoint-3" playOrder="3">
        <navLabel><text>NCX Section 2.1</text></navLabel>
        <content src="../text/chapter2-1.xhtml"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`;
}

function chapter(title: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body><h1>${title}</h1><p>${title} body.</p></body>
</html>`;
}

function tocSubdirEpubEntries(options: TocSubdirBookOptions = {}): ZipEntry[] {
  const resolved: Required<TocSubdirBookOptions> = {
    navigationDocument: options.navigationDocument ?? "filled",
    ncx: options.ncx ?? true,
  };

  const entries: ZipEntry[] = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: containerXml() },
    { name: "OEBPS/content.opf", data: contentOpf(resolved) },
    { name: "OEBPS/text/chapter1.xhtml", data: chapter("Chapter 1") },
    { name: "OEBPS/text/chapter2.xhtml", data: chapter("Chapter 2") },
    { name: "OEBPS/text/chapter2-1.xhtml", data: chapter("Section 2.1") },
  ];

  if (resolved.navigationDocument !== "none") {
    entries.push({
      name: TOC_SUBDIR_BOOK_NAV_PATH,
      data: navXhtml(resolved.navigationDocument === "filled"),
    });
  }
  if (resolved.ncx) {
    entries.push({ name: TOC_SUBDIR_BOOK_NCX_PATH, data: ncxXml() });
  }

  return entries;
}

export function buildTocSubdirEpub(options: TocSubdirBookOptions = {}): Buffer {
  return buildZip(tocSubdirEpubEntries(options));
}
