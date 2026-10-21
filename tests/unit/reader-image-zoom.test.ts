import { describe, expect, it } from "vitest";

import {
  IMAGE_MAX_SCALE,
  IMAGE_MIN_SCALE,
  IMAGE_TRANSFORM_IDENTITY,
  clampPan,
  panBy,
  toggleZoom,
  zoomAt,
  zoomByWheel,
} from "@/features/reader/image-zoom";

/** 未缩放的图片布局尺寸：一张比容器大的图（两个方向都能平移）。 */
const BOUNDS = { width: 1000, height: 600 };

describe("zoomByWheel", () => {
  it("scales up on wheel up and down on wheel down, continuously", () => {
    const once = zoomByWheel(
      IMAGE_TRANSFORM_IDENTITY,
      -40,
      { dx: 0, dy: 0 },
      BOUNDS,
    );
    const twice = zoomByWheel(once, -40, { dx: 0, dy: 0 }, BOUNDS);
    const back = zoomByWheel(twice, 40, { dx: 0, dy: 0 }, BOUNDS);

    // 一格滚轮只是乘一个小倍率（不是跳到下一个档位）。
    expect(once.scale).toBeGreaterThan(1);
    expect(once.scale).toBeLessThan(1.2);
    expect(twice.scale).toBeGreaterThan(once.scale);
    expect(back.scale).toBeLessThan(twice.scale);
    // 一上一下回到原处。
    expect(back.scale).toBeCloseTo(once.scale, 10);
  });

  it("never zooms below fit or above the cap", () => {
    let out = IMAGE_TRANSFORM_IDENTITY;
    for (let i = 0; i < 50; i += 1) {
      out = zoomByWheel(out, 120, { dx: 0, dy: 0 }, BOUNDS);
    }
    expect(out.scale).toBe(IMAGE_MIN_SCALE);
    for (let i = 0; i < 50; i += 1) {
      out = zoomByWheel(out, -120, { dx: 0, dy: 0 }, BOUNDS);
    }
    expect(out.scale).toBe(IMAGE_MAX_SCALE);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor in place", () => {
    // 指针在图片中心右侧 100px：放大后这一点不该移动。
    const anchor = { dx: 100, dy: 0 };
    const next = zoomAt(IMAGE_TRANSFORM_IDENTITY, 2, anchor, BOUNDS);
    // 图像坐标 u = (anchor - t) / scale；缩放后 anchor 仍应落在同一个 u 上。
    const u =
      (anchor.dx - IMAGE_TRANSFORM_IDENTITY.x) / IMAGE_TRANSFORM_IDENTITY.scale;
    expect(next.x + next.scale * u).toBeCloseTo(anchor.dx, 10);
    expect(next.scale).toBe(2);
    expect(next.x).toBeLessThan(0);
  });

  it("clamps the pan at the edge of the zoomed image", () => {
    // 指针在右下方（dx 正、dy 负）：放大后图片往左上方走，被边界截住。
    // 8 倍时最多平移 1000 × 7 / 2 = 3500（宽）、600 × 7 / 2 = 2100（高）。
    const next = zoomAt(
      IMAGE_TRANSFORM_IDENTITY,
      8,
      { dx: 100000, dy: -100000 },
      BOUNDS,
    );
    expect(next).toEqual({ scale: 8, x: -3500, y: 2100 });
  });
});

describe("clampPan", () => {
  it("clamps each axis to half the overflow", () => {
    // 放大 1.5 倍：宽 200 最多平移 50，高 100 最多平移 25。
    expect(
      clampPan({ scale: 1.5, x: 40, y: -40 }, { width: 200, height: 100 }),
    ).toEqual({ scale: 1.5, x: 40, y: -25 });
    expect(
      clampPan({ scale: 1.5, x: 80, y: -80 }, { width: 200, height: 100 }),
    ).toEqual({ scale: 1.5, x: 50, y: -25 });
    // 适配屏幕（scale 1）时不能平移。
    expect(clampPan({ scale: 1, x: 40, y: -40 }, BOUNDS)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it("leaves the pan alone once it is inside the limit", () => {
    const next = panBy({ scale: 2, x: 0, y: 0 }, 100, 100, BOUNDS);
    expect(next).toEqual({ scale: 2, x: 100, y: 100 });
  });
});

describe("toggleZoom", () => {
  it("goes from fit to 2.5x and back to fit", () => {
    const zoomed = toggleZoom(
      IMAGE_TRANSFORM_IDENTITY,
      { dx: 0, dy: 0 },
      BOUNDS,
    );
    expect(zoomed.scale).toBe(2.5);
    expect(toggleZoom(zoomed, { dx: 0, dy: 0 }, BOUNDS)).toEqual(
      IMAGE_TRANSFORM_IDENTITY,
    );
  });
});
