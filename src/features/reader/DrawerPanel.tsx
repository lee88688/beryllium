import { PinIcon, XIcon } from "lucide-react";

import { NestedList } from "@/components/nested-list";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";

import { BookmarkList } from "./lists/BookmarkList";
import { HighlightList } from "./lists/HighlightList";
import { PanelTypography } from "./PanelTypography";
import { toNestedItems } from "./toc";
import type { PanelTab } from "./panel-state";
import type { ReadingMark, TocNode } from "./epub/types";

/** 面板标题跟着页签走（避免「标题写着目录、内容是备注」）。 */
const TAB_LABEL: Record<PanelTab, string> = {
  toc: "目录",
  notes: "备注",
  bookmarks: "书签",
  type: "排版",
};

/**
 * 侧栏形态：`docked` 常驻（正文让位，跳转后不收起）/ `float` 浮层（盖在正文上，
 * 带遮罩，跳转或点遮罩即收起）。小屏一律是整屏抽屉，与形态无关。
 */
export type PanelMode = "float" | "docked";

/** 滑出时长与缓动：面板、遮罩与正文让位（`ReaderShell` 的 `main`）必须一致。 */
export const PANEL_DURATION = "duration-[280ms] ease-[var(--ease-soft)]";

export type DrawerPanelProps = {
  /** 展开时看的那一屏；收起时照样传，面板滑出/滑回前后都是它。 */
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 是否展开（收起 = 面板滑出右缘，见下方说明）。 */
  open: boolean;
  onClose: () => void;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  /** 小屏整屏抽屉（`role="dialog"`）的开关。 */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  /** 当前书 id：排版页签读写这本书的覆盖值。 */
  bookId: number;
  toc: readonly TocNode[];
  highlights: readonly ReadingMark[];
  bookmarks: readonly ReadingMark[];
  /** `relocated.start.href`, highlights the current chapter in the TOC. */
  currentHref: string;
  onSelectToc: (src: string) => void;
  onSelectHighlight: (mark: ReadingMark) => void;
  onSelectBookmark: (mark: ReadingMark) => void;
  onRemoveHighlight: (mark: ReadingMark) => void;
  onRemoveBookmark: (mark: ReadingMark) => void;
  onRenameBookmark: (mark: ReadingMark) => void;
};

type PanelViewsProps = Omit<
  DrawerPanelProps,
  | "open"
  | "tab"
  | "onTabChange"
  | "onClose"
  | "mode"
  | "onModeChange"
  | "mobileOpen"
  | "onMobileOpenChange"
> & {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  title: string;
  /** 面板头右侧的两个按钮（桌面有、小屏只留关闭）。 */
  onToggleMode?: () => void;
  onClose: () => void;
  mode?: PanelMode;
};

