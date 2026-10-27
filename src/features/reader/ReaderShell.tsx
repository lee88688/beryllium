import { useCallback, useEffect, useRef, useState } from "react";
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
import { setReaderPrefs, useReaderPrefs } from "@/lib/prefs";
import { cn } from "cn";

import { readerErrorMessage, type ReaderApi, type ReaderBook } from "./api";
import { BookmarkTitleDialog } from "./BookmarkTitleDialog";
import { DrawerPanel, PANEL_DURATION } from "./DrawerPanel";
import { HighlightEditor } from "./editor/HighlightEditor";
import { SelectionPopover } from "./editor/SelectionPopover";
import { describeCfi } from "./epub/cfi";
import {
  MARK_TYPE,
  type NewReadingMark,
  type ReadingMark,
  type TocNode,
} from "./epub/types";
import { ImagePreview } from "./ImagePreview";
import {
  useReaderAdapter,
  type ReaderAdapterController,
} from "./hooks/use-reader-adapter";
import { useHighlightEditor } from "./hooks/use-highlight-editor";
import { useReaderShortcuts } from "./hooks/use-reader-shortcuts";
import { useScreenWakeLock } from "./hooks/use-screen-wake-lock";
import {
  readPanelState,
  writePanelState,
  type PanelState,
} from "./panel-state";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { resolveCurrentHref } from "./toc";

export type ReaderShellProps = {
  book: ReaderBook;
  toc: readonly TocNode[];
  highlights: readonly ReadingMark[];
  bookmarks: readonly ReadingMark[];
  api: ReaderApi;
  /** Called after every successful mark mutation so the owner can refetch. */
  onMarksChanged?: () => void;
  /** Called when the user leaves the reader. */
  onExit?: () => void;
};

type BookmarkDialogState = {
  title: string;
  /** Either a new bookmark or the id of one whose title is being edited. */
  target:
    | { kind: "create"; mark: NewReadingMark }
    | { kind: "rename"; id: number };
};

/** Progress report interval (PRD §5.4: at most one write per second). */
const PROGRESS_INTERVAL_MS = 1000;

/**
 * The reader screen: top bar, side panel/drawer, page arrows, progress
 * reporting and the wake lock. All data and mutations arrive through props and
 * `ReaderApi`, so the route (W4) owns fetching and this stays testable.
 */
