/**
 * 模板测试：守两件事 ——
 *   1) 每套模板都能解析成完整 spec，缺字段时有兜底，不会渲染出 undefined。
 *   2) 模板之间的差异是「结构性的」（形状/笔画/字号），不只是换颜色。
 *      只换色等于假模板，这条用例就是防止以后退化成那样。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETTES,
  TEMPLATES,
  SHAPE_KINDS,
  resolveSpec,
  shapeOf,
  colorOf,
  listTemplates,
  listPalettes,
} from '../src/templates.js';
import { parseMarkdown } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { renderSvg } from '../src/render.js';

const SAMPLE = `# 退款流程

1. 开始
2. 用户提交退款申请
3. 判断：订单是否已发货？
  - 否 → 直接退款
  - 是 → 判断：商品是否影响二次销售？
    - 否 → 人工审核
    - 是 → 驳回申请
4. 直接退款 => 财务打款
5. 人工审核 => 财务打款
6. 驳回申请 => 通知用户，流程结束
7. 财务打款
8. 打款是否成功？
  - 是 → 通知用户，流程结束
  - 否 → 重试三次
9. 重试三次 => @财务打款
10. 通知用户，流程结束
11. 结束
`;

const NAMES = Object.keys(TEMPLATES);

test('每套模板都能解析出完整 spec', () => {
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    assert.ok(spec.theme?.paper, `${name} 缺 theme.paper`);
    assert.ok(spec.theme?.ink, `${name} 缺 theme.ink`);
    assert.ok(spec.nodeName.size > 0, `${name} 字号非法`);
    assert.ok(spec.padding > 0, `${name} padding 非法`);
    assert.ok(spec.nodeGap > 0, `${name} nodeGap 非法`);
    assert.ok(spec.rankGap > 0, `${name} rankGap 非法`);
    assert.ok(spec.fontSans, `${name} 缺 fontSans`);
    assert.ok(spec.edge, `${name} 缺 edge 配置`);
  }
});

test('每个节点的形状都能落到三种合法 kind 之一', () => {
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    for (const type of ['start', 'end', 'process', 'decision', 'note']) {
      const sh = shapeOf(spec, type);
      assert.ok(SHAPE_KINDS.includes(sh.kind), `${name}/${type} kind=${sh.kind} 不合法`);
      assert.ok(sh.fill, `${name}/${type} 缺 fill 角色`);
      assert.ok(sh.stroke, `${name}/${type} 缺 stroke 角色`);
      assert.ok(sh.text, `${name}/${type} 缺 text 角色`);
    }
  }
});

test('每套模板的颜色角色都能解析成实际色值', () => {
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    for (const type of ['start', 'process', 'decision']) {
      const sh = shapeOf(spec, type);
      for (const role of [sh.fill, sh.stroke, sh.text]) {
        const v = colorOf(spec, role);
        assert.match(v, /^(#[0-9a-f]{6}|none)$/i, `${name}/${type} 颜色 ${role}=${v} 非法`);
      }
    }
    assert.match(colorOf(spec, spec.edge.color), /^#[0-9a-f]{6}$/i);
  }
});

test('模板之间是结构性差异，不只是换色', () => {
  const specs = NAMES.map((n) => resolveSpec(n));
  // 至少有两套模板的起止形状不同（pill vs rect）
  const startKinds = new Set(specs.map((s) => shapeOf(s, 'start').kind));
  assert.ok(startKinds.size >= 2, '所有模板的起止形状都一样，模板退化成换色');

  // 至少有两套模板的字号不同
  const sizes = new Set(specs.map((s) => s.nodeName.size));
  assert.ok(sizes.size >= 2, '所有模板字号都一样');

  // 至少有两套模板的间距不同
  const gaps = new Set(specs.map((s) => `${s.nodeGap}/${s.rankGap}`));
  assert.ok(gaps.size >= 2, '所有模板间距都一样');

  // 至少有一套模板的箭头不是实心三角
  const arrows = new Set(specs.map((s) => s.edge.arrow));
  assert.ok(arrows.size >= 2, '所有模板箭头样式都一样');
});

test('minimal 真的是直角 + 无填充', () => {
  const spec = resolveSpec('minimal');
  assert.equal(shapeOf(spec, 'process').fill, 'none');
  assert.equal(shapeOf(spec, 'start').kind, 'rect');
});

test('business 的起止是反白实心（深底浅字）', () => {
  const spec = resolveSpec('business');
  const start = shapeOf(spec, 'start');
  assert.equal(start.kind, 'pill');
  assert.notEqual(colorOf(spec, start.fill), colorOf(spec, start.text));
  // 深底：起止填充色应该等于强调色，而不是纸色
  assert.notEqual(colorOf(spec, start.fill), spec.theme.paper);
});

test('未知模板/配色抛出可读错误', () => {
  assert.throws(() => resolveSpec('nope'), /未知模板/);
  assert.throws(() => resolveSpec('default', { palette: 'nope' }), /未知配色/);
});

test('旧签名兼容：传配色名等价于默认模板 + 该配色', () => {
  const a = resolveSpec('light');
  const b = resolveSpec('default', { palette: 'light' });
  assert.equal(a.theme.paper, b.theme.paper);
  assert.equal(a.theme.ink, b.theme.ink);
  assert.equal(a.nodeName.size, b.nodeName.size);
});

test('模板与配色正交：可任意组合', () => {
  for (const t of NAMES) {
    for (const p of Object.keys(PALETTES)) {
      const spec = resolveSpec(t, { palette: p });
      assert.equal(spec.theme.paper, PALETTES[p].paper, `${t}+${p} 配色没生效`);
      assert.equal(shapeOf(spec, 'start').kind, shapeOf(resolveSpec(t), 'start').kind);
    }
  }
});

test('每套模板渲染出的 SVG 都是自洽的', () => {
  const d = parseMarkdown(SAMPLE);
  assert.ok(d.nodes.length >= 10, '样例图节点太少，测试失去意义');
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    const laid = layout(d, spec);
    const svg = renderSvg(laid, spec, { title: d.title });

    // 不能有 undefined / NaN 漏进属性
    assert.ok(!/undefined/.test(svg), `${name} 的 SVG 里有 undefined`);
    assert.ok(!/NaN/.test(svg), `${name} 的 SVG 里有 NaN`);
    // 每套模板都画出全部节点和连线
    const texts = (svg.match(/<text /g) || []).length;
    assert.ok(texts >= laid.nodes.length, `${name} 文字数量不足：${texts} < ${laid.nodes.length}`);
    const paths = (svg.match(/marker-end="url\(#arrow\)"/g) || []).length;
    if (spec.edge.arrow !== 'none') {
      assert.equal(paths, laid.edges.length, `${name} 连线数量不对：${paths} != ${laid.edges.length}`);
    }
    // 4px 网格
    for (const n of laid.nodes) {
      for (const k of ['x', 'y', 'w', 'h']) {
        assert.equal(n[k] % 4, 0, `${name} 节点 ${n.id}.${k}=${n[k]} 不在 4px 网格上`);
      }
    }
  }
});

test('模板只改外观，不改图结构（节点数/连线数/顺序）', () => {
  const d = parseMarkdown(SAMPLE);
  const base = layout(d, resolveSpec('default'));
  for (const name of NAMES) {
    const laid = layout(d, resolveSpec(name));
    assert.equal(laid.nodes.length, base.nodes.length, `${name} 节点数变了`);
    assert.equal(laid.edges.length, base.edges.length, `${name} 连线数变了`);
    assert.deepEqual(
      laid.nodes.map((n) => n.id),
      base.nodes.map((n) => n.id),
      `${name} 节点顺序变了`,
    );
  }
});

test('listTemplates / listPalettes 与常量表一致', () => {
  assert.equal(listTemplates().length, NAMES.length);
  assert.equal(listPalettes().length, Object.keys(PALETTES).length);
  for (const t of listTemplates()) {
    assert.ok(t.name && t.label, '模板列表项缺 name/label');
  }
});
