import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScene, sceneBounds, snapToNeighbors } from '../src/scene.js';
import { emptyDoc, addNode, addEdge } from '../src/doc.js';
import { resolveSpec } from '../../core/src/templates.js';
import { GRID } from '../../core/src/theme.js';

const spec = resolveSpec('default');

/** 造一份两个节点一条边的文档。 */
function twoNodeDoc() {
  let doc = emptyDoc('测试');
  const a = addNode(doc, { type: 'start', text: '开始', x: 100, y: 40 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: '执行动作', x: 100, y: 200 });
  doc = b.doc;
  doc = addEdge(doc, a.id, b.id).doc;
  return { doc, a: a.id, b: b.id };
}

test('空文档：没有节点、连线、标签，包围盒为零尺寸', () => {
  const scene = buildScene(emptyDoc(), spec);
  assert.deepEqual(scene.nodes, []);
  assert.deepEqual(scene.edges, []);
  assert.deepEqual(scene.labels, []);
  assert.deepEqual(scene.bounds, { x: 0, y: 0, w: 0, h: 0 });
});

test('节点尺寸来自度量，且守 4px 网格', () => {
  const { doc } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  for (const n of scene.nodes) {
    assert.equal(n.w % GRID, 0, `${n.id} 宽 ${n.w} 不在网格上`);
    assert.equal(n.h % GRID, 0, `${n.id} 高 ${n.h} 不在网格上`);
    assert.ok(n.w > 0 && n.h > 0);
    assert.equal(n.cx, n.x + n.w / 2);
    assert.equal(n.cy, n.y + n.h / 2);
    assert.ok(Array.isArray(n.lines) && n.lines.length > 0);
    // 中心点也要在网格上：端口取的就是中心，半格偏移会让连线出现 2px 折角
    assert.equal(n.cx % GRID, 0, `${n.id} 中心 x ${n.cx} 偏网格 ${n.cx % GRID}px`);
    assert.equal(n.cy % GRID, 0, `${n.id} 中心 y ${n.cy} 偏网格 ${n.cy % GRID}px`);
  }
});

test('场景里的连线全是正交线段，无斜线、无短折角', () => {
  const { doc } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  for (const e of scene.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const dx = Math.abs(e.points[i].x - e.points[i - 1].x);
      const dy = Math.abs(e.points[i].y - e.points[i - 1].y);
      assert.ok(dx === 0 || dy === 0, `第 ${i} 段斜走 ${JSON.stringify([e.points[i - 1], e.points[i]])}`);
      assert.ok(Math.hypot(dx, dy) >= 8, `第 ${i} 段过短（折角毛刺）`);
    }
  }
});

test('节点坐标取自文档，不被排版覆盖（拖动后位置即真相）', () => {
  const { doc, a } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  const n = scene.nodes.find((v) => v.id === a);
  assert.equal(n.x, 100);
  assert.equal(n.y, 40);
});

test('每条边都布出正交折线，首尾贴在框边上', () => {
  const { doc, a, b } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  assert.equal(scene.edges.length, 1);
  const e = scene.edges[0];
  const from = scene.nodes.find((n) => n.id === a);
  const to = scene.nodes.find((n) => n.id === b);
  assert.ok(e.points.length >= 2);
  const head = e.points[0];
  const tail = e.points.at(-1);
  // 首点在某条框边上（x 或 y 相等）
  assert.ok(head.x === from.x || head.x === from.x + from.w || head.y === from.y || head.y === from.y + from.h);
  assert.ok(tail.x === to.x || tail.x === to.x + to.w || tail.y === to.y || tail.y === to.y + to.h);
});

test('每次线段都是水平或垂直的（正交）', () => {
  const { doc } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  for (const e of scene.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const p = e.points[i - 1];
      const q = e.points[i];
      assert.ok(p.x === q.x || p.y === q.y, `第 ${i} 段是斜线：${JSON.stringify(p)} → ${JSON.stringify(q)}`);
    }
  }
});

