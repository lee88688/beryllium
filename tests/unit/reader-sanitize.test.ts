// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  attachLoadGuards,
  sanitizeSectionHtml,
  type SectionMediaType,
} from "@/features/reader/epub/sanitize";

const XHTML: SectionMediaType = "application/xhtml+xml";
const HTML: SectionMediaType = "text/html";
const SVG: SectionMediaType = "image/svg+xml";

function parse(html: string, type: SectionMediaType = XHTML): Document {
  return new DOMParser().parseFromString(
    sanitizeSectionHtml(html, type),
    type === HTML ? "text/html" : type,
  );
}

describe("sanitizeSectionHtml", () => {
  it("removes script elements and inline handlers", () => {
    const doc = parse(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><body>
        <p id="p" onclick="steal()">text</p>
        <script>window.__pwned = true</script>
        <img src="x.png" onerror="steal()"/>
      </body></html>`);

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("#p")?.getAttribute("onclick")).toBeNull();
    expect(doc.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(doc.querySelector("#p")?.textContent).toBe("text");
  });

  it("neutralises javascript:, vbscript: and data:text/html URLs", () => {
    const doc = parse(`<html xmlns="http://www.w3.org/1999/xhtml"><body>
        <a id="a" href="javascript:steal()">link</a>
        <a id="b" href="vbscript:steal">link</a>
        <iframerx href="data:text/html,&lt;script&gt;steal()&lt;/script&gt;">x</iframerx>
        <img id="keep" src="data:image/png;base64,AAAA"/>
      </body></html>`);

    expect(doc.querySelector("#a")?.getAttribute("href")).toBeNull();
    expect(doc.querySelector("#b")?.getAttribute("href")).toBeNull();
    expect(doc.querySelector("iframerx")?.getAttribute("href")).toBeNull();
    // A data: *image* is legitimate book content and stays.
    expect(doc.querySelector("#keep")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("drops embedded documents, re-basing elements and refresh metas", () => {
    const doc = parse(`<html xmlns="http://www.w3.org/1999/xhtml"><head>
        <base href="https://evil.example/"/>
        <meta http-equiv="refresh" content="0;url=https://evil.example/"/>
      </head><body>
        <iframe src="https://evil.example/"></iframe>
        <object data="x.svg"></object>
        <embed src="x.svg"/>
      </body></html>`);

    expect(doc.querySelector("base")).toBeNull();
    expect(doc.querySelector("meta[http-equiv]")).toBeNull();
    expect(doc.querySelector("iframe")).toBeNull();
    expect(doc.querySelector("object")).toBeNull();
    expect(doc.querySelector("embed")).toBeNull();
  });

  it("keeps the markup the paginator needs", () => {
    const sanitized = sanitizeSectionHtml(
      `<?xml version="1.0"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><head>
         <title>Chapter 1</title>
         <link rel="stylesheet" href="style.css"/>
         <style>p { color: red }</style>
       </head><body style="margin: 0">
         <h1 class="title">Chapter 1</h1>
         <p><a href="chapter2.xhtml#note">next</a></p>
         <img src="../images/inline.png" srcset="../images/a.png 1x, ../images/b.png 2x"/>
       </body></html>`,
      XHTML,
    );

    expect(sanitized).toContain("<title>Chapter 1</title>");
    expect(sanitized).toContain('href="style.css"');
    expect(sanitized).toContain("p { color: red }");
    expect(sanitized).toContain('style="margin: 0"');
    expect(sanitized).toContain('href="chapter2.xhtml#note"');
    expect(sanitized).toContain("srcset=");
    // Namespaces survive the round trip: this becomes a blob document.
    expect(sanitized).toContain("http://www.w3.org/1999/xhtml");
  });

  it("keeps only the safe candidates of a srcset", () => {
    const doc = parse(`<html xmlns="http://www.w3.org/1999/xhtml"><body>
        <img id="a" srcset="a.png 1x, javascript:steal() 2x"/>
      </body></html>`);

    expect(doc.querySelector("#a")?.getAttribute("srcset")).toBe("a.png 1x");
  });

  it("sanitises SVG documents", () => {
    const doc = parse(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="steal()">
         <script>steal()</script><rect width="10" height="10"/>
       </svg>`,
      SVG,
    );

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.documentElement.getAttribute("onload")).toBeNull();
    expect(doc.querySelector("rect")).not.toBeNull();
  });

  it("falls back to HTML parsing for markup that is not well-formed", () => {
    const sanitized = sanitizeSectionHtml(
      `<html><body><p>unclosed<script>steal()</script></body>`,
      XHTML,
    );

    expect(sanitized).not.toContain("<script");
    expect(sanitized).toContain("unclosed");
  });

  it("leaves media types the reader never renders alone", () => {
    const css = "body { background: url(javascript:steal()) }";

    expect(sanitizeSectionHtml(css, "text/css")).toBe(css);
    expect(sanitizeSectionHtml("binary", "image/png")).toBe("binary");
  });
});

describe("attachLoadGuards", () => {
  function dispatch(target: EventTarget, type: string, detail: object) {
    const event = new CustomEvent(type, { detail });
    target.dispatchEvent(event);
    return event.detail as Record<string, unknown>;
  }

  it("denies scripted manifest items", () => {
    const target = new EventTarget();
    const detach = attachLoadGuards(target);

    const scripted = dispatch(target, "load", {
      type: "text/javascript",
      isScript: true,
      allow: true,
    });
    const chapter = dispatch(target, "load", {
      type: "application/xhtml+xml",
      isScript: false,
      allow: true,
    });

    expect(scripted.allow).toBe(false);
    expect(chapter.allow).toBe(true);
    detach();
  });

  it("sanitises section markup on its way to the blob", async () => {
    const target = new EventTarget();
    attachLoadGuards(target);

    const detail = dispatch(target, "data", {
      type: "application/xhtml+xml",
      data: `<html xmlns="http://www.w3.org/1999/xhtml"><body><script>steal()</script><p>ok</p></body></html>`,
    });

    const sanitized = await (detail.data as Promise<string>);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).toContain("<p>ok</p>");
  });

  it("accepts a Blob payload and leaves untargeted types untouched", async () => {
    const target = new EventTarget();
    attachLoadGuards(target);

    const htmlDetail = dispatch(target, "data", {
      type: "text/html",
      data: new Blob([`<html><body><script>steal()</script></body></html>`], {
        type: "text/html",
      }),
    });
    const imageDetail = dispatch(target, "data", {
      type: "image/png",
      data: new Blob(["binary"]),
    });

    expect(await (htmlDetail.data as Promise<string>)).not.toContain("<script");
    expect(await (imageDetail.data as Promise<Blob>)).toBeInstanceOf(Blob);
  });

  it("stops guarding once detached", () => {
    const target = new EventTarget();
    const detach = attachLoadGuards(target);
    detach();

    const detail = dispatch(target, "load", { isScript: true, allow: true });
    expect(detail.allow).toBe(true);
  });
});
