import test from 'node:test';
import assert from 'node:assert/strict';

import { arrowMarkers, pathData, renderEdge } from '../src/paint.js';
import { resolveSpec } from '../src/templates.js';
import { DEFAULT_SPEC } from '../src/theme.js';

/** 从 marker 字符串里抠出尺寸相关属性。 */
const markerSize = (svg) => {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const mw = /markerWidth="([\d.]+)"/.exec(svg);
  return { vb: Number(vb[1]), markerWidth: Number(mw[1]) };
};

test('箭头默认 12px —— 8px 在 12px 字号的图里小到看不见', () => {
  assert.equal(DEFAULT_SPEC.edge.arrowSize, 12);
  // arrowMarkers 要查配色，所以得用 resolveSpec 出来的 spec（带 palette）
  const { vb, markerWidth } = markerSize(arrowMarkers(resolveSpec('default')));
  assert.equal(vb, 12);
  assert.equal(markerWidth, 12);
});

test('箭头大小跟着 arrowSize 走，viewBox 与 marker 尺寸同步', () => {
  const spec = resolveSpec('default', { edge: { arrowSize: 24 } });
  const { vb, markerWidth } = markerSize(arrowMarkers(spec));
  assert.equal(vb, 24);
  assert.equal(markerWidth, 24);
  // refX 要贴三角形尖端，否则箭头会缩到线里
  const refX = Number(/refX="([\d.]+)"/.exec(arrowMarkers(spec))[1]);
  assert.equal(refX, 23);
});

test('arrowSize 有下限，不会退化成不可见的点', () => {
  const spec = resolveSpec('default', { edge: { arrowSize: 0 } });
  assert.ok(markerSize(arrowMarkers(spec)).vb >= 4);
});

test('arrowSize 是坏值时退回默认 12，不是 NaN 属性', () => {
  const spec = resolveSpec('default', { edge: { arrowSize: 'x' } });
  const { vb } = markerSize(arrowMarkers(spec));
  assert.equal(vb, 12);
});

test('paint 的箭头几何：尖端在 refX，底边两点对称', () => {
  const spec = resolveSpec('default', { edge: { arrowSize: 10 } });
  const svg = arrowMarkers(spec);
  assert.match(svg, /d="M0,0 L10,5 L0,10 z"/);
  assert.match(svg, /refY="5"/);
  assert.match(svg, /orient="auto-start-reverse"/);
});

// ---------------------------------------------------------------- 圆角路径

const segs = (points) => points.slice(1).map((p, i) => ({ a: points[i], b: p }));

test('pathData：corner=0 时是纯折线，和旧行为一致', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];
  assert.equal(pathData(pts, 0), 'M0,0 L100,0 L100,80');
});

test('pathData：corner>0 时拐点变成二次贝塞尔，端点不动', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];
  const d = pathData(pts, 10);
  assert.match(d, /^M0,0 L90,0 Q100,0 100,10 L100,80$/);
});

test('pathData：圆角半径不超过相邻线段的一半，短段不会画出圈', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 80 },
  ];
  const d = pathData(pts, 40);
  // 6px 的段只能给 3px 圆角，否则两段圆弧会重叠
  assert.match(d, /L3,0 Q6,0 6,3/);
});

test('pathData：退化输入不产 NaN', () => {
  assert.equal(pathData([], 8), '');
  assert.equal(pathData([{ x: 1, y: 2 }], 8), '');
  assert.doesNotMatch(pathData([{ x: 0, y: 0 }, { x: 0, y: 0 }], 8), /NaN/);
});

test('renderEdge：圆角设置真的进了 d 属性', () => {
  const spec = resolveSpec('default', { edge: { corner: 8 } });
  const edge = {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ],
    label: '',
  };
  for (const corner of [0, 8]) {
    const s = resolveSpec('default', { edge: { corner } });
    const svg = renderEdge(edge, s);
    assert.equal(/Q/.test(svg), corner > 0);
  }
  assert.match(renderEdge(edge, spec), /stroke-width="1"/);
});

test('renderEdge：arrow 为 none 时不挂 marker', () => {
  const spec = resolveSpec('default', { edge: { arrow: 'none' } });
  const svg = renderEdge({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, spec);
  assert.doesNotMatch(svg, /marker-end/);
});

test('renderEdge：两条点不足的边不产空路径之外的脏东西', () => {
  assert.equal(renderEdge({ points: [] }, DEFAULT_SPEC), '');
  assert.equal(renderEdge({ points: [{ x: 0, y: 0 }] }, DEFAULT_SPEC), '');
});
