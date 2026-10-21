/**
 * In-book script defence (the replacement for epubjs' `allowScriptedContent:
 * false`, which foliate-js has no equivalent of).
 *
 * foliate-js renders every section in a `sandbox="allow-same-origin
 * allow-scripts"` iframe created from a `blob:` URL (`paginator.js:244`), and
 * its loader only gate-keeps manifest items whose media type is JavaScript —
 * inline `<script>`, `on*` handlers and `javascript:` links inside a chapter
 * pass straight through. Measured in a browser: without a policy, a chapter's
 * inline script runs and reaches `parent.document`.
 *
 * Two mechanisms close that, both wired here:
 *
 * - `attachLoadGuards` mutates the loader's `load` event to deny scripted
 *   manifest items, and its `data` event to sanitise rendered markup before it
 *   is turned into a blob URL.
 * - The document-level CSP (`server.mjs`, `vite.config.ts`) is what actually
 *   stops inline scripts in the blob document, whose policy is inherited from
 *   the page that created it. Both are needed: CSP is the hard stop, the
 *   sanitiser removes the vectors CSP alone would still allow.
 */

/** Media types whose markup reaches a rendered section, as a union so the
 * value can be handed to `DOMParser` without a cast. */
export type SectionMediaType =
  | "application/xhtml+xml"
  | "text/html"
  | "image/svg+xml";

const SANITIZED_TYPES: Record<string, true> = {
  "application/xhtml+xml": true,
  "text/html": true,
  "image/svg+xml": true,
};

/** Elements that either execute, navigate, or re-base the document. */
const BLOCKED_ELEMENTS = [
  "applet",
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "object",
  "script",
].join(",");

/** Attributes whose value is a URL the browser would follow. */
const URL_ATTRIBUTES: Record<string, true> = {
  action: true,
  background: true,
  data: true,
  dynsrc: true,
  formaction: true,
  href: true,
  longdesc: true,
  ping: true,
  poster: true,
  src: true,
  srcset: true,
};

/**
 * Schemes that must never be reachable from book markup: `javascript:` and
 * `vbscript:` execute, `data:text/html` is a script carrier in disguise.
 * `data:image/...`, `blob:`, `http(s):` and relative references stay.
 */
const UNSAFE_URL =
  /^\s*(?:javascript|vbscript|data\s*:\s*(?:text\/html|application\/xhtml))/i;

function sanitizeSrcset(value: string): string | null {
  const kept = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        candidate !== "" && !UNSAFE_URL.test(candidate.split(/\s+/)[0] ?? ""),
    );
  return kept.length > 0 ? kept.join(", ") : null;
}

function sanitizeDocument(doc: Document): void {
  for (const element of doc.querySelectorAll(BLOCKED_ELEMENTS)) {
    element.remove();
  }
  for (const meta of doc.querySelectorAll("meta[http-equiv]")) {
    const directive = (meta.getAttribute("http-equiv") ?? "").toLowerCase();
    if (directive === "refresh" || directive === "set-cookie") meta.remove();
  }

  for (const element of doc.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      if (attribute.name.toLowerCase().startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES[name] !== true) continue;
      if (name === "srcset") {
        const kept = sanitizeSrcset(attribute.value);
        if (kept === null) element.removeAttribute(attribute.name);
        else if (kept !== attribute.value) {
          element.setAttribute(attribute.name, kept);
        }
        continue;
      }
      if (UNSAFE_URL.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

/**
 * Strips executable markup from one rendered section, keeping everything the
 * paginator needs (styles, links, images, inline `style`).
 *
 * Invalid XHTML is re-parsed as HTML — the same fallback the loader itself
 * applies to a section before it reaches here.
 */
export function sanitizeSectionHtml(
  html: string,
  mediaType: SectionMediaType | string,
): string {
  const type =
    SANITIZED_TYPES[mediaType] === true
      ? (mediaType as SectionMediaType)
      : undefined;
  if (type === undefined) return html;
  const asXml = type !== "text/html";
  let doc = new DOMParser().parseFromString(html, type);
  if (
    asXml &&
    (doc.querySelector("parsererror") !== null || !doc.documentElement)
  ) {
    doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.documentElement) return html;
    sanitizeDocument(doc);
    return doc.documentElement.outerHTML;
  }
  sanitizeDocument(doc);
  if (!asXml) return doc.documentElement?.outerHTML ?? html;
  return new XMLSerializer().serializeToString(doc);
}

type LoadDetail = {
  type?: string;
  isScript?: boolean;
  allow?: boolean;
};

type DataDetail = {
  data: unknown;
  type?: string;
};

/**
 * Wires the two guards onto the book's `transformTarget` (the loader's own
 * event target) and returns the detach function.
 */
export function attachLoadGuards(target: EventTarget): () => void {
  const handleLoad = (event: Event) => {
    const detail = (event as CustomEvent<LoadDetail | undefined>).detail;
    // A manifest item whose media type is JavaScript: nothing in this reader
    // ever needs it, so it is denied outright.
    if (detail?.isScript) detail.allow = false;
  };

  const handleData = (event: Event) => {
    const detail = (event as CustomEvent<DataDetail | undefined>).detail;
    const type = detail?.type;
    if (!detail || type === undefined || SANITIZED_TYPES[type] !== true) return;
    detail.data = Promise.resolve(detail.data).then(async (data: unknown) => {
      const html =
        typeof data === "string"
          ? data
          : data instanceof Blob
            ? await data.text()
            : null;
      return html === null ? data : sanitizeSectionHtml(html, type);
    });
  };

  target.addEventListener("load", handleLoad);
  target.addEventListener("data", handleData);
  return () => {
    target.removeEventListener("load", handleLoad);
    target.removeEventListener("data", handleData);
  };
}
