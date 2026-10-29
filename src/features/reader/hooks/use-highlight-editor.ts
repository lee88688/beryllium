import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ReaderAnchor } from "@/lib/reader-anchor";

import { readerErrorMessage, type ReaderApi } from "../api";
import {
  draftFromMark,
  emptyEditorDraft,
  planEditorIntent,
  toNewMark,
  toPersistedMark,
  type EditorDraft,
} from "../editor/state";
import {
  MARK_TYPE,
  type MarkClickedEvent,
  type ReadingMark,
  type Rect,
  type SelectedEvent,
} from "../epub/types";

/** One open editing session: the draft plus where the bubble is anchored. */
export type EditorSession = {
  /**
   * Stable identity of this session (A4). Every copy of the session keeps the
   * token, so an async response can tell "still the same editing session" from
   * "cancelled, or replaced by a new selection".
   */
  token: number;
  draft: EditorDraft;
  rect: Rect | undefined;
  measure: (() => Rect | undefined) | undefined;
  frame: HTMLIFrameElement | undefined;
};

export type UseHighlightEditorOptions = {
  bookId: number;
  api: ReaderApi;
  /** Called after a successful mutation so the owner can refetch its lists. */
  onMarksChanged?: () => void;
  onAddHighlight: (mark: ReadingMark) => void;
  onRemoveHighlight: (anchor: ReaderAnchor) => void;
  onUpdateHighlight: (mark: ReadingMark) => void;
};

export type HighlightEditorController = {
  session: EditorSession | undefined;
  pending: boolean;
  handleSelected: (event: SelectedEvent) => void;
  handleMarkClicked: (event: MarkClickedEvent) => void;
  /** 重新测量当前会话的锚点（翻页后、连续滚动中都要）。 */
  refreshAnchor: () => void;
  close: () => void;
  setColor: (color: string) => void;
  setContent: (content: string) => void;
  confirm: () => void;
  remove: () => void;
  cancel: () => void;
};

/**
 * Highlight editing state machine (D15).
 *
 * - 选色即创建: picking a colour on a draft without an id calls `addMark`;
 * - 批注框选色后可用: `HighlightEditor` disables it while `id === undefined`;
 * - 确定 = `updateMark`, 删除 = `removeMark` (both need an id);
 * - 取消 rolls back the mark this session created and restores the persisted
 *   colour of an existing one.
 *
 * A4: every session carries a token. A response that arrives after its session
 * was cancelled or replaced (a new selection while the request was in flight)
 * is discarded and the row it created is deleted, so it can neither edit the
 * wrong row nor leak its id into the next session.
 */
