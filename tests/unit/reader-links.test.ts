// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachImagePreview } from "@/features/reader/epub/section-interactions";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * A section document, as the adapter hands it over: XHTML parsed as XML (which
 * is why `tagName` keeps the source case here), with foliate-js owning link
 * handling — the only delegation left is the image preview.
 */
function sectionDocument(): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="utf-8"?>
     <html xmlns="${XHTML_NS}"><body>
       <p><img id="inline" src="../images/inline.png" alt="inline"/></p>
       <p><a id="external" href="https://example.com/page">external</a></p>
       <p><a id="internal" href="chapter2.xhtml#note">internal</a></p>
       <p id="text">plain text</p>
     </body></html>`,
    "application/xhtml+xml",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attachImagePreview", () => {
  it("reports the clicked image and stops the default action", () => {
    const doc = sectionDocument();
    const onImageClick = vi.fn();
    const detach = attachImagePreview(doc, onImageClick);
    const image = doc.getElementById("inline")!;

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    image.dispatchEvent(event);

    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(onImageClick.mock.calls[0]?.[0]).toContain("images/inline.png");
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it("ignores links and plain text", () => {
    // Links belong to foliate-js: it emits `link` / `external-link`, and the
    // adapter cancels the latter to open the tab without `window.opener`.
    const doc = sectionDocument();
    const onImageClick = vi.fn();
    const detach = attachImagePreview(doc, onImageClick);

    for (const id of ["external", "internal", "text"]) {
      doc
        .getElementById(id)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }

    expect(onImageClick).not.toHaveBeenCalled();
    detach();
  });

  it("stops listening once detached", () => {
    const doc = sectionDocument();
    const onImageClick = vi.fn();
    const detach = attachImagePreview(doc, onImageClick);
    detach();

    doc
      .getElementById("inline")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onImageClick).not.toHaveBeenCalled();
  });
});
