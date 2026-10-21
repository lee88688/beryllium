import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

import { READER_SHORTCUTS } from "./shortcuts";

export type ShortcutsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** `?`：阅读器的快捷键说明。内容就是 `shortcuts.ts` 那张表（与设置页同一份）。 */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>在阅读器里按下这些键。</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2">
          {READER_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-4"
            >
              <dt className="text-muted-foreground text-base">
                {shortcut.label}
              </dt>
              <dd className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-sm">
          焦点在输入框里时这些键都不生效；键盘焦点在正文里同样有效。
        </p>
      </DialogContent>
    </Dialog>
  );
}
