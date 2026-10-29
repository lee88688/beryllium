import { describe, expect, it } from "vitest";
import { PDF_METADATA_PARSE_LIMIT_MB } from "@/lib/pdf-package";
import { parsePdfMetadata } from "@/features/upload/pdf-metadata";

describe("parsePdfMetadata", () => {
  it("skips the parse (and pdf.js) for files above the metadata limit", async () => {
    const file = {
      size: (PDF_METADATA_PARSE_LIMIT_MB + 1) * 1024 * 1024,
    } as File;
    await expect(parsePdfMetadata(file)).resolves.toBeUndefined();
  });
});
