import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  MenuIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useViewportSize } from "@/hooks/use-viewport-size";
import { markFirstPage } from "@/lib/reader-mark";
import {
  setBookReaderPrefs,
  useBookReaderPrefs,
  setReaderPrefs,
  useReaderPrefs,
} from "@/lib/prefs";
import { cn } from "cn";

import { readerErrorMessage, type ReaderApi, type ReaderData } from "./api";
import { BookmarkTitleDialog } from "./BookmarkTitleDialog";
import { DrawerPanel, PANEL_DURATION } from "./DrawerPanel";
import { HighlightEditor } from "./editor/HighlightEditor";
import { SelectionPopover } from "./editor/SelectionPopover";
import {
  MARK_TYPE,
  type NewReadingMark,
  type ReadingMark,
  type TocNode,
} from "./epub/types";
import { useHighlightEditor } from "./hooks/use-highlight-editor";
import { useReaderShortcuts } from "./hooks/use-reader-shortcuts";
import { useScreenWakeLock } from "./hooks/use-screen-wake-lock";
import { PanelPdfDisplay } from "./PanelPdfDisplay";
import {
  readPanelState,
  writePanelState,
  type PanelState,
} from "./panel-state";
import { PdfZoomControls } from "./PdfZoomControls";
import { PdfEngine, type PdfEngineError } from "./pdf/engine";
import type { PdfMode, PdfZoom } from "./pdf/engine";
import "./pdf/pdf.css";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { resolveCurrentHref } from "./toc";
import type { PdfTocItem } from "@/lib/pdf-package";

export type PdfReaderProps = {
  data: ReaderData;
  api: ReaderApi;
  onMarksChanged?: () => void;
  onExit?: () => void;
};

type BookmarkDialogState = {
  title: string;
  target:
    | { kind: "create"; mark: NewReadingMark }
    | { kind: "rename"; id: number };
};

const PROGRESS_INTERVAL_MS = 1000;

function initialPage(current: string): number {
  const match = /^page:(\d+)$/.exec(current);
  return match ? Number(match[1]) : 0;
}

function toTocNodes(items: readonly PdfTocItem[]): TocNode[] {
  return items.map((item) => ({
    label: item.label,
    src: `page:${item.page}`,
    ...(item.children?.length ? { children: toTocNodes(item.children) } : {}),
  }));
}

/** A page-number fallback for PDFs whose outline is missing or unreadable. */
function pageToc(pageCount: number): TocNode[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    label: `第 ${index + 1} 页`,
    src: `page:${index}`,
  }));
}

