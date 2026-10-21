import { useEffect, useState } from "react";

export type ViewportSize = { width: number; height: number };

const readViewport = (): ViewportSize =>
  typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/**
 * Live viewport size, used to synthesize the popover anchor while the virtual
 * keyboard overlays the page.
 */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(readViewport);

  useEffect(() => {
    const update = () => setSize(readViewport());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return size;
}
