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

/**
 * 箭头样式。五种，语义取自 Visio 的 EndArrow 那组：
 *   triangle 实心三角（默认）· open 细描边人字 · diamond 实心菱形
 *   circle 实心圆点 · none 不画箭头
 *
 * 尺寸由 spec.edge.arrowSize 控制。默认 12（原来写死 8）——8px 的实心三角
 * 在 A4 尺寸的图里缩到 50% 就只剩 3px，用户会以为「箭头没画出来」。
 */
export function arrowMarkers(spec) {
  const color = colorOf(spec, spec.edge.color);
  const kind = spec.edge.arrow || 'triangle';
  if (kind === 'none') return '';
  const s = Math.max(4, Number(spec.edge.arrowSize) || 12);
  const half = s / 2;
  let body;
  switch (kind) {
    case 'open':
      body =
        `<path d="M0,0 L${s},${half} L0,${s}" fill="none" stroke="${color}" ` +
        `stroke-width="${Math.max(1, s / 8).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'diamond':
      // 菱形箭头比三角窄一点才不显笨（三角占满 s×s，菱形取 s×0.75s）
      body = `<path d="M0,${half} L${half},${half - s * 0.34} L${s},${half} L${half},${half + s * 0.34} z" fill="${color}"/>`;
      break;
    case 'circle':
      body = `<circle cx="${half}" cy="${half}" r="${s * 0.34}" fill="${color}"/>`;
      break;
    default:
      body = `<path d="M0,0 L${s},${half} L0,${s} z" fill="${color}"/>`;
  }
  return (
    `<marker id="arrow" viewBox="0 0 ${s} ${s}" refX="${s - 1}" refY="${half}" ` +
    `markerWidth="${s}" markerHeight="${s}" orient="auto-start-reverse">${body}</marker>`
  );
}

/**
 * 线型 → SVG 的 stroke-dasharray。
 *
 * 虚线间隔跟着线宽走，否则把线调粗之后虚线还是 4px 一格，密集得像实线。
 * 返回空串表示实线（SVG 里不写这个属性）。
 */
export function dashArray(spec) {
  const kind = spec.edge?.dash || 'solid';
  if (kind === 'none' || kind === 'solid') return '';
  const w = Math.max(0.5, Number(spec.edge.width) || 1);
  if (kind === 'dotted') {
    // 点线：极短的点 + 圆头（stroke-linecap=round 让 0.1 长的段看起来是个圆点）
    return `${(w * 0.1).toFixed(2)} ${(w * 2.6).toFixed(2)}`;
  }
  // 虚线：4 倍线宽一段，空 3 倍
  return `${(w * 4).toFixed(2)} ${(w * 3).toFixed(2)}`;
}

/**
 * 折线转路径。corner = 0 时是严格直角（输出与逐点拼接完全一致），
 * 大于 0 时在每个拐点用二次贝塞尔把尖角磨圆。
 *
 * 为什么不另写一套「曲线」算法：圆角半径给到段长的一半以上就自然变成曲线，
 * 所以「直角 / 圆角 / 曲线」是同一条路径的三个取值，而不是三种模式。
 * 折线段本身仍受最外圈矩形约束，不会因为磨圆而穿出框体。
 */
export function pathData(points, corner = 0) {
  if (!points || points.length < 2) return '';
  const r0 = Number(corner) || 0;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    // 半径不能超过相邻两段长度的一半，否则相邻圆角会互相吞掉，路径折回来
    const r = Math.min(r0, d1 / 2, d2 / 2);
    if (r <= 0.5) {
      d += ` L${p1.x},${p1.y}`;
      continue;
    }
    const ax = p1.x + ((p0.x - p1.x) * r) / d1;
    const ay = p1.y + ((p0.y - p1.y) * r) / d1;
    const bx = p1.x + ((p2.x - p1.x) * r) / d2;
    const by = p1.y + ((p2.y - p1.y) * r) / d2;
    d += ` L${ax},${ay} Q${p1.x},${p1.y} ${bx},${by}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
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
  // 正交折线（dagre 给的是带拐点的路径）；corner > 0 时拐点磨圆
  const d = pathData(pts, spec.edge.corner);
  const dash = dashArray(spec);
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dashAttr}${marker} stroke-linejoin="round" stroke-linecap="round"/>`;
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
