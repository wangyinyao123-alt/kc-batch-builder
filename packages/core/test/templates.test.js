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

// WCAG 相对亮度与对比度。模板最容易翻车的地方是「深色底配深色字」，
// 而这类问题在代码里看不出来，必须算。
function luminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('每套模板的文字对比度都过 WCAG AA（4.5:1）', () => {
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    for (const type of ['start', 'end', 'process', 'decision', 'note']) {
      const sh = shapeOf(spec, type);
      const fillRole = colorOf(spec, sh.fill);
      // 无填充的节点视觉上就是纸色
      const bg = fillRole === 'none' ? spec.theme.paper : fillRole;
      const fg = colorOf(spec, sh.text);
      const ratio = contrast(bg, fg);
      assert.ok(
        ratio >= 4.5,
        `${name}/${type} 文字对比度 ${ratio.toFixed(2)}:1 低于 AA（底色 ${bg}，字色 ${fg}）`,
      );
    }
    // 分支标签也要读得清
    const labBg = spec.theme.paper;
    const labFg = spec.theme.muted;
    assert.ok(
      contrast(labBg, labFg) >= 4.5,
      `${name} 分支标签对比度 ${contrast(labBg, labFg).toFixed(2)}:1 低于 AA`,
    );
  }
});

test('连线颜色与纸面有足够区分度（3:1，图形元素标准）', () => {
  for (const name of NAMES) {
    const spec = resolveSpec(name);
    const ratio = contrast(spec.theme.paper, colorOf(spec, spec.edge.color));
    assert.ok(ratio >= 3, `${name} 连线对比度 ${ratio.toFixed(2)}:1 偏低`);
  }
});

test('listTemplates / listPalettes 与常量表一致', () => {
  assert.equal(listTemplates().length, NAMES.length);
  assert.equal(listPalettes().length, Object.keys(PALETTES).length);
  for (const t of listTemplates()) {
    assert.ok(t.name && t.label, '模板列表项缺 name/label');
  }
});

// ---------------------------------------------------------------- edge 覆盖项

test('resolveSpec：edge 是逐字段合并，只覆盖一个字段不会丢其他', () => {
  const base = resolveSpec('default');
  const spec = resolveSpec('default', { edge: { corner: 6 } });
  assert.equal(spec.edge.corner, 6);
  // 这三项必须还在，否则箭头消失、连线变黑
  assert.equal(spec.edge.color, base.edge.color);
  assert.equal(spec.edge.arrow, base.edge.arrow);
  assert.equal(spec.edge.width, base.edge.width);
});

test('resolveSpec：每套模板都有完整的 edge 字段（含 arrowSize 与 corner）', () => {
  for (const t of listTemplates()) {
    const spec = resolveSpec(t.name);
    assert.ok(Number.isFinite(spec.edge.width), `${t.name} 缺 width`);
    assert.ok(Number.isFinite(spec.edge.arrowSize), `${t.name} 缺 arrowSize`);
    assert.ok(Number.isFinite(spec.edge.corner), `${t.name} 缺 corner`);
    assert.ok(['triangle', 'open', 'none'].includes(spec.edge.arrow), `${t.name} 箭头类型异常`);
  }
});

test('resolveSpec：覆盖项不会污染下一次调用', () => {
  resolveSpec('default', { edge: { width: 4 } });
  assert.notEqual(resolveSpec('default').edge.width, 4);
});
