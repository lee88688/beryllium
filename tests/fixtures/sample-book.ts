import { crc32, deflateSync } from "node:zlib";
import { buildZip, type ZipEntry } from "./zip.ts";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

/** True-colour solid PNG; real image bytes for cover/inline-image assertions. */
export function buildPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  const [red, green, blue] = rgb;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = red;
      raw[pixel + 1] = green;
      raw[pixel + 2] = blue;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const SAMPLE_BOOK_TITLE = "Sample Book";
export const SAMPLE_BOOK_AUTHOR = "Beryllium Fixture Author";
export const SAMPLE_BOOK_DESCRIPTION =
  "Minimal EPUB3 fixture: navigation document, NCX, cover, nested TOC, inline image and an internal link.";
export const SAMPLE_BOOK_COVER_PATH = "OEBPS/images/cover.png";
export const SAMPLE_BOOK_OPF_PATH = "OEBPS/content.opf";

/** Expected TOC from `nav.xhtml` (EPUB3 path), archive-rooted. */
export const SAMPLE_BOOK_NAV_TOC = [
  { label: "Chapter 1", src: "OEBPS/text/chapter1.xhtml" },
  {
    label: "Chapter 2",
    src: "OEBPS/text/chapter2.xhtml",
    children: [{ label: "Section 2.1", src: "OEBPS/text/chapter2-1.xhtml" }],
  },
];

/** Expected TOC from `toc.ncx`; labels differ from the nav document on purpose. */
export const SAMPLE_BOOK_NCX_TOC = [
  { label: "NCX Chapter 1", src: "OEBPS/text/chapter1.xhtml" },
  {
    label: "NCX Chapter 2",
    src: "OEBPS/text/chapter2.xhtml",
    children: [
      { label: "NCX Section 2.1", src: "OEBPS/text/chapter2-1.xhtml" },
    ],
  },
];

interface SampleBookOptions {
  /** Include `nav.xhtml` (EPUB3 navigation document). */
  withNavigationDocument?: boolean;
  /** Include `toc.ncx`; its `spine[toc]` reference is dropped when false. */
  withNcx?: boolean;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${SAMPLE_BOOK_OPF_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf(options: Required<SampleBookOptions>): string {
  const manifestItems = [
    options.withNavigationDocument
      ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
      : "",
    options.withNcx
      ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
      : "",
    `<item id="cover-image" href="images/cover.png" media-type="image/png"/>`,
    `<item id="inline-image" href="images/inline.png" media-type="image/png"/>`,
    `<item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="chapter2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="chapter2-1" href="text/chapter2-1.xhtml" media-type="application/xhtml+xml"/>`,
  ].filter(Boolean);

  const spine = options.withNcx ? `<spine toc="ncx">` : `<spine>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:sample-book-fixture</dc:identifier>
    <dc:title>${SAMPLE_BOOK_TITLE}</dc:title>
    <dc:creator>${SAMPLE_BOOK_AUTHOR}</dc:creator>
    <dc:description>${SAMPLE_BOOK_DESCRIPTION}</dc:description>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  ${spine}
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter2-1"/>
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
        <li><a href="text/chapter1.xhtml">Chapter 1</a></li>
        <li>
          <a href="text/chapter2.xhtml">Chapter 2</a>
          <ol>
            <li><a href="text/chapter2-1.xhtml"><span>Section </span><span>2.1</span></a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`;
}

function ncxXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:sample-book-fixture"/>
  </head>
  <docTitle><text>${SAMPLE_BOOK_TITLE}</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>NCX Chapter 1</text></navLabel>
      <content src="text/chapter1.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-2" playOrder="2">
      <navLabel><text>NCX Chapter 2</text></navLabel>
      <content src="text/chapter2.xhtml"/>
      <navPoint id="navPoint-3" playOrder="3">
        <navLabel><text>NCX Section 2.1</text></navLabel>
        <content src="text/chapter2-1.xhtml"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`;
}

function chapter(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>
    <h1>${title}</h1>
    ${body}
  </body>
</html>`;
}

/**
 * Entry list of the sample EPUB used by the unit fixtures (mirrored to the repo
 * root as `sample-book.epub`): EPUB3 + NCX, nested TOC, cover, inline image and
 * an internal link, i.e. everything the upload/reader paths must handle.
 * Exported as a list so tests can drop single entries (e.g. keep the manifest
 * `properties="nav"` declaration while removing `nav.xhtml`).
 */
export function sampleEpubEntries(options: SampleBookOptions = {}): ZipEntry[] {
  const resolved: Required<SampleBookOptions> = {
    withNavigationDocument: options.withNavigationDocument ?? true,
    withNcx: options.withNcx ?? true,
  };

  const entries: ZipEntry[] = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/", data: "" },
    { name: "META-INF/container.xml", data: containerXml() },
    { name: "OEBPS/", data: "" },
    { name: "OEBPS/content.opf", data: contentOpf(resolved) },
    { name: "OEBPS/images/cover.png", data: buildPng(2, 2, [200, 60, 60]) },
    { name: "OEBPS/images/inline.png", data: buildPng(1, 1, [20, 120, 200]) },
    // Unreferenced members that pin the member route's cache tiers by MIME
    // type (immutable font/css/raster, revalidated svg, short-lived media,
    // fail-closed unknown). The reader never requests them.
    { name: "OEBPS/styles/book.css", data: "body { color: #111; }\n" },
    { name: "OEBPS/fonts/book.woff2", data: Buffer.from("wOF2") },
    {
      name: "OEBPS/images/art.svg",
      data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><text x="0" y="3">art</text></svg>',
    },
    { name: "OEBPS/media/audio.mp3", data: Buffer.from("ID3") },
    { name: "OEBPS/misc/blob.bin", data: "unknown bytes" },
    { name: "OEBPS/misc/empty.txt", data: "" },
    {
      name: "OEBPS/text/chapter1.xhtml",
      data: chapter(
        "Chapter 1",
        `<p>Body of chapter one.</p>
    <img src="../images/inline.png" alt="inline"/>
    <p><a href="chapter2.xhtml">Go to chapter two</a></p>`,
      ),
    },
    {
      name: "OEBPS/text/chapter2.xhtml",
      data: chapter("Chapter 2", "<p>Body of chapter two.</p>"),
    },
    {
      name: "OEBPS/text/chapter2-1.xhtml",
      data: chapter("Section 2.1", "<p>Body of section 2.1.</p>"),
    },
  ];

  if (resolved.withNavigationDocument) {
    entries.push({ name: "OEBPS/nav.xhtml", data: navXhtml() });
  }
  if (resolved.withNcx) {
    entries.push({ name: "OEBPS/toc.ncx", data: ncxXml() });
  }

  return entries;
}

/** The sample EPUB as ZIP bytes. */
export function buildSampleEpub(options: SampleBookOptions = {}): Buffer {
  return buildZip(sampleEpubEntries(options));
}
