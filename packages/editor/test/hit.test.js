import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hitBox,
  hitDiamond,
  hitNode,
  distToSegment,
  distToPolyline,
  pickNode,
  pickEdge,
  pickLabel,
  pickPort,
  pickInRect,
} from '../src/hit.js';

const box = (x, y, w = 100, h = 40, extra = {}) => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2, ...extra });

test('hitBox：内部命中，外部不命中，边界算命中', () => {
  const b = box(0, 0);
  assert.equal(hitBox({ x: 50, y: 20 }, b), true);
  assert.equal(hitBox({ x: -1, y: 20 }, b), false);
  assert.equal(hitBox({ x: 0, y: 0 }, b), true, '左上角应算命中');
  assert.equal(hitBox({ x: 100, y: 40 }, b), true, '右下角应算命中');
});

test('hitBox：slop 向外扩', () => {
  const b = box(0, 0);
  assert.equal(hitBox({ x: -3, y: 20 }, b), false);
  assert.equal(hitBox({ x: -3, y: 20 }, b, 4), true);
});

test('hitDiamond：四角不算命中，四边中点算命中', () => {
  const d = box(0, 0, 100, 40); // 菱形：(50,0) (100,20) (50,40) (0,20)
  assert.equal(hitDiamond({ x: 50, y: 20 }, d), true, '中心');
  assert.equal(hitDiamond({ x: 50, y: 0 }, d), true, '上顶点');
  assert.equal(hitDiamond({ x: 100, y: 20 }, d), true, '右顶点');
  assert.equal(hitDiamond({ x: 1, y: 1 }, d), false, '左上角在菱形外');
  assert.equal(hitDiamond({ x: 99, y: 39 }, d), false, '右下角在菱形外');
});

test('hitDiamond：菱形的边中点命中（那是凸出的地方）', () => {
  const d = box(0, 0, 100, 40);
  assert.equal(hitDiamond({ x: 75, y: 10 }, d), true);
  assert.equal(hitDiamond({ x: 25, y: 30 }, d), true);
});

test('hitNode：按类型分派（判断用菱形，其余用矩形）', () => {
  const decision = box(0, 0, 100, 40, { type: 'decision' });
  const process = box(0, 0, 100, 40, { type: 'process' });
  const corner = { x: 2, y: 2 };
  assert.equal(hitNode(corner, decision), false);
  assert.equal(hitNode(corner, process), true);
});

test('distToSegment：垂直、端点、退化线段', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.equal(distToSegment({ x: 50, y: 10 }, a, b), 10);
  assert.equal(distToSegment({ x: -10, y: 0 }, a, b), 10, '投影落到端点外应量到端点');
  assert.equal(distToSegment({ x: 5, y: 5 }, a, a), Math.hypot(5, 5), '零长线段退化为点距');
});

test('distToPolyline：取所有线段里的最小值', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.equal(distToPolyline({ x: 50, y: 3 }, pts), 3);
  assert.equal(distToPolyline({ x: 97, y: 50 }, pts), 3);
  assert.equal(distToPolyline({ x: 0, y: 0 }, pts), 0);
});

test('pickNode：返回最上面那个（数组后序）', () => {
  const under = box(0, 0, 100, 40, { id: 'under', type: 'process' });
  const over = box(0, 0, 100, 40, { id: 'over', type: 'process' });
  const hit = pickNode([under, over], { x: 50, y: 20 });
  assert.equal(hit.id, 'over');
});

test('pickNode：什么都没点中返回 null', () => {
  assert.equal(pickNode([box(0, 0)], { x: 500, y: 500 }), null);
  assert.equal(pickNode([], { x: 0, y: 0 }), null);
});

test('pickEdge：靠近线就选中，远了不选', () => {
  const e = { id: 'e1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  assert.equal(pickEdge([e], { x: 50, y: 4 })?.id, 'e1');
  assert.equal(pickEdge([e], { x: 50, y: 40 }), null);
});

test('pickEdge：多条线时选最近的', () => {
  const near = { id: 'near', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const far = { id: 'far', points: [{ x: 0, y: 5 }, { x: 100, y: 5 }] };
  assert.equal(pickEdge([far, near], { x: 50, y: 1 }, 8)?.id, 'near');
});

test('pickEdge：容差可调，细线别太难点', () => {
  const e = { id: 'e1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  assert.equal(pickEdge([e], { x: 50, y: 10 }, 4), null);
  assert.equal(pickEdge([e], { x: 50, y: 10 }, 12)?.id, 'e1');
});

test('pickLabel：命中标签框', () => {
  const l = { x: 10, y: 10, w: 40, h: 20, text: '是' };
  assert.equal(pickLabel([l], { x: 20, y: 20 }), l);
  assert.equal(pickLabel([l], { x: 200, y: 200 }), null);
});

test('pickPort：四条边中点各能点中，远端不命中', () => {
  const n = box(0, 0, 100, 40);
  assert.equal(pickPort({ x: 50, y: 0 }, n)?.side, 'top');
  assert.equal(pickPort({ x: 100, y: 20 }, n)?.side, 'right');
  assert.equal(pickPort({ x: 50, y: 40 }, n)?.side, 'bottom');
  assert.equal(pickPort({ x: 0, y: 20 }, n)?.side, 'left');
  assert.equal(pickPort({ x: 50, y: 20 }, n), null, '框中心不是端口');
});

test('pickPort：半径内的偏移仍能命中', () => {
  const n = box(0, 0, 100, 40);
  assert.equal(pickPort({ x: 53, y: 4 }, n, 10)?.side, 'top');
  assert.equal(pickPort({ x: 53, y: 4 }, n, 2), null);
});

test('pickInRect：部分相交即选中（不要求完全包住）', () => {
  const a = box(0, 0, 100, 40, { id: 'a' });
  const b = box(200, 200, 100, 40, { id: 'b' });
  const hit = pickInRect([a, b], { x: 90, y: 30, w: 20, h: 20 });
  assert.deepEqual(hit.map((n) => n.id), ['a']);
});

test('pickInRect：反向拖框（负宽高）也能用', () => {
  const a = box(0, 0, 100, 40, { id: 'a' });
  const hit = pickInRect([a], { x: 120, y: 60, w: -100, h: -100 });
  assert.deepEqual(hit.map((n) => n.id), ['a']);
});

test('pickInRect：空框不选中任何东西', () => {
  const a = box(0, 0, 100, 40, { id: 'a' });
  assert.deepEqual(pickInRect([a], { x: 500, y: 500, w: 0, h: 0 }), []);
});
