import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyDoc,
  docFromDiagram,
  docToDiagram,
  addNode,
  updateNodeText,
  setNodeType,
  moveNode,
  removeNode,
  addEdge,
  removeEdge,
  setEdgeLabel,
  setEdgeSides,
  setTitle,
  setTemplate,
  setPalette,
  applyLayout,
  serializeDoc,
  deserializeDoc,
  nodesWithBox,
} from '../src/doc.js';
import { parseMarkdown } from '../../core/src/parse.js';
import { layout } from '../../core/src/layout.js';
import { resolveSpec } from '../../core/src/templates.js';

const MD = `# 运动控制流程

1. 开始
2. 回零：调用 MC_Home
3. 判断：模式是否为位置模式？
   - 是 → 设置目标位置
   - 否 → 报错：模式不支持
4. 设置目标位置 => 待机
5. 待机：检查模式和范围
`;

const build = () => docFromDiagram(parseMarkdown(MD));

test('docFromDiagram：维度与 IR 一致，节点名变成 text', () => {
  const ir = parseMarkdown(MD);
  const doc = docFromDiagram(ir);
  assert.equal(doc.nodes.length, ir.nodes.length);
  assert.equal(doc.edges.length, ir.edges.length);
  // id 是流水号，不是文字
  assert.equal(doc.nodes[0].id, 'n1');
  // 这份 MD 是 6 个节点：开始 / 回零 / 判断 / 设置目标位置 / 报错 / 待机
  assert.deepEqual(doc.nodes.map((n) => n.id), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  assert.ok(doc.nodes.every((n) => !/^[ne]\d+$/.test(n.text)), 'text 不应是 id');
});

test('docFromDiagram：所有边都指向存在的节点', () => {
  const doc = build();
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const e of doc.edges) {
    assert.ok(ids.has(e.from), `悬空起点 ${e.from}`);
    assert.ok(ids.has(e.to), `悬空终点 ${e.to}`);
  }
});

test('改文字不断连线（本模型存在的理由）', () => {
  const doc = build();
  const target = doc.nodes[1];
  const before = doc.edges.filter((e) => e.from === target.id || e.to === target.id).length;
  assert.ok(before > 0, '测试前提：该节点确实有连线');

  const { doc: after, changed } = updateNodeText(doc, target.id, '归零：调用 MC_Home 回到原点');
  assert.equal(changed, true);
  assert.equal(after.nodes[1].text, '归零：调用 MC_Home 回到原点');
  assert.equal(after.nodes[1].id, target.id, 'id 必须不变');
  const now = after.edges.filter((e) => e.from === target.id || e.to === target.id).length;
  assert.equal(now, before, '连线数量必须不变');
  assert.deepEqual(
    after.edges.map((e) => [e.from, e.to]),
    doc.edges.map((e) => [e.from, e.to]),
  );
});

test('改文字：内容相同时返回原对象且 changed=false', () => {
  const doc = build();
  const n = doc.nodes[0];
  const r = updateNodeText(doc, n.id, n.text);
  assert.equal(r.changed, false);
  assert.equal(r.doc, doc, '没变就不该产生新对象');
});

test('改文字：不认识的 id 不崩、不改变文档', () => {
  const doc = build();
  const r = updateNodeText(doc, 'n999', 'x');
  assert.equal(r.changed, false);
  assert.equal(r.doc.nodes.length, doc.nodes.length);
});

test('所有变更都不原地修改输入文档（撤销栈的前提）', () => {
  const doc = build();
  const snapshot = JSON.stringify(doc);
  updateNodeText(doc, 'n1', '改了');
  addNode(doc, { x: 10, y: 10 });
  removeNode(doc, 'n2');
  addEdge(doc, 'n1', 'n5', '旁路');
  setTitle(doc, '新标题');
  setTemplate(doc, 'tech');
  moveNode(doc, 'n1', 80, 80);
  assert.equal(JSON.stringify(doc), snapshot, '输入文档被就地改坏了');
});

test('moveNode：吸附 4px 网格，同位置返回 changed=false', () => {
  const doc = build();
  const r1 = moveNode(doc, 'n1', 13, 27);
  assert.equal(r1.doc.nodes[0].x, 12);
  assert.equal(r1.doc.nodes[0].y, 28);
  const r2 = moveNode(r1.doc, 'n1', 12, 28);
  assert.equal(r2.changed, false);
});

test('addNode：给新 id 且不撞现有 id', () => {
  const doc = build();
  const { doc: after, id } = addNode(doc, { type: 'process', text: '补充步骤', x: 40, y: 40 });
  assert.equal(id, 'n7');
  assert.equal(after.nodes.length, doc.nodes.length + 1);
  assert.equal(new Set(after.nodes.map((n) => n.id)).size, after.nodes.length, 'id 撞号了');
});

