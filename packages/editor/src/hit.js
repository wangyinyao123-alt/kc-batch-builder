/**
 * 命中测试：这个点落在哪个框 / 哪条线上。
 *
 * 为什么单独写而不是用 SVG 的 pointer-events：
 * 1. 命中判定要能单测。用 DOM 的话得开浏览器才知道「点边缘 1px 算不算」。
 * 2. 拖动时高频调用，纯几何比查 DOM 便宜得多。
 * 3. 判断节点是菱形，矩形命中会让人觉得「我明明点在框外面怎么选中了」。
 *
 * 所有坐标都是**世界坐标**，调用方先做一次 toWorld。
 */

/**
 * 点是否在框内。
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number,w:number,h:number}} box
 * @param {number} [slop=0] 容差（向外扩多少），触摸和小目标时有用
 */
export function hitBox(p, box, slop = 0) {
  return (
    p.x >= box.x - slop &&
    p.x <= box.x + box.w + slop &&
    p.y >= box.y - slop &&
    p.y <= box.y + box.h + slop
  );
}

/**
 * 点是否在菱形内（判断节点）。
 * 菱形四顶点是 (cx,y) (x+w,cy) (cx,y+h) (x,cy)。
 * 用 |dx|/hw + |dy|/hh <= 1 判定，比通用的多边形测试快且无浮点歧义。
 */
export function hitDiamond(p, box, slop = 0) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hw = box.w / 2 + slop;
  const hh = box.h / 2 + slop;
  if (hw <= 0 || hh <= 0) return false;
  return Math.abs(p.x - cx) / hw + Math.abs(p.y - cy) / hh <= 1;
}

/** 按节点类型选命中形状。 */
export function hitNode(p, node, slop = 0) {
  return node.type === 'decision' ? hitDiamond(p, node, slop) : hitBox(p, node, slop);
}

/**
 * 点到线段的最短距离。命中连线用。
 */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点到折线的最短距离。 */
export function distToPolyline(p, points) {
  if (!points || points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

/**
 * 找最上面那个被点中的节点。
 *
 * 倒序遍历：nodes 数组的顺序就是绘制顺序，后画的在上面，
 * 所以重叠时应该选中「看起来在上面」的那个。
 *
 * @returns {object|null}
 */
export function pickNode(sceneNodes, p, slop = 0) {
  for (let i = sceneNodes.length - 1; i >= 0; i--) {
    if (hitNode(p, sceneNodes[i], slop)) return sceneNodes[i];
  }
  return null;
}

/**
 * 找被点中的连线。节点优先由调用方决定（先 pickNode 再 pickEdge），
 * 因为「点在线和框的交界处」时用户想选的几乎总是框。
 *
 * @param {object[]} sceneEdges
 * @param {{x:number,y:number}} p
 * @param {number} [tol=6] 容差（世界坐标）。细线不好点，给几像素宽容
 * @returns {object|null}
 */
export function pickEdge(sceneEdges, p, tol = 6) {
  let best = null;
  let bestD = Infinity;
  for (const e of sceneEdges) {
    const d = distToPolyline(p, e.points);
    if (d <= tol && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 找被点中的标签框（双击改标签用）。 */
export function pickLabel(sceneLabels, p, slop = 0) {
  for (let i = sceneLabels.length - 1; i >= 0; i--) {
    if (hitBox(p, sceneLabels[i], slop)) return sceneLabels[i];
  }
  return null;
}

/** 一个节点的四个连接端口（框边中点）。 */
export function portsOf(node) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  return [
    { side: 'top', x: cx, y: node.y },
    { side: 'right', x: node.x + node.w, y: cy },
    { side: 'bottom', x: cx, y: node.y + node.h },
    { side: 'left', x: node.x, y: cy },
  ];
}

/**
 * 离某个点最近的端口（不设半径上限）。
 *
 * 连线时用它决定「接到目标的哪条边」：用户把线拖到目标框的右下角，
 * 接上的就是右边或下边里更近的那条，而不是按两框中心点的方向硬猜。
 */
export function nearestPort(p, node) {
  let best = null;
  let bestD = Infinity;
  for (const port of portsOf(node)) {
    const d = Math.hypot(p.x - port.x, p.y - port.y);
    if (d < bestD) {
      bestD = d;
      best = port;
    }
  }
  return { ...best, dist: bestD };
}

/**
 * 找被点中的连接端口（从框边拉出新线的把手）。
 *
 * 取**半径内最近**的那个，而不是按 top/right/bottom/left 顺序第一个命中：
 * 小框（比如 96×44 的起止）四条边离得很近，按顺序取会让人总觉得
 * 「我点的是下边，怎么从右边出」。
 *
 * @param {{x:number,y:number}} p 世界坐标
 * @param {number} [radius=10] 世界坐标下的可点半径。调用方按 屏幕px / scale 传进来
 */
export function pickPort(p, node, radius = 10) {
  const near = nearestPort(p, node);
  return near.dist <= radius ? near : null;
}

/**
 * 拉线松手/经过时的落点：优先取指针所在的框，没有就返回 null。
 *
 * 判定用**整个框体**而不是端口圆点 —— 用户把线拖到框中间就该接上，
 * 没必要精确压到边上那颗小圆点。落点选哪条边由 nearestPort 决定。
 *
 * @returns {{node:object, side:string, point:{x:number,y:number}}|null}
 */
export function pickDropTarget(sceneNodes, p, fromId = null, slop = 0) {
  for (let i = sceneNodes.length - 1; i >= 0; i--) {
    const n = sceneNodes[i];
    if (n.id === fromId) continue;
    if (hitNode(p, n, slop)) {
      const port = nearestPort(p, n);
      return { node: n, side: port.side, point: { x: port.x, y: port.y } };
    }
  }
  return null;
}

/**
 * 框选：返回与矩形相交的所有节点。
 * 用相交而不是包含 —— 用户从空白处斜拉一个框时，擦到边缘就想选中，
 * 要求完全包住会让人反复拉扯。
 */
export function pickInRect(sceneNodes, rect) {
  const x2 = rect.x + rect.w;
  const y2 = rect.y + rect.h;
  const minX = Math.min(rect.x, x2);
  const minY = Math.min(rect.y, y2);
  const maxX = Math.max(rect.x, x2);
  const maxY = Math.max(rect.y, y2);
  return sceneNodes.filter(
    (n) => n.x < maxX && n.x + n.w > minX && n.y < maxY && n.y + n.h > minY,
  );
}
