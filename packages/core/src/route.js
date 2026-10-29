/**
 * 正交线路由：给两个框算一条「出线 → 拐点 → 入线」的折线。
 *
 * 为什么需要它：dagre 给的折线只在「全自动排版」时可靠。
 * 一旦用户手动拖动过节点（画布编辑），坐标就偏离了 dagre 的设想，
 * 原来那条线会从框中间穿过去。此时必须按当前两个框的真实位置重新布线。
 *
 * 规则：
 *   - 端口取框边的中点（上/下/左/右），与 vsdx 的 cardinal 连接点一致
 *   - 出线先沿法线走 OUT 像素，避免贴着框边画
 *   - 两端都是竖端口就用中间高度横向并线；都是横端口就用中间宽度纵向并线；
 *     一竖一横就一个肘点
 *   - 只有拐点吸 4px 网格，首尾点保持精确贴边（吸格会让线离开边框）
 */
import { snapGrid } from './theme.js';

/** 出线距离：线离开框边后先直走这么远再拐弯。 */
export const OUT = 20;

const SIDES = ['top', 'right', 'bottom', 'left'];

/** 框边中点。 */
export function portPoint(box, side) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (side) {
    case 'top':
      return { x: cx, y: box.y };
    case 'bottom':
      return { x: cx, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: cy };
    case 'right':
      return { x: box.x + box.w, y: cy };
    default:
      throw new Error(`未知端口方向 "${side}"`);
  }
}

/** 端口的外法线方向。 */
function normalOf(side) {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    default:
      throw new Error(`未知端口方向 "${side}"`);
  }
}

const isVertical = (side) => side === 'top' || side === 'bottom';

/**
 * 由两个框的相对位置推断该从哪一侧出、哪一侧进。
 * 与 vsdx-input.js 的 inferPorts 同一套规则（主轴优先），
 * 所以屏幕上看到的接法和导出到 Visio 的接法一致。
 */
export function inferSides(from, to) {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { fromSide: 'bottom', toSide: 'top' }
      : { fromSide: 'top', toSide: 'bottom' };
  }
  return dx >= 0
    ? { fromSide: 'right', toSide: 'left' }
    : { fromSide: 'left', toSide: 'right' };
}

/** 去掉重复点与共线的中间点，避免 SVG 里出现 0 长度的线段。 */
function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (collinear) out.splice(i, 1);
  }
  return out;
}

/** 两个「离开框边的点」之间怎么连。 */
function connect(p1, s1, p2, s2) {
  if (p1.x === p2.x || p1.y === p2.y) return [p1, p2];
  if (isVertical(s1) && isVertical(s2)) {
    const midY = snapGrid((p1.y + p2.y) / 2);
    return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
  }
  if (!isVertical(s1) && !isVertical(s2)) {
    const midX = snapGrid((p1.x + p2.x) / 2);
    return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
  }
  // 一竖一横：单个肘点
  return isVertical(s1)
    ? [p1, { x: p1.x, y: p2.y }, p2]
    : [p1, { x: p2.x, y: p1.y }, p2];
}

/**
 * 给一条边布线。
 *
 * @param {{id?:string,x:number,y:number,w:number,h:number}} from
 * @param {{id?:string,x:number,y:number,w:number,h:number}} to
 * @param {object} [opts]
 * @param {number} [opts.out=OUT] 出线距离
 * @returns {{x:number,y:number}[]} 折线拐点，首点在起点框边上，末点在终点框边上
 */
export function orthogonalRoute(from, to, opts = {}) {
  const out = opts.out ?? OUT;

  // 自连：从右侧出去，绕到框上方再回来。画在框外，不压住自己。
  if (from === to || (from.id && from.id === to.id)) {
    const p0 = portPoint(from, 'right');
    const p5 = portPoint(from, 'top');
    const upY = snapGrid(from.y - out);
    const rightX = snapGrid(from.x + from.w + out);
    return simplify([
      p0,
      { x: rightX, y: p0.y },
      { x: rightX, y: upY },
      { x: p5.x, y: upY },
      p5,
    ]);
  }

  const { fromSide, toSide } = opts.fromSide && opts.toSide
    ? opts
    : inferSides(from, to);

  const p0 = portPoint(from, fromSide);
  const p3 = portPoint(to, toSide);
  const n1 = normalOf(fromSide);
  const n2 = normalOf(toSide);

  const p1 = { x: p0.x + n1.x * out, y: p0.y + n1.y * out };
  const p2 = { x: p3.x + n2.x * out, y: p3.y + n2.y * out };

  // 只把「离开框边的点」吸格；p0/p3 必须精确贴边
  const s1 = { x: snapGrid(p1.x), y: snapGrid(p1.y) };
  const s2 = { x: snapGrid(p2.x), y: snapGrid(p2.y) };

  const mid = connect(s1, fromSide, s2, toSide);
  return simplify([p0, ...mid, p3]);
}

export { SIDES };
