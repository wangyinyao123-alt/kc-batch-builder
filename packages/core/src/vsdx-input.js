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

  const nodes = laid.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    text: n.text,
    x: n.x + padding,
    y: n.y + padding + titleHeight,
    w: n.w,
    h: n.h,
  }));

  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const labels = (laid.labels || []).map((l) => ({
    text: l.text,
    x: l.x + padding,
    y: l.y + padding + titleHeight,
    w: l.w,
    h: l.h,
  }));

  const edges = [];
  for (const e of laid.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    const { fromPort, toPort } = inferPorts(from, to);
    edges.push({
      from: e.from,
      to: e.to,
      label: e.label,
      kind: e.kind,
      fromPort,
      toPort,
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

/** 字体与描边参数 → vsdx 的主题对象（vsdx 用 pt，SVG 用 px）。 */
export function toVsdxTheme(spec) {
  const t = spec.theme;
  return {
    fontFamily: 'PingFang SC',
    fontSize: pxToPt(spec.nodeName.size),
    fillColor: t.paper,
    lineColor: t.ink,
    fontColor: t.ink,
    lineWeightPt: spec.stroke.default,
    cornerRadiusPx: spec.radius.md,
  };
}

/** 96dpi 下 1pt = 96/72 px；反过来 px * 72/96。 */
export const pxToPt = (px) => (px * 72) / 96;
