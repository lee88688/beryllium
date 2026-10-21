import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "cn";

import {
  IMAGE_MIN_SCALE,
  IMAGE_TRANSFORM_IDENTITY,
  panBy,
  toggleZoom,
  zoomAt,
  zoomByWheel,
  type ImageBounds,
} from "./image-zoom";

export type ImagePreviewProps = {
  /** Absolute URL of the image to show; `undefined` hides the viewer. */
  src: string | undefined;
  onClose: () => void;
};

/** 拖拽/捏合时判定「这算一次移动」的阈值（px）：低于它的按下仍算点击。 */
const DRAG_THRESHOLD_PX = 3;

/**
 * 全屏图片预览：滚轮/捏合缩放、拖拽平移、双击在「适配屏幕」与 2.5 倍之间切换，
 * 点空白处、按 Esc 或点右上角的按钮关闭。
 *
 * 缩放自己算（`image-zoom.ts`）：**滚轮每一格都直接更新同一个 `transform`**，所以
 * 放大是连续的。之前用的 react-photo-view 不能吃滚轮，桌面上的「滚轮放大」实际是
 * 浏览器的 Ctrl+滚轮页面缩放 —— 每翻一档整页重新布局，图片看起来就是「一格一格
 * 重新调整」而不是连续放大。
 *
 * A1: the section runs no script any more, so nothing inside the book can call
 * into the reader. The parent document detects the click on the section
 * document (`section-interactions.ts`) and hands the image URL to this viewer.
 * The last image is kept while the viewer animates out, which is why the list
 * is adjusted during render instead of being derived from `src`.
 */
export function ImagePreview({ src, onClose }: ImagePreviewProps) {
  const [shown, setShown] = useState<{ src: string } | undefined>(undefined);
  if (src !== undefined && shown?.src !== src) {
    setShown({ src });
  }

  return (
    <Dialog
      open={src !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // 整屏的黑底舞台；图片本身是它的子节点。
        className="h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black/85 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        {shown ? (
          <ImageView key={shown.src} src={shown.src} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ImageView({ src, onClose }: { src: string; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState(IMAGE_TRANSFORM_IDENTITY);
  /** 缩放/平移都以「图片中心」（= 舞台中心）为原点，指针位置换算成它的偏移。 */
  const bounds = (): ImageBounds => ({
    width: imageRef.current?.clientWidth ?? 0,
    height: imageRef.current?.clientHeight ?? 0,
  });
  const anchorOf = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      dx: clientX - (rect ? rect.left + rect.width / 2 : 0),
      dy: clientY - (rect ? rect.top + rect.height / 2 : 0),
    };
  };

  // 滚轮单独用原生监听（`passive: false`）：缩放必须 `preventDefault`，否则
  // Ctrl+滚轮会落到浏览器自己的页面缩放上（那才是「一格一格重新适配」的由来）。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // 行/页为单位时（Firefox、部分鼠标驱动）换算成像素，手感才一致。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const anchor = anchorOf(event.clientX, event.clientY);
      setTransform((current) =>
        zoomByWheel(current, event.deltaY * unit, anchor, bounds()),
      );
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  /** 按下的指针（带按下位置，用来区分「点一下」和「拖拽」）；两个指针时进入捏合。 */
  const pointers = useRef(
    new Map<number, { x: number; y: number; startX: number; startY: number }>(),
  );
  const pinch = useRef<{ distance: number } | null>(null);
  const dragged = useRef(false);

  const pinchState = () => {
    const [first, second] = [...pointers.current.values()];
    if (!first || !second) return null;
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      anchor: anchorOf((first.x + second.x) / 2, (first.y + second.y) / 2),
    };
  };

  /**
   * 指针捕获只在**真的开始拖拽/捏合**时才要：一开始就捕获，后续的 `click`/
   * `dblclick` 都会重定向到舞台本身，点空白处关闭和双击缩放就都收不到了。
   */
  const capturePointers = () => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const pointerId of pointers.current.keys()) {
      stage.setPointerCapture(pointerId);
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    dragged.current = pointers.current.size >= 2;
    pinch.current = pointers.current.size === 2 ? pinchState() : null;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, {
      ...previous,
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size >= 2) {
      const next = pinchState();
      const last = pinch.current;
      if (!dragged.current) {
        dragged.current = true;
        capturePointers();
      }
      if (next && last && last.distance > 0) {
        setTransform((current) =>
          zoomAt(current, next.distance / last.distance, next.anchor, bounds()),
        );
      }
      pinch.current = next;
      return;
    }
    // 抖动不算拖拽：只有真的移开了阈值，这一下才不再当成「点空白处关闭」。
    if (
      !dragged.current &&
      Math.hypot(
        event.clientX - previous.startX,
        event.clientY - previous.startY,
      ) > DRAG_THRESHOLD_PX
    ) {
      dragged.current = true;
      capturePointers();
    }
    setTransform((current) =>
      panBy(
        current,
        event.clientX - previous.x,
        event.clientY - previous.y,
        bounds(),
      ),
    );
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const zoomed = transform.scale > IMAGE_MIN_SCALE;

  return (
    <>
      <div
        ref={stageRef}
        // `presentation`：舞台只是个容器，交互是画布式的手势（滚轮/拖拽/点击）。
        // 键盘等价物是 Esc 与右上角的关闭按钮，所以这里不需要键位处理。
        role="presentation"
        className={cn(
          // flex（不是 grid）：`max-w-full/max-h-full` 要按舞台的实际尺寸解析，
          // grid 的 auto 轨道会按图片自身尺寸撑开，图片反而不会被缩到「适配屏幕」。
          "absolute inset-0 flex touch-none items-center justify-center overflow-hidden",
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={(event) => {
          // 拖拽（平移）之后那一下不是「点」。
          if (dragged.current) return;
          const anchor = anchorOf(event.clientX, event.clientY);
          if (event.target === imageRef.current) {
            setTransform((current) => toggleZoom(current, anchor, bounds()));
            return;
          }
          onClose();
        }}
      >
        {/* 图片是缩放入口（`cursor-zoom-in`）：点图片放大到 2.5 倍、再点回到适配
            屏幕；点图片之外的空白关闭。 */}
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        />
      </div>
      <IconButton
        aria-label="关闭"
        size="sm"
        className="absolute top-3 right-3 z-10 text-white/90 hover:bg-white/15 hover:text-white"
        onClick={onClose}
      >
        <XIcon />
      </IconButton>
    </>
  );
}
