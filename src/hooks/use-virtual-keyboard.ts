import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";

/**
 * Number of mounted consumers that currently require
 * `navigator.virtualKeyboard.overlaysContent`. The flag is turned back off when
 * the last consumer unmounts. (Ported from the legacy `store/virtualKeyboard`.)
 */
export const overlaysContentCountAtom = atom(0);

/**
 * Minimal structural type for the Virtual Keyboard API
 * (the TS DOM lib used by this repo does not ship `VirtualKeyboard`).
 */
type VirtualKeyboardTarget = EventTarget & {
  boundingRect: DOMRect;
  overlaysContent: boolean;
};

function getVirtualKeyboard(): VirtualKeyboardTarget | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardTarget })
    .virtualKeyboard;
}

export type UseVirtualKeyboardResult = {
  isSupported: boolean;
  isKeyboardOpen: boolean;
  boundingRect: DOMRect | undefined;
};

export default function useVirtualKeyboard(): UseVirtualKeyboardResult {
  const [boundingRect, setBoundingRect] = useState<DOMRect>();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const isSupported = Boolean(getVirtualKeyboard());
  // this atom is shared by every consumer
  const [, setOverlaysContentCount] = useAtom(overlaysContentCountAtom);

  useEffect(() => {
    const virtualKeyboard = getVirtualKeyboard();
    if (!virtualKeyboard) return;

    const handleGeometryChange: EventListener = () => {
      const rect = virtualKeyboard.boundingRect;
      setBoundingRect(rect);
      if (rect.width) {
        setIsKeyboardOpen(true);
      } else {
        setIsKeyboardOpen(false);
      }
    };

    virtualKeyboard.addEventListener("geometrychange", handleGeometryChange);
    if (!virtualKeyboard.overlaysContent) {
      virtualKeyboard.overlaysContent = true;
    }
    setOverlaysContentCount((c) => c + 1);

    return () => {
      virtualKeyboard.removeEventListener(
        "geometrychange",
        handleGeometryChange,
      );
      setOverlaysContentCount((c) => {
        if (c <= 0) return c;
        const next = c - 1;
        if (next <= 0 && virtualKeyboard.overlaysContent) {
          virtualKeyboard.overlaysContent = false;
        }
        return next;
      });
    };
  }, [isSupported, setOverlaysContentCount]);

  return {
    isSupported,
    isKeyboardOpen,
    boundingRect,
  };
}
