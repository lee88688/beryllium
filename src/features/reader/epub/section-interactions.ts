/**
 * Image preview for section content (A1/A6).
 *
 * foliate-js owns link handling: it stops the default navigation and emits
 * `link` (internal, navigated by the view) or `external-link` (cancellable,
 * and the adapter opens the tab itself with `noopener`). What it does not do is
 * what the reader needs for images, so the parent document listens on the
 * same-origin section document and reports the click.
 *
 * The duck-typed node shape is deliberate: the event target belongs to the
 * section realm, where `instanceof` against the parent's constructors fails.
 */

type ClickedImage = {
  nodeType: number;
  tagName?: string;
  currentSrc?: string;
  src?: string;
  getAttribute?: (name: string) => string | null;
};

/**
 * Attaches the delegation listener to one rendered section document and
 * returns its unsubscribe function.
 */
export function attachImagePreview(
  sectionDocument: Document,
  onImageClick: (src: string) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as unknown as ClickedImage | null;
    // Section markup is XHTML parsed as XML, where `tagName` keeps the source
    // case (`img`, not `IMG`) — unlike an HTML document. Getting this wrong
    // silently disables the preview.
    if (
      !target ||
      target.nodeType !== 1 ||
      target.tagName?.toLowerCase() !== "img"
    ) {
      return;
    }
    event.preventDefault();
    // `currentSrc` is the source the browser loaded; `src` (already absolute)
    // and the raw attribute cover an image that has not finished loading.
    const src =
      target.currentSrc ||
      target.src ||
      target.getAttribute?.("src")?.trim() ||
      "";
    if (src) onImageClick(src);
  };

  sectionDocument.addEventListener("click", onClick);
  return () => {
    sectionDocument.removeEventListener("click", onClick);
  };
}
