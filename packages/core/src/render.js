/**
 * 渲染：排版结果 → 自包含的 SVG 字符串。
 *
 * 不用浏览器排版：每个字多宽、每个框多大都在 measure/layout 里算好了，
 * 这里只负责把数字变成图元。因此导出的 SVG 在任何机器上都和屏幕一致。
 *
 * 外观全部来自 spec（由 templates.js 的 resolveSpec 产出）：
 * 节点长什么样查 spec.shape，连线查 spec.edge，颜色查 spec.theme。
 * 这里不出现任何写死的颜色或形状。
 *
 * 图元绘制在 paint.js —— 编辑器画布也用那一份，保证屏幕与导出完全一致。
 */
import { DEFAULT_SPEC, ceilGrid, titleHeight as calcTitleHeight } from './theme.js';
import { arrowMarkers, esc, renderEdge, renderLabel, renderNode } from './paint.js';

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

  // 分支标签：铺底把线切断后写字
  for (const l of laid.labels) out.push(renderLabel(l, spec));

  for (const n of laid.nodes) out.push(renderNode(n, spec));

  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join('\n');
}
