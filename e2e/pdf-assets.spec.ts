import { expect, test } from "./fixtures";

test("serves the pdf.js worker, cmaps, fonts and wasm assets", async ({
  request,
}) => {
  for (const url of [
    "/vendor/pdfjs/pdf.worker.mjs",
    "/vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap",
    "/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
    "/vendor/pdfjs/wasm/openjpeg.wasm",
    "/vendor/pdfjs/text_layer_builder.css",
    "/vendor/pdfjs/annotation_layer_builder.css",
  ]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
  }
});
