/**
 * 排版结果 → vsdx 导出器的输入。
 *
 * `tools/vsdx-export` 是 CommonJS 且只依赖 ts-visio，它需要的是
 * 「像素坐标系 + 每个节点的框 + 每条连线的端口」，而不是本包的内部结构。
 * 这里做唯一一处转换，避免导出器自己再猜尺寸。
 *
 * 端口约定：vsdx 的形状按 StandardConnectionPoints.cardinal 建，
 * 连接点名字是 Top / Right / Bottom / Left。
 */

import { colorOf, shapeOf } from './templates.js';

/** 画布上的小写端口名 → vsdx 连接点名。 */
const SIDE_TO_PORT = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/**
 * 由两个框的相对位置推出连线该从哪一侧出去、从哪一侧进来。
 * 规则与 dagre 的正交路由一致：主要沿 y 走就用上下，否则用左右。
 */
export function inferPorts(from, to) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0 ? { fromPort: 'Bottom', toPort: 'Top' } : { fromPort: 'Top', toPort: 'Bottom' };
  }
  return dx >= 0 ? { fromPort: 'Right', toPort: 'Left' } : { fromPort: 'Left', toPort: 'Right' };
}

/**
 * @param {object} laid   layout() 的返回值
 * @param {object} spec   resolveSpec() 的返回值
 * @param {object} [opts]
 * @param {number} [opts.padding] 页面留白（与 SVG 导出保持同一个数）
 * @param {number} [opts.titleHeight] 标题占的高度
 * @returns {{ nodes: object[], edges: object[], labels: object[], meta: { pageW: number, pageH: number } }}
 */
export function toVsdxInput(laid, spec, opts = {}) {
  const padding = opts.padding ?? spec.padding;
  const titleHeight = opts.titleHeight ?? 0;

  // 每个节点带上自己的外观：模板里「起止反白实心、判断淡底」这类差异
  // 必须一路传到 vsdx，否则导出后所有形状是同一个填充色，模板等于白做。
  const nodes = laid.nodes.map((n) => {
    const sh = shapeOf(spec, n.type);
    return {
      id: n.id,
      type: n.type,
      text: n.text,
      x: n.x + padding,
      y: n.y + padding + titleHeight,
      w: n.w,
      h: n.h,
      style: {
        shape: sh.kind,
        fillColor: colorOf(spec, sh.fill),
        lineColor: colorOf(spec, sh.stroke),
        fontColor: colorOf(spec, sh.text),
        lineWeightPt: pxToPt(spec.stroke?.default ?? 1),
        // 胶囊用半高做圆角；矩形用模板的 md 圆角；菱形忽略圆角
        cornerRadiusPx: sh.kind === 'pill' ? n.h / 2 : spec.radius?.md ?? 6,
      },
    };
  });

  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const labels = (laid.labels || []).map((l) => ({
    text: l.text,
    x: l.x + padding,
    y: l.y + padding + titleHeight,
    w: l.w,
    h: l.h,
    style: {
      fillColor: spec.theme.paper,
      lineColor: spec.theme.paper, // 与纸同色 = 视觉上无边框
      fontColor: spec.theme.muted,
    },
  }));

  const edges = [];
  for (const e of laid.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    // 用户在画布上指定过端口就跟用户走，否则按位置推断。
    // 两边不一致的话，「屏幕上从左边出、导出后从下边出」这种问题会很难查。
    const guessed = inferPorts(from, to);
    const fromPort = SIDE_TO_PORT[e.fromSide] || guessed.fromPort;
    const toPort = SIDE_TO_PORT[e.toSide] || guessed.toPort;
    edges.push({
      from: e.from,
      to: e.to,
      label: e.label,
      kind: e.kind,
      fromPort,
      toPort,
      style: {
        lineColor: colorOf(spec, spec.edge?.color || 'muted'),
        lineWeightPt: pxToPt(spec.edge?.width ?? spec.stroke?.default ?? 1),
        // vsdx 只有「有箭头 / 没箭头」两档，没有尺寸档（ts-visio 把
        // EndArrowSize 写死成 2 = 大号）。所以只把「关掉箭头」传下去。
        arrow: spec.edge?.arrow ?? 'triangle',
        // 线型交给导出器翻成 Visio 的 LinePattern 编号
        dash: spec.edge?.dash ?? 'solid',
      },
    });
  }

  return {
    nodes,
    edges,
    labels,
    meta: {
      pageW: laid.width + padding * 2,
      pageH: laid.height + padding * 2 + titleHeight,
    },
  };
}

/**
 * 字体与描边参数 → vsdx 的主题对象（vsdx 用 pt，SVG 用 px）。
 *
 * 这里的 fill/line/font 只是兜底值：每个节点在自己的 style 里覆盖它们。
 */
export function toVsdxTheme(spec) {
  const t = spec.theme;
  const shape = shapeOf(spec, 'process');
  return {
    fontFamily: 'PingFang SC',
    fontSize: pxToPt(spec.nodeName.size),
    fillColor: colorOf(spec, shape.fill),
    lineColor: colorOf(spec, shape.stroke),
    fontColor: colorOf(spec, shape.text),
    lineWeightPt: spec.stroke.default,
    cornerRadiusPx: spec.radius.md,
    paperColor: t.paper,
  };
}

/** 96dpi 下 1pt = 96/72 px；反过来 px * 72/96。 */
export const pxToPt = (px) => (px * 72) / 96;
