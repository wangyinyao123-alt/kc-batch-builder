import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OUT,
  SIDES,
  portPoint,
  inferSides,
  orthogonalRoute,
} from '../../core/src/route.js';

const box = (x, y, w = 120, h = 48) => ({ id: `n_${x}_${y}`, x, y, w, h });

// ---------------------------------------------------------------- 端口

test('portPoint：四个边的中点，坐标正确', () => {
  const b = box(100, 200, 120, 48); // 中心 (160, 224)
  assert.deepEqual(portPoint(b, 'top'), { x: 160, y: 200 });
  assert.deepEqual(portPoint(b, 'bottom'), { x: 160, y: 248 });
  assert.deepEqual(portPoint(b, 'left'), { x: 100, y: 224 });
  assert.deepEqual(portPoint(b, 'right'), { x: 220, y: 224 });
});

test('portPoint：未知方向抛错而不是返回 undefined', () => {
  assert.throws(() => portPoint(box(0, 0), 'up'), /未知端口方向/);
});

test('SIDES 常量完整', () => {
  assert.deepEqual(SIDES, ['top', 'right', 'bottom', 'left']);
});

// ---------------------------------------------------------------- 方向推断

test('inferSides：目标在正下方 → bottom/top', () => {
  const a = box(100, 0);
  const b = box(100, 200);
  assert.deepEqual(inferSides(a, b), { fromSide: 'bottom', toSide: 'top' });
});

test('inferSides：目标在正上方 → top/bottom', () => {
  const a = box(100, 200);
  const b = box(100, 0);
  assert.deepEqual(inferSides(a, b), { fromSide: 'top', toSide: 'bottom' });
});

test('inferSides：目标在右侧 → right/left', () => {
  const a = box(0, 100);
  const b = box(300, 100);
  assert.deepEqual(inferSides(a, b), { fromSide: 'right', toSide: 'left' });
});

test('inferSides：目标在左侧 → left/right', () => {
  const a = box(300, 100);
  const b = box(0, 100);
  assert.deepEqual(inferSides(a, b), { fromSide: 'left', toSide: 'right' });
});

test('inferSides：与 vsdx inferPorts 一致（竖线用上下，横线用左右）', async () => {
  const { inferPorts } = await import('../../core/src/vsdx-input.js');
  const cases = [
    [box(100, 0), box(100, 300)],
    [box(100, 300), box(100, 0)],
    [box(0, 100), box(300, 100)],
    [box(300, 100), box(0, 100)],
    // 完全重叠：两个函数都不该崩
    [box(0, 0), box(0, 0)],
  ];
  for (const [a, b] of cases) {
    const mine = inferSides(a, b);
    // inferPorts 读的是 cx / cy（中心点），必须补上
    const withCenter = (bx) => ({ ...bx, cx: bx.x + bx.w / 2, cy: bx.y + bx.h / 2 });
    const theirs = inferPorts(withCenter(a), withCenter(b));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    assert.equal(cap(mine.fromSide), theirs.fromPort, '出线侧不一致');
    assert.equal(cap(mine.toSide), theirs.toPort, '入线侧不一致');
  }
});

// ---------------------------------------------------------------- 路由结果

test('正交路由：任意两框之间都只有水平或垂直段，没有斜线', () => {
  const pairs = [
    [box(100, 0), box(100, 200)],
    [box(0, 100), box(300, 100)],
    [box(0, 0), box(400, 300)],
    [box(400, 300), box(0, 0)],
    [box(200, 200), box(200, 0)],
  ];
  for (const [a, b] of pairs) {
    const pts = orthogonalRoute(a, b);
    assert.ok(pts.length >= 2, '至少两个点');
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const axisAligned = p.x === q.x || p.y === q.y;
      assert.ok(
        axisAligned,
        `第 ${i} 段不是正交：${JSON.stringify(p)} → ${JSON.stringify(q)}`,
      );
    }
  }
});

test('正交路由：首点落在起点框边上，末点落在终点框边上', () => {
  const a = box(100, 0);
  const b = box(100, 200);
  const pts = orthogonalRoute(a, b);
  const onBox = (p, bx) =>
    (p.x === bx.x || p.x === bx.x + bx.w) && p.y >= bx.y && p.y <= bx.y + bx.h ||
    (p.y === bx.y || p.y === bx.y + bx.h) && p.x >= bx.x && p.x <= bx.x + bx.w;
  assert.ok(onBox(pts[0], a), `首点不在起点框边上：${JSON.stringify(pts[0])}`);
  assert.ok(onBox(pts.at(-1), b), `末点不在终点框边上：${JSON.stringify(pts.at(-1))}`);
});

test('正交路由：出线方向垂直于框边（先沿法线走，不贴着边拐弯）', () => {
  const a = box(100, 0);
  const b = box(300, 200);
  const pts = orthogonalRoute(a, b);
  // 从底边出去：第一段必须是竖直向下
  assert.equal(pts[0].x, pts[1].x, '出线不是竖直的');
  assert.ok(pts[1].y > pts[0].y, '出线方向反了');
  // 进入顶边：最后一段必须是竖直向下
  assert.equal(pts.at(-2).x, pts.at(-1).x, '入线不是竖直的');
  assert.ok(pts.at(-2).y < pts.at(-1).y, '入线方向反了');
});

test('正交路由：每一段长度都大于 0（无零长度线段）', () => {
  const pts = orthogonalRoute(box(100, 0), box(300, 200));
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    assert.ok(len > 0, `第 ${i} 段长度为 0`);
  }
});

