/**
 * 排版：图数据 → 每个节点的坐标与尺寸、每条连线的路径点。
 *
 * 为什么要自己算尺寸而不是让 dagre 猜：dagre 只接受给定的 w/h。
 * 尺寸必须来自文字度量（measure.js），否则导出 SVG 后文字一定溢出。
 */
import dagre from '@dagrejs/dagre';
import { measureBlock, textWidth } from './measure.js';
import { DEFAULT_SPEC, ceilGrid, snapGrid } from './theme.js';

const NODE_TEXT_MAX = 200;

/**
 * 宽度安全系数。
 *
 * widths.js 用的是 Arial 的实测字宽，但页面上真正渲染的是字体栈
 * （Geist → PingFang / Noto Sans TC）。在 macOS + Chrome 实测，同一串文字
 * 用字体栈渲染比 Arial 宽的最差情况是 +3.6%（字重 600 的数字与带空格的西文：
 * `1234567890` 69.16 vs 66.74、`a b c` 28.81 vs 27.35；汉字完全一致）。
 * 折行阈值按 1.06 倍收缩，框宽按 1.06 倍放大：文字最宽的一行也留得下 8px 边距。
 */
const FONT_SAFETY = 1.06;

/**
 * 估出一个节点的框尺寸。尺寸全部对齐 4px 网格。
 * @returns {{ w: number, h: number, lines: string[] }}
 */
export function measureNode(node, spec = DEFAULT_SPEC) {
  const t = spec.nodeName;
  const theme = spec.theme || {};
  void theme;
  const g = spec.lineHeightRatio;

  if (node.type === 'decision') {
    // 菱形：文字要装进内接区域，实际需要比文字宽 1.6~2 倍
    const maxTextWidth = g.decision.maxTextWidth / FONT_SAFETY;
    const m = measureBlock(node.text, maxTextWidth, t.size, t.lineHeight);
    const w = Math.max(ceilGrid(m.width * FONT_SAFETY * g.decision.aspect + 32), 128);
    const h = Math.max(ceilGrid(m.height * 1.7 + 24), 80);
    return { w: ceilGrid(w), h: ceilGrid(h), lines: m.lines };
  }

  if (node.type === 'start' || node.type === 'end') {
    const m = measureBlock(node.text, NODE_TEXT_MAX / FONT_SAFETY, t.size, t.lineHeight);
    const w = ceilGrid(Math.max(m.width * FONT_SAFETY + g.terminal.padX, g.terminal.minW));
    const h = ceilGrid(Math.max(m.height + g.terminal.padY, 44));
    return { w, h, lines: m.lines };
  }

  // process / note
  const m = measureBlock(node.text, NODE_TEXT_MAX / FONT_SAFETY, t.size, t.lineHeight);
  const w = ceilGrid(Math.max(m.width * FONT_SAFETY + g.process.padX, g.process.minW));
  const h = ceilGrid(Math.max(m.height + g.process.padY, spec.minRowHeight));
  return { w, h, lines: m.lines };
}

/**
 * 对整张图排版。
 *
 * @param {import('./ir.js').Diagram} diagram
 * @param {object} spec  由 resolveSpec() 得到的绘制参数
 * @param {object} [opts]
 * @param {'TB'|'LR'} [opts.direction='TB']
 * @param {number} [opts.nodeGap=40]  nodesep
 * @param {number} [opts.rankGap=56]  ranksep
 * @returns {{ nodes: object[], edges: object[], labels: object[], width: number, height: number }}
 */