/** 目录 / 备注 / 书签 / 排版 四个视图，桌面面板与小屏抽屉共用。 */
function PanelViews({
  tab,
  onTabChange,
  title,
  mode,
  onToggleMode,
  onClose,
  bookId,
  toc,
  highlights,
  bookmarks,
  currentHref,
  onSelectToc,
  onSelectHighlight,
  onSelectBookmark,
  onRemoveHighlight,
  onRemoveBookmark,
  onRenameBookmark,
}: PanelViewsProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(String(value) as PanelTab)}
      className="flex h-full min-h-0 w-full flex-col gap-0"
    >
      <div className="h-bar border-line flex shrink-0 items-center gap-1 border-b pr-2 pl-3">
        <span className="min-w-0 flex-1 truncate text-base font-semibold">
          {title}
        </span>
        {onToggleMode && mode ? (
          <IconButton
            size="sm"
            aria-label={mode === "docked" ? "切换为悬浮面板" : "切换为固定侧栏"}
            aria-pressed={mode === "docked"}
            onClick={onToggleMode}
          >
            <PinIcon />
          </IconButton>
        ) : null}
        <IconButton size="sm" aria-label="关闭面板" onClick={onClose}>
          <XIcon />
        </IconButton>
      </div>
      <TabsList variant="line" className="w-full shrink-0 border-b px-2 py-1">
        <TabsTrigger value="toc">目录</TabsTrigger>
        <TabsTrigger value="notes">备注</TabsTrigger>
        <TabsTrigger value="bookmarks">书签</TabsTrigger>
        <TabsTrigger value="type">排版</TabsTrigger>
      </TabsList>
      <TabsContent
        value="toc"
        keepMounted
        className="min-h-0 flex-1 overflow-auto p-1"
      >
        <NestedList
          items={toNestedItems(toc)}
          selectedId={currentHref}
          onSelect={(item) => onSelectToc(item.id)}
        />
      </TabsContent>
      <TabsContent
        value="notes"
        keepMounted
        className="min-h-0 flex-1 overflow-auto p-1"
      >
        <HighlightList
          highlights={highlights}
          onSelect={onSelectHighlight}
          onRemove={onRemoveHighlight}
        />
      </TabsContent>
      <TabsContent
        value="bookmarks"
        keepMounted
        className="min-h-0 flex-1 overflow-auto p-1"
      >
        <BookmarkList
          bookmarks={bookmarks}
          onSelect={onSelectBookmark}
          onRemove={onRemoveBookmark}
          onRename={onRenameBookmark}
        />
      </TabsContent>
      <TabsContent
        value="type"
        keepMounted
        className="min-h-0 flex-1 scrollbar-thin overflow-auto"
      >
        <PanelTypography bookId={bookId} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * 阅读器的侧栏：桌面两种形态（常驻 / 悬浮），小屏固定是整屏抽屉。
 *
 * 桌面面板**始终留在 DOM 里**：收起的动作是把它滑出右缘（`translate-x-full`，
 * 280ms），常驻形态同时让正文补上它的宽度 —— 一次性卸载会看不到动画，正文也会
 * 瞬移（用户报的「很生硬」）。滑出后 `inert` 把它从可聚焦/可访问树里摘掉；
 * `tab` 一直传着，所以滑出过程中看到的就是刚点过的那一屏。
 *
 * `float` 形态额外画一层遮罩，点它就收起（跳转后由调用方收起）。
 */
export function DrawerPanel({
  tab,
  onTabChange,
  open,
  onClose,
  mode,
  onModeChange,
  mobileOpen,
  onMobileOpenChange,
  ...views
}: DrawerPanelProps) {
  return (
    <>
      {mode === "float" ? (
        // 遮罩：只在小屏之上出现（小屏用抽屉自己的遮罩）。收起后仍留在 DOM 里，
        // 这样淡出也能看到动画。
        <div
          aria-hidden="true"
          data-slot="panel-scrim"
          data-open={open ? "true" : "false"}
          className={cn(
            "absolute inset-0 z-30 hidden bg-black/32 transition-opacity duration-[200ms] ease-[var(--ease-soft)] sm:block",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={onClose}
        />
      ) : null}
      <aside
        data-slot="reader-panel"
        data-panel-mode={mode}
        data-open={open ? "true" : "false"}
        inert={!open}
        className={cn(
          "absolute inset-y-0 right-0 z-40 hidden w-panel flex-col overflow-hidden border-l border-line bg-background sm:flex",
          "transition-transform",
          PANEL_DURATION,
          open ? "translate-x-0" : "translate-x-full",
          mode === "float" ? "shadow-pop" : null,
        )}
      >
        <PanelViews
          {...views}
          tab={tab}
          onTabChange={onTabChange}
          title={TAB_LABEL[tab]}
          mode={mode}
          onToggleMode={() =>
            onModeChange(mode === "docked" ? "float" : "docked")
          }
          onClose={onClose}
        />
      </aside>

      <Drawer
        open={mobileOpen}
        onOpenChange={onMobileOpenChange}
        swipeDirection="right"
        showSwipeHandle
        modal
      >
        <DrawerContent className="[--drawer-content-width:min(85vw,var(--panel-w))]">
          <div className="h-full min-h-0 overflow-hidden">
            <PanelViews
              {...views}
              tab={tab}
              onTabChange={onTabChange}
              title={TAB_LABEL[tab]}
              onClose={() => onMobileOpenChange(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
