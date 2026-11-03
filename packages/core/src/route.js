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

/**
 * 去掉重复点与共线的中间点，避免 SVG 里出现 0 长度的线段。
 *
 * 必须反复做到稳定为止：删掉一个共线点后，它两侧的点可能刚刚好重合，
 * 于是又冒出一个重复点。只扫一遍会留下 `L300,348 L300,348` 这种
 * 自相矛盾的路径段。
 */
function simplify(points) {
  let out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = out.length - 2; i > 0; i--) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      const collinear =
        (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      const duplicate = (a.x === b.x && a.y === b.y) || (b.x === c.x && b.y === c.y);
      if (collinear || duplicate) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * 出线点只沿法线方向吸格，另一轴保持与端口完全对齐。
 *
 * 两轴都吸会出事：端口中线在 y=102（不是 4 的倍数），吸格成 104 之后
 * 第一段就成了斜线 —— 正交路由里冒出斜线段，看起来像画歪了。
 */
function snapOut(p, side) {
  return isVertical(side)
    ? { x: p.x, y: snapGrid(p.y) }
    : { x: snapGrid(p.x), y: p.y };
}

const EDGE_PAD = 2;

/** 一条轴对齐线段是否穿过了某个框（内缩 pad，贴着边走不算穿）。 */
function segHitsBox(a, b, box, pad = EDGE_PAD) {
  const x1 = box.x + pad;
  const x2 = box.x + box.w - pad;
  const y1 = box.y + pad;
  const y2 = box.y + box.h - pad;

  if (a.x === b.x) {
    if (a.x <= x1 || a.x >= x2) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi > y1 && lo < y2;
  }
  if (a.y === b.y) {
    if (a.y <= y1 || a.y >= y2) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi > x1 && lo < x2;
  }
  // 斜线一律当作「穿过了」：正交路由里不该出现斜线
  return true;
}

/** 整条折线是否完全不穿过给定的框。 */
function routeIsClean(pts, boxes) {
  const list = boxes.filter(Boolean);
  for (let i = 0; i < pts.length - 1; i++) {
    for (const box of list) {
      if (segHitsBox(pts[i], pts[i + 1], box)) return false;
    }
  }
  return true;
}

/** 第一段是否沿法线朝外走（而不是原地折回压住自己的框）。 */
function exitsForward(p1, p2, side) {
  const n = normalOf(side);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * n.x + dy * n.y >= 0;
}

/**
 * 把「拐点位置」夹在一段正数区间里。
 *
 * 为什么必须夹：拐点越过两端就会让线折回去，画出来是一个套子。
 * 留 BEND_KEEP 的余量，保证拐点离两端端口至少还有一小段直线，
 * 否则拐点贴着端口时圆角会把整段吃掉，看着像「线没接上」。
 */
const BEND_KEEP = 8;

function clampBend(base, a, b) {
  const lo = Math.min(a, b) + BEND_KEEP;
  const hi = Math.max(a, b) - BEND_KEEP;
  if (hi < lo) return base; // 两端太近，没有可调空间
  return snapGrid(Math.min(Math.max(base, lo), hi));
}

/**
 * 两个「离开框边的点」之间怎么连。
 *
 * @param {object} p1 出线点（起点框外 out 处）
 * @param {string} s1 出口方向
 * @param {object} p2 入线点（终点框外 out 处）
 * @param {string} s2 入口方向
 * @param {object[]} boxes 需要避让的两个框
 * @param {number} [bend=0] 拐点偏移（px）。0 = 正中间，正负把并线段往两端推。
 */
function connect(p1, s1, p2, s2, boxes = [], bend = 0) {
  if (p1.x === p2.x || p1.y === p2.y) return [p1, p2];

  // 两竖 → 中间高度横向并线；两横 → 中间宽度纵向并线。
  // bend 让用户能把这条并线段往上/往下挪 —— 默认在中点，但两个框
  // 之间有别的图形、或者想让几根线分开走时，中点往往不是想要的位置。
  if (isVertical(s1) && isVertical(s2)) {
    const midY = clampBend(snapGrid((p1.y + p2.y) / 2) + bend, p1.y, p2.y);
    return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
  }
  if (!isVertical(s1) && !isVertical(s2)) {
    const midX = clampBend(snapGrid((p1.x + p2.x) / 2) + bend, p1.x, p2.x);
    return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
  }

  // 一竖一横：有两种肘点摆法，挑一条既不折返、又不穿过框的
  const verticalFirst = [p1, { x: p1.x, y: p2.y }, p2];
  const horizontalFirst = [p1, { x: p2.x, y: p1.y }, p2];

  const ok = (route) =>
    exitsForward(p1, route[1], s1) && routeIsClean(route, boxes);

  if (ok(verticalFirst)) return verticalFirst;
  if (ok(horizontalFirst)) return horizontalFirst;

  // 两种单肘都不行（目标在斜后方）：先沿法线走出去，再从两框之间横穿。
  // 中间那条线要放在两个框之外，才不会压在框体上。
  if (isVertical(s1)) {
    const outward = p1.y + (normalOf(s1).y > 0 ? Math.max(0, p2.y - p1.y) : Math.min(0, p2.y - p1.y));
    const midY = snapGrid(Math.abs(p2.y - p1.y) < 1 ? p1.y : outward);
    return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
  }
  const outwardX = p1.x + (normalOf(s1).x > 0 ? Math.max(0, p2.x - p1.x) : Math.min(0, p2.x - p1.x));
  const midX = snapGrid(Math.abs(p2.x - p1.x) < 1 ? p1.x : outwardX);
  return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
}

/**
 * 给一条边布线。
 *
 * @param {{id?:string,x:number,y:number,w:number,h:number}} from
 * @param {{id?:string,x:number,y:number,w:number,h:number}} to
 * @param {object} [opts]
 * @param {number} [opts.out=OUT] 出线距离
 * @param {number} [opts.bend=0] 拐点偏移（px）。只在「两竖」或「两横」的
 *   并线段上生效 —— 也就是两个框不在同一水平线/竖直线、中间必须横着
 *   （或竖着）走一段的那种连接。0 是正中间，正负把这段往两端推。
 *   一竖一横的单肘连接只有一个拐点，位置由两个端口唯一确定，
 *   没有可调空间，此时 bend 被忽略。
 * @returns {{x:number,y:number}[]} 折线拐点，首点在起点框边上，末点在终点框边上
 */
export function orthogonalRoute(from, to, opts = {}) {
  const out = opts.out ?? OUT;
  const bend = Number(opts.bend) || 0;

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

  // 允许只指定一端：另一端仍按位置推断。编辑器的连线可能只记了出口。
  const inferred = inferSides(from, to);
  const fromSide = opts.fromSide || inferred.fromSide;
  const toSide = opts.toSide || inferred.toSide;

  const p0 = portPoint(from, fromSide);
  const p3 = portPoint(to, toSide);
  const n1 = normalOf(fromSide);
  const n2 = normalOf(toSide);

  const p1 = { x: p0.x + n1.x * out, y: p0.y + n1.y * out };
  const p2 = { x: p3.x + n2.x * out, y: p3.y + n2.y * out };

  // 只把「离开框边的点」吸格；p0/p3 必须精确贴边
  const s1 = snapOut(p1, fromSide);
  const s2 = snapOut(p2, toSide);

  const mid = connect(s1, fromSide, s2, toSide, [from, to], bend);
  return simplify([p0, ...mid, p3]);
}

export { SIDES };
