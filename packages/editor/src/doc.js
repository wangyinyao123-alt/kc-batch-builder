/**
 * 编辑器文档模型：可编辑的图，坐标与文字都在这里。
 *
 * ## 为什么不直接改 IR
 * IR（ir.js）里 `node.id` 就是解析出的节点名 —— 这是给「文本 → 图」这条单向路用的，
 * 同名即同一节点，很省事。但一旦要编辑，它就变成陷阱：
 * 把「回零」改成「归零」，id 跟着变，所有指向它的连线立刻全断。
 *
 * 所以编辑器另立一套文档：**id 是稳定的流水号（n1、n2…），文字是文字**。
 * 改名只改 text，连线一根都不动。这也是 undo 能可靠回滚的前提 ——
 * 快照里存的 id 永远指向同一个东西，不会因为文本变了而失配。
 *
 * ## 约定
 * - 所有操作都是纯函数：接收 doc 返回**新的** doc，绝不原地改。撤销栈靠这个才能成立。
 * - 尺寸不存在文档里。框多大由文字算（measure.js），文档只存左上角 x/y。
 *   否则改了字号模板，存的尺寸就成了错的。
 */
import { measureNode } from '../../core/src/layout.js';
import { DEFAULT_SPEC, snapGrid } from '../../core/src/theme.js';

export const DOC_VERSION = 1;

/**
 * 连线外观的可调项。
 *
 * 存在文档里而不是界面上：这是「这张图怎么画的」的一部分，
 * 和模板/配色同级 —— 换了机器打开、导出 SVG，粗细和圆角必须跟着走。
 * 每项用 null 表示「沿用模板」，而不是抄一份模板的值存进来，
 * 否则换模板后线条样式会卡在旧值上。
 */
export const EDGE_STYLE_KEYS = ['width', 'corner', 'arrowSize'];

/** 新建一份空文档。 */
export function emptyDoc(title = '') {
  return {
    version: DOC_VERSION,
    title,
    template: 'default',
    // 空字符串 = 用模板自带的配色。非空时覆盖模板配色，
    // 于是「模板（形状/字号/间距）」和「配色」是两个独立维度。
    palette: '',
    // 连线外观覆盖项（null = 用模板的）。只存用户真改过的那几项。
    edge: {},
    nodes: [],
    edges: [],
  };
}

const clone = (doc) => ({
  ...doc,
  nodes: doc.nodes.map((n) => ({ ...n })),
  edges: doc.edges.map((e) => ({ ...e })),
});

/** 下一个可用 id：扫描现有 id 取最大序号 +1，不维护计数器，避免序列化时漏字段。 */
function nextId(doc, prefix) {
  let max = 0;
  const pool = prefix === 'n' ? doc.nodes : doc.edges;
  for (const item of pool) {
    const m = /^[ne](\d+)$/.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  // 前缀不同也可能撞号，统一取两者最大
  if (prefix === 'n') {
    for (const e of doc.edges) {
      const m = /^n(\d+)$/.exec(e.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } else {
    for (const n of doc.nodes) {
      const m = /^e(\d+)$/.exec(n.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `${prefix}${max + 1}`;
}

/**
 * 由解析出的 IR 建文档。IR 的节点名变成 text，id 重编为稳定流水号。
 * @param {import('../../core/src/ir.js').Diagram} diagram
 */
export function docFromDiagram(diagram) {
  const doc = emptyDoc(diagram.title || '');
  const idMap = new Map(); // IR 里的节点名 → 文档 id

  diagram.nodes.forEach((n, i) => {
    const id = `n${i + 1}`;
    idMap.set(n.id, id);
    doc.nodes.push({
      id,
      type: n.type,
      text: n.text,
      // 初版坐标先全部排到 0，随后由 reflow 填。文档层不猜坐标。
      x: 0,
      y: 0,
    });
  });

  let seq = 0;
  for (const e of diagram.edges) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;
    doc.edges.push({
      id: `e${++seq}`,
      from,
      to,
      label: e.label || '',
      kind: e.kind || 'flow',
      fromSide: '',
      toSide: '',
    });
  }

  return doc;
}

/** 文档 → IR，供 renderSvg / vsdx 导出这条只读链路复用。 */
export function docToDiagram(doc) {
  return {
    version: 1,
    title: doc.title,
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      text: n.text,
      sourceLine: 0,
      sourceCol: 0,
    })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      kind: e.kind,
      sourceLine: 0,
      sourceCol: 0,
    })),
    diagnostics: [],
  };
}

