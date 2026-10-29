/**
 * Retention policy for the ASAR store: an `<asarDir>/<name>.asar` file that no
 * `Book` row points at is dead weight (a failed upload that escaped cleanup, a
 * hand-copied archive, a row deleted straight in SQLite). Pure on purpose, so
 * `pnpm data:cleanup` and its tests cannot drift apart on what "orphan" means.
 */

/** `file.asar` → `file`, or `undefined` for anything that is not an ASAR. */
export function asarNameOf(entryName: string): string | undefined {
  const suffix = ".asar";
  if (!entryName.toLowerCase().endsWith(suffix)) return undefined;
  const name = entryName.slice(0, -suffix.length);
  return name === "" ? undefined : name;
}

/** `file.pdf` → `file`, or `undefined` for anything that is not a PDF. */
export function pdfNameOf(entryName: string): string | undefined {
  const suffix = ".pdf";
  if (!entryName.toLowerCase().endsWith(suffix)) return undefined;
  const name = entryName.slice(0, -suffix.length);
  return name === "" ? undefined : name;
}

/**
 * Names (not paths) of the ASAR files whose `<name>` appears in no book row.
 *
 * `dirEntries` are the names of the entries in the ASAR directory; directories
 * that happen to end in `.asar` should be filtered out by the caller, which is
 * why this takes names rather than a directory path.
 */
export function findOrphanAsarFiles(
  bookFileNames: readonly string[],
  dirEntries: readonly string[],
): string[] {
  const known = new Set(bookFileNames);
  const orphans = new Set<string>();

  for (const entryName of dirEntries) {
    const name = asarNameOf(entryName);
    if (name !== undefined && !known.has(name)) orphans.add(entryName);
  }

  return [...orphans].sort();
}

/** Same policy for the PDF store (`BOOKS_DIR/*.pdf`). */
export function findOrphanPdfFiles(
  bookFileNames: readonly string[],
  dirEntries: readonly string[],
): string[] {
  const known = new Set(bookFileNames);
  const orphans = new Set<string>();

  for (const entryName of dirEntries) {
    const name = pdfNameOf(entryName);
    if (name !== undefined && !known.has(name)) orphans.add(entryName);
  }

  return [...orphans].sort();
}