test('removeNode：连带删掉所有相连的边，不留悬空边', () => {
  const doc = build();
  const victim = doc.nodes.find((n) => n.type === 'decision');
  const touching = doc.edges.filter((e) => e.from === victim.id || e.to === victim.id);
  assert.ok(touching.length >= 2, '测试前提：判断节点至少两条边');

  const { doc: after } = removeNode(doc, victim.id);
  assert.equal(after.nodes.length, doc.nodes.length - 1);
  assert.equal(after.edges.length, doc.edges.length - touching.length);
  for (const e of after.edges) {
    assert.notEqual(e.from, victim.id);
    assert.notEqual(e.to, victim.id);
  }
});

test('removeNode：删不存在的节点返回 changed=false', () => {
  const doc = build();
  const r = removeNode(doc, 'n999');
  assert.equal(r.changed, false);
});

test('addEdge：拒绝重复同向同标签的边', () => {
  const doc = build();
  const { doc: d1, changed } = addEdge(doc, 'n1', 'n5', '旁路');
  assert.equal(changed, true);
  const { doc: d2, changed: c2 } = addEdge(d1, 'n1', 'n5', '旁路');
  assert.equal(c2, false);
  assert.equal(d2.edges.length, d1.edges.length);
  // 标签不同是另一条边
  const { changed: c3 } = addEdge(d2, 'n1', 'n5', '回调');
  assert.equal(c3, true);
});

test('addEdge：端点不存在时拒绝建边', () => {
  const doc = build();
  assert.equal(addEdge(doc, 'n1', 'n999').changed, false);
  assert.equal(addEdge(doc, 'n999', 'n1').changed, false);
});

test('setEdgeLabel / removeEdge', () => {
  const doc = build();
  const e = doc.edges.find((x) => x.label === '是');
  const r1 = setEdgeLabel(doc, e.id, 'Yes');
  assert.equal(r1.changed, true);
  assert.equal(r1.doc.edges.find((x) => x.id === e.id).label, 'Yes');
  const r2 = removeEdge(r1.doc, e.id);
  assert.equal(r2.doc.edges.length, doc.edges.length - 1);
});

test('setNodeType：形状可改，边不受影响', () => {
  const doc = build();
  const r = setNodeType(doc, 'n2', 'decision');
  assert.equal(r.changed, true);
  assert.equal(r.doc.nodes[1].type, 'decision');
  assert.equal(r.doc.edges.length, doc.edges.length);
});

test('docToDiagram：能直接喂给 layout 与 parse 的消费方', () => {
  const doc = build();
  const ir = docToDiagram(doc);
  assert.equal(ir.version, 1);
  assert.deepEqual(ir.diagnostics, []);
  assert.equal(ir.nodes[0].id, 'n1');
  const spec = resolveSpec('default');
  const laid = layout(ir, spec);
  assert.equal(laid.nodes.length, doc.nodes.length);
  assert.ok(laid.width > 0 && laid.height > 0);
});

test('docToDiagram 的节点顺序与文档一致（渲染顺序稳定）', () => {
  const doc = build();
  const ir = docToDiagram(doc);
  assert.deepEqual(ir.nodes.map((n) => n.id), doc.nodes.map((n) => n.id));
});

test('applyLayout：把 dagre 坐标写回文档', () => {
  const doc = build();
  const spec = resolveSpec('default');
  const laid = layout(docToDiagram(doc), spec);
  const after = applyLayout(doc, laid);
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));
  for (const n of after.nodes) {
    assert.equal(n.x, byId.get(n.id).x);
    assert.equal(n.y, byId.get(n.id).y);
  }
  // 只动坐标，不动文字与边
  assert.deepEqual(after.nodes.map((n) => n.text), doc.nodes.map((n) => n.text));
  assert.equal(after.edges.length, doc.edges.length);
});

test('serialize → deserialize 往返一致', () => {
  const doc = build();
  const round = deserializeDoc(serializeDoc(doc));
  assert.deepEqual(round, doc);
});

test('deserializeDoc：坏输入返回 null 而不是抛异常', () => {
  assert.equal(deserializeDoc('not json'), null);
  assert.equal(deserializeDoc('{}'), null);
  // 空画布是合法状态（用户可以存一张空图），不能当坏数据
  const empty = deserializeDoc('{"nodes":[],"edges":[]}');
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
  assert.equal(deserializeDoc('{"nodes":[{"id":1,"type":"process"}],"edges":[]}'), null);
  assert.equal(deserializeDoc('{"nodes":[{"id":"n1","type":"process"}],"edges":[{"id":"e1"}]}'), null);
});

test('deserializeDoc：悬空边被丢弃而不是画出来', () => {
  const raw = JSON.stringify({
    version: 1,
    title: '',
    template: 'default',
    nodes: [{ id: 'n1', type: 'process', text: 'a', x: 0, y: 0 }],
    edges: [
      { id: 'e1', from: 'n1', to: 'n1', label: '', kind: 'flow' },
      { id: 'e2', from: 'n1', to: 'n404', label: '', kind: 'flow' },
    ],
  });
  const doc = deserializeDoc(raw);
  assert.equal(doc.edges.length, 1);
  assert.equal(doc.edges[0].id, 'e1');
});

