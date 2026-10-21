import { describe, expect, it } from "vitest";
import {
  fillInBaseInfo,
  contentMetadata,
  getManifestItemFromId,
  getNavigationPath,
  getTocPath,
  parseContainerPath,
  parseOpf,
  parseToc,
  resolveHref,
  type EpubPackage,
} from "@/server/domain/epub";
import { RequestError } from "@/server/domain/errors";

const OPF_XML = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Navigation &amp; Structure</dc:title>
    <dc:creator>Ada</dc:creator>
    <dc:creator>Grace</dc:creator>
    <dc:description>A book about books</dc:description>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="../images/cover.png" media-type="image/png"/>
    <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
  </spine>
</package>`;

const NCX_XML = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1">
      <navLabel><text>One</text></navLabel>
      <content src="text/c1.xhtml"/>
    </navPoint>
    <navPoint id="n2">
      <navLabel><text>Two</text></navLabel>
      <content src="text/c2.xhtml"/>
      <navPoint id="n3">
        <navLabel><text>Two and a half</text></navLabel>
        <content src="text/c3.xhtml"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`;

const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="landmarks">
      <ol><li><a href="text/c1.xhtml">Start</a></li></ol>
    </nav>
    <nav epub:type="toc">
      <ol>
        <li><a href="text/c1.xhtml">One</a></li>
        <li>
          <a href="text/c2.xhtml">Two<span> (reloaded)</span></a>
          <ol>
            <li><a href="text/c3.xhtml">Two and a half</a></li>
          </ol>
        </li>
        <li><a href="text/c4.xhtml">  Spaced
          out  </a></li>
      </ol>
    </nav>
  </body>
</html>`;

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

describe("parseOpf / metadata helpers", () => {
  it("parses the OPF into the stored EpubPackage shape", async () => {
    const pkg = await parseOpf(OPF_XML);

    expect(pkg.package.manifest?.[0]?.item).toHaveLength(4);
    expect(pkg.package.spine?.[0]?.$?.toc).toBe("ncx");
    expect(contentMetadata(pkg)["dc:title"]).toEqual([
      "Navigation & Structure",
    ]);
  });

  it("returns an empty metadata object for an empty package", () => {
    expect(contentMetadata({} as EpubPackage)).toEqual({});
  });

  it("fills title, author, description and the cover path", async () => {
    const pkg = await parseOpf(OPF_XML);

    expect(fillInBaseInfo(pkg, "OEBPS/content.opf")).toEqual({
      title: "Navigation & Structure",
      author: "Ada,Grace",
      description: "A book about books",
      cover: "images/cover.png",
    });
  });

  it("leaves the cover empty when the OPF has no meta[name=cover]", async () => {
    const pkg = await parseOpf(
      OPF_XML.replace('<meta name="cover" content="cover-img"/>', ""),
    );

    expect(fillInBaseInfo(pkg, "OEBPS/content.opf").cover).toBe("");
  });

  it("looks manifest items up by id and resolves their href", async () => {
    const pkg = await parseOpf(OPF_XML);

    expect(getManifestItemFromId(pkg, "c1")?.$?.href).toBe("text/c1.xhtml");
    expect(getManifestItemFromId(pkg, undefined)).toBeUndefined();
    expect(getManifestItemFromId(pkg, "missing")).toBeUndefined();
  });
});

describe("resolveHref", () => {
  it("resolves against the directory holding the OPF", () => {
    expect(resolveHref("OEBPS/content.opf", "text/c1.xhtml")).toBe(
      "OEBPS/text/c1.xhtml",
    );
    expect(resolveHref("content.opf", "toc.ncx")).toBe("toc.ncx");
    expect(resolveHref("OEBPS/content.opf", "../images/cover.png")).toBe(
      "images/cover.png",
    );
  });

  it("always returns forward slashes", () => {
    expect(resolveHref("OEBPS\\content.opf", "text\\c1.xhtml")).toBe(
      "OEBPS/text/c1.xhtml",
    );
  });

  it("returns an empty path when the book has no OPF path", () => {
    expect(resolveHref("", "toc.ncx")).toBe("");
  });
});

describe("getTocPath / getNavigationPath", () => {
  it("resolves the NCX path from spine[toc]", async () => {
    const pkg = await parseOpf(OPF_XML);

    expect(getTocPath({ contentPath: "OEBPS/content.opf", content: pkg })).toBe(
      "OEBPS/toc.ncx",
    );
  });

  it("returns an empty NCX path for EPUB3-only books", async () => {
    const pkg = await parseOpf(OPF_XML.replace('<spine toc="ncx">', "<spine>"));

    expect(getTocPath({ contentPath: "OEBPS/content.opf", content: pkg })).toBe(
      "",
    );
  });

  it("resolves the EPUB3 navigation document from properties=nav", async () => {
    const pkg = await parseOpf(OPF_XML);

    expect(
      getNavigationPath({ contentPath: "OEBPS/content.opf", content: pkg }),
    ).toBe("OEBPS/nav.xhtml");
  });

  it("returns an empty navigation path when no item declares properties=nav", async () => {
    const pkg = await parseOpf(OPF_XML.replace(' properties="nav"', ""));

    expect(
      getNavigationPath({ contentPath: "OEBPS/content.opf", content: pkg }),
    ).toBe("");
  });
});

describe("parseContainerPath", () => {
  it("reads the OPF path out of META-INF/container.xml", async () => {
    await expect(parseContainerPath(CONTAINER_XML)).resolves.toBe(
      "OEBPS/content.opf",
    );
  });

  it("rejects a container without a rootfile", async () => {
    await expect(parseContainerPath("<container/>")).rejects.toThrowError(
      RequestError,
    );
  });
});

describe("parseToc", () => {
  it("parses nested NCX navPoints (auto-detected dialect)", async () => {
    await expect(parseToc(NCX_XML)).resolves.toEqual([
      { label: "One", src: "text/c1.xhtml" },
      {
        label: "Two",
        src: "text/c2.xhtml",
        children: [{ label: "Two and a half", src: "text/c3.xhtml" }],
      },
    ]);
  });

  it("parses the EPUB3 nav document and ignores other nav elements", async () => {
    await expect(parseToc(NAV_XHTML)).resolves.toEqual([
      { label: "One", src: "text/c1.xhtml" },
      {
        label: "Two (reloaded)",
        src: "text/c2.xhtml",
        children: [{ label: "Two and a half", src: "text/c3.xhtml" }],
      },
      { label: "Spaced out", src: "text/c4.xhtml" },
    ]);
  });

  it("honours an explicit dialect", async () => {
    await expect(parseToc(NCX_XML, "ncx")).resolves.toHaveLength(2);
    await expect(parseToc(NAV_XHTML, "nav")).resolves.toHaveLength(3);
  });

  it("returns an empty TOC for empty or structureless documents", async () => {
    await expect(parseToc("")).resolves.toEqual([]);
    await expect(parseToc("<html><body></body></html>")).resolves.toEqual([]);
    await expect(parseToc("<ncx><navMap/></ncx>")).resolves.toEqual([]);
  });
});