test('拖动终点后连线跟着重新布线（不沿用旧路径）', () => {
  const { doc, a, b } = twoNodeDoc();
  const before = buildScene(doc, spec).edges[0].points.at(-1);

  // 把终点挪到很远的右下角
  const moved = {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === b ? { ...n, x: 800, y: 600 } : n)),
  };
  const after = buildScene(moved, spec).edges[0].points.at(-1);
  assert.notDeepEqual(before, after, '连线没有跟随节点移动');
});

test('有标签的边生成标签框，位置来自 placeLabel', () => {
  const { doc, a, b } = twoNodeDoc();
  const labelled = { ...doc, edges: doc.edges.map((e) => ({ ...e, label: '是' })) };
  const scene = buildScene(labelled, spec);
  assert.equal(scene.labels.length, 1);
  const l = scene.labels[0];
  assert.equal(l.text, '是');
  assert.ok(l.w > 0 && l.h > 0);
  assert.ok(l.x % GRID === 0 && l.y % GRID === 0, '标签位置应在网格上');
});

test('无标签的边不产生标签框', () => {
  const { doc } = twoNodeDoc();
  assert.equal(buildScene(doc, spec).labels.length, 0);
});

test('悬空边不画（文档被手工改坏时的兜底）', () => {
  const { doc } = twoNodeDoc();
  const broken = { ...doc, edges: [...doc.edges, { id: 'e99', from: 'n404', to: 'n1', label: '', kind: 'flow' }] };
  const scene = buildScene(broken, spec);
  assert.equal(scene.edges.length, 1, '悬空边不该被画出来');
});

test('自连边能画出绕过自身框外的路径', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: '等待', x: 100, y: 100 });
  doc = a.doc;
  doc = addEdge(doc, a.id, a.id).doc;
  const scene = buildScene(doc, spec);
  assert.equal(scene.edges.length, 1);
  const n = scene.nodes[0];
  const outside = scene.edges[0].points.some(
    (p) => p.x > n.x + n.w || p.x < n.x || p.y > n.y + n.h || p.y < n.y,
  );
  assert.ok(outside, '自连的线应绕到框外');
});

test('包围盒含全部节点、连线点与标签', () => {
  const { doc } = twoNodeDoc();
  const scene = buildScene(doc, spec);
  const b = scene.bounds;
  for (const n of scene.nodes) {
    assert.ok(n.x >= b.x && n.y >= b.y);
    assert.ok(n.x + n.w <= b.x + b.w + 1e-9);
    assert.ok(n.y + n.h <= b.y + b.h + 1e-9);
  }
  for (const e of scene.edges) {
    for (const p of e.points) {
      assert.ok(p.x >= b.x && p.x <= b.x + b.w);
      assert.ok(p.y >= b.y && p.y <= b.y + b.h);
    }
  }
});

test('sceneBounds 空输入返回零尺寸而不是 Infinity', () => {
  assert.deepEqual(sceneBounds([]), { x: 0, y: 0, w: 0, h: 0 });
});

test('换模板只改外观数据，不改变节点坐标', () => {
  const { doc } = twoNodeDoc();
  const a = buildScene(doc, resolveSpec('default'));
  const b = buildScene(doc, resolveSpec('minimal'));
  for (const n of a.nodes) {
    const m = b.nodes.find((x) => x.id === n.id);
    assert.equal(m.x, n.x, '换模板不该挪动节点');
    assert.equal(m.y, n.y);
  }
});

// ------------------------------------------------------------ 对齐吸附

const box = (x, y, w = 100, h = 40) => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });

test('snapToNeighbors：左边缘对齐时给出吸附坐标', () => {
  const moved = { ...box(103, 300), id: 'n1' };
  const other = { ...box(100, 100), id: 'n2' };
  const r = snapToNeighbors(moved, [other]);
  assert.equal(r.x, 100);
  assert.equal(r.y, null);
  assert.ok(r.guides.x.includes(100), '应对齐线给出参考');
});

