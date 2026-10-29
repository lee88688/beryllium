import path from "node:path";
import { parseStringPromise } from "xml2js";
import { RequestError } from "./errors";

/** xml2js attribute bag (`$`) — every value comes from XML, so all optional. */
export type XmlAttributes = Record<string, string | undefined>;

/** Plain xml2js node: attributes in `$`, own text in `_`, children by tag name. */
export interface XmlNode {
  $?: XmlAttributes;
  _?: string;
  [key: string]: unknown;
}

export interface OpfManifest {
  item?: { $: XmlAttributes }[];
}

export interface OpfSpine {
  $?: XmlAttributes;
  itemref?: { $: XmlAttributes }[];
}

export interface OpfPackage {
  $?: XmlAttributes;
  metadata: Record<string, unknown>[];
  manifest: OpfManifest[];
  spine: OpfSpine[];
}

/**
 * Parsed OPF document as stored in `Book.content`. Kept structurally identical
 * to the previous xml2js output so existing rows stay readable: xml2js wraps
 * child elements in arrays but not the document root itself.
 */
export interface EpubPackage {
  package: OpfPackage;
}

/** Columns needed to resolve in-archive paths for a book. */
export interface EpubDocumentSource {
  contentPath: string;
  content: EpubPackage;
}

/** One TOC entry; `children` mirrors the nesting of NCX navPoints / nav `<ol>`. */
export interface TocItem {
  label: string;
  src: string;
  children?: TocItem[];
}

/** Which TOC dialect a document is written in. */
export type TocMode = "ncx" | "nav";

/**
 * Where a TOC document lives, so its hrefs can be rebased (B18). Both dialects
 * write their hrefs relative to *their own* file, while the reader needs
 * archive-rooted member paths — the form foliate-js matches against manifest
 * hrefs (`book.resolveHref`) and reports back as a location's `tocItem.href`.
 * The two directories only coincide when nav/NCX sit next to the OPF.
 */
export interface TocBase {
  /** Archive path of the nav/NCX document being parsed. */
  documentPath: string;
  /** Archive path of the OPF package document. */
  contentPath: string;
}

export interface BookBaseInfo {
  title: string;
  author: string;
  description: string;
  cover: string;
}

function asArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

/** Concatenates all text nodes below `node`, including nested inline markup. */
function collectText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (node === null || typeof node !== "object") return "";

  const record = node as Record<string, unknown>;
  let text = typeof record._ === "string" ? record._ : "";
  for (const [key, value] of Object.entries(record)) {
    if (key === "$" || key === "_") continue;
    text += collectText(value);
  }
  return text;
}

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function parseOpf(xml: string): Promise<EpubPackage> {
  return (await parseStringPromise(xml)) as EpubPackage;
}

/**
 * OPF path declared in `META-INF/container.xml`
 * (`container/rootfiles/rootfile/@full-path`).
 */
export async function parseContainerPath(xml: string): Promise<string> {
  const container = (await parseStringPromise(xml)) as XmlNode;
  const rootfile = asArray<XmlNode>(
    asArray<XmlNode>(asArray<XmlNode>(container.container)[0]?.rootfiles)[0]
      ?.rootfile,
  )[0];
  const fullPath = rootfile?.$?.["full-path"];
  if (!fullPath) {
    throw new RequestError(
      "BAD_REQUEST",
      "META-INF/container.xml does not declare an OPF rootfile",
    );
  }
  return fullPath;
}

/** `Book.contentObject.package.metadata[0]` equivalent (replaces the Prisma `$extends`). */
export function contentMetadata(pkg: EpubPackage): Record<string, unknown> {
  return pkg.package?.metadata?.[0] ?? {};
}

function readMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
): string {
  const entries = asArray<unknown>(metadata[`dc:${key}`] ?? metadata[key]);
  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = entry as Record<string, unknown>;
      return typeof record._ === "string" ? record._ : collectText(record);
    })
    .join(",");
}

function readMetaContent(
  metadata: Record<string, unknown>,
  name: string,
): string | undefined {
  const metas = asArray<XmlNode>(metadata.meta);
  const match = metas.find((meta) => meta.$?.name === name);
  return match?.$?.content;
}

export function getManifestItemFromId(
  pkg: EpubPackage,
  id: string | undefined,
): { $: XmlAttributes } | undefined {
  if (!id) return undefined;
  const items = asArray<{ $: XmlAttributes }>(pkg.package?.manifest?.[0]?.item);
  return items.find((item) => item.$.id === id);
}

/**
 * Resolves an OPF-relative `href` against the directory holding the OPF file
 * and always returns forward slashes: asar paths must never look Windows-like.
 */
export function resolveHref(contentPath: string, href: string): string {
  if (!contentPath) return "";
  const directory = path.posix.dirname(contentPath.replaceAll("\\", "/"));
  return path.posix.normalize(
    path.posix.join(directory, href.replaceAll("\\", "/")),
  );
}

/** Book columns derived from OPF metadata; cover is an ASAR-relative path. */
export function fillInBaseInfo(
  pkg: EpubPackage,
  contentPath: string,
): BookBaseInfo {
  const metadata = contentMetadata(pkg);
  const coverItem = getManifestItemFromId(
    pkg,
    readMetaContent(metadata, "cover"),
  );
  const coverHref = coverItem?.$.href;

  return {
    title: readMetadataValue(metadata, "title"),
    author: readMetadataValue(metadata, "creator"),
    description: readMetadataValue(metadata, "description"),
    cover: coverHref ? resolveHref(contentPath, coverHref) : "",
  };
}

/**
 * NCX path of the book (`spine[toc]` → manifest href). Returns `""` when the
 * book has no NCX instead of throwing, so callers can fall back.
 */
