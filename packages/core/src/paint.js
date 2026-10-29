/**
 * 图元绘制：把一个节点 / 一条边 / 一个标签画成 SVG 字符串。
 *
 * 为什么单独拆出来：编辑器画布要「逐个元素」重画（拖一个节点只重画这一个），
 * 而导出的 SVG 要「整张一次画完」。两者如果各写一份绘制代码，早晚会不一样——
 * 屏幕上看着对，导出后错位。所以绘制只有这一份实现，两处共用。
 *
 * 这里不碰 DOM，也不碰浏览器 API，纯字符串。
 */
import { colorOf, shapeOf } from './templates.js';

export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function isCjk(text) {
  return /[\u3000-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);
}

/** 箭头样式：triangle 实心三角、open 细描边人字、none 不画箭头。 */
export function arrowMarkers(spec) {
  const color = colorOf(spec, spec.edge.color);
  const kind = spec.edge.arrow || 'triangle';
  if (kind === 'none') return '';
  const body =
    kind === 'open'
      ? `<path d="M0,0 L8,4 L0,8" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M0,0 L8,4 L0,8 z" fill="${color}"/>`;
  return (
    `<marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" ` +
    `markerWidth="8" markerHeight="8" orient="auto-start-reverse">${body}</marker>`
  );
}

/** 一个形状的描边宽度：细/中/粗三档里取中档，除非模板给了 stroke.default。 */
export function nodeStroke(spec) {
  if (typeof spec.stroke === 'number') return spec.stroke;
  return spec.stroke?.default ?? 1;
}

/** 判断节点的多边形顶点（菱形）。 */
export function diamondPoints(n) {
  return [
    [n.cx, n.y],
    [n.x + n.w, n.cy],
    [n.cx, n.y + n.h],
    [n.x, n.cy],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

/** 形状本体（不含文字）。编辑器做命中高亮时单独用它。 */
export function renderShape(n, spec) {
  const shape = shapeOf(spec, n.type);
  const fill = colorOf(spec, shape.fill);
  const stroke = colorOf(spec, shape.stroke);
  const sw = nodeStroke(spec);

  if (shape.kind === 'diamond') {
    return (
      `<polygon points="${diamondPoints(n)}" fill="${fill}" stroke="${stroke}" ` +
      `stroke-width="${sw}" stroke-linejoin="round"/>`
    );
  }
  if (shape.kind === 'pill') {
    // 胶囊：圆角取高度一半，但模板可以用 ovalRadius 压小（如极简模板的直角）
    const r = Math.min(spec.ovalRadius ?? n.h / 2, n.h / 2);
    return (
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${r}" ry="${r}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
    );
  }
  return (
    `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${spec.radius.md}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  );
}

/** 节点文字（逐行居中，行高与 measureNode 用的是同一个 lineHeight）。 */
export function renderNodeText(n, spec) {
  const shape = shapeOf(spec, n.type);
  const textColor = colorOf(spec, shape.text);
  const lh = spec.nodeName.lineHeight;
  const startY = n.cy - ((n.lines.length - 1) * lh) / 2;
  const parts = [];
  n.lines.forEach((line, i) => {
    parts.push(
      `<text x="${n.cx}" y="${startY + i * lh}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${esc(spec.fontSans)}" font-size="${spec.nodeName.size}" ` +
        `font-weight="${spec.nodeName.weight}" fill="${textColor}">${esc(line)}</text>`,
    );
  });
  return parts.join('\n');
}

export function renderNode(n, spec) {
  return [renderShape(n, spec), renderNodeText(n, spec)].join('\n');
}

export function renderEdge(e, spec) {
  const pts = e.points;
  if (!pts || pts.length < 2) return '';
  const color = colorOf(spec, spec.edge.color);
  const width = spec.edge.width ?? nodeStroke(spec);
  const marker = spec.edge.arrow === 'none' ? '' : ' marker-end="url(#arrow)"';
  // 用正交折线（dagre 给的是带拐点的路径）
  const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${marker} stroke-linejoin="round"/>`;
}

/** 分支标签：先铺一块与纸同色的底把线切断，再写字。 */
export function renderLabel(l, spec) {
  const t = spec.theme;
  return (
    `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="${t.paper}"/>\n` +
    `<text x="${l.x + l.w / 2}" y="${l.y + l.h / 2}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${esc(isCjk(l.text) ? spec.fontSans : spec.fontMono)}" ` +
    `font-size="${l.size}" font-weight="${isCjk(l.text) ? spec.arrowLabel.cjkWeight : spec.arrowLabel.weight}" ` +
    `fill="${t.muted}">${esc(l.text)}</text>`
  );
}