test('正交路由：两端正对时简化成一条直线（不留多余的出线点）', () => {
  const pts = orthogonalRoute(box(100, 0), box(100, 200));
  assert.equal(pts.length, 2, '正对的连线应化简为两点直线');
  assert.equal(pts[0].x, pts[1].x, '化简后不是竖直直线');
});

test('正交路由：连线不穿过起点框或终点框的内部', () => {
  const a = box(100, 0);
  const b = box(300, 200);
  const pts = orthogonalRoute(a, b);
  const inside = (p, bx) =>
    p.x > bx.x && p.x < bx.x + bx.w && p.y > bx.y && p.y < bx.y + bx.h;
  for (const p of pts) {
    assert.ok(!inside(p, a), `折线点落在起点框内：${JSON.stringify(p)}`);
    assert.ok(!inside(p, b), `折线点落在终点框内：${JSON.stringify(p)}`);
  }
});

test('正交路由：不产生重复点或共线的中间点', () => {
  const pts = orthogonalRoute(box(0, 0), box(400, 300));
  for (let i = 1; i < pts.length; i++) {
    assert.ok(
      !(pts[i - 1].x === pts[i].x && pts[i - 1].y === pts[i].y),
      `第 ${i} 个点与上一个重合`,
    );
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    assert.ok(
      !((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)),
      `第 ${i} 个点是多余的共线点`,
    );
  }
});

test('正交路由：拐点吸 4px 网格，首尾点保持精确贴边', () => {
  const a = box(101, 3);
  const b = box(307, 213);
  const pts = orthogonalRoute(a, b);
  // 首尾必须精确在框边（不吸格）
  assert.deepEqual(pts[0], portPoint(a, inferSides(a, b).fromSide));
  assert.deepEqual(pts.at(-1), portPoint(b, inferSides(a, b).toSide));
  // 中间拐点必须守网格
  for (let i = 1; i < pts.length - 1; i++) {
    assert.equal(pts[i].x % 4, 0, `拐点 ${i} 的 x 不在网格上：${pts[i].x}`);
    assert.equal(pts[i].y % 4, 0, `拐点 ${i} 的 y 不在网格上：${pts[i].y}`);
  }
});

test('正交路由：可指定端口方向覆盖推断', () => {
  const a = box(100, 0);
  const b = box(100, 200);
  const pts = orthogonalRoute(a, b, { fromSide: 'right', toSide: 'top' });
  assert.deepEqual(pts[0], portPoint(a, 'right'));
  assert.deepEqual(pts.at(-1), portPoint(b, 'top'));
});

test('正交路由：out 参数控制绕行距离（自连时最直观）', () => {
  const a = box(100, 100, 120, 48);
  const wide = orthogonalRoute(a, a, { out: 20 });
  const tight = orthogonalRoute(a, a, { out: 8 });
  const maxX = (pts) => Math.max(...pts.map((p) => p.x));
  const minY = (pts) => Math.min(...pts.map((p) => p.y));
  assert.ok(maxX(wide) > maxX(tight), 'out 变大后绕行应更远');
  assert.ok(minY(wide) < minY(tight), 'out 变大后上绕应更高');
});

test('自连：绕到框外，不穿过自己', () => {
  const a = box(100, 100, 120, 48);
  const pts = orthogonalRoute(a, a);
  assert.ok(pts.length >= 4, '自连至少要有绕行点');
  // 所有点都不该落在框的内部
  const inside = pts.filter(
    (p) => p.x > a.x && p.x < a.x + a.w && p.y > a.y && p.y < a.y + a.h,
  );
  assert.equal(inside.length, 0, `有 ${inside.length} 个点在框内部`);
  // 首尾贴在框边上
  assert.deepEqual(pts[0], portPoint(a, 'right'));
  assert.deepEqual(pts.at(-1), portPoint(a, 'top'));
});

test('自连：id 相同但对象不同也能识别', () => {
  const a = { id: 'n1', x: 0, y: 0, w: 120, h: 48 };
  const b = { id: 'n1', x: 0, y: 0, w: 120, h: 48 };
  const pts = orthogonalRoute(a, b);
  assert.ok(pts.length >= 4, 'id 相同应按自连处理');
});

test('两端都水平时用中间宽度纵向并线', () => {
  // 上下错开，否则两端正对的横线会被化简成直线
  const a = box(0, 100);
  const b = box(400, 140);
  const pts = orthogonalRoute(a, b);
  // 应当有一条竖直的中间段
  let hasVertical = false;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1].x === pts[i].x) hasVertical = true;
  }
  assert.ok(hasVertical, '两端都水平却少了一个纵向并线段');
});

test('两端都竖直时用中间高度横向并线', () => {
  const a = box(0, 0);
  const b = box(400, 200);
  // 强制两头都是竖直端口
  const pts = orthogonalRoute(a, b, { fromSide: 'bottom', toSide: 'top' });
  let hasHorizontal = false;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1].y === pts[i].y) hasHorizontal = true;
  }
  assert.ok(hasHorizontal, '两端都竖直却少了一个横向并线段');
});

test('退化输入不崩：零尺寸框', () => {
  const a = { id: 'a', x: 0, y: 0, w: 0, h: 0 };
  const b = { id: 'b', x: 100, y: 100, w: 0, h: 0 };
  const pts = orthogonalRoute(a, b);
  assert.ok(pts.length >= 2);
});