export function getTocPath(book: EpubDocumentSource): string {
  const spine = asArray<OpfSpine>(book.content.package?.spine)[0];
  const tocId = spine?.$?.toc;
  const href = getManifestItemFromId(book.content, tocId)?.$.href;
  return href ? resolveHref(book.contentPath, href) : "";
}

/** EPUB3 navigation document path (`manifest item[properties~="nav"]`), or `""`. */
export function getNavigationPath(book: EpubDocumentSource): string {
  const items = asArray<{ $: XmlAttributes }>(
    book.content.package?.manifest?.[0]?.item,
  );
  const navItem = items.find((item) =>
    (item.$.properties ?? "").split(/\s+/).includes("nav"),
  );
  const href = navItem?.$.href;
  return href ? resolveHref(book.contentPath, href) : "";
}

/**
 * Member paths of the spine in reading order, archive-rooted and decoded —
 * the keys the reader's loader is asked for, both for sizes and for the
 * section documents themselves. Items whose `idref` has no manifest entry are
 * skipped, mirroring how the reader treats a broken spine.
 */
export function getSpinePaths(pkg: EpubPackage, contentPath: string): string[] {
  const spine = asArray<OpfSpine>(pkg.package?.spine)[0];
  const items = asArray<{ $: XmlAttributes }>(pkg.package?.manifest?.[0]?.item);
  const paths: string[] = [];
  for (const ref of asArray<{ $: XmlAttributes }>(spine?.itemref)) {
    const href = items.find((item) => item.$.id === ref.$.idref)?.$.href;
    if (href) paths.push(decodeArchiveHref(resolveHref(contentPath, href)));
  }
  return paths;
}

/** Parses one navPoint subtree (recursive, mirrors nested NCX navMaps). */
function parseNavPoint(point: XmlNode, base?: TocBase): TocItem {
  const label = asArray<XmlNode>(point.navLabel)
    .map((navLabel) =>
      asArray<string | XmlNode>(navLabel.text)
        .map((text) => normalizeLabel(collectText(text)))
        .join(", "),
    )
    .join(", ");
  const content = asArray<XmlNode>(point.content)[0];

  const item: TocItem = {
    label,
    src: rebaseTocHref(content?.$?.src ?? "", base),
  };
  const children = asArray<XmlNode>(point.navPoint);
  if (children.length > 0) {
    item.children = children.map((child) => parseNavPoint(child, base));
  }
  return item;
}

/**
 * Turns a TOC href into an archive-root-relative member path: resolve it
 * against the document's own directory, then percent-decode it. That is the
 * form the reader passes to foliate-js, whose `resolveHref` matches TOC hrefs
 * against *manifest* hrefs — archive-rooted and decoded (`epub.js`
 * `resolveURL`). Without a base the href is returned as written, which is what
 * documents living next to the OPF need anyway.
 */
function rebaseTocHref(href: string, base?: TocBase): string {
  if (base === undefined || href === "") return href;
  return decodeArchiveHref(resolveHref(base.documentPath, href));
}

/**
 * Percent-decoding for member paths, matching what foliate-js asks the loader
 * for. A malformed escape sequence keeps the raw value instead of throwing, so
 * one broken href cannot take the whole TOC down.
 */
export function decodeArchiveHref(memberPath: string): string {
  try {
    return decodeURI(memberPath);
  } catch {
    return memberPath;
  }
}

/** Parses one `<ol>` of an EPUB3 nav document (recursive). */
function parseNavList(list: XmlNode, base?: TocBase): TocItem[] {
  const items: TocItem[] = [];
  for (const li of asArray<XmlNode>(list.li)) {
    const anchor = asArray<XmlNode>(li.a)[0] ?? asArray<XmlNode>(li.span)[0];
    const item: TocItem = {
      label: normalizeLabel(collectText(anchor)),
      src: rebaseTocHref(anchor?.$?.href ?? "", base),
    };
    const nested = asArray<XmlNode>(li.ol)[0];
    if (nested) {
      item.children = parseNavList(nested, base);
    }
    items.push(item);
  }
  return items;
}

function parseNcxDocument(doc: XmlNode, base?: TocBase): TocItem[] {
  const navMap = asArray<XmlNode>(asArray<XmlNode>(doc.ncx)[0]?.navMap)[0];
  if (!navMap) return [];
  return asArray<XmlNode>(navMap.navPoint).map((point) =>
    parseNavPoint(point, base),
  );
}

function parseNavDocument(doc: XmlNode, base?: TocBase): TocItem[] {
  const body = asArray<XmlNode>(asArray<XmlNode>(doc.html)[0]?.body)[0];
  if (!body) return [];

  const navs = asArray<XmlNode>(body.nav);
  const tocNav =
    navs.find((nav) =>
      (nav.$?.["epub:type"] ?? nav.$?.type ?? "").split(/\s+/).includes("toc"),
    ) ?? navs[0];
  const list = asArray<XmlNode>(tocNav?.ol)[0];
  return list ? parseNavList(list, base) : [];
}

/**
 * Parses an EPUB3 `nav.xhtml` or an NCX document into a nested TOC.
 *
 * `mode` may be given explicitly — the service layer prefers the EPUB3 nav
 * document and falls back to NCX — otherwise the dialect is detected
 * from the root element (`<ncx>` vs `<html>`). `base` rebases every href onto
 * the OPF directory (B18).
 */
export async function parseToc(
  xml: string,
  mode?: TocMode,
  base?: TocBase,
): Promise<TocItem[]> {
  if (!xml) return [];
  const doc = (await parseStringPromise(xml)) as XmlNode;
  const resolved = mode ?? (doc.ncx === undefined ? "nav" : "ncx");
  return resolved === "ncx"
    ? parseNcxDocument(doc, base)
    : parseNavDocument(doc, base);
}
