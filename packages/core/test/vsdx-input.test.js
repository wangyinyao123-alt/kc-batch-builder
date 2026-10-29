/**
 * 导出契约测试：排版结果交给 vsdx 导出器时，必须带齐它需要的每一样东西。
 *
 * 导出器（tools/vsdx-export）不认识本包的内部结构，只认「像素坐标 + 框 + 端口」
 * 这一份扁平数据。这个文件就是那份契约的测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMarkdown } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { resolveSpec, titleHeight } from '../src/theme.js';
import { toVsdxInput, toVsdxTheme, inferPorts, pxToPt } from '../src/vsdx-input.js';

const spec = resolveSpec('light');

const SRC = `# 运动控制流程

1. 初始化
2. 判断：已建立位置参考？
   - 否 → 回零：调用 MC_Home
   - 是 → 待机：检查模式和范围
3. 回零 => 待机
`;

const build = (opts) => {
  const d = parseMarkdown(SRC);
  const laid = layout(d, spec);
  return { d, laid, vin: toVsdxInput(laid, spec, opts) };
};

test('节点数量与文字原样传递，坐标加上页边距', () => {
  const { laid, vin } = build({});
  assert.equal(vin.nodes.length, laid.nodes.length);
  for (let i = 0; i < laid.nodes.length; i++) {
    const a = laid.nodes[i];
    const b = vin.nodes[i];
    assert.equal(b.id, a.id);
    assert.equal(b.text, a.text);
    assert.equal(b.type, a.type);
    assert.equal(b.w, a.w);
    assert.equal(b.h, a.h);
    assert.equal(b.x, a.x + spec.padding);
    assert.equal(b.y, a.y + spec.padding);
  }
});

test('标题高度会把所有元素整体下移，且页高同步增加', () => {
  const th = titleHeight(spec, true);
  const a = build({});
  const b = build({ titleHeight: th });
  assert.equal(b.vin.nodes[0].y - a.vin.nodes[0].y, th);
  assert.equal(b.vin.meta.pageH - a.vin.meta.pageH, th);
  assert.equal(b.vin.meta.pageW, a.vin.meta.pageW);
});

test('页尺寸包得住所有节点', () => {
  const { vin } = build({ titleHeight: titleHeight(spec, true) });
  for (const n of vin.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0, `${n.id} 有负坐标`);
    assert.ok(n.x + n.w <= vin.meta.pageW, `${n.id} 右溢出`);
    assert.ok(n.y + n.h <= vin.meta.pageH, `${n.id} 下溢出`);
  }
});

test('每条连线都带合法的连接点名', () => {
  const VALID = new Set(['Top', 'Right', 'Bottom', 'Left']);
  const { vin } = build({});
  assert.equal(vin.edges.length, 4);
  for (const e of vin.edges) {
    assert.ok(VALID.has(e.fromPort), `非法出口 ${e.fromPort}`);
    assert.ok(VALID.has(e.toPort), `非法入口 ${e.toPort}`);
  }
});

test('分支标签带文字与位置', () => {
  const { vin } = build({});
  assert.equal(vin.labels.length, 2);
  assert.deepEqual(vin.labels.map((l) => l.text).sort(), ['否', '是'].sort());
  for (const l of vin.labels) {
    assert.ok(l.w > 0 && l.h > 0);
  }
});

test('inferPorts：下方节点从底部出，上方节点从顶部出', () => {
  const a = { cx: 100, cy: 100 };
  const below = { cx: 100, cy: 300 };
  const above = { cx: 100, cy: 0 };
  const right = { cx: 400, cy: 100 };
  const left = { cx: -200, cy: 100 };
  assert.deepEqual(inferPorts(a, below), { fromPort: 'Bottom', toPort: 'Top' });
  assert.deepEqual(inferPorts(a, above), { fromPort: 'Top', toPort: 'Bottom' });
  assert.deepEqual(inferPorts(a, right), { fromPort: 'Right', toPort: 'Left' });
  assert.deepEqual(inferPorts(a, left), { fromPort: 'Left', toPort: 'Right' });
});

test('inferPorts：斜向时按主轴取，与 dagre 的正交路由一致', () => {
  // 偏移 100 横向、300 纵向 → 主轴是纵向
  assert.deepEqual(inferPorts({ cx: 0, cy: 0 }, { cx: 100, cy: 300 }), {
    fromPort: 'Bottom',
    toPort: 'Top',
  });
  // 偏移 300 横向、100 纵向 → 主轴是横向
  assert.deepEqual(inferPorts({ cx: 0, cy: 0 }, { cx: 300, cy: 100 }), {
    fromPort: 'Right',
    toPort: 'Left',
  });
});

test('主题换算：px → pt 按 96/72', () => {
  assert.equal(pxToPt(12), 9);
  assert.equal(pxToPt(16), 12);
  const theme = toVsdxTheme(spec);
  assert.equal(theme.fontSize, 9); // 节点字号 12px = 9pt
  assert.equal(theme.fillColor, spec.theme.paper);
  assert.equal(theme.lineColor, spec.theme.ink);
  assert.equal(theme.fontColor, spec.theme.ink);
});

test('空图交给导出器不崩', () => {
  const laid = layout(parseMarkdown(''), spec);
  const vin = toVsdxInput(laid, spec, {});
  assert.deepEqual(vin.nodes, []);
  assert.deepEqual(vin.edges, []);
  assert.equal(vin.meta.pageW, spec.padding * 2);
});
