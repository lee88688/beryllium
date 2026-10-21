/**
 * 阅读器内的快捷键。
 *
 * 说明表放在这里（而不是各写一份）：设置页的「快捷键（阅读器内）」与阅读器里按
 * `?` 弹出来的说明读的是同一份 —— 只改实现，说明就跟着变，不会再出现「文档里
 * 写着、实际上没有」。
 */
export interface ReaderShortcut {
  /** 能触发的键位（展示用文案）。 */
  keys: string[];
  /** 这个键做什么；收起/切换的语义写清楚，免得两处描述不一致。 */
  label: string;
}

export const READER_SHORTCUTS: readonly ReaderShortcut[] = [
  { keys: ["←", "PgUp"], label: "上一页" },
  { keys: ["→", "PgDn", "Space"], label: "下一页" },
  { keys: ["t"], label: "目录 → 备注 → 收起（循环）" },
  { keys: ["s"], label: "排版面板（再按收起）" },
  { keys: ["m"], label: "呼出 / 收起顶栏" },
  { keys: ["b"], label: "添加书签" },
  { keys: ["?"], label: "快捷键说明" },
];
