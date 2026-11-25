import { useState } from "react";
import { DialogKb } from "@/components/dialog-kb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export type CreateCategoryDialogProps = {
  creating: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
};

/**
 * 「添加类别」对话框. 由页面而不是 `BookshelfDrawer` 挂载：小屏上「创建分类」
 * 在抽屉里，点它要先收起抽屉，而收起会把抽屉连同里面的对话框一起卸载。
 * 名称去空格后为空时不能提交（server 端用同一套规则再校验一次）。
 */
export function CreateCategoryDialog({
  creating,
  onCancel,
  onCreate,
}: CreateCategoryDialogProps) {
  const [name, setName] = useState("");
  const trimmedName = name.trim();

  const submit = () => {
    if (creating || trimmedName === "") return;
    onCreate(trimmedName);
  };

  return (
    <DialogKb
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="添加类别"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-name">输入类别名称</Label>
        <Input
          id="category-name"
          autoFocus
          value={name}
          disabled={creating}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={creating}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          type="button"
          disabled={creating || trimmedName === ""}
          onClick={submit}
        >
          {creating ? <Spinner className="size-4" /> : null}
          创建
        </Button>
      </div>
    </DialogKb>
  );
}