export function PdfReader({
  data,
  api,
  onMarksChanged,
  onExit,
}: PdfReaderProps) {
  const { book } = data;
  const viewerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PdfEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(() => initialPage(book.current));
  const [pageCount, setPageCount] = useState(book.pageCount ?? 0);
  const [toc, setToc] = useState<TocNode[]>(data.toc);
  const [currentHref, setCurrentHref] = useState(`page:${page}`);
  const bookPrefs = useBookReaderPrefs(book.id);
  const { panelMode } = useReaderPrefs();
  const [mode, setMode] = useState<PdfMode>(
    bookPrefs.pdfLayout === "page" ? "page" : "scroll",
  );
  const [zoom, setZoom] = useState<PdfZoom>(
    bookPrefs.pdfLayout === "page" ? "fit-page" : "fit-width",
  );
  const [chromeShown, setChromeShown] = useState(true);
  const [pageIndicatorShown, setPageIndicatorShown] = useState(true);
  const [panel, setPanel] = useState<PanelState>(readPanelState);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [bookmarkDialog, setBookmarkDialog] = useState<BookmarkDialogState>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [contentElement, setContentElement] = useState<HTMLElement | null>(
    null,
  );
  const contentRef = useCallback((node: HTMLElement | null) => {
    setContentElement(node);
  }, []);
  const tocTargetRef = useRef<string | undefined>(undefined);
  const reportedRef = useRef(book.current);
  const turnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastScrollTopRef = useRef(0);
  const { width: viewportWidth } = useViewportSize();
  const isNarrow = viewportWidth > 0 && viewportWidth < 640;
  const isNarrowRef = useRef(isNarrow);

  useEffect(() => {
    isNarrowRef.current = isNarrow;
  }, [isNarrow]);

  useEffect(() => {
    setPageIndicatorShown(true);
  }, [mode]);

  const updatePanel = (patch: Partial<PanelState>) => {
    setPanel((current) => ({ ...current, ...patch }));
  };

  const editor = useHighlightEditor({
    bookId: book.id,
    api,
    onMarksChanged,
    onAddHighlight: (mark) => engineRef.current?.addHighlight(mark),
    onRemoveHighlight: (anchor) => engineRef.current?.removeHighlight(anchor),
    onUpdateHighlight: (mark) => engineRef.current?.updateHighlight(mark),
  });
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  useEffect(() => {
    writePanelState(panel);
  }, [panel]);

  useScreenWakeLock();

  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    let cancelled = false;
    const engine = new PdfEngine({
      url: `/api/books/${book.id}/pdf`,
      mode: bookPrefs.pdfLayout,
      zoom: bookPrefs.pdfLayout === "page" ? "fit-page" : "fit-width",
      initialPage: initialPage(book.current),
      marks: data.highlights,
      onError: (reason: PdfEngineError) => {
        if (cancelled) return;
        setError(reason.message);
        setLoading(false);
      },
      onOutline: (outline) => {
        if (cancelled) return;
        setToc((current) =>
          current.length > 0 ? current : toTocNodes(outline),
        );
      },
      onZoomChange: (next) => setZoom(next),
    });
    engineRef.current = engine;
    container.replaceChildren(engine.element);

    const unsubscribes = [
      engine.on("selected", (event) => editorRef.current.handleSelected(event)),
      engine.on("markClicked", (event) =>
        editorRef.current.handleMarkClicked(event),
      ),
      engine.on("pointerDown", () => editorRef.current.cancel()),
      engine.on("scrolled", (event) => {
        editorRef.current.refreshAnchor();
        const top = event.scrollTop;
        if (top === undefined) return;
        const previous = lastScrollTopRef.current;
        lastScrollTopRef.current = top;
        if (!isNarrowRef.current) return;
        if (top <= 0) setPageIndicatorShown(true);
        else if (top - previous > 4) setPageIndicatorShown(false);
        else if (previous - top > 4) setPageIndicatorShown(true);
      }),
      engine.on("relocated", (event) => {
        setCurrentHref(
          resolveCurrentHref(
            { startHref: event.href, endHref: event.location.end.href },
            tocTargetRef.current,
          ),
        );
        const anchor = event.anchor;
        if (anchor.type === "pdf" && anchor.pages[0]) {
          setPage(anchor.pages[0].page);
        }
        editorRef.current.refreshAnchor();
      }),
    ];

    void engine
      .open()
      .then(() => {
        if (cancelled) return;
        setPageCount(engine.pageCount);
        setPage(engine.page);
        setLoading(false);
        engine.remember(data.highlights);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "PDF 打开失败");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      engineRef.current = null;
      engine.destroy();
      container.replaceChildren();
    };
    // The engine owns its own lifetime; changing mode/zoom goes through the
    // imperative methods below, not by recreating the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    engineRef.current?.remember(data.highlights);
  }, [data.highlights]);

  const reportProgress = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const location = engine.currentLocation();
    const anchor = location.start.anchor;
    if (!anchor || anchor.type !== "pdf" || !anchor.pages[0]) return;
    const current = `page:${anchor.pages[0].page}`;
    if (reportedRef.current === current) return;
    reportedRef.current = current;
    try {
      await api.updateBookCurrent(
        book.id,
        current,
        Math.round((location.start.percentage ?? 0) * 100),
      );
    } catch {
      // A failed progress write must not interrupt reading.
    }
  }, [api, book.id]);

  useEffect(() => {
    const timer = setInterval(() => {
      void reportProgress();
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reportProgress]);

  const handleExit = () => {
    void reportProgress();
    onExit?.();
  };

  const turnPage = (direction: "next" | "prev") => {
    tocTargetRef.current = undefined;
    editor.close();
    turnQueueRef.current = turnQueueRef.current
      .then(() => engineRef.current?.[direction]())
      .then(() => undefined)
      .catch(() => undefined);
  };

  const changeMode = (next: PdfMode) => {
    const nextZoom: PdfZoom = next === "page" ? "fit-page" : "fit-width";
    setMode(next);
    setZoom(nextZoom);
    setBookReaderPrefs(book.id, { pdfLayout: next });
    engineRef.current?.setMode(next);
    engineRef.current?.setZoom(nextZoom);
  };

  const changeZoom = (next: PdfZoom) => {
    setZoom(next);
    engineRef.current?.setZoom(next);
  };

  const zoomBy = (factor: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    changeZoom(Math.min(8, Math.max(0.25, engine.scaleValue * factor)));
  };

  const goTo = (target: string, tocTarget?: string) => {
    editor.close();
    tocTargetRef.current = tocTarget;
    void engineRef.current?.display(target);
  };

  const maybeClosePanel = () => {
    if (panelMode === "float") updatePanel({ open: false });
  };

  const cycleLists = () => {
    if (!panel.open) {
      updatePanel({ open: true, tab: "toc" });
      return;
    }
    if (panel.tab === "toc") {
      updatePanel({ tab: "notes" });
      return;
    }
    if (panel.tab === "notes") {
      updatePanel({ open: false });
      return;
    }
    updatePanel({ open: true, tab: "toc" });
  };

  const toggleDisplay = () => {
    updatePanel(
      panel.open && panel.tab === "type"
        ? { open: false }
        : { open: true, tab: "type" },
    );
  };

  const handleTocSelect = (src: string) => {
    setMobilePanelOpen(false);
    maybeClosePanel();
    goTo(src, src);
  };

  const openBookmarkDialog = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const location = engine.currentLocation();
    const anchor = location.start.anchor;
    const index =
      anchor?.type === "pdf" && anchor.pages[0]
        ? anchor.pages[0].page
        : engine.page;
    const title = `第 ${index + 1} 页`;
    setBookmarkDialog({
      title,
      target: {
        kind: "create",
        mark: {
          bookId: book.id,
          type: MARK_TYPE.bookmark,
          anchor: {
            type: "pdf",
            v: 1,
            pages: [{ page: index, quads: [] }],
          },
          selectedString: "",
          title,
          color: "",
          content: "",
        },
      },
    });
  };

  const renameBookmark = (mark: ReadingMark) => {
    setBookmarkDialog({
      title: mark.title,
      target: { kind: "rename", id: mark.id },
    });
  };

  const confirmBookmarkTitle = async (title: string) => {
    const dialog = bookmarkDialog;
    if (!dialog) return;
    setBookmarkDialog(undefined);
    try {
      if (dialog.target.kind === "rename") {
        await api.updateMark({ id: dialog.target.id, title });
      } else {
        await api.addMark({ ...dialog.target.mark, title });
      }
      onMarksChanged?.();
      toast.success(
        dialog.target.kind === "create" ? "书签已添加" : "标题已修改",
      );
    } catch (reason) {
      toast.error(readerErrorMessage(reason));
    }
  };

  const removeMark = async (mark: ReadingMark) => {
    try {
      await api.removeMark(mark.id);
      if (mark.type === MARK_TYPE.highlight) {
        engineRef.current?.removeHighlight(mark.anchor);
      }
      await onMarksChanged?.();
    } catch (reason) {
      toast.error(readerErrorMessage(reason));
    }
  };

  useReaderShortcuts({
    enabled:
      bookmarkDialog === undefined &&
      !shortcutsOpen &&
      editor.session === undefined,
    turnPage,
    cycleLists,
    toggleTypography: toggleDisplay,
    toggleChrome: () => setChromeShown((shown) => !shown),
    addBookmark: openBookmarkDialog,
    showHelp: () => setShortcutsOpen(true),
  });

  const tocNodes = useMemo(
    () => (toc.length > 0 ? toc : pageToc(pageCount)),
    [toc, pageCount],
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header
        inert={!chromeShown}
        className={cn(
          "flex shrink-0 items-center gap-1 overflow-hidden px-2",
          "transition-[max-height,opacity,padding] duration-[200ms] ease-[var(--ease-soft)]",
          chromeShown
            ? "max-h-bar border-b py-1 opacity-100 max-sm:py-0"
            : "max-h-0 border-b-0 py-0 opacity-0",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回书架"
          className="max-sm:size-11"
          onClick={handleExit}
        >
          <ArrowLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-base font-medium max-sm:text-lg">
          {book.title}
        </h1>
        <div className="hidden sm:flex">
          <PdfZoomControls
            zoom={zoom}
            percent={typeof zoom === "number" ? zoom * 100 : 100}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onZoomIn={() => zoomBy(1.2)}
            onFit={() => changeZoom("fit-page")}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="添加书签"
          className="max-sm:size-11"
          onClick={openBookmarkDialog}
        >
          <BookmarkIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="打开目录"
          className="max-sm:size-11"
          aria-pressed={isNarrow ? mobilePanelOpen : panel.open}
          onClick={() => {
            if (isNarrow) {
              setMobilePanelOpen((open) => !open);
              return;
            }
            updatePanel({ open: !panel.open });
          }}
        >
          <MenuIcon />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-row-reverse">
        <DrawerPanel
          open={panel.open}
          tab={panel.tab}
          onTabChange={(tab) => updatePanel({ tab })}
          onClose={() => updatePanel({ open: false })}
          mode={panelMode}
          onModeChange={(next) => setReaderPrefs({ panelMode: next })}
          mobileOpen={mobilePanelOpen}
          onMobileOpenChange={setMobilePanelOpen}
          bookId={book.id}
          toc={tocNodes}
          highlights={data.highlights}
          bookmarks={data.bookmarks}
          currentHref={currentHref}
          displayPanel={
            <PanelPdfDisplay
              mode={mode}
              onModeChange={changeMode}
              zoom={zoom}
              onFitWidth={() => changeZoom("fit-width")}
              onFitPage={() => changeZoom("fit-page")}
            />
          }
          displayTabLabel="显示"
          onSelectToc={handleTocSelect}
          onSelectHighlight={(mark) => {
            setMobilePanelOpen(false);
            maybeClosePanel();
            const target = markFirstPage(mark);
            if (target !== undefined) goTo(`page:${target}`);
          }}
          onSelectBookmark={(mark) => {
            setMobilePanelOpen(false);
            maybeClosePanel();
            const target = markFirstPage(mark);
            if (target !== undefined) goTo(`page:${target}`);
          }}
          onRemoveHighlight={(mark) => void removeMark(mark)}
          onRemoveBookmark={(mark) => void removeMark(mark)}
          onRenameBookmark={renameBookmark}
        />

        <main
          ref={contentRef}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden p-2",
            panelMode === "docked"
              ? cn("transition-[margin]", PANEL_DURATION)
              : null,
            panelMode === "docked" && panel.open ? "sm:mr-panel" : null,
          )}
        >
          <div ref={viewerRef} className="h-full w-full" />

          {loading ? (
            <div className="text-muted pointer-events-none absolute inset-0 grid place-items-center text-sm">
              正在打开 PDF…
            </div>
          ) : null}

          {error ? (
            <div className="bg-background/90 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm">{error}</p>
              <Button variant="secondary" size="sm" onClick={handleExit}>
                返回书架
              </Button>
            </div>
          ) : null}

          {editor.session ? (
            <SelectionPopover
              open
              onOpenChange={(open) => {
                if (!open) editor.cancel();
              }}
              rect={editor.session.rect}
              measure={editor.session.measure}
              frame={editor.session.frame}
              container={contentElement}
              side="bottom"
            >
              <HighlightEditor
                draft={editor.session.draft}
                pending={editor.pending}
                onColorChange={editor.setColor}
                onContentChange={editor.setContent}
                onConfirm={editor.confirm}
                onDelete={editor.remove}
                onCancel={editor.cancel}
              />
            </SelectionPopover>
          ) : null}

          {chromeShown && pageCount > 0 ? (
            mode === "page" ? (
              <div className="border-line bg-background/95 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border px-1 shadow-sm">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一页"
                  onClick={() => turnPage("prev")}
                >
                  <ChevronLeft />
                </Button>
                <span className="min-w-20 text-center text-xs tabular-nums">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一页"
                  onClick={() => turnPage("next")}
                >
                  <ChevronRight />
                </Button>
              </div>
            ) : (
              <div
                data-slot="pdf-page-indicator"
                className={cn(
                  "border-line bg-background/90 pointer-events-none absolute right-9 bottom-3 rounded-full border px-2 py-1 text-xs tabular-nums shadow-sm transition-[opacity,transform] duration-200 ease-[var(--ease-soft)]",
                  isNarrow &&
                    mode === "scroll" &&
                    !pageIndicatorShown &&
                    "translate-y-2 opacity-0",
                )}
                aria-hidden={
                  isNarrow && mode === "scroll" && !pageIndicatorShown
                }
              >
                {page + 1} / {pageCount}
              </div>
            )
          ) : null}
        </main>
      </div>

      <BookmarkTitleDialog
        open={bookmarkDialog !== undefined}
        value={bookmarkDialog?.title ?? ""}
        onValueChange={(title) =>
          setBookmarkDialog((current) =>
            current ? { ...current, title } : current,
          )
        }
        onCancel={() => setBookmarkDialog(undefined)}
        onConfirm={(title) => {
          void confirmBookmarkTitle(title);
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