export function layout(diagram, spec = DEFAULT_SPEC, opts = {}) {
  const direction = opts.direction || 'TB';
  const nodesep = opts.nodeGap ?? 40;
  const ranksep = opts.rankGap ?? 56;

  const sized = new Map();
  for (const n of diagram.nodes) {
    sized.set(n.id, measureNode(n, spec));
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep, ranksep, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of diagram.nodes) {
    const s = sized.get(n.id);
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  diagram.edges.forEach((e, i) => {
    if (!sized.has(e.from) || !sized.has(e.to)) return;
    g.setEdge(e.from, e.to, {}, `e${i}`);
  });

  dagre.layout(g);

  const outNodes = diagram.nodes.map((n) => {
    const s = sized.get(n.id);
    const dn = g.node(n.id);
    // dagre 给的是中心点，IR 用左上角
    const x = snapGrid(dn.x - s.w / 2);
    const y = snapGrid(dn.y - s.h / 2);
    return {
      ...n,
      x,
      y,
      w: s.w,
      h: s.h,
      lines: s.lines,
      cx: x + s.w / 2,
      cy: y + s.h / 2,
    };
  });

  const byId = new Map(outNodes.map((n) => [n.id, n]));

  const outEdges = [];
  const outLabels = [];
  diagram.edges.forEach((e, i) => {
    const de = g.edge(e.from, e.to, `e${i}`);
    if (!de) return;
    const points = de.points.map((p) => ({ x: snapGrid(p.x), y: snapGrid(p.y) }));
    const from = byId.get(e.from);
    const to = byId.get(e.to);

    const rendered = {
      ...e,
      points,
      fromType: from?.type,
      toType: to?.type,
      // 分支标签：放在路径总长的某个比例处，避开两端
      labelBox: null,
    };

    if (e.label) {
      const box = placeLabel(e.label, points, spec);
      rendered.labelBox = box;
      outLabels.push({ ...box, text: e.label, edgeIndex: outEdges.length });
    }
    outEdges.push(rendered);
  });

  // 分支标签和连线本身可能撑出节点包围盒，必须一起算，否则页面会切掉它们
  const bounds = computeBounds(outNodes, outEdges, outLabels);
  const dx = -bounds.minX;
  const dy = -bounds.minY;
  if (dx !== 0 || dy !== 0) {
    for (const n of outNodes) {
      n.x += dx;
      n.y += dy;
      n.cx += dx;
      n.cy += dy;
    }
    for (const e of outEdges) {
      e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    for (const l of outLabels) {
      l.x += dx;
      l.y += dy;
    }
  }

  return {
    nodes: outNodes,
    edges: outEdges,
    labels: outLabels,
    width: ceilGrid(bounds.width),
    height: ceilGrid(bounds.height),
    bounds: { ...bounds, minX: 0, minY: 0 },
  };
}

/**
 * 分支标签的位置：取路径 40% 处，并把标签框向左/右挪开连线。
 */
function placeLabel(text, points, spec) {
  if (points.length < 2) return null;
  const a = spec.arrowLabel;
  const size = isCjk(text) ? a.cjkSize : a.size;
  // 汉字在 8px 等宽槽位里不可读，切到 12px 无衬线；宽度按 1em/全角、0.6em/半角估
  const w = ceilGrid(textWidth(text, size) + 12);
  const h = ceilGrid(size * 1.5 + 8);

  const at = pointAtRatio(points, 0.42);
  const isVertical =
    Math.abs(points.at(-1).y - points[0].y) > Math.abs(points.at(-1).x - points[0].x);
  // 竖排连线：标签放在线的右侧并留 6px 间隙，绝不压线；
  // 横排连线：放在线的上方。这样标签不需要靠底色去切断连线。
  const x = snapGrid(isVertical ? at.x + 6 : at.x - w / 2);
  const y = snapGrid(isVertical ? at.y - h / 2 : at.y - h - 4);
  return { x, y, w, h, size };
}

function isCjk(text) {
  return /[\u3000-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);
}

/** 折线上按长度比例取点。 */
function pointAtRatio(points, ratio) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.hypot(dx, dy);
    segs.push({ i, len });
    total += len;
  }
  if (total === 0) return points[0];
  let target = total * ratio;
  for (const s of segs) {
    if (target <= s.len) {
      const p0 = points[s.i - 1];
      const p1 = points[s.i];
      const k = s.len === 0 ? 0 : target / s.len;
      return { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k };
    }
    target -= s.len;
  }
  return points.at(-1);
}

function computeBounds(nodes, edges = [], labels = []) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0, minX: 0, minY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const n of nodes) {
    take(n.x, n.y);
    take(n.x + n.w, n.y + n.h);
  }
  for (const e of edges) for (const p of e.points) take(p.x, p.y);
  for (const l of labels) {
    take(l.x, l.y);
    take(l.x + l.w, l.y + l.h);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY, x: minX, y: minY };
}
