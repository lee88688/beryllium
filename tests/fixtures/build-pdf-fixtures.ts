import * as fsp from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";

/**
 * Writes the copyright-free PDF fixtures used by the e2e/integration suites.
 * All content is generated here; the encrypted file uses a fixed test password.
 *
 * Usage: `node tests/fixtures/build-pdf-fixtures.ts`
 */
type Draw = (doc: PDFKit.PDFDocument) => void;

function renderPdf(
  options: PDFKit.PDFDocumentOptions,
  draw: Draw,
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const doc = new PDFDocument(options);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
  draw(doc);
  doc.end();
  return promise;
}

const sample = renderPdf(
  {
    size: "A4",
    info: {
      Title: "Sample PDF",
      Author: "Beryllium PDF Author",
      Subject: "PDF fixture",
      CreationDate: new Date("2026-01-01T00:00:00Z"),
    },
  },
  (doc) => {
    doc.fontSize(24).text("Sample PDF");
    doc.moveDown().fontSize(14).text("Body of page one.");
    doc.outline.addItem("Page one");
    doc.addPage().fontSize(20).text("Page two");
    doc.moveDown().fontSize(14).text("Body of page two.");
    doc.outline.addItem("Page two");
    doc.addPage().fontSize(20).text("Page three");
    doc.moveDown().fontSize(14).text("Body of page three.");
    doc.outline.addItem("Page three");
  },
);

const noOutline = renderPdf(
  { size: "A4", info: { CreationDate: new Date("2026-01-01T00:00:00Z") } },
  (doc) => {
    doc.fontSize(20).text("No outline");
    doc
      .moveDown()
      .fontSize(14)
      .text("A fixture without metadata or bookmarks.");
    doc.addPage().fontSize(14).text("Second page without an outline.");
  },
);

const blankFirst = renderPdf(
  { size: "A4", info: { Title: "Blank First Page" } },
  (doc) => {
    doc.addPage().fontSize(20).text("Page two");
    doc
      .moveDown()
      .fontSize(14)
      .text("The first page of this fixture is blank.");
  },
);

const mixedPages = renderPdf(
  { size: "A4", info: { Title: "Mixed Pages" } },
  (doc) => {
    doc.fontSize(20).text("Portrait A4");
    doc.addPage({ size: "A4", layout: "landscape" }).text("Landscape A4");
    doc.addPage({ size: "LETTER" }).text("US Letter");
    doc.addPage({ size: "A5" }).text("A5");
  },
);

const manyPages = renderPdf(
  { size: "A5", info: { Title: "Many Pages" } },
  (doc) => {
    for (let page = 1; page <= 60; page += 1) {
      if (page > 1) doc.addPage();
      doc.fontSize(10).text(`Page ${page} of 60`);
    }
  },
);

const scannedPage = renderPdf(
  { size: "A4", info: { Title: "Scanned Page" } },
  (doc) => {
    doc.rect(0, 0, 595, 842).fill("#e5e7eb");
    doc.rect(80, 280, 420, 120).fill("#cbd5e1");
  },
);

const encrypted = renderPdf(
  {
    size: "A4",
    userPassword: "e2e-password",
    ownerPassword: "e2e-owner",
    info: { Title: "Encrypted PDF" },
  },
  (doc) => {
    doc.fontSize(20).text("Encrypted PDF");
    doc.moveDown().fontSize(14).text("This page needs a password.");
  },
);

const outputs: Record<string, Promise<Buffer>> = {
  "sample.pdf": sample,
  "no-outline.pdf": noOutline,
  "blank-first.pdf": blankFirst,
  "mixed-pages.pdf": mixedPages,
  "many-pages.pdf": manyPages,
  "scanned.pdf": scannedPage,
  "encrypted.pdf": encrypted,
};

for (const [name, promise] of Object.entries(outputs)) {
  const output = path.resolve(import.meta.dirname, name);
  await fsp.writeFile(output, await promise);
  console.log(`wrote ${output}`);
}
