import React, { useState, useRef, useEffect } from "react";
import ePub, { type Rendition } from "epubjs";
import { EpubCFI } from "epubjs";
import Popover from "@mui/material/Popover";
import { HighlightEditor, getColorsValue } from "y/components/highlightEditor";
import { addMark, removeMark, updateMark } from "../clientApi";
import { getElementHeading } from "./index";
import type * as Prisma from "@prisma/client";
import { MarkType } from "y/utils/constants";

// window.EpubCFI = EpubCFI;

type UseReaderProps = {
  opfUrl: string;
  bookId: number;
  startCfi: string;
  highlightList: Prisma.Mark[];
};

type EditorValue = {
  id: number;
  color: string;
  content: string;
  epubcfi: string;
};

export function useReader({
  opfUrl,
  bookId,
  startCfi,
  highlightList,
}: UseReaderProps) {
  const rendition = useRef<Rendition>();
  const anchorEl = useRef<HTMLElement>();
  const [openPopover, setOpenPopover] = useState(false);
  const [curEditorValue, setCurEditorValue] = useState<EditorValue>({
    id: 0,
    color: "",
    content: "",
    epubcfi: "",
  });
  const curEditorValueRef = useRef<EditorValue>(curEditorValue);
  const preEditorValue = useRef(curEditorValue);

  // point curEditorValueRef to curEditorValue
  curEditorValueRef.current = curEditorValue;

  const updateHighlightElement = (value: EditorValue, temporarily = true) => {
    const { epubcfi } = value;
    const g = document.querySelector<SVGGElement>(
      `g[data-epubcfi="${epubcfi}"]`,
    );

    if (!g) {
      console.warn(`${epubcfi} element is not found!`);
      return;
    }

    Object.keys(g.dataset).forEach((k) => {
      g.dataset[k] = value[k];
    });
    g.setAttribute("fill", getColorsValue(value.color)!);
    if (!temporarily) {
      // change rendition's annotations
    }
  };

  const getHighlightSelectedFunction =
    (cfi: string) => (e: React.MouseEvent<HTMLElement>) => {
      // new add highlight callback
      // void touchstart trigger
      if (e.type.startsWith("touch")) {
        e.stopPropagation();
        return;
      }
      const g = document.querySelector<SVGAElement>(
        `g[data-epubcfi="${cfi}"]`,
      )!;
      const editorValue = { ...curEditorValueRef.current };
      Object.keys(g.dataset).forEach((k) => (editorValue[k] = g.dataset[k]));
      preEditorValue.current = { ...editorValue };
      setCurEditorValue(editorValue);
      anchorEl.current = e.target as HTMLElement;
      setOpenPopover(true);
    };

  useEffect(() => {
    const book = ePub(opfUrl);
    rendition.current = book.renderTo("viewer", {
      manager: "continuous",
      flow: "paginated",
      width: "100%",
      height: "100%",
      snap: true,
      // allowScriptedContent: true,
      // FIXME: need to add
      // script: `${process.env.PUBLIC_URL}/epubjs-ext/rendition-injection.js`,
    });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    rendition.current.display(startCfi || 0);

    let epubcfi = "";
    let selectedString = "";
    // when registered selected event, all references in selected callback function are frozen
    // curEditorValue will be changed, and it would not change in selected callback.
    // so it's important to change `curEditorValue` to `curEditorValueRef`.
    rendition.current.on(
      "selected",
      function (cfiRange: string, contents: Window) {
        if (!epubcfi) {
          const fn = async (e: MouseEvent) => {
            contents.document.removeEventListener("mouseup", fn);
            const color = "red";
            const content = "";
            // const cfi = epubcfi; // epubcfi will be set to null, save a copy.
            const title = getElementHeading(e.target);
            console.log(title);
            const curValue = {
              color,
              content,
              epubcfi,
              selectedString,
              type: MarkType.Highlight,
              title,
            };
            rendition.current?.annotations.highlight(
              epubcfi,
              { ...curValue },
              getHighlightSelectedFunction(epubcfi),
              "",
              { fill: getColorsValue(color) },
            );
            setCurEditorValue({ ...curValue });
            const { data: markId } = await addMark(bookId, { ...curValue });
            // dispatch(getHighlightList(bookId)); // update highlight list
            setCurEditorValue({ ...curValue, id: markId });
            epubcfi = "";
            selectedString = "";
          };
          contents.document.addEventListener("mouseup", fn);
        }
        epubcfi = cfiRange;
        selectedString = contents.window.getSelection()?.toString() ?? "";
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opfUrl]);

  useEffect(() => {
    if (openPopover && curEditorValue.epubcfi) {
      // find the highlight element and compare with the color before. if not the same, change element's color.
      updateHighlightElement(curEditorValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curEditorValue.color]);

  useEffect(() => {
    if (!rendition.current || !Array.isArray(highlightList)) return;
    const { annotations } = rendition.current;
    if (Object.keys(annotations._annotations).length !== 0) return;
    highlightList.forEach((item) => {
      const { epubcfi, color } = item;
      annotations.highlight(
        epubcfi,
        { ...item },
        getHighlightSelectedFunction(epubcfi),
        "",
        { fill: getColorsValue(color) },
      );
    });
  }, [highlightList]);

  const handleEditorChange = (value) => setCurEditorValue(value);

  const handleEditorCancel = () => {
    // canceling will remove changes
    updateHighlightElement(preEditorValue.current);
    setOpenPopover(false);
  };

  const handleConfirm = async (value: EditorValue) => {
    const { id } = { ...curEditorValue, ...value };
    await updateMark(id, bookId, value);
    // dispatch(getHighlightList(bookId)); // update highlight list
    updateHighlightElement(value, false);
    setOpenPopover(false);
  };

  const handleRemove = async (value: EditorValue) => {
    const { id, epubcfi, type } = { ...curEditorValue, ...value };
    await removeMark(id, bookId);
    // dispatch(getHighlightList(bookId)); // update highlight list
    rendition.current?.annotations.remove(new EpubCFI(epubcfi), type);
    setOpenPopover(false);
  };

  const bookItem = (
    <React.Fragment>
      <div id="viewer" style={{ height: "100%", width: "100%" }}></div>
      <Popover
        open={openPopover}
        anchorEl={anchorEl.current}
        onClose={handleEditorCancel}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <HighlightEditor
          {...curEditorValue}
          onChange={handleEditorChange}
          onConfirm={handleConfirm}
          onCancel={handleEditorCancel}
          onDelete={handleRemove}
        />
      </Popover>
    </React.Fragment>
  );

  return {
    bookItem,
    rendition,
    nextPage: () => {
      return rendition.current?.next();
    },
    prevPage: () => {
      return rendition.current?.prev();
    },
  };
}
