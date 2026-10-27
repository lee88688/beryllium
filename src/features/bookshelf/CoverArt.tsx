import { useMemo, type CSSProperties } from "react";

/**
 * 无封面书籍的生成封面（`Book.cover === ""`）。
 *
 * 设计约束：
 *  - 跟随界面：颜色只由书籍色相混入 `--bg` / `--fg` 推导，切换明暗或 11 套
 *    配色时自动重算；不落盘、不生成图片，也就不存在与主题脱节的陈旧封面。
 *  - 稳定随机：同一本书（`seed` = 书籍 id）永远得到同一张封面，否则每次渲染
 *    都会换色，书架看起来会闪。
 *  - 像封面而不像色块：柔和光斑 + 细弧线 + 纸纹 + 书名首字的大号水印；书名与
 *    作者仍由卡片底部的标题浮层负责，这里不重复排字。
 */

/** 低饱和取向的色相集合；避开与主操作色过于接近的纯蓝，防止和 UI 抢焦点。 */
const HUES = [
  8, 24, 38, 54, 76, 98, 132, 158, 178, 196, 216, 242, 264, 288, 312, 334,
];

/** FNV-1a：把书籍 id 变成 32 位种子。 */
function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 确定性伪随机（mulberry32）：同一种子恒定产出同一串 0–1 数。 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 封面水印用：书名里第一个有意义的字符（跳过《、引号、空白等）。 */
function firstGlyph(title: string): string {
  for (const char of title.trim()) {
    if (/[\p{L}\p{N}]/u.test(char)) return char;
  }
  return "";
}

export interface CoverArtProps {
  /** 稳定标识，通常是 `book.id`。 */
  seed: number | string;
  title: string;
}

export function CoverArt({ seed, title }: CoverArtProps) {
  const { style, glyph } = useMemo(() => {
    const random = mulberry32(hashSeed(String(seed)));
    const hue = HUES[Math.floor(random() * HUES.length)] ?? 214;
    // 第二个色相与主色相邻，形成同一色族的深浅过渡而不是撞色。
    const hue2 = (hue + 16 + Math.round(random() * 48)) % 360;

    const coverStyle: CSSProperties = {
      "--cover-h": String(hue),
      "--cover-h2": String(hue2),
      "--cover-angle": `${Math.round(100 + random() * 80)}deg`,
      "--cover-x1": `${Math.round(4 + random() * 88)}%`,
      "--cover-y1": `${Math.round(-14 + random() * 66)}%`,
      "--cover-x2": `${Math.round(-8 + random() * 96)}%`,
      "--cover-y2": `${Math.round(36 + random() * 76)}%`,
      "--cover-ring-x": `${Math.round(-40 + random() * 180)}%`,
      "--cover-ring-y": `${Math.round(-40 + random() * 180)}%`,
      "--cover-ring-alpha": (0.18 + random() * 0.18).toFixed(2),
    } as CSSProperties;

    return { style: coverStyle, glyph: firstGlyph(title) };
  }, [seed, title]);

  return (
    <span
      aria-hidden="true"
      className="cover-art block h-full w-full"
      style={style}
    >
      {glyph === "" ? null : <span className="cover-art__glyph">{glyph}</span>}
    </span>
  );
}