/** 每个节点按当前模板量一遍尺寸。文档不存尺寸，所以每次都要问一次。 */
export function sizeNodes(doc, spec = DEFAULT_SPEC) {
  const out = new Map();
  for (const n of doc.nodes) {
    const s = measureNode({ type: n.type, text: n.text }, spec);
    out.set(n.id, s);
  }
  return out;
}

/** 取节点连同尺寸，方便命中测试与绘制。 */
export function nodesWithBox(doc, spec = DEFAULT_SPEC) {
  const sizes = sizeNodes(doc, spec);
  return doc.nodes.map((n) => {
    const s = sizes.get(n.id);
    return {
      ...n,
      w: s.w,
      h: s.h,
      lines: s.lines,
      cx: n.x + s.w / 2,
      cy: n.y + s.h / 2,
    };
  });
}

// ---------------------------------------------------------------- 节点操作

export function addNode(doc, { type = 'process', text = '新步骤', x = 0, y = 0 }) {
  const next = clone(doc);
  const id = nextId(next, 'n');
  next.nodes.push({ id, type, text, x: snapGrid(x), y: snapGrid(y) });
  return { doc: next, id };
}

/** 改文字。**id 不变，连线不动** —— 这是本模型存在的全部理由。 */
export function updateNodeText(doc, id, text) {
  const next = clone(doc);
  const n = next.nodes.find((x) => x.id === id);
  if (!n || n.text === text) return { doc, changed: false };
  n.text = text;
  return { doc: next, changed: true };
}

/** 改类型（形状）。判断节点变矩形时会留下多余出口，由调用方决定是否提示。 */
export function setNodeType(doc, id, type) {
  const next = clone(doc);
  const n = next.nodes.find((x) => x.id === id);
  if (!n || n.type === type) return { doc, changed: false };
  n.type = type;
  return { doc: next, changed: true };
}

export function moveNode(doc, id, x, y) {
  const next = clone(doc);
  const n = next.nodes.find((v) => v.id === id);
  if (!n) return { doc, changed: false };
  const nx = snapGrid(x);
  const ny = snapGrid(y);
  if (n.x === nx && n.y === ny) return { doc, changed: false };
  n.x = nx;
  n.y = ny;
  return { doc: next, changed: true };
}

/**
 * 删节点：连带删掉所有与它相连的边。
 * 留一条指向空气的边，后面每个步骤都得判空，不如在这里一次清干净。
 */
export function removeNode(doc, id) {
  const next = clone(doc);
  const before = next.nodes.length;
  next.nodes = next.nodes.filter((n) => n.id !== id);
  if (next.nodes.length === before) return { doc, changed: false };
  next.edges = next.edges.filter((e) => e.from !== id && e.to !== id);
  return { doc: next, changed: true };
}

// ---------------------------------------------------------------- 连线操作

/** 两点之间是否已有同向同标签的边（避免重复拉线）。 */
function hasEdge(doc, from, to, label) {
  return doc.edges.some((e) => e.from === from && e.to === to && e.label === label);
}

/** 合法端口名。空串 = 没指定，布线时按两框相对位置自动推断。 */
export const SIDES = ['top', 'right', 'bottom', 'left'];
const cleanSide = (s) => (SIDES.includes(s) ? s : '');

/**
 * 建一条连线。两端可以指定端口。
 *
 * 为什么必须把端口存下来：用户从左边端口拉出去的线，如果布线时又按
 * 两框中心点的主轴重新推断，可能被画成从下端口出 —— 手一松线就跳到
 * 另一条边。这就是「连完没对齐」的直接原因。存下来，画的时候照用户
 * 指的边走。空串表示没指定（自动排版生成的线都是空串），此时才推断。
 */
export function addEdge(doc, from, to, label = '', kind = 'flow', sides = {}) {
  if (!from || !to) return { doc, changed: false };
  if (!doc.nodes.some((n) => n.id === from) || !doc.nodes.some((n) => n.id === to)) {
    return { doc, changed: false };
  }
  if (hasEdge(doc, from, to, label)) return { doc, changed: false };
  const next = clone(doc);
  next.edges.push({
    id: nextId(next, 'e'),
    from,
    to,
    label,
    kind,
    fromSide: cleanSide(sides.fromSide),
    toSide: cleanSide(sides.toSide),
  });
  return { doc: next, changed: true };
}

/** 改一条边两端的端口。传空串 = 回到自动推断。 */
export function setEdgeSides(doc, id, sides = {}) {
  const next = clone(doc);
  const e = next.edges.find((x) => x.id === id);
  if (!e) return { doc, changed: false };
  const fromSide = cleanSide(sides.fromSide);
  const toSide = cleanSide(sides.toSide);
  if ((e.fromSide || '') === fromSide && (e.toSide || '') === toSide) {
    return { doc, changed: false };
  }
  e.fromSide = fromSide;
  e.toSide = toSide;
  return { doc: next, changed: true };
}

