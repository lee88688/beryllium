import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

/** Rejection reason of a pending `openDialog` promise that was cancelled. */
export class ConfirmCanceledError extends Error {
  constructor() {
    super("confirm dialog canceled");
    this.name = "ConfirmCanceledError";
  }
}

export type ConfirmDialogOptions = {
  title: React.ReactNode;
  content?: React.ReactNode;
  /** Confirm button label. */
  confirmText?: React.ReactNode;
  /** Cancel button label. */
  cancelText?: React.ReactNode;
};

export type ConfirmDialogHandle = {
  /** Render this once, anywhere inside the component tree that calls `openDialog`. */
  dialog: React.ReactNode;
  /** Opens the dialog; resolves on confirm, rejects on cancel / dismiss. */
  openDialog: (options: ConfirmDialogOptions) => Promise<void>;
  /** Programmatic cancel: closes the dialog and rejects a pending promise. */
  closeDialog: () => void;
};

/**
 * Imperative confirm dialog with promise semantics (replaces the legacy MUI
 * `useConfirmDialog`):
 *
 * ```tsx
 * const { dialog, openDialog } = useConfirmDialog();
 * // ...
 * await openDialog({ title: "删除书籍", content: "不可撤销" });
 * ```
 *
 * Confirm → resolve, cancel / Esc / outside press → reject with
 * `ConfirmCanceledError`. Opening a second dialog while one is pending rejects
 * the previous promise (it is superseded).
 */
export function useConfirmDialog(): ConfirmDialogHandle {
  const [options, setOptions] = React.useState<ConfirmDialogOptions | null>(
    null,
  );
  const pendingRef = React.useRef<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
  } | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOptions(null);
    if (!pending) return;
    if (confirmed) {
      pending.resolve();
    } else {
      pending.reject(new ConfirmCanceledError());
    }
  }, []);

  const openDialog = React.useCallback(
    (next: ConfirmDialogOptions) =>
      new Promise<void>((resolve, reject) => {
        pendingRef.current?.reject(new ConfirmCanceledError());
        pendingRef.current = { resolve, reject };
        setOptions(next);
      }),
    [],
  );

  const closeDialog = React.useCallback(() => settle(false), [settle]);

  const dialog = (
    <AlertDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          {options?.content === undefined ? null : (
            <AlertDialogDescription>{options.content}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {options?.cancelText ?? "取消"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            {options?.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { dialog, openDialog, closeDialog };
}
