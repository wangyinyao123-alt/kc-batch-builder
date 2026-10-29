/**
 * 版式不变量测试。
 *
 * 这些用例替代「用眼睛看」——排版对不对是可以算出来的：
 * 框量得对不对、连线有没有接在边框上、标签有没有压到节点、页面有没有切掉内容。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMarkdown } from '../src/parse.js';
import { layout, measureNode } from '../src/layout.js';
import { renderSvg } from '../src/render.js';
import { resolveSpec } from '../src/theme.js';
import { textWidth } from '../src/measure.js';

const spec = resolveSpec('light');

const SIMPLE = `# 运动控制流程

1. 初始化
2. 判断：已建立位置参考？
   - 否 → 回零：调用 MC_Home
   - 是 → 待机：检查模式和范围
3. 回零 => 待机
`;

const COMPLEX = `# 订单退款流程

1. 开始
2. 用户提交退款申请
3. 判断：订单是否已发货？
   - 否 → 直接退款
   - 是 → 判断：商品是否影响二次销售？
     - 否 → 人工审核
     - 是 → 驳回申请
4. 直接退款 => 财务打款
5. 人工审核 => 财务打款
6. 判断：打款是否成功？
   - 是 → 通知用户，流程结束
   - 否 → 重试三次
7. 重试三次 => 人工介入
8. 结束
`;

const LONG = `# 长文本

1. 开始
2. 这是一个特别特别长的步骤说明，用来测试框宽会不会算错，以及折行之后文字会不会溢出边框
3. 调用 MC_Home 之后需要检查 ERROR_CODE_404_NOT_FOUND 这个返回值
4. 结束
`;

function laid(src) {
  return layout(parseMarkdown(src), spec);
}

const isGrid = (v) => v % 4 === 0;

test('所有节点的坐标与尺寸都在 4px 网格上', () => {
  for (const src of [SIMPLE, COMPLEX, LONG]) {
    const out = laid(src);
    for (const n of out.nodes) {
      assert.ok(isGrid(n.x) && isGrid(n.y), `${n.id} 坐标 ${n.x},${n.y} 不在网格上`);
      assert.ok(isGrid(n.w) && isGrid(n.h), `${n.id} 尺寸 ${n.w}x${n.h} 不在网格上`);
    }
    assert.ok(isGrid(out.width) && isGrid(out.height), '页面尺寸不在网格上');
  }
});

test('节点之间互不重叠', () => {
  const out = laid(COMPLEX);
  for (let i = 0; i < out.nodes.length; i++) {
    for (let j = i + 1; j < out.nodes.length; j++) {
      const a = out.nodes[i];
      const b = out.nodes[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `节点「${a.id}」与「${b.id}」重叠`);
    }
  }
});

test('每行文字都装得进框里', () => {
  for (const src of [SIMPLE, COMPLEX, LONG]) {
    const out = laid(src);
    for (const n of out.nodes) {
      for (const line of n.lines) {
        const w = textWidth(line, spec.nodeName.size);
        assert.ok(
          w <= n.w,
          `节点「${n.id}」的文字「${line}」宽 ${w.toFixed(1)} 超出框宽 ${n.w}`,
        );
      }
    }
  }
});

test('连线的首尾点落在节点边框上', () => {
  const out = laid(COMPLEX);
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  const near = (p, n) => {
    const insideX = p.x >= n.x - 1 && p.x <= n.x + n.w + 1;
    const insideY = p.y >= n.y - 1 && p.y <= n.y + n.h + 1;
    const onBorder =
      Math.abs(p.x - n.x) <= 1 ||
      Math.abs(p.x - (n.x + n.w)) <= 1 ||
      Math.abs(p.y - n.y) <= 1 ||
      Math.abs(p.y - (n.y + n.h)) <= 1;
    return insideX && insideY && onBorder;
  };
  for (const e of out.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    assert.ok(near(e.points[0], a), `${e.from} 的起点没贴住框`);
    assert.ok(near(e.points.at(-1), b), `${e.to} 的终点没贴住框`);
  }
});

test('分支标签不压在节点上', () => {
  const out = laid(COMPLEX);
  for (const l of out.labels) {
    for (const n of out.nodes) {
      const overlap =
        l.x < n.x + n.w && n.x < l.x + l.w && l.y < n.y + n.h && n.y < l.y + l.h;
      assert.ok(!overlap, `标签「${l.text}」压在节点「${n.id}」上`);
    }
  }
});

test('分支标签互不重叠', () => {
  const out = laid(COMPLEX);
  for (let i = 0; i < out.labels.length; i++) {
    for (let j = i + 1; j < out.labels.length; j++) {
      const a = out.labels[i];
      const b = out.labels[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `标签「${a.text}」与「${b.text}」重叠`);
    }
  }
});

test('页面包围盒包住全部节点、连线与标签', () => {
  for (const src of [SIMPLE, COMPLEX, LONG]) {
    const out = laid(src);
    for (const n of out.nodes) {
      assert.ok(n.x >= 0 && n.y >= 0, `${n.id} 有负坐标`);
      assert.ok(n.x + n.w <= out.width, `${n.id} 右溢出`);
      assert.ok(n.y + n.h <= out.height, `${n.id} 下溢出`);
    }
    for (const e of out.edges) {
      for (const p of e.points) {
        assert.ok(p.x >= 0 && p.y >= 0, '连线有负坐标');
        assert.ok(p.x <= out.width && p.y <= out.height, '连线溢出页面');
      }
    }
    for (const l of out.labels) {
      assert.ok(l.x >= 0 && l.y >= 0, '标签有负坐标');
      assert.ok(l.x + l.w <= out.width, '标签右溢出');
      assert.ok(l.y + l.h <= out.height, '标签下溢出');
    }
  }
});

test('同一输入两次排版结果完全一致', () => {
  assert.deepEqual(laid(COMPLEX), laid(COMPLEX));
});

test('菱形框比同文字的矩形框宽，且始终是判断节点的形状依据', () => {
  const d = measureNode({ type: 'decision', text: '已建立位置参考？' }, spec);
  const p = measureNode({ type: 'process', text: '已建立位置参考？' }, spec);
  assert.ok(d.w > p.w, '菱形应更宽');
  assert.ok(d.h > p.h, '菱形应更高');
});

test('起止椭圆比流程框矮', () => {
  const s = measureNode({ type: 'start', text: '开始' }, spec);
  const p = measureNode({ type: 'process', text: '开始' }, spec);
  assert.ok(s.h <= p.h);
});

test('空图不报错', () => {
  const out = laid('');
  assert.deepEqual(out.nodes, []);
  assert.equal(out.width, 0);
  const svg = renderSvg(out, spec, {});
  assert.match(svg, /<svg /);
});

test('SVG 结构：每个节点一个形状，每条连线一条 path', () => {
  const out = laid(COMPLEX);
  const svg = renderSvg(out, spec, { title: '订单退款流程' });
  const rects = (svg.match(/<rect /g) || []).length;
  const polys = (svg.match(/<polygon /g) || []).length;
  // 注意：<defs> 里的箭头 marker 本身也是一个 <path>，不能按 <path 计数
  const paths = (svg.match(/marker-end="url\(#arrow\)"/g) || []).length;
  const decisions = out.nodes.filter((n) => n.type === 'decision').length;
  assert.equal(polys, decisions, '菱形数量不对');
  // 非判断节点各一个矩形 + 背景一块 + 每个标签一块纸底色（防止标签压到别的连线）
  assert.equal(rects, out.nodes.length - decisions + 1 + out.labels.length, '矩形数量不对');
  assert.equal(paths, out.edges.length, '连线数量不对');
});

test('SVG 转义特殊字符，不破坏文档', () => {
  const d = parseMarkdown(`# A & B\n\n1. a < b & c > d\n2. 结束\n`);
  const out = layout(d, spec);
  const svg = renderSvg(out, spec, { title: d.title });
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /a &lt; b &amp; c &gt; d/);
  assert.ok(!svg.includes('<title id="dgm-title">A & B'), '标题未转义');
});

test('SVG 根元素带 viewBox 与尺寸', () => {
  const out = laid(SIMPLE);
  const svg = renderSvg(out, spec, { title: '运动控制流程' });
  const m = svg.match(/width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(m, '缺少 width/height/viewBox');
  assert.equal(m[1], m[3]);
  assert.equal(m[2], m[4]);
});

test('深色主题只换色，不改几何', () => {
  const src = COMPLEX;
  const a = layout(parseMarkdown(src), resolveSpec('light'));
  const b = layout(parseMarkdown(src), resolveSpec('dark'));
  assert.deepEqual(
    a.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h]),
    b.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h]),
  );
  const svgLight = renderSvg(a, resolveSpec('light'), {});
  const svgDark = renderSvg(b, resolveSpec('dark'), {});
  assert.match(svgLight, /#f5f5f5/);
  assert.match(svgDark, /#2d3142/);
});
