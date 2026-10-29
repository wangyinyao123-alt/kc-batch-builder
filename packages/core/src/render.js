/**
 * 渲染：排版结果 → 自包含的 SVG 字符串。
 *
 * 不用浏览器排版：每个字多宽、每个框多大都在 measure/layout 里算好了，
 * 这里只负责把数字变成图元。因此导出的 SVG 在任何机器上都和屏幕一致。
 *
 * 外观全部来自 spec（由 templates.js 的 resolveSpec 产出）：
 * 节点长什么样查 spec.shape，连线查 spec.edge，颜色查 spec.theme。
 * 这里不出现任何写死的颜色或形状。
 */
import { DEFAULT_SPEC, ceilGrid, titleHeight as calcTitleHeight } from './theme.js';
import { colorOf, shapeOf } from './templates.js';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * @param {object} laid   layout() 的返回值
 * @param {object} spec   resolveSpec() 的返回值
 * @param {object} [opts]
 * @param {string} [opts.title]      页面标题
 * @param {string[]} [opts.diagnostics] 有 error 时在角落标注
 * @returns {string} SVG 源码
 */
export function renderSvg(laid, spec = DEFAULT_SPEC, opts = {}) {
  const t = spec.theme;
  const title = opts.title ?? '';
  // 页面尺寸也守 4px 网格：导出后贴在文档里不会出现半像素错位
  const titleH = calcTitleHeight(spec, Boolean(title));
  const pad = spec.padding;
  const pageW = ceilGrid(laid.width + pad * 2);
  const pageH = ceilGrid(laid.height + pad * 2 + titleH);

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" ` +
      `viewBox="0 0 ${pageW} ${pageH}" role="img" aria-labelledby="dgm-title">`,
  );
  out.push(`<title id="dgm-title">${esc(title || '流程图')}</title>`);
  out.push(`<defs>${arrowMarkers(spec)}</defs>`);
  out.push(`<rect width="${pageW}" height="${pageH}" fill="${t.paper}"/>`);

  if (title) {
    out.push(
      `<text x="${pad}" y="${pad + spec.title.size}" font-family="${esc(spec.fontSerif)}" ` +
        `font-size="${spec.title.size}" font-weight="${spec.title.weight}" fill="${t.ink}">${esc(title)}</text>`,
    );
  }

  out.push(`<g transform="translate(${pad},${pad + titleH})">`);

  // 先画连线，再画节点，保证线被框盖住
  for (const e of laid.edges) out.push(renderEdge(e, spec));

  // 分支标签：先铺一块与纸同色的底，把线切断，再写字
  for (const l of laid.labels) {
    out.push(
      `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="${t.paper}"/>`,
    );
    out.push(
      `<text x="${l.x + l.w / 2}" y="${l.y + l.h / 2}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${esc(isCjk(l.text) ? spec.fontSans : spec.fontMono)}" ` +
        `font-size="${l.size}" font-weight="${isCjk(l.text) ? spec.arrowLabel.cjkWeight : spec.arrowLabel.weight}" ` +
        `fill="${t.muted}">${esc(l.text)}</text>`,
    );
  }

  for (const n of laid.nodes) out.push(renderNode(n, spec));

  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join('\n');
}

function isCjk(text) {
  return /[\u3000-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);
}

/** 箭头样式：triangle 实心三角、open 细描边人字、none 不画箭头。 */
function arrowMarkers(spec) {
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

/** 判断节点的多边形顶点（菱形）。 */
function diamondPoints(n) {
  return [
    [n.cx, n.y],
    [n.x + n.w, n.cy],
    [n.cx, n.y + n.h],
    [n.x, n.cy],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

/** 一个形状的描边宽度：细/中/粗三档里取中档，除非模板给了 stroke.default。 */
function nodeStroke(spec) {
  if (typeof spec.stroke === 'number') return spec.stroke;
  return spec.stroke?.default ?? 1;
}

function renderNode(n, spec) {
  const shape = shapeOf(spec, n.type);
  const fill = colorOf(spec, shape.fill);
  const stroke = colorOf(spec, shape.stroke);
  const textColor = colorOf(spec, shape.text);
  const sw = nodeStroke(spec);
  const parts = [];

  if (shape.kind === 'diamond') {
    parts.push(
      `<polygon points="${diamondPoints(n)}" fill="${fill}" stroke="${stroke}" ` +
        `stroke-width="${sw}" stroke-linejoin="round"/>`,
    );
  } else if (shape.kind === 'pill') {
    // 胶囊：圆角取高度一半，但模板可以用 ovalRadius 压小（如极简模板的直角）
    const r = Math.min(spec.ovalRadius ?? n.h / 2, n.h / 2);
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${r}" ry="${r}" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
    );
  } else {
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${spec.radius.md}" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
    );
  }

  // 文字逐行居中；行高与 measureNode 用的是同一个 lineHeight
  const lh = spec.nodeName.lineHeight;
  const startY = n.cy - ((n.lines.length - 1) * lh) / 2;
  n.lines.forEach((line, i) => {
    parts.push(
      `<text x="${n.cx}" y="${startY + i * lh}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${esc(spec.fontSans)}" font-size="${spec.nodeName.size}" ` +
        `font-weight="${spec.nodeName.weight}" fill="${textColor}">${esc(line)}</text>`,
    );
  });
  return parts.join('\n');
}

function renderEdge(e, spec) {
  const pts = e.points;
  if (!pts || pts.length < 2) return '';
  const color = colorOf(spec, spec.edge.color);
  const width = spec.edge.width ?? nodeStroke(spec);
  const marker = spec.edge.arrow === 'none' ? '' : ' marker-end="url(#arrow)"';
  // 用正交折线（dagre 给的是带拐点的路径），最后一段留出箭头长度
  const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${marker} stroke-linejoin="round"/>`;
}
