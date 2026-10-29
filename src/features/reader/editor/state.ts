import type { ReaderAnchor } from "@/lib/reader-anchor";
import {
  MARK_TYPE,
  type MarkType,
  type NewReadingMark,
  type ReadingMark,
  type ReadingMarkPatch,
} from "../epub/types";

/**
 * Editor state for one highlight (D15).
 *
 * The draft is a superset of `Mark`: it keeps the row it was loaded from
 * (`origin`) and whether this editing session created it (`created`), which is
 * what makes "cancel rolls back a brand new mark" implementable.
 */
export type EditorDraft = {
  id?: number;
  bookId: number;
  type: MarkType;
  anchor: ReaderAnchor;
  color: string;
  content: string;
  selectedString: string;
  title: string;
  /** A row was created during this session → cancelling must delete it. */
  created: boolean;
  /** The persisted row this draft was loaded from (absent for new marks). */
  origin?: ReadingMark;
};

export function emptyEditorDraft(
  bookId: number,
  init?: Partial<EditorDraft>,
): EditorDraft {
  return {
    bookId,
    type: MARK_TYPE.highlight,
    anchor: { type: "cfi", cfi: "" },
    color: "",
    content: "",
    selectedString: "",
    title: "",
    created: false,
    ...init,
  };
}

export function draftFromMark(mark: ReadingMark): EditorDraft {
  return emptyEditorDraft(mark.bookId, {
    id: mark.id,
    type:
      mark.type === MARK_TYPE.bookmark
        ? MARK_TYPE.bookmark
        : MARK_TYPE.highlight,
    anchor: mark.anchor,
    color: mark.color,
    content: mark.content,
    selectedString: mark.selectedString,
    title: mark.title,
    origin: mark,
  });
}

/** D15: the annotation box can only be used once a colour created the row. */
export function isAnnotationEditable(draft: EditorDraft): boolean {
  return draft.id !== undefined;
}

export type EditorIntent =
  | { type: "none" }
  /** Cancel of a mark created in this session → delete it again. */
  | { type: "rollback"; id: number }
  | { type: "update"; patch: ReadingMarkPatch }
  | { type: "remove"; id: number };

/**
 * Single source of truth for the D15 state machine:
 * - `cancel` → roll back this session's creation (an existing mark is left to
 *   the caller, which restores the persisted colour in the overlay);
 * - `confirm` → `updateMark`, and only when the mark already has an id;
 * - `delete` → `removeMark`, and only when the mark already has an id.
 */
export function planEditorIntent(
  action: "cancel" | "confirm" | "delete",
  draft: EditorDraft,
): EditorIntent {
  const id = draft.id;
  if (action === "cancel") {
    return draft.created && id !== undefined
      ? { type: "rollback", id }
      : { type: "none" };
  }
  if (id === undefined) return { type: "none" };
  if (action === "delete") return { type: "remove", id };
  return {
    type: "update",
    patch: {
      id,
      type: draft.type,

      color: draft.color,
      content: draft.content,
      selectedString: draft.selectedString,
      title: draft.title,
    },
  };
}

export function toNewMark(draft: EditorDraft): NewReadingMark {
  return {
    bookId: draft.bookId,
    type: draft.type,
    anchor: draft.anchor,
    color: draft.color,
    content: draft.content,
    selectedString: draft.selectedString,
    title: draft.title,
  };
}

/**
 * The persisted row a confirmed draft describes (A3). The adapter indexes whole
 * rows, so a confirmed edit has to hand back every field — a colour-only
 * geometry would leave the stale content behind in the index.
 */
export function toPersistedMark(draft: EditorDraft): ReadingMark | undefined {
  if (draft.id === undefined) return undefined;
  return { id: draft.id, ...toNewMark(draft) };
}
