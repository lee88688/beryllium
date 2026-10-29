import type { EpubPackage } from "@/server/domain/epub";
import type { PdfPackage } from "./pdf-package";

/** The two shapes stored in `Book.content`; discriminated by `kind`/`package`. */
export type BookContent = EpubPackage | PdfPackage;

export function isPdfPackage(content: unknown): content is PdfPackage {
  return (
    typeof content === "object" &&
    content !== null &&
    "kind" in content &&
    content.kind === "pdf"
  );
}

export function isEpubPackage(content: unknown): content is EpubPackage {
  return (
    typeof content === "object" &&
    content !== null &&
    "package" in content &&
    typeof content.package === "object" &&
    content.package !== null
  );
}