export function useHighlightEditor(
  options: UseHighlightEditorOptions,
): HighlightEditorController {
  const [session, setSessionState] = useState<EditorSession | undefined>();
  const [pendingToken, setPendingToken] = useState<number | undefined>();
  const sessionRef = useRef<EditorSession | undefined>(undefined);
  /** Token of the session whose request is in flight, if any. */
  const pendingRef = useRef<number | undefined>(undefined);
  const tokenRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  const setSession = (next: EditorSession | undefined) => {
    sessionRef.current = next;
    setSessionState(next);
  };

  /**
   * Marks a request in flight for one session. Pending is per session (A4): a
   * request that outlives its session must not block the next one.
   */
  const beginPending = (token: number) => {
    pendingRef.current = token;
    setPendingToken(token);
  };

  /** Clears the flag only for the request that set it. */
  const endPending = (token: number) => {
    if (pendingRef.current !== token) return;
    pendingRef.current = undefined;
    setPendingToken(undefined);
  };

  /** Starts a session with a fresh identity (A4). */
  const startSession = (
    session: Omit<EditorSession, "token">,
  ): EditorSession => {
    tokenRef.current += 1;
    const started = { ...session, token: tokenRef.current };
    setSession(started);
    return started;
  };

  const close = () => setSession(undefined);

  const handleSelected = (event: SelectedEvent) => {
    startSession({
      draft: emptyEditorDraft(optionsRef.current.bookId, {
        type: MARK_TYPE.highlight,
        anchor: event.anchor,
        selectedString: event.text,
        title: event.heading,
      }),
      rect: event.rect,
      measure: event.measure,
      frame: event.frame,
    });
  };

  const handleMarkClicked = (event: MarkClickedEvent) => {
    startSession({
      draft: draftFromMark(event.mark),
      rect: event.rect,
      measure: event.measure,
      frame: event.frame,
    });
  };

  const refreshAnchor = () => {
    const current = sessionRef.current;
    if (!current) return;
    const rect = current.measure?.();
    if (rect) setSession({ ...current, rect });
  };

  const setColor = (color: string) => {
    const current = sessionRef.current;
    // A create request is already in flight for this session: ignore extra
    // picks so a single session cannot create two marks.
    if (!current || pendingRef.current === current.token) return;

    const draft = { ...current.draft, color };
    setSession({ ...current, draft });
    if (draft.id !== undefined) return;

    const token = current.token;
    beginPending(token);
    const { api, onAddHighlight, onMarksChanged } = optionsRef.current;
    void api
      .addMark(toNewMark(draft))
      .then((created) => {
        const persisted: ReadingMark = { ...toNewMark(draft), id: created.id };
        const latest = sessionRef.current;
        if (latest?.token !== token) {
          // A4: the session was cancelled (or replaced by a new selection)
          // while the create was in flight — the row it produced must not
          // survive, and it must not leak its id into the new session.
          void api
            .removeMark(created.id)
            .then(() => {
              onMarksChanged?.();
            })
            .catch((error: unknown) => {
              toast.error(readerErrorMessage(error));
            });
          return;
        }
        onAddHighlight(persisted);
        setSession({
          ...latest,
          draft: {
            ...latest.draft,
            id: created.id,
            created: true,
            origin: persisted,
          },
        });
        onMarksChanged?.();
      })
      .catch((error: unknown) => {
        toast.error(readerErrorMessage(error));
      })
      .finally(() => {
        endPending(token);
      });
  };

  const setContent = (content: string) => {
    const current = sessionRef.current;
    if (!current) return;
    setSession({ ...current, draft: { ...current.draft, content } });
  };

  const confirm = () => {
    const current = sessionRef.current;
    if (!current || pendingRef.current === current.token) return;
    const intent = planEditorIntent("confirm", current.draft);
    // D15: 确定 is a no-op until the colour created the mark.
    if (intent.type !== "update") return;
    // A3: the whole edited row goes to the adapter, not just the colour.
    const persisted = toPersistedMark(current.draft);
    if (!persisted) return;

    const token = current.token;
    beginPending(token);
    const { api, onUpdateHighlight, onMarksChanged } = optionsRef.current;
    void api
      .updateMark(intent.patch)
      .then(() => {
        onUpdateHighlight(persisted);
        close();
        onMarksChanged?.();
      })
      .catch((error: unknown) => {
        toast.error(readerErrorMessage(error));
      })
      .finally(() => {
        endPending(token);
      });
  };

  const remove = () => {
    const current = sessionRef.current;
    if (!current || pendingRef.current === current.token) return;
    const intent = planEditorIntent("delete", current.draft);
    if (intent.type !== "remove") return;

    const token = current.token;
    beginPending(token);
    const { api, onRemoveHighlight, onMarksChanged } = optionsRef.current;
    const { anchor } = current.draft;
    void api
      .removeMark(intent.id)
      .then(() => {
        onRemoveHighlight(anchor);
        close();
        onMarksChanged?.();
      })
      .catch((error: unknown) => {
        toast.error(readerErrorMessage(error));
      })
      .finally(() => {
        endPending(token);
      });
  };

  const cancel = () => {
    const current = sessionRef.current;
    if (!current) return;
    const { draft } = current;
    setSession(undefined);
    // A4: a create that is still in flight is rolled back by its own response
    // handler (it sees a session token that no longer matches), so cancelling
    // only has to drop the session here.

    const intent = planEditorIntent("cancel", draft);
    const { api, onRemoveHighlight, onUpdateHighlight, onMarksChanged } =
      optionsRef.current;
    if (intent.type === "rollback") {
      void api
        .removeMark(intent.id)
        .then(() => {
          onRemoveHighlight(draft.anchor);
          onMarksChanged?.();
        })
        .catch((error: unknown) => {
          toast.error(readerErrorMessage(error));
        });
      return;
    }
    // Unsaved colour change on an existing mark: put the overlay back to the
    // persisted row (A3: the index gets the whole row back).
    if (draft.origin && draft.origin.color !== draft.color) {
      onUpdateHighlight(draft.origin);
    }
  };

  return {
    session,
    // The bubble only shows a spinner for the session that owns the request.
    pending: session !== undefined && pendingToken === session.token,
    handleSelected,
    handleMarkClicked,
    refreshAnchor,
    close,
    setColor,
    setContent,
    confirm,
    remove,
    cancel,
  };
}
