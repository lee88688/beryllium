import { ColorRadio, type MarkColor } from "@/components/color-radio";
import { Button } from "@/components/ui/button";

import { isAnnotationEditable, type EditorDraft } from "./state";

export type HighlightEditorProps = {
  draft: EditorDraft;
  /** A create/update/remove request is in flight. */
  pending?: boolean;
  onColorChange: (color: MarkColor) => void;
  onContentChange: (content: string) => void;
  onConfirm: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

/**
 * Highlight bubble (D15): picking a colour creates the mark, the annotation box
 * becomes usable once the mark exists, 确定 updates it, 删除 removes it and
 * 取消 rolls back whatever this session created.
 */
export function HighlightEditor({
  draft,
  pending = false,
  onColorChange,
  onContentChange,
  onConfirm,
  onDelete,
  onCancel,
}: HighlightEditorProps) {
  const editable = isAnnotationEditable(draft) && !pending;

  return (
    <div className="flex w-[300px] flex-col gap-2">
      <ColorRadio
        value={draft.color}
        onChange={onColorChange}
        disabled={pending}
        aria-label="高亮颜色"
      />
      <textarea
        value={draft.content}
        onChange={(event) => onContentChange(event.target.value)}
        placeholder="评论"
        rows={2}
        disabled={!editable}
        className="border-input focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={!editable}
        >
          删除
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={!editable}>
          确定
        </Button>
      </div>
      {draft.id === undefined && (
        <p className="text-muted-foreground text-xs">选择颜色即可创建高亮</p>
      )}
    </div>
  );
}