test('nodesWithBox：尺寸来自文字度量，不是文档里存的', () => {
  const doc = build();
  const spec = resolveSpec('default');
  const boxed = nodesWithBox(doc, spec);
  assert.equal(boxed.length, doc.nodes.length);
  for (const n of boxed) {
    assert.ok(n.w > 0 && n.h > 0, `${n.id} 尺寸为 0`);
    assert.ok(n.lines.length > 0);
    assert.equal(n.cx, n.x + n.w / 2);
    assert.equal(n.cy, n.y + n.h / 2);
  }
  // 都守 4px 网格
  for (const n of boxed) {
    assert.equal(n.w % 4, 0, `${n.id} 宽度不在网格上`);
    assert.equal(n.h % 4, 0, `${n.id} 高度不在网格上`);
  }
});

test('文字改长后框变宽（尺寸随文字走）', () => {
  const doc = build();
  const spec = resolveSpec('default');
  const before = nodesWithBox(doc, spec).find((n) => n.id === 'n2').w;
  const { doc: after } = updateNodeText(doc, 'n2', '归零：调用 MC_Home 回到机械原点并复位状态机');
  const now = nodesWithBox(after, spec).find((n) => n.id === 'n2');
  assert.ok(now.w !== before || now.lines.length > 1, '改长文字后框没变化');
});

test('setTemplate 只换模板名，不动几何数据', () => {
  const doc = build();
  const r = setTemplate(doc, 'tech');
  assert.equal(r.doc.template, 'tech');
  assert.deepEqual(r.doc.nodes, doc.nodes);
});

test('setPalette：换配色不改模板，空串回到模板自带', () => {
  const doc = build();
  const dark = setPalette(doc, 'dark');
  assert.equal(dark.changed, true);
  assert.equal(dark.doc.palette, 'dark');
  assert.equal(dark.doc.template, doc.template);
  // 重复设同一个值不算改动，否则会往撤销栈里塞空记录
  assert.equal(setPalette(dark.doc, 'dark').changed, false);
  const reset = setPalette(dark.doc, '');
  assert.equal(reset.doc.palette, '');
});

test('palette 能存进 JSON 并被读回（否则刷新就丢配色）', () => {
  const doc = setPalette(build(), 'slate').doc;
  const round = deserializeDoc(serializeDoc(doc));
  assert.equal(round.palette, 'slate');
  // 老文件没有 palette 字段时按模板自带处理，不能变成 undefined
  const legacy = deserializeDoc('{"version":1,"nodes":[],"edges":[]}');
  assert.equal(legacy.palette, '');
});

// ---------------------------------------------------------------- 连线端口

test('addEdge：端口被记下来，没传时是空串（表示自动推断）', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'start', text: '开始', x: 0, y: 0 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: '执行', x: 0, y: 200 });
  doc = b.doc;

  const auto = addEdge(doc, a.id, b.id);
  assert.equal(auto.doc.edges[0].fromSide, '');
  assert.equal(auto.doc.edges[0].toSide, '');

  const manual = addEdge(doc, a.id, b.id, '', 'flow', { fromSide: 'right', toSide: 'left' });
  assert.equal(manual.doc.edges[0].fromSide, 'right');
  assert.equal(manual.doc.edges[0].toSide, 'left');
});

test('addEdge：非法端口名被吞掉，不会写进文档', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: 'A', x: 0, y: 0 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: 'B', x: 0, y: 200 });
  doc = b.doc;
  const r = addEdge(doc, a.id, b.id, '', 'flow', { fromSide: 'northeast', toSide: 'bottom' });
  assert.equal(r.doc.edges[0].fromSide, '');
  assert.equal(r.doc.edges[0].toSide, 'bottom');
});

test('setEdgeSides：改端口、重复设同值不算改动', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: 'A', x: 0, y: 0 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: 'B', x: 0, y: 200 });
  doc = b.doc;
  doc = addEdge(doc, a.id, b.id).doc;
  const id = doc.edges[0].id;

  const set = setEdgeSides(doc, id, { fromSide: 'left', toSide: 'top' });
  assert.equal(set.changed, true);
  assert.equal(set.doc.edges[0].fromSide, 'left');
  assert.equal(set.doc.edges[0].toSide, 'top');
  assert.equal(setEdgeSides(set.doc, id, { fromSide: 'left', toSide: 'top' }).changed, false);
});

test('端口能存进 JSON 并被读回', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: 'A', x: 0, y: 0 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: 'B', x: 0, y: 200 });
  doc = b.doc;
  doc = addEdge(doc, a.id, b.id, '', 'flow', { fromSide: 'bottom', toSide: 'top' }).doc;
  const round = deserializeDoc(serializeDoc(doc));
  assert.equal(round.edges[0].fromSide, 'bottom');
  assert.equal(round.edges[0].toSide, 'top');

  // 老文件没有这两个字段 → 空串，不能是 undefined
  const legacy = deserializeDoc(
    `{"version":1,"nodes":[{"id":"n1","type":"process","text":"A","x":0,"y":0}],"edges":[]}`,
  );
  assert.deepEqual(legacy.edges, []);
});
