/**
 * 侧栏的上次状态（收起 / 展开、是哪一屏）。阅读器每次挂载都从这里恢复，
 * 所以「进阅读器就自己弹开侧栏」不会发生。
 *
 * 单独一个 localStorage key，不并进 `lib/prefs.ts` 的排版偏好：
 *  - 它不是设置项：设置页没有这一项，「恢复默认」也不该把侧栏的开关一起清掉；
 *  - 开关侧栏是阅读器里最频繁的写入，混进排版 store 会连带重套/重排正文；
 *  - 那个 store 会跨标签同步整份快照，被一份旧快照（另一个标签、书里章节
 *    的 iframe）盖回来就会把刚收起的侧栏又弹开。
 */

/** 侧栏的四个视图（`DrawerPanel` 的页签）。 */
export type PanelTab = "toc" | "notes" | "bookmarks" | "type";

export interface PanelState {
  /** 是否展开。 */
  open: boolean;
  /** 展开时看的那一屏；收起时保留，下次展开回到这一屏。 */
  tab: PanelTab;
}

export const PANEL_STATE_KEY = "reader-panel";

/** 第一次进阅读器：展开在「目录」，与旧行为一致。 */
export const PANEL_STATE_DEFAULT: PanelState = { open: true, tab: "toc" };

const PANEL_TABS: readonly PanelTab[] = ["toc", "notes", "bookmarks", "type"];

function isPanelTab(value: unknown): value is PanelTab {
  return PANEL_TABS.includes(value as PanelTab);
}

export function readPanelState(): PanelState {
  if (typeof window === "undefined") return { ...PANEL_STATE_DEFAULT };
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      if (stored && typeof stored === "object") {
        const { open, tab } = stored as { open?: unknown; tab?: unknown };
        return {
          open: open !== false,
          tab: isPanelTab(tab) ? tab : PANEL_STATE_DEFAULT.tab,
        };
      }
    }
  } catch {
    // 坏数据（手改 / 旧版本）或受限存储：退回默认值
  }
  return { ...PANEL_STATE_DEFAULT };
}

export function writePanelState(state: PanelState): void {
  try {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch {
    // 受限存储（隐私模式）：本次会话里仍然有效
  }
}
