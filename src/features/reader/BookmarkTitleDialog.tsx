import { DialogKb } from "@/components/dialog-kb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type BookmarkTitleDialogProps = {
  open: boolean;
  /** Current title, controlled by the caller. */
  value: string;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (title: string) => void;
};

/**
 * 「书签标题」对话框. Uses `DialogKb` so it stays above the on-screen keyboard
 * (PRD §10: 对话框在虚拟键盘弹出时上移). Fully controlled: the owner prefills the
 * title (new bookmark: nearest heading, rename: current title).
 */
export function BookmarkTitleDialog({
  open,
  value,
  onValueChange,
  onCancel,
  onConfirm,
}: BookmarkTitleDialogProps) {
  return (
    <DialogKb
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="书签标题"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="bookmark-title">请输入标题</Label>
        <Input
          id="bookmark-title"
          value={value}
          placeholder="请输入标题"
          onChange={(event) => onValueChange(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={() => onConfirm(value)}>
          确定
        </Button>
      </div>
    </DialogKb>
  );
}
