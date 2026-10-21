/**
 * 图片预览的缩放/平移几何。
 *
 * 图片在预览层里始终**居中**、按容器「铺满」（`scale = 1` 就是适配屏幕），缩放只
 * 改这里的 `scale` 与 `x/y`（CSS `transform`）。滚轮每一格都直接落在这一份状态上，
 * 所以放大是连续的 —— 不是每格重新布局一次。
 *
 * 全部是纯函数：`ImagePreview` 只管把指针/滚轮事件换算成入参。
 */

/** 缩放下限：1 = 适配屏幕（再往外缩没有意义）。 */
export const IMAGE_MIN_SCALE = 1;
/** 缩放上限：相对「适配屏幕」的倍数，够看清插图里的字。 */
export const IMAGE_MAX_SCALE = 8;

/** 滚轮每 100 像素的缩放倍率（`.exp()` 让每一格的手感一致）。 */
const WHEEL_ZOOM_RATE = 0.0025;

export interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

export const IMAGE_TRANSFORM_IDENTITY: ImageTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

/** 图片未缩放时的布局尺寸（CSS px）；容器比图大时那一维不能平移。 */
export interface ImageBounds {
  width: number;
  height: number;
}

/** `Math.min/max` 会留下 `-0`（`translate3d(-0px …)`）—— 归一成 `0`。 */
const clamp = (value: number, min: number, max: number) => {
  const bounded = Math.min(max, Math.max(min, value));
  return bounded === 0 ? 0 : bounded;
};

/**
 * 把 `x/y` 收进「图片边缘不外露」的范围：某一维在放大后仍比容器小（或等于）时，
 * 就锁死在 0（居中），否则最多平移到 `(尺寸 × (scale - 1)) / 2`。
 */
export function clampPan(
  transform: ImageTransform,
  bounds: ImageBounds,
): ImageTransform {
  const limit = (size: number) =>
    Math.max(0, (size * (transform.scale - 1)) / 2);
  return {
    scale: transform.scale,
    x: clamp(transform.x, -limit(bounds.width), limit(bounds.width)),
    y: clamp(transform.y, -limit(bounds.height), limit(bounds.height)),
  };
}

/**
 * 以 `anchor`（相对预览层中心的偏移，即指针位置）为不动点缩放 `factor` 倍。
 *
 * 推导：缩放前指针下的图像点相对图片中心为 `u = (anchor - t) / scale`（`t` 是当前
 * 平移）；缩放后仍要落在指针下，于是 `t' = anchor - scale' × u`，整理即上式。
 */
export function zoomAt(
  current: ImageTransform,
  factor: number,
  anchor: { dx: number; dy: number },
  bounds: ImageBounds,
): ImageTransform {
  const scale = clamp(current.scale * factor, IMAGE_MIN_SCALE, IMAGE_MAX_SCALE);
  const ratio = scale / current.scale;
  return clampPan(
    {
      scale,
      x: ratio * current.x + (1 - ratio) * anchor.dx,
      y: ratio * current.y + (1 - ratio) * anchor.dy,
    },
    bounds,
  );
}

/** 滚轮一格：向上（`deltaY < 0`）放大，向下缩小。 */
export function zoomByWheel(
  current: ImageTransform,
  deltaY: number,
  anchor: { dx: number; dy: number },
  bounds: ImageBounds,
): ImageTransform {
  return zoomAt(current, Math.exp(-deltaY * WHEEL_ZOOM_RATE), anchor, bounds);
}

/** 拖拽平移：`dx/dy` 是指针这一帧移动的像素。 */
export function panBy(
  current: ImageTransform,
  dx: number,
  dy: number,
  bounds: ImageBounds,
): ImageTransform {
  return clampPan({ ...current, x: current.x + dx, y: current.y + dy }, bounds);
}

/** 双击缩放：适配屏幕与 2.5 倍之间来回。 */
export const IMAGE_DOUBLE_TAP_SCALE = 2.5;

export function toggleZoom(
  current: ImageTransform,
  anchor: { dx: number; dy: number },
  bounds: ImageBounds,
): ImageTransform {
  return current.scale > IMAGE_MIN_SCALE
    ? { ...IMAGE_TRANSFORM_IDENTITY }
    : zoomAt(current, IMAGE_DOUBLE_TAP_SCALE, anchor, bounds);
}
