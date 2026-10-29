import path from "node:path";
import { defineConfig, normalizePath } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// `vite-plugin-static-copy` serves these files directly from node_modules in
// dev and writes them into `build.outDir` on build. They are fetched by URL at
// runtime (worker, CMaps, fonts, wasm decoders, layer CSS), so they must keep
// stable paths rather than going through the module graph.
const root = import.meta.dirname;
const pdfjs = normalizePath(path.resolve(root, "node_modules", "pdfjs-dist"));
const vendoredPdfjs = normalizePath(
  path.resolve(root, "vendor", "foliate-js", "vendor", "pdfjs"),
);

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    tailwindcss(),
    viteReact(),
    ...viteStaticCopy({
      targets: [
        {
          src: `${pdfjs}/build/pdf.worker.min.mjs`,
          dest: "vendor/pdfjs",
          rename: { stripBase: true, name: "pdf.worker.mjs" },
        },
        {
          src: `${pdfjs}/cmaps/**/*`,
          dest: "vendor/pdfjs",
          rename: { stripBase: 2 },
        },
        {
          src: `${pdfjs}/standard_fonts/**/*`,
          dest: "vendor/pdfjs",
          rename: { stripBase: 2 },
        },
        {
          src: `${pdfjs}/wasm/**/*`,
          dest: "vendor/pdfjs",
          rename: { stripBase: 2 },
        },
        {
          src: `${pdfjs}/iccs/**/*`,
          dest: "vendor/pdfjs",
          rename: { stripBase: 2 },
        },
        {
          src: `${vendoredPdfjs}/*.css`,
          dest: "vendor/pdfjs",
          rename: { stripBase: true },
        },
        {
          src: `${pdfjs}/LICENSE*`,
          dest: "vendor/pdfjs",
          rename: { stripBase: 2 },
        },
      ],
    }),
  ],
});
