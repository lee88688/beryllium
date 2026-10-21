import { useEffect, useRef } from "react";

/**
 * 阅读器的快捷键（`document` 级监听）。
 *
 * 键位与说明见 `shortcuts.ts`。这里只负责「按键 → 意图」的翻译：
 *  - 焦点在输入框/批注框里（书名、搜索、写批注）时全部让开；
 *  - 带 Ctrl/Cmd/Alt 的组合一律不碰（macOS 的 Cmd+M 是最小化窗口）；
 *  - 空格在按钮/链接上是「激活」，同样让开；
 *  - `enabled=false`（弹窗、批注编辑器、图片预览开着）时整块键盘让位。
 *
 * 章节正文渲染在 iframe 里，点过正文之后焦点就在那个文档里 —— 键事件不会冒泡到
 * 宿主文档，`adapter.ts` 会把它们转发过来（见 `attachSection`）。
 */
export interface ReaderShortcutHandlers {
  /** 上下翻页。 */
  turnPage: (direction: "next" | "prev") => void;
  /** `t`：目录 → 备注 → 收起。 */
  cycleLists: () => void;
  /** `s`：排版面板（再按收起）。 */
  toggleTypography: () => void;
  /** `m`：呼出 / 收起顶栏。 */
  toggleChrome: () => void;
  /** `b`：添加书签。 */
  addBookmark: () => void;
  /** `?`：快捷键说明。 */
  showHelp: () => void;
  /** 有别的浮层在用时整块键盘让位。 */
  enabled: boolean;
}

/** 会「吃键入」的元素：在这里打字不该翻页或弹面板。 */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable === true
  );
}

/** 空格要留给这些元素自己「按下」。 */
function isActivatable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest?.("button, a, [role=button], [role=tab], [role=radio]"),
  );
}

export function useReaderShortcuts(handlers: ReaderShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handlers = handlersRef.current;
      if (!handlers.enabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;

      const key = event.key;
      const isPageKey =
        key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "PageUp" ||
        key === "PageDown" ||
        key === " ";
      // 长按翻页很顺手，但长按 t/s/m/b 不该把面板来回弹。
      if (event.repeat && !isPageKey) return;

      if (key === "ArrowLeft" || key === "PageUp") {
        handlers.turnPage("prev");
      } else if (key === "ArrowRight" || key === "PageDown") {
        handlers.turnPage("next");
      } else if (key === " ") {
        if (isActivatable(event.target)) return;
        handlers.turnPage("next");
      } else if (key === "t") {
        handlers.cycleLists();
      } else if (key === "s") {
        handlers.toggleTypography();
      } else if (key === "m") {
        handlers.toggleChrome();
      } else if (key === "b") {
        handlers.addBookmark();
      } else if (key === "?") {
        handlers.showHelp();
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
