/**
 * 画布渲染：把 scene 变成一组 SVG 字符串。
 *
 * 与导出的关系：形状、文字、连线、标签全部复用 core 的 paint.js，
 * 所以「屏上看到的」和「导出的 SVG / PNG / VSDX」用的是同一份绘制代码。
 * 这一层只额外加了一件事：给每个元素包一层带 data-id 的 <g>，
 * 让交互层能定位到具体对象（paint.js 只管画，不管交互）。
 */
import { renderEdge, renderLabel, renderShape, renderNodeText } from '../../core/src/paint.js';
import { SIDES } from '../../core/src/route.js';
import { OUT, portPoint } from '../../core/src/route.js';

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
  const { selected = false, hovered = false, showPorts = false } = opts;
  const shape = renderShape(n, spec);
  const text = renderNodeText(n, spec);
  const cls = ['node', selected ? 'node-selected' : '', hovered ? 'node-hover' : '']
    .filter(Boolean)
    .join(' ');

  const ports = SIDES.map((side) => {
    const p = portPoint(n, side);
    const visible = selected || hovered || showPorts;
    return (
      `<circle class="port${visible ? ' visible' : ''}" data-port="${side}" data-node="${n.id}" ` +
      `cx="${p.x}" cy="${p.y}" r="5"/>`
    );
  }).join('');

  return wrap(`data-node-group="${n.id}" class="${cls}"`, shape + text + ports);
}

/**
 * 正在拉的那根「橡皮筋」：从端口到鼠标。
 * 用虚线直角折线，让人提前看出接上后会怎么走。
 */
export function rubberSvg(from, to, side) {
  const p0 = portPoint(from, side);
  const vertical = side === 'top' || side === 'bottom';
  const p1 = vertical
    ? { x: p0.x, y: p0.y + (side === 'bottom' ? OUT : -OUT) }
    : { x: p0.x + (side === 'right' ? OUT : -OUT), y: p0.y };
  const d = vertical
    ? `M${p0.x},${p0.y} L${p1.x},${p1.y} L${p1.x},${to.y} L${to.x},${to.y}`
    : `M${p0.x},${p0.y} L${p1.x},${p1.y} L${to.x},${p1.y} L${to.x},${to.y}`;
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
