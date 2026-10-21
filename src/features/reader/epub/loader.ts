import type { BookLoader } from "foliate-js/epub.js";

import { sha1Bytes } from "./sha1";

/**
 * The loader foliate-js asks for: raw member access, no archive container.
 *
 * Our storage is an ASAR of the unzipped EPUB tree (`src/server/services/file.ts`),
 * not a zip, so the wrapper never calls `makeBook`/`makeZipLoader` — `view.open()`
 * receives book objects we build ourselves from this loader, and every member is
 * fetched from the same `/api/books/{id}/files/{path}` route epubjs used before.
 */
export type BookLoaderOptions = {
  /** Member-URL prefix, i.e. `bookFileUrl(bookId, "")`. */
  filesBaseUrl: string;
  /**
   * Member path → uncompressed size. `epub.js` reads `.sections[i].size`
   * synchronously while building the book, and those sizes drive the reading
   * progress, so the caller pre-loads the spine sizes from the asar index.
   */
  sizes: ReadonlyMap<string, number>;
  fetch?: typeof globalThis.fetch;
};

/**
 * Member path → URL. Each segment is encoded separately so slashes survive and
 * the result matches what the server route expects (`bookFileUrl`).
 */
export function memberUrl(filesBaseUrl: string, path: string): string {
  return filesBaseUrl + path.split("/").map(encodeURIComponent).join("/");
}

export function createBookLoader(options: BookLoaderOptions): BookLoader {
  const fetcher = options.fetch ?? globalThis.fetch;

  const load = async (path: string): Promise<Response | null> => {
    const response = await fetcher(memberUrl(options.filesBaseUrl, path));
    // A member the OPF references but the archive lacks (an optional iBooks
    // display-options document, a dangling href) is `null`, never a throw:
    // foliate-js treats that as "absent" and carries on.
    return response.ok ? response : null;
  };

  return {
    loadText: async (path) => {
      const response = await load(path);
      return response ? await response.text() : null;
    },
    loadBlob: async (path) => {
      const response = await load(path);
      return response ? await response.blob() : null;
    },
    getSize: (path) => options.sizes.get(path) ?? 0,
    // IDPF font deobfuscation, without depending on a secure context.
    sha1: async (text) => {
      const digest = sha1Bytes(new TextEncoder().encode(text));
      return digest.buffer as ArrayBuffer;
    },
  };
}
