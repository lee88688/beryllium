import { useState, type FormEvent } from "react";
import { DialogKb } from "@/components/dialog-kb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BookshelfBook } from "./types";

export type EditBookDialogProps = {
  /** The book being edited; the owner mounts this per book (`key={book.id}`). */
  book: BookshelfBook;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: { title: string; author: string }) => void;
};

/**
 * 「编辑书籍信息」对话框. 只改展示用的书名/作者（文件与 `content` 快照不动）；
 * 书名去空格后不能为空，作者可以留空。Server 端用同一套规则再校验一次。
 */
export function EditBookDialog({
  book,
  saving,
  onCancel,
  onSave,
}: EditBookDialogProps) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const trimmedTitle = title.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || trimmedTitle === "") return;
    onSave({ title: trimmedTitle, author: author.trim() });
  };

  return (
    <DialogKb
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="编辑书籍信息"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-book-title">书名</Label>
          <Input
            id="edit-book-title"
            value={title}
            maxLength={200}
            placeholder="请输入书名"
            autoFocus
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-book-author">作者</Label>
          <Input
            id="edit-book-author"
            value={author}
            maxLength={200}
            placeholder="可留空"
            disabled={saving}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={saving || trimmedTitle === ""}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </DialogKb>
  );
}
