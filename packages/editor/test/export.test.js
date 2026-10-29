import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScene, sceneToLaid } from '../src/scene.js';
import { emptyDoc, addNode, addEdge, setTitle } from '../src/doc.js';
import { resolveSpec } from '../../core/src/templates.js';
import { toVsdxInput, toVsdxTheme } from '../../core/src/vsdx-input.js';
import { GRID } from '../../core/src/theme.js';

/**
 * 导出的输入必须来自 core 的 toVsdxInput —— 手拼 payload 会让模板差异丢失
 * （真实踩到过：所有形状都变成同一个 #f5f5f5）。这里把这件事钉成测试。
 */

const spec = resolveSpec('default');

function buildDoc() {
  let doc = emptyDoc('导出测试');
  const a = addNode(doc, { type: 'start', text: '开始', x: 100, y: 40 });
  doc = a.doc;
  const b = addNode(doc, { type: 'process', text: '执行动作', x: 100, y: 200 });
  doc = b.doc;
  doc = addEdge(doc, a.id, b.id).doc;
  return doc;
}

test('toVsdxInput 给每个节点带上自己的模板样式', () => {
  const scene = sceneToLaid(buildScene(buildDoc(), spec));
  const payload = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 0 });
  assert.equal(payload.nodes.length, 2);
  for (const n of payload.nodes) {
    assert.ok(n.style, `节点 ${n.id} 缺 style`);
    assert.ok(n.style.fillColor, `节点 ${n.id} 缺 fillColor`);
    assert.ok(n.style.lineColor, `节点 ${n.id} 缺 lineColor`);
  }
});

test('起止节点与过程节点拿到不同填充（模板差异必须传到 vsdx）', () => {
  const scene = sceneToLaid(buildScene(buildDoc(), spec));
  const payload = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 0 });
  const start = payload.nodes.find((n) => n.type === 'start');
  const proc = payload.nodes.find((n) => n.type === 'process');
  assert.notEqual(start.style.fillColor, proc.style.fillColor,
    'start 与 process 的填充色相同 —— 模板样式在导出链路上丢了');
});

test('切换模板后输入里的颜色随之改变', () => {
  const doc = buildDoc();
  const light = toVsdxInput(sceneToLaid(buildScene(doc, resolveSpec('default'))), resolveSpec('default'), {});
  const tech = toVsdxInput(sceneToLaid(buildScene(doc, resolveSpec('tech'))), resolveSpec('tech'), {});
  const a = light.nodes.find((n) => n.type === 'process').style.fillColor;
  const b = tech.nodes.find((n) => n.type === 'process').style.fillColor;
  assert.notEqual(a, b);
});

test('每条连线都带端口与独立线色（不能粘中心点、不能全同色）', () => {
  const scene = sceneToLaid(buildScene(buildDoc(), spec));
  const payload = toVsdxInput(scene, spec, {});
  assert.equal(payload.edges.length, 1);
  const e = payload.edges[0];
  assert.ok(['Top', 'Right', 'Bottom', 'Left'].includes(e.fromPort));
  assert.ok(['Top', 'Right', 'Bottom', 'Left'].includes(e.toPort));
  assert.ok(e.style.lineColor);
});

test('toVsdxTheme 用的是 pt 而不是 px', () => {
  const t = toVsdxTheme(spec);
  // 12px 字号 → 9pt；如果误传 12 就会得到 12
  assert.ok(t.fontSize < spec.nodeName.size, 'fontSize 没有从 px 转成 pt');
  assert.ok(t.fontSize > 0);
});

test('页面尺寸 = 场景包围盒 + 两侧 padding', () => {
  const scene = sceneToLaid(buildScene(buildDoc(), spec));
  const payload = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 0 });
  assert.ok(Math.abs(payload.meta.pageW - (scene.width + spec.padding * 2)) < 0.001);
});

test('带标题时页面变高，等于标题高度', () => {
  const doc = buildDoc();
  const scene = sceneToLaid(buildScene(doc, spec));
  const noTitle = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 0 });
  const withTitle = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 60 });
  assert.ok(Math.abs(withTitle.meta.pageH - noTitle.meta.pageH - 60) < 0.001);
});

test('导出坐标全部落在页面范围内', () => {
  const scene = sceneToLaid(buildScene(buildDoc(), spec));
  const payload = toVsdxInput(scene, spec, { padding: spec.padding, titleHeight: 0 });
  for (const n of payload.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0, `${n.id} 坐标越界`);
    assert.ok(n.x + n.w <= payload.meta.pageW + GRID, `${n.id} 右边越界`);
    assert.ok(n.y + n.h <= payload.meta.pageH + GRID, `${n.id} 下边越界`);
  }
});