test('snapToNeighbors：超出容差就不吸附', () => {
  const moved = { ...box(120, 300), id: 'n1' };
  const other = { ...box(100, 100), id: 'n2' };
  const r = snapToNeighbors(moved, [other], 6);
  assert.equal(r.x, null);
  assert.deepEqual(r.guides.x, []);
});

test('snapToNeighbors：中线对齐也算', () => {
  // moved.cx = 103+50 = 153；other 中线 = 100+50 = 150
  const moved = { ...box(103, 300), id: 'n1' };
  const other = { ...box(100, 100), id: 'n2' };
  const r = snapToNeighbors(moved, [other]);
  assert.equal(r.x, 100, '左边缘差 3px 比中线差 3px 更近或相同，都应吸到 100');
});

test('snapToNeighbors：忽略自己和空集合', () => {
  const moved = { ...box(0, 0), id: 'n1' };
  assert.equal(snapToNeighbors(moved, []).x, null);
  assert.equal(snapToNeighbors(moved, [{ ...moved }]).x, null, '不该和自己比');
});

test('snapToNeighbors：吸附后坐标仍守 4px 网格', () => {
  const moved = { ...box(101, 301), id: 'n1' };
  const other = { ...box(98, 99), id: 'n2' };
  const r = snapToNeighbors(moved, [other]);
  if (r.x !== null) assert.equal(r.x % GRID, 0);
  if (r.y !== null) assert.equal(r.y % GRID, 0);
});

// ---------------------------------------------------------------- 指定端口后布线

test('buildScene：连线按文档里记的端口出/入，不受两框相对位置影响', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: 'A', x: 0, y: 0 });
  doc = a.doc;
  // B 在 A 正下方：自动推断必然是 bottom → top
  const b = addNode(doc, { type: 'process', text: 'B', x: 0, y: 200 });
  doc = b.doc;

  const scene = buildScene(doc, spec);
  const A = scene.nodes.find((n) => n.id === a.id);
  const B = scene.nodes.find((n) => n.id === b.id);

  const auto = buildScene(addEdge(doc, a.id, b.id).doc, spec).edges[0];
  assert.deepEqual(auto.points[0], { x: A.cx, y: A.y + A.h }, '自动应从 A 底边出');
  assert.deepEqual(auto.points.at(-1), { x: B.cx, y: B.y }, '自动应从 B 顶边进');

  // 用户指定从右边出、左边进：即使 B 在正下方，也必须照办。
  // 这正是「连完线跳到另一条边」那个问题的回归测试。
  const manual = buildScene(
    addEdge(doc, a.id, b.id, '', 'flow', { fromSide: 'right', toSide: 'left' }).doc,
    spec,
  ).edges[0];
  assert.deepEqual(manual.points[0], { x: A.x + A.w, y: A.cy }, '必须从 A 右边出');
  assert.deepEqual(manual.points.at(-1), { x: B.x, y: B.cy }, '必须从 B 左边进');
});

test('buildScene：端口原样带进场景，导出时不用再猜', () => {
  let doc = emptyDoc();
  const a = addNode(doc, { type: 'process', text: 'A', x: 0, y: 0 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: 'B', x: 300, y: 0 });
  doc = b.doc;
  doc = addEdge(doc, a.id, b.id, '', 'flow', { fromSide: 'top', toSide: 'right' }).doc;
  const e = buildScene(doc, spec).edges[0];
  assert.equal(e.fromSide, 'top');
  assert.equal(e.toSide, 'right');
  // 起点必须是 A 的上边中点
  const aScene = buildScene(doc, spec).nodes.find((n) => n.id === a.id);
  assert.deepEqual(e.points[0], { x: aScene.x + aScene.w / 2, y: aScene.y });
});
