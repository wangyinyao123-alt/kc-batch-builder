/**
 * 视口：屏幕坐标 ↔ 世界坐标的换算。
 *
 * 为什么单独抽成纯函数：缩放和拖拽是「手感」问题，
 * 出一次错就是「鼠标和图形对不上」，而且这种错在浏览器里极难排查
 * （看起来只是有点偏）。做成纯函数就能在 Node 里断言。
 *
 * 约定：view = { scale, tx, ty }，世界坐标 p 画到屏幕上的位置是
 *   screen = p * scale + (tx, ty)
 */

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** 默认视口。 */
export function newView() {
  return { scale: 1, tx: 0, ty: 0 };
}

/** 世界坐标 → 屏幕坐标。 */
export function toScreen(view, p) {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

/** 屏幕坐标 → 世界坐标。 */
export function toWorld(view, p) {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

/**
 * 以某个屏幕点为锚点缩放：该点下方的世界坐标保持不动。
 * 不做这个的话，滚轮放大时图形会往左上角跑，用户就会失去方位。
 */
export function zoomAt(view, screenPt, nextScale) {
  const s = clampScale(nextScale);
  const world = toWorld(view, screenPt);
  return {
    scale: s,
    tx: screenPt.x - world.x * s,
    ty: screenPt.y - world.y * s,
  };
}

/** 按倍率缩放（滚轮用）。 */
export function zoomBy(view, screenPt, factor) {
  return zoomAt(view, screenPt, view.scale * factor);
}

/** 平移。 */
export function panBy(view, dx, dy) {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

/**
 * 让一组框刚好铺满视口。
 * @param {{x:number,y:number,w:number,h:number}} bounds 世界坐标包围盒
 * @param {{width:number,height:number}} size 视口像素尺寸
 * @param {number} [pad] 内边距（屏幕像素）
 */
export function fitBox(bounds, size, pad = 48) {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0 || size.width <= 0 || size.height <= 0) {
    return newView();
  }
  const availW = Math.max(1, size.width - pad * 2);
  const availH = Math.max(1, size.height - pad * 2);
  const scale = clampScale(Math.min(availW / bounds.w, availH / bounds.h));
  // 居中：让内容中心落在视口中心
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    scale,
    tx: size.width / 2 - cx * scale,
    ty: size.height / 2 - cy * scale,
  };
}

/** 若干框的并集包围盒。 */
export function unionBounds(boxes) {
  if (!boxes || boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
