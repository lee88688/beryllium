import { describe, expect, it } from "vitest";

import {
  draftFromMark,
  emptyEditorDraft,
  isAnnotationEditable,
  planEditorIntent,
  toNewMark,
  toPersistedMark,
} from "@/features/reader/editor/state";
import { MARK_TYPE, type ReadingMark } from "@/features/reader/epub/types";
import { resolveCurrentHref, toNestedItems } from "@/features/reader/toc";

const mark: ReadingMark = {
  id: 7,
  bookId: 3,
  type: MARK_TYPE.highlight,
  color: "red",
  content: "批注",
  epubcfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)",
  selectedString: "hello",
  title: "第一章",
};

describe("highlight editor draft (D15)", () => {
  it("starts empty, highlighting, and not yet created", () => {
    expect(emptyEditorDraft(3)).toEqual({
      bookId: 3,
      type: MARK_TYPE.highlight,
      epubcfi: "",
      color: "",
      content: "",
      selectedString: "",
      title: "",
      created: false,
    });
  });

  it("seeds a new draft from a selection", () => {
    expect(
      emptyEditorDraft(3, {
        epubcfi: mark.epubcfi,
        selectedString: "hello",
        title: "第一章",
      }),
    ).toMatchObject({
      bookId: 3,
      epubcfi: mark.epubcfi,
      selectedString: "hello",
      title: "第一章",
      created: false,
    });
  });

  it("loads an existing mark, remembering it as the origin", () => {
    const draft = draftFromMark(mark);

    expect(draft).toMatchObject({
      id: 7,
      bookId: 3,
      color: "red",
      content: "批注",
      epubcfi: mark.epubcfi,
      created: false,
    });
    expect(draft.origin).toBe(mark);
    expect(isAnnotationEditable(draft)).toBe(true);
  });

  it("keeps the annotation box unusable until a colour created the mark", () => {
    const draft = emptyEditorDraft(3, { epubcfi: mark.epubcfi });

    expect(isAnnotationEditable(draft)).toBe(false);
    expect(isAnnotationEditable({ ...draft, color: "blue" })).toBe(false);
    expect(isAnnotationEditable({ ...draft, id: 11 })).toBe(true);
  });
});

describe("planEditorIntent", () => {
  it("confirm is a no-op while the mark has no id", () => {
    expect(planEditorIntent("confirm", emptyEditorDraft(3))).toEqual({
      type: "none",
    });
  });

  it("delete is a no-op while the mark has no id", () => {
    expect(planEditorIntent("delete", emptyEditorDraft(3))).toEqual({
      type: "none",
    });
  });

  it("confirm updates the persisted mark", () => {
    const draft = { ...draftFromMark(mark), color: "teal", content: "改" };

    expect(planEditorIntent("confirm", draft)).toEqual({
      type: "update",
      patch: {
        id: 7,
        type: MARK_TYPE.highlight,
        color: "teal",
        content: "改",
        epubcfi: mark.epubcfi,
        selectedString: "hello",
        title: "第一章",
      },
    });
  });

  it("delete removes the persisted mark", () => {
    expect(planEditorIntent("delete", draftFromMark(mark))).toEqual({
      type: "remove",
      id: 7,
    });
  });

  it("cancel rolls back the mark this session created", () => {
    const draft = {
      ...emptyEditorDraft(3, { epubcfi: mark.epubcfi, color: "blue" }),
      id: 21,
      created: true,
    };

    expect(planEditorIntent("cancel", draft)).toEqual({
      type: "rollback",
      id: 21,
    });
  });

  it("cancel leaves a pre-existing mark alone", () => {
    expect(planEditorIntent("cancel", draftFromMark(mark))).toEqual({
      type: "none",
    });
  });

  it("cancel does nothing when the colour never created a mark", () => {
    expect(planEditorIntent("cancel", emptyEditorDraft(3))).toEqual({
      type: "none",
    });
  });
});

describe("toNewMark", () => {
  it("drops the editor-only fields", () => {
    const draft = { ...draftFromMark(mark), id: 7, created: true };

    expect(toNewMark(draft)).toEqual({
      bookId: 3,
      type: MARK_TYPE.highlight,
      color: "red",
      content: "批注",
      epubcfi: mark.epubcfi,
      selectedString: "hello",
      title: "第一章",
    });
  });
});

describe("toPersistedMark (A3)", () => {
  it("returns the whole row a confirmed draft describes", () => {
    const draft = { ...draftFromMark(mark), color: "teal", content: "改" };

    expect(toPersistedMark(draft)).toEqual({
      id: 7,
      bookId: 3,
      type: MARK_TYPE.highlight,
      color: "teal",
      content: "改",
      epubcfi: mark.epubcfi,
      selectedString: "hello",
      title: "第一章",
    });
  });

  it("has no row before a colour created the mark", () => {
    expect(toPersistedMark(emptyEditorDraft(3))).toBeUndefined();
  });
});

describe("toNestedItems", () => {
  it("maps nested TOC nodes, using src as the item id", () => {
    expect(
      toNestedItems([
        {
          label: "第一章",
          src: "Text/chapter1.xhtml",
          children: [{ label: "1.1", src: "Text/chapter1.xhtml#s1" }],
        },
        { label: "第二章", src: "Text/chapter2.xhtml", children: [] },
      ]),
    ).toEqual([
      {
        id: "Text/chapter1.xhtml",
        label: "第一章",
        children: [{ id: "Text/chapter1.xhtml#s1", label: "1.1" }],
      },
      { id: "Text/chapter2.xhtml", label: "第二章" },
    ]);
  });

  it("falls back to an index id when a node has no src", () => {
    expect(toNestedItems([{ label: "封面", src: "" }])).toEqual([
      { id: "toc-0", label: "封面" },
    ]);
  });
});

describe("resolveCurrentHref (D4)", () => {
  // A location whose reported entry is the parent chapter while the reader
  // picked the nested section 2.1 it jumped to (both are on screen, so the
  // library may report either).
  const sharedPage = {
    startHref: "OEBPS/text/chapter2.xhtml",
    endHref: "OEBPS/text/chapter2-1.xhtml",
  };
  it("keeps the picked entry while the page still shows it", () => {
    expect(resolveCurrentHref(sharedPage, "OEBPS/text/chapter2-1.xhtml")).toBe(
      "OEBPS/text/chapter2-1.xhtml",
    );
    expect(resolveCurrentHref(sharedPage, "OEBPS/text/chapter2.xhtml")).toBe(
      "OEBPS/text/chapter2.xhtml",
    );
  });

  it("falls back to the reported start once the pick left the page", () => {
    expect(resolveCurrentHref(sharedPage, "OEBPS/text/chapter1.xhtml")).toBe(
      "OEBPS/text/chapter2.xhtml",
    );
    expect(resolveCurrentHref(sharedPage)).toBe("OEBPS/text/chapter2.xhtml");
  });

  it("uses the reported start when the location has no end", () => {
    expect(
      resolveCurrentHref(
        { startHref: "OEBPS/text/chapter1.xhtml" },
        "OEBPS/text/chapter1.xhtml",
      ),
    ).toBe("OEBPS/text/chapter1.xhtml");
    expect(
      resolveCurrentHref(
        { startHref: "OEBPS/text/chapter1.xhtml" },
        "OEBPS/text/chapter2.xhtml",
      ),
    ).toBe("OEBPS/text/chapter1.xhtml");
  });
});