export function removeEdge(doc, id) {
  const next = clone(doc);
  const before = next.edges.length;
  next.edges = next.edges.filter((e) => e.id !== id);
  if (next.edges.length === before) return { doc, changed: false };
  return { doc: next, changed: true };
}

export function setEdgeLabel(doc, id, label) {
  const next = clone(doc);
  const e = next.edges.find((x) => x.id === id);
  if (!e || e.label === label) return { doc, changed: false };
  e.label = label;
  return { doc: next, changed: true };
}

// ---------------------------------------------------------------- 整体

export function setTitle(doc, title) {
  if (doc.title === title) return { doc, changed: false };
  return { doc: { ...doc, title }, changed: true };
}

export function setTemplate(doc, template) {
  if (doc.template === template) return { doc, changed: false };
  return { doc: { ...doc, template }, changed: true };
}

/** 换配色。传空串 = 回到模板自带配色。 */
export function setPalette(doc, palette) {
  const next = palette || '';
  if ((doc.palette || '') === next) return { doc, changed: false };
  return { doc: { ...doc, palette: next }, changed: true };
}

/**
 * 改连线外观（粗细 / 圆角 / 箭头大小）。
 *
 * 传 null 或 undefined 的字段表示「这一项回到模板默认」，而不是忽略 ——
 * 否则用户没法把「改粗过的线」改回和模板一致。
 */
export function setEdgeStyle(doc, patch = {}) {
  const cur = doc.edge || {};
  const next = { ...cur };
  for (const k of EDGE_STYLE_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === undefined) delete next[k];
    else next[k] = Number(v);
  }
  // 值没变就不产生撤销点：拖动滑块时不能每帧记一笔
  const same =
    Object.keys(next).length === Object.keys(cur).length &&
    EDGE_STYLE_KEYS.every((k) => next[k] === cur[k]);
  if (same) return { doc, changed: false };
  return { doc: { ...doc, edge: next }, changed: true };
}

/**
 * 把排版结果写回文档：这是 dagre 坐标进入文档的唯一入口。
 * laid 是 core 的 layout() 返回值（节点带 x/y）。
 */
export function applyLayout(doc, laid) {
  const pos = new Map(laid.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const next = clone(doc);
  for (const n of next.nodes) {
    const p = pos.get(n.id);
    if (p) {
      n.x = p.x;
      n.y = p.y;
    }
  }
  return next;
}

// ---------------------------------------------------------------- 序列化

/** 保存格式：只存「图数据」，不存图片。这样能再次打开继续编辑。 */
export function serializeDoc(doc) {
  return JSON.stringify(
    {
      version: DOC_VERSION,
      title: doc.title,
      template: doc.template,
      palette: doc.palette || '',
      edge: doc.edge || {},
      nodes: doc.nodes,
      edges: doc.edges,
    },
    null,
    2,
  );
}

/** 读回。坏数据不抛异常，返回 null 由调用方提示，避免打开一个坏文件就白屏。 */
export function deserializeDoc(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  for (const n of raw.nodes) {
    if (typeof n.id !== 'string' || typeof n.type !== 'string') return null;
  }
  for (const e of raw.edges) {
    if (typeof e.id !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') return null;
  }
  const ids = new Set(raw.nodes.map((n) => n.id));
  // 连线外观：只保留认识的键、且必须是有限数，坏值一律当作「用模板的」
  const edge = {};
  if (raw.edge && typeof raw.edge === 'object') {
    for (const k of EDGE_STYLE_KEYS) {
      if (Number.isFinite(raw.edge[k])) edge[k] = raw.edge[k];
    }
  }
  return {
    version: DOC_VERSION,
    title: typeof raw.title === 'string' ? raw.title : '',
    template: typeof raw.template === 'string' ? raw.template : 'default',
    palette: typeof raw.palette === 'string' ? raw.palette : '',
    edge,
    nodes: raw.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      text: typeof n.text === 'string' ? n.text : '',
      x: Number.isFinite(n.x) ? n.x : 0,
      y: Number.isFinite(n.y) ? n.y : 0,
    })),
    // 悬空边直接丢弃：宁可少一条线，也不要画一条指向不存在的框的线
    edges: raw.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        label: typeof e.label === 'string' ? e.label : '',
        kind: e.kind === 'merge' ? 'merge' : 'flow',
        // 老文件没有这两个字段 → 空串 → 回到按位置推断，不会读崩
        fromSide: SIDES.includes(e.fromSide) ? e.fromSide : '',
        toSide: SIDES.includes(e.toSide) ? e.toSide : '',
      })),
  };
}
