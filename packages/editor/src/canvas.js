/**
 * 画布渲染：把 scene 变成一组 SVG 字符串。
 *
 * 与导出的关系：形状、文字、连线、标签全部复用 core 的 paint.js，
 * 所以「屏上看到的」和「导出的 SVG / PNG / VSDX」用的是同一份绘制代码。
 * 这一层只额外加了一件事：给每个元素包一层带 data-id 的 <g>，
 * 让交互层能定位到具体对象（paint.js 只管画，不管交互）。
 */
import { renderEdge, renderLabel, renderShape, renderNodeText } from '../../core/src/paint.js';
import { SIDES, portPoint, orthogonalRoute } from '../../core/src/route.js';

/** 让 shape 与文字成为同一个可定位单元。 */
function wrap(attrs, body) {
  return `<g ${attrs}>${body}</g>`;
}

/** 连线：可见路径 + 一条加宽的透明「命中带」，细线才好点。 */
export function edgeSvg(e, spec, selected = false) {
  const d = 'M' + e.points.map((p) => `${p.x},${p.y}`).join(' L');
  const hit = `<path d="${d}" class="edge-hit" data-edge="${e.id}"/>`;
  const visible = renderEdge({ ...e, points: e.points }, spec).replace(
    '<path ',
    `<path data-edge-path="${e.id}" class="${selected ? 'edge-selected' : ''}" `,
  );
  return wrap(`data-edge-group="${e.id}"`, hit + visible);
}

/** 标签。 */
export function labelSvg(l, spec, selected = false) {
  const body = renderLabel(l, spec);
  return wrap(
    `data-label-group="${l.edgeId}" class="label-hit"${selected ? ' data-selected="1"' : ''}`,
    body,
  );
}

/**
 * 节点：形状 + 文字 + 四个连接端口。
 * 端口平时透明（opacity 0），鼠标移到节点上或选中时才显形 ——
 * 一直画着四个小圆点会让整张图显脏。
 */
export function nodeSvg(n, spec, opts = {}) {
  const {
    selected = false,
    hovered = false,
    showPorts = false,
    dropSide = null,
  } = opts;
  const shape = renderShape(n, spec);
  const text = renderNodeText(n, spec);
  const cls = [
    'node',
    selected ? 'node-selected' : '',
    hovered ? 'node-hover' : '',
    dropSide ? 'node-drop' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const ports = SIDES.map((side) => {
    const p = portPoint(n, side);
    // 被瞄准的那条边放大并高亮：拖线过来时能看清会接在哪
    const armed = dropSide === side;
    const visible = selected || hovered || showPorts || Boolean(dropSide);
    return (
      `<circle class="port${visible ? ' visible' : ''}${armed ? ' armed' : ''}" ` +
      `data-port="${side}" data-node="${n.id}" ` +
      `cx="${p.x}" cy="${p.y}" r="${armed ? 7 : 5}"/>`
    );
  }).join('');

  return wrap(`data-node-group="${n.id}" class="${cls}"`, shape + text + ports);
}

/**
 * 正在拉的那根「橡皮筋」：从起点端口到指针。
 *
 * 用 core 的正交路由画，而不是手写三段折线 —— 这样橡皮筋的拐法
 * 和松手后真实连线一模一样，拖的时候就能看出会不会绕一圈。
 *
 * 已瞄准某个框的端口时，终点吸附到那个端口并画成实线，
 * 表示「松手就是这个结果」。
 */
export function rubberSvg(from, to, side, opts = {}) {
  const { dropNode = null, dropSide = null } = opts;

  if (dropNode && dropSide) {
    const pts = orthogonalRoute(from, dropNode, { fromSide: side, toSide: dropSide });
    const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
    return `<path class="rubber armed" d="${d}"/>`;
  }

  // 还没瞄准目标：把指针当成零尺寸虚拟框，复用同一套路由
  const ghost = { x: to.x, y: to.y, w: 0, h: 0 };
  const pts = orthogonalRoute(from, ghost, { fromSide: side });
  const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
  return `<path class="rubber" d="${d}"/>`;
}

/** 对齐参考线（拖动时出现）。 */
export function guidesSvg(guides, bounds, span = 4000) {
  const parts = [];
  for (const x of guides.x) {
    parts.push(`<line class="guide" x1="${x}" y1="${bounds.y - span}" x2="${x}" y2="${bounds.y + bounds.h + span}"/>`);
  }
  for (const y of guides.y) {
    parts.push(`<line class="guide" x1="${bounds.x - span}" y1="${y}" x2="${bounds.x + bounds.w + span}" y2="${y}"/>`);
  }
  return parts.join('');
}

/** 框选矩形。 */
export function marqueeSvg(rect) {
  return (
    `<rect class="marquee" x="${Math.min(rect.x, rect.x + rect.w)}" y="${Math.min(rect.y, rect.y + rect.h)}" ` +
    `width="${Math.abs(rect.w)}" height="${Math.abs(rect.h)}"/>`
  );
}
