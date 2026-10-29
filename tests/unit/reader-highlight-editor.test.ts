import type { ReaderAnchor } from "@/lib/reader-anchor";
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReaderApi } from "@/features/reader/api";
import {
  useHighlightEditor,
  type UseHighlightEditorOptions,
} from "@/features/reader/hooks/use-highlight-editor";
import type { ReadingMark, SelectedEvent } from "@/features/reader/epub/types";

/** A promise whose settlement the test controls (A4 race construction). */
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CFI = "epubcfi(/6/2[chap01]!/4/2,/1:0,/1:5)";
const OTHER_CFI = "epubcfi(/6/4[chap02]!/4/2,/1:0,/1:5)";

function selection(cfi = CFI): SelectedEvent {
  return {
    anchor: { type: "cfi", cfi },
    rect: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      top: 0,
      right: 1,
      bottom: 1,
      left: 0,
    },
    text: "hello",
    heading: "第一章",
    measure: () => undefined,
    frame: undefined,
  };
}

/** The `addMark` calls the test can settle by hand. */
type Created = Deferred<{ id: number }>;

function createApi() {
  const creations: Created[] = [];
  const removed: number[] = [];
  const updated: unknown[] = [];
  const api: ReaderApi = {
    addMark: () => {
      const next = deferred<{ id: number }>();
      creations.push(next);
      return next.promise;
    },
    updateMark: (mark) => {
      updated.push(mark);
      return Promise.resolve();
    },
    removeMark: (id) => {
      removed.push(id);
      return Promise.resolve();
    },
    updateBookCurrent: () => Promise.resolve(),
  };
  return { api, creations, removed, updated };
}

function renderEditor(api: ReaderApi) {
  const added: ReadingMark[] = [];
  const removedHighlights: ReaderAnchor[] = [];
  const updatedHighlights: ReadingMark[] = [];
  const options: UseHighlightEditorOptions = {
    bookId: 3,
    api,
    onAddHighlight: (mark) => added.push(mark),
    onRemoveHighlight: (anchor) => removedHighlights.push(anchor),
    onUpdateHighlight: (mark) => updatedHighlights.push(mark),
  };
  const rendered = renderHook(() => useHighlightEditor(options));
  return { ...rendered, added, removedHighlights, updatedHighlights };
}

/** Flushes the microtask queue so a resolved promise's handlers have run. */
const flush = () => act(async () => {});

afterEach(cleanup);

describe("useHighlightEditor in-flight requests (A4)", () => {
  it("rolls back a mark whose session was cancelled while the create was in flight", async () => {
    const { api, creations, removed } = createApi();
    const editor = renderEditor(api);

    act(() => editor.result.current.handleSelected(selection()));
    act(() => editor.result.current.setColor("red"));
    expect(creations).toHaveLength(1);

    // 取消 while `addMark` is still unanswered.
    act(() => editor.result.current.cancel());
    expect(editor.result.current.session).toBeUndefined();

    await act(async () => {
      creations[0]?.resolve({ id: 42 });
    });
    await flush();

    // The row the request produced must not survive the cancelled session.
    expect(removed).toEqual([42]);
    expect(editor.added).toEqual([]);
    expect(editor.removedHighlights).toEqual([]);
  });

  it("does not leak an in-flight id into the next session", async () => {
    const { api, creations, removed } = createApi();
    const editor = renderEditor(api);

    act(() => editor.result.current.handleSelected(selection()));
    act(() => editor.result.current.setColor("red"));

    // The reader cancels and immediately starts a new session (new selection).
    act(() => editor.result.current.cancel());
    act(() => editor.result.current.handleSelected(selection(OTHER_CFI)));
    act(() => editor.result.current.setColor("blue"));
    expect(creations).toHaveLength(2);

    // The first (stale) response arrives last: it must be rolled back and must
    // not give the new session the old row's id.
    await act(async () => {
      creations[0]?.resolve({ id: 1 });
    });
    await flush();

    expect(removed).toEqual([1]);
    expect(editor.result.current.session?.draft.id).toBeUndefined();
    expect(editor.result.current.session?.draft.color).toBe("blue");

    await act(async () => {
      creations[1]?.resolve({ id: 2 });
    });
    await flush();

    expect(editor.result.current.session?.draft.id).toBe(2);
    expect(editor.added.map((mark) => mark.id)).toEqual([2]);
  });

  it("applies the created row to the session that asked for it", async () => {
    const { api, creations } = createApi();
    const editor = renderEditor(api);

    act(() => editor.result.current.handleSelected(selection()));
    act(() => editor.result.current.setColor("red"));
    act(() => editor.result.current.setContent("批注"));

    await act(async () => {
      creations[0]?.resolve({ id: 7 });
    });
    await flush();

    expect(editor.added).toEqual([
      expect.objectContaining({
        id: 7,
        color: "red",
        anchor: { type: "cfi", cfi: CFI },
      }),
    ]);
    expect(editor.result.current.session?.draft).toMatchObject({
      id: 7,
      created: true,
      // The annotation typed while the create was in flight is kept.
      content: "批注",
    });
  });

  it("keeps 确定 from writing the row it was opened on (A3)", async () => {
    const { api, updated } = createApi();
    const editor = renderEditor(api);
    const mark: ReadingMark = {
      id: 9,
      bookId: 3,
      type: "highlight",
      color: "teal",
      content: "旧批注",
      anchor: { type: "cfi", cfi: CFI },
      selectedString: "hello",
      title: "第一章",
    };

    act(() =>
      editor.result.current.handleMarkClicked({
        anchor: { type: "cfi", cfi: CFI },
        mark,
        rect: undefined,
        measure: () => undefined,
        frame: undefined,
      }),
    );
    act(() => editor.result.current.setContent("新批注"));
    act(() => editor.result.current.confirm());
    await flush();

    expect(updated).toEqual([
      expect.objectContaining({ id: 9, content: "新批注", color: "teal" }),
    ]);
    // The adapter receives the whole row, so its click index stops being stale.
    expect(editor.updatedHighlights).toEqual([
      expect.objectContaining({ id: 9, content: "新批注", color: "teal" }),
    ]);
  });

  it("reports pending only for the session that owns the request", async () => {
    const { api, creations } = createApi();
    const editor = renderEditor(api);

    act(() => editor.result.current.handleSelected(selection()));
    act(() => editor.result.current.setColor("red"));
    expect(editor.result.current.pending).toBe(true);

    act(() => editor.result.current.cancel());
    act(() => editor.result.current.handleSelected(selection(OTHER_CFI)));

    // The abandoned request must not block the new session's bubble.
    expect(editor.result.current.pending).toBe(false);

    await act(async () => {
      creations[0]?.resolve({ id: 1 });
    });
    await flush();

    act(() => editor.result.current.setColor("blue"));
    expect(creations).toHaveLength(2);
    expect(editor.result.current.pending).toBe(true);
  });

  it("surfaces a failed create without leaving the session pending", async () => {
    const { api, creations } = createApi();
    const editor = renderEditor(api);

    act(() => editor.result.current.handleSelected(selection()));
    act(() => editor.result.current.setColor("red"));

    await act(async () => {
      creations[0]?.reject(new Error("保存失败"));
    });
    await flush();

    expect(editor.result.current.pending).toBe(false);
    expect(editor.result.current.session?.draft.id).toBeUndefined();
  });
});
