/** Fields a mark can match. Bookmarks never search `content`. */
export type MarkSearchField = "content" | "selectedString" | "title";

/** The book summary attached to each result group. */
export interface MarkSearchBook {
  id: number;
  title: string;
  author: string;
  coverUrl: string;
  format: "epub" | "pdf";
  percent: number;
  lastReadAt: number;
}

/** One matched highlight/bookmark, already reduced to a display snippet. */
export interface MarkSearchHit {
  id: number;
  type: "highlight" | "bookmark";
  color: string;
  /** Chapter name / bookmark page, already formatted for the row. */
  location: string;
  /** `true` when the highlight has a note (`content`). */
  hasNote: boolean;
  matchedField: MarkSearchField;
  snippet: string;
}

/** Cursor inside one book: highlights (rank 0) first, then bookmarks. */
export interface MarkSearchCursor {
  rank: number;
  id: number;
}

export interface MarkSearchCounts {
  notes: number;
  bookmarks: number;
}

export interface MarkSearchGroup {
  book: MarkSearchBook;
  counts: MarkSearchCounts;
  hits: MarkSearchHit[];
  /** Present when the group has more hits after `${hits.length}`. */
  nextHitCursor?: MarkSearchCursor;
}

export interface MarkSearchResult {
  groups: MarkSearchGroup[];
  totals: {
    books: number;
    notes: number;
    bookmarks: number;
  };
  /** Present when more book groups exist after this page. */
  nextGroupOffset?: number;
}

export interface MarkSearchHitsResult {
  hits: MarkSearchHit[];
  nextHitCursor?: MarkSearchCursor;
}
