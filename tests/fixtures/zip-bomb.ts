import { buildZip, type ZipEntry } from "./zip.ts";

/**
 * Fixtures for the upload/extract budget (B1): a real zip bomb is just a very
 * compressible member, which is exactly what `Buffer.alloc(n)` zips into.
 */

/** A single member of `memberBytes` zero bytes — kilobytes on the wire. */
export function buildZipBomb(memberBytes = 16 * 1024 * 1024): Buffer {
  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "bomb.bin", data: Buffer.alloc(memberBytes) },
  ]);
}

/**
 * The same archive with the *declared* uncompressed size of the bomb member
 * patched down to `declaredBytes` (local header and central directory), while
 * the deflate stream still expands to `memberBytes`. This is the archive a
 * declared-size-only check would wave through, so it pins the byte-counting
 * half of the guard.
 */
export function buildLyingZipBomb({
  memberBytes,
  declaredBytes,
}: {
  memberBytes: number;
  declaredBytes: number;
}): Buffer {
  const zip = buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "bomb.bin", data: Buffer.alloc(memberBytes) },
  ]);
  const patched = Buffer.from(zip);

  // The `mimetype` entry comes first, so the second entry's local header starts
  // after it; both size fields are at fixed offsets in their headers.
  const firstHeaderLength = 30 + patched.readUInt16LE(26);
  const firstDataLength = patched.readUInt32LE(18);
  const localOffset = firstHeaderLength + firstDataLength;
  const secondHeaderLength = 30 + patched.readUInt16LE(localOffset + 26);
  const secondDataLength = patched.readUInt32LE(localOffset + 18);
  const centralOffset = localOffset + secondHeaderLength + secondDataLength;
  if (patched.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error("zip-bomb fixture: unexpected central directory layout");
  }

  patched.writeUInt32LE(declaredBytes, localOffset + 22);
  patched.writeUInt32LE(declaredBytes, centralOffset + 24);
  return patched;
}

/**
 * The XHTML body of `buildFatMemberEpub`'s chapter. Exported so the tests can
 * assert the served bytes exactly instead of "more than 2 MB".
 */
export function fatMemberChapter(memberBytes: number): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    "<head><title>Fat Chapter</title></head>",
    `<body><p>${"A".repeat(memberBytes)}</p></body>`,
    "</html>",
  ].join("\n");
}

/**
 * A structurally valid EPUB whose single chapter member is `memberBytes` of
 * text: small enough to upload and extract, far too big to hand to a reader in
 * one response.
 */
export function buildFatMemberEpub(memberBytes: number): Buffer {
  const entries: ZipEntry[] = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      name: "OEBPS/content.opf",
      data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fat-member-fixture</dc:identifier>
    <dc:title>Fat Member</dc:title>
    <dc:creator>Fixture</dc:creator>
    <dc:description>One very large chapter.</dc:description>
  </metadata>
  <manifest>
    <item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`,
    },
    { name: "OEBPS/text/chapter1.xhtml", data: fatMemberChapter(memberBytes) },
  ];

  return buildZip(entries);
}
