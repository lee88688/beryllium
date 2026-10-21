/**
 * Member-URL prefix of one book's archive. The reader builds every member URL
 * (chapters, stylesheets, images) from it, one encoded segment at a time.
 */
export function bookFilesBaseUrl(bookId: number): string {
  return `/api/books/${bookId}/files/`;
}

/** Same-origin URL of one file inside a book's archive. Used for the cover
 * (`Book.cover`, D1) and for the OPF the reader reads through its loader. */
export function bookFileUrl(bookId: number, filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return bookFilesBaseUrl(bookId) + encoded;
}