export function ReaderShell({
  book,
  toc,
  highlights,
  bookmarks,
  api,
  onMarksChanged,
  onExit,
}: ReaderShellProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  // The popover portals into the reader area, so the element is mirrored into
  // state (a render-phase ref read is not allowed). A stable callback keeps
  // React from detaching the ref on every render.
  const [contentElement, setContentElement] = useState<HTMLElement | null>(
    null,
  );
  const contentRef = useCallback((node: HTMLElement | null) => {
    setContentElement(node);
  }, []);
  const adapterRef = useRef<ReaderAdapterController | null>(null);
  const [currentHref, setCurrentHref] = useState("");
  // The TOC entry the reader picked (D4). Kept out of state on purpose: it
  // only feeds the next relocation, it never renders on its own.
  const tocTargetRef = useRef<string | undefined>(undefined);
  /** 桌面侧栏：展开/收起与当前视图都记忆在本地（`panel-state.ts`）。 */
  const [panel, setPanel] = useState<PanelState>(readPanelState);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>();
  const [bookmarkDialog, setBookmarkDialog] = useState<
    BookmarkDialogState | undefined
  >();
  /** `m`：顶栏（沉浸阅读时收起来，正文就多出一行）。 */
  const [chromeShown, setChromeShown] = useState(true);
  /** `?`：快捷键说明。 */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { panelMode } = useReaderPrefs();
  const { width: viewportWidth } = useViewportSize();
  /** 与 Tailwind 的 `sm` 对齐：小屏没有常驻栏，打开的是整屏抽屉。 */
  const isNarrow = viewportWidth > 0 && viewportWidth < 640;
  /** 侧栏状态的唯一写入口；落盘交给下面那个 effect。 */
  const updatePanel = (patch: Partial<PanelState>) => {
    setPanel((current) => ({ ...current, ...patch }));
  };

  const editor = useHighlightEditor({
    bookId: book.id,
    api,
    onMarksChanged,
    onAddHighlight: (mark) => adapterRef.current?.addHighlight(mark),
    onRemoveHighlight: (epubcfi) =>
      adapterRef.current?.removeHighlight(epubcfi),
    onUpdateHighlight: (mark) => adapterRef.current?.updateHighlight(mark),
  });

  const adapter = useReaderAdapter({
    containerRef: viewerRef,
    bookId: book.id,
    filesBaseUrl: book.filesBaseUrl,
    spineSizes: book.spineSizes,
    startCfi: book.current,
    initialHighlights: highlights,
    handlers: {
      onSelected: editor.handleSelected,
      onMarkClicked: editor.handleMarkClicked,
      // 点正文（章节 iframe）里任意位置：原生选区和浮窗一起收起。父文档的
      // 外部点击处理跨不过 iframe 边界，所以由适配器把这次按下转发上来。
      onPointerDown: () => editor.cancel(),
      onImageClicked: (event) => setPreviewImage(event.src),
      // 连续滚动：浮窗要跟着正文走，否则会停在选区的旧屏幕位置。
      onScrolled: editor.refreshAnchor,
      onRelocated: (event) => {
        setCurrentHref(
          resolveCurrentHref(
            { startHref: event.href, endHref: event.location.end.href },
            tocTargetRef.current,
          ),
        );
        editor.refreshAnchor();
      },
    },
  });

  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  useScreenWakeLock();

  // 侧栏状态落盘（放在 effect 里，不在 updater 里：StrictMode 会双调用 updater）。
  useEffect(() => {
    writePanelState(panel);
  }, [panel]);

  // Progress reporting: poll the current location and persist the CFI when it
  // changed (the write itself is a best-effort request, throttled to 1/s).
  const reportedCfiRef = useRef(book.current);
  const reportProgress = useCallback(async () => {
    const location = await adapter.currentLocation();
    const cfi = location?.start.cfi;
    if (!cfi || reportedCfiRef.current === cfi) return;
    reportedCfiRef.current = cfi;
    // 书级百分比来自 foliate 的 （0–1）；书架直接用这个数。
    const percent = Math.round((location?.start.percentage ?? 0) * 100);
    try {
      await api.updateBookCurrent(book.id, cfi, percent);
    } catch {
      // Silent: a failed progress write must not interrupt reading.
    }
  }, [adapter, api, book.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      void reportProgress();
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [reportProgress]);

  const handleExit = () => {
    // Leaving reports the position immediately instead of waiting for the tick.
    void reportProgress();
    onExit?.();
  };

  /**
   * Jumps the rendition; `tocTarget` is the TOC entry the reader picked. Every
   * other jump (marks, page turns) drops the pick so the highlight follows the
   * reported location again (D4).
   */
  const goTo = (target: string | number, tocTarget?: string) => {
    editor.close();
    tocTargetRef.current = tocTarget;
    adapter.display(target);
  };

  /**
   * 翻页排队：分页器在翻页过程中有一把 `#locked` 锁（`paginator.js#turnPage`），
   * 翻页没结束就来的新请求会被**静默丢掉** —— 连按两下方向键 / 连点两下翻页箭头
   * 时第二下以前就没了。这里按顺序串起来，一下也不会丢。
   */
  const turnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const turnPage = (direction: "next" | "prev") => {
    tocTargetRef.current = undefined;
    editor.close();
    turnQueueRef.current = turnQueueRef.current
      .then(() => adapter[direction]())
      // 一次翻页失败不该卡住后面的队列（错误已经由 adapter 记过日志）。
      .catch(() => undefined);
  };

  /** 浮层形态下跳转后收起面板（常驻形态留着，方便连续跳）。 */
  const maybeClosePanel = () => {
    if (panelMode === "float") updatePanel({ open: false });
  };

  /** `t`：目录 → 备注 → 收起。两个「阅读辅助」列表共用一个键，轮着走。 */
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
    // 开在书签/排版上时，`t` 先把面板带回目录。
    updatePanel({ open: true, tab: "toc" });
  };

  /** `s`：排版面板；已经开在排版上就收起。 */
  const toggleTypography = () => {
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

  const openBookmarkDialog = async () => {
    const location = await adapter.currentLocation();
    const cfi = location?.start.cfi;
    if (!cfi) return;
    const { heading, selectedString } = describeCfi(cfi, adapter.getRange);
    setBookmarkDialog({
      title: heading,
      target: {
        kind: "create",
        mark: {
          bookId: book.id,
          type: MARK_TYPE.bookmark,
          epubcfi: cfi,
          selectedString,
          title: heading,
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
    } catch (error) {
      toast.error(readerErrorMessage(error));
    }
  };

  const removeMark = async (mark: ReadingMark) => {
    try {
      await api.removeMark(mark.id);
      if (mark.type === MARK_TYPE.highlight) {
        adapter.removeHighlight(mark.epubcfi);
      }
      await onMarksChanged?.();
    } catch (error) {
      toast.error(readerErrorMessage(error));
    }
  };

  useReaderShortcuts({
    // 浮层在用的时候整块键盘让位：书签标题、快捷键说明、图片预览、批注编辑器。
    enabled:
      bookmarkDialog === undefined &&
      !shortcutsOpen &&
      previewImage === undefined &&
      editor.session === undefined,
    turnPage,
    cycleLists,
    toggleTypography,
    toggleChrome: () => setChromeShown((shown) => !shown),
    addBookmark: () => {
      void openBookmarkDialog();
    },
    showHelp: () => setShortcutsOpen(true),
  });

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header
        inert={!chromeShown}
        className={cn(
          "flex shrink-0 items-center gap-1 overflow-hidden px-2",
          "transition-[max-height,opacity,padding] duration-[200ms] ease-[var(--ease-soft)]",
          // `m` 收起来时靠 `max-h-0` 把这一条压掉（不是卸载：正文跟着多一行）。
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="添加书签"
          className="max-sm:size-11"
          onClick={() => {
            void openBookmarkDialog();
          }}
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
          onModeChange={(mode) => setReaderPrefs({ panelMode: mode })}
          mobileOpen={mobilePanelOpen}
          onMobileOpenChange={setMobilePanelOpen}
          bookId={book.id}
          toc={toc}
          highlights={highlights}
          bookmarks={bookmarks}
          currentHref={currentHref}
          onSelectToc={handleTocSelect}
          onSelectHighlight={(mark) => {
            setMobilePanelOpen(false);
            maybeClosePanel();
            goTo(mark.epubcfi);
          }}
          onSelectBookmark={(mark) => {
            setMobilePanelOpen(false);
            maybeClosePanel();
            goTo(mark.epubcfi);
          }}
          onRemoveHighlight={(mark) => {
            void removeMark(mark);
          }}
          onRemoveBookmark={(mark) => {
            void removeMark(mark);
          }}
          onRenameBookmark={renameBookmark}
        />

        <main
          ref={contentRef}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden p-2",
            // 常驻形态下正文给面板让位；面板滑出的同时这里补上/让出宽度，
            // 两者用同一段时长，看起来才是一块移动的面板而不是两次跳变。
            panelMode === "docked"
              ? cn("transition-[margin]", PANEL_DURATION)
              : null,
            panelMode === "docked" && panel.open ? "sm:mr-panel" : null,
          )}
        >
          <div ref={viewerRef} className="h-full w-full" />

          <Button
            variant="ghost"
            size="icon"
            aria-label="上一页"
            className="absolute top-1/2 left-1 hidden -translate-y-1/2 sm:inline-flex"
            onClick={() => turnPage("prev")}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下一页"
            className="absolute top-1/2 right-1 hidden -translate-y-1/2 sm:inline-flex"
            onClick={() => turnPage("next")}
          >
            <ChevronRight />
          </Button>

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
      <ImagePreview
        src={previewImage}
        onClose={() => setPreviewImage(undefined)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
