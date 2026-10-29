import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  newView,
  toScreen,
  toWorld,
  zoomAt,
  zoomBy,
  panBy,
  fitBox,
  unionBounds,
} from '../src/viewport.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('默认视口是 1 倍、无平移', () => {
  const v = newView();
  assert.deepEqual(v, { scale: 1, tx: 0, ty: 0 });
});

test('toScreen 与 toWorld 互为逆运算', () => {
  const v = { scale: 1.75, tx: -30, ty: 42 };
  for (const p of [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: -12, y: 333 }]) {
    const back = toWorld(v, toScreen(v, p));
    assert.ok(near(back.x, p.x) && near(back.y, p.y), `${JSON.stringify(p)} 往返失真`);
  }
});

test('toScreen 的换算是 p*scale + t', () => {
  const s = toScreen({ scale: 2, tx: 10, ty: -5 }, { x: 3, y: 4 });
  assert.equal(s.x, 16);
  assert.equal(s.y, 3);
});

test('clampScale 卡在 [MIN_SCALE, MAX_SCALE]', () => {
  assert.equal(clampScale(0.0001), MIN_SCALE);
  assert.equal(clampScale(999), MAX_SCALE);
  assert.equal(clampScale(1.5), 1.5);
});

test('zoomAt 让锚点下方的世界坐标保持不动', () => {
  const v = { scale: 1, tx: 20, ty: 10 };
  const anchor = { x: 300, y: 200 };
  const before = toWorld(v, anchor);
  const next = zoomAt(v, anchor, 2.5);
  const after = toWorld(next, anchor);
  assert.ok(near(before.x, after.x) && near(before.y, after.y), '缩放后锚点漂移了');
  assert.equal(next.scale, 2.5);
});

test('zoomAt 超出范围时按边界缩放，锚点仍不漂', () => {
  const v = { scale: 1, tx: 0, ty: 0 };
  const anchor = { x: 100, y: 100 };
  const before = toWorld(v, anchor);
  const next = zoomAt(v, anchor, 99);
  assert.equal(next.scale, MAX_SCALE);
  const after = toWorld(next, anchor);
  assert.ok(near(before.x, after.x) && near(before.y, after.y));
});

test('zoomBy 是倍率版 zoomAt', () => {
  const v = { scale: 1.2, tx: 5, ty: 5 };
  const a = zoomBy(v, { x: 50, y: 60 }, 1.5);
  const b = zoomAt(v, { x: 50, y: 60 }, 1.2 * 1.5);
  assert.deepEqual(a, b);
});

test('panBy 只改平移不改缩放', () => {
  const v = panBy({ scale: 2, tx: 0, ty: 0 }, 15, -8);
  assert.deepEqual(v, { scale: 2, tx: 15, ty: -8 });
});

test('fitBox 把内容居中铺满', () => {
  const bounds = { x: 100, y: 100, w: 200, h: 100 };
  const size = { width: 800, height: 600 };
  const v = fitBox(bounds, size, 0);
  assert.equal(v.scale, 4, '宽度受限时取宽高比里小的那个');
  // 内容中心 (200,150) 应落在视口中心 (400,300)
  const center = toScreen(v, { x: 200, y: 150 });
  assert.ok(near(center.x, 400) && near(center.y, 300), '内容没居中');
});

test('fitBox 高度受限时按高度缩放', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 500 };
  const v = fitBox(bounds, { width: 800, height: 600 }, 0);
  assert.equal(v.scale, 1.2);
});

test('fitBox 受 pad 影响，且尊重缩放上下限', () => {
  const v = fitBox({ x: 0, y: 0, w: 10, h: 10 }, { width: 800, height: 600 }, 48);
  assert.equal(v.scale, MAX_SCALE, '内容极小时不该无限放大');
});

test('fitBox 对退化输入返回默认视口，不抛异常', () => {
  assert.deepEqual(fitBox(null, { width: 800, height: 600 }), newView());
  assert.deepEqual(fitBox({ x: 0, y: 0, w: 0, h: 10 }, { width: 800, height: 600 }), newView());
  assert.deepEqual(fitBox({ x: 0, y: 0, w: 10, h: 10 }, { width: 0, height: 0 }), newView());
});

test('unionBounds 合并多个框', () => {
  const b = unionBounds([
    { x: 10, y: 20, w: 30, h: 40 },
    { x: 100, y: 0, w: 10, h: 10 },
  ]);
  assert.deepEqual(b, { x: 10, y: 0, w: 100, h: 60 });
});

test('unionBounds 空输入返回 null（不是零框，零框会把视口缩到极限）', () => {
  assert.equal(unionBounds([]), null);
  assert.equal(unionBounds(null), null);
});

test('连续缩放后往返仍然一致（数值稳定性）', () => {
  let v = newView();
  for (let i = 0; i < 20; i++) v = zoomBy(v, { x: 400, y: 300 }, 1.1);
  const back = toWorld(v, toScreen(v, { x: 12, y: 34 }));
  assert.ok(near(back.x, 12, 1e-4) && near(back.y, 34, 1e-4));
});
