import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory } from '../src/history.js';
import { emptyDoc } from '../src/doc.js';

const d = (n) => ({ ...emptyDoc(), title: `t${n}` });

test('初始状态：不能撤销也不能重做', () => {
  const h = createHistory(d(0));
  assert.equal(h.current.title, 't0');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.size, 1);
});

test('push 后能撤销回上一状态，再重做回来', () => {
  const h = createHistory(d(0));
  h.push(d(1));
  h.push(d(2));
  assert.equal(h.current.title, 't2');
  assert.equal(h.undo().title, 't1');
  assert.equal(h.undo().title, 't0');
  assert.equal(h.undo(), null, '到底了应返回 null');
  assert.equal(h.redo().title, 't1');
  assert.equal(h.redo().title, 't2');
  assert.equal(h.redo(), null, '到顶了应返回 null');
});

test('push 同一个对象引用返回 false，不入栈', () => {
  const doc = d(0);
  const h = createHistory(doc);
  assert.equal(h.push(doc), false);
  assert.equal(h.size, 1);
});

test('撤销后再 push 会丢掉 redo 分支', () => {
  const h = createHistory(d(0));
  h.push(d(1));
  h.push(d(2));
  h.undo(); // 回到 t1
  h.push(d(9));
  assert.equal(h.current.title, 't9');
  assert.equal(h.canRedo, false, 'redo 分支没被丢掉');
  assert.equal(h.size, 3);
});

test('合并窗口：同 tag 连续 push 只保留一个栈帧（拖动场景）', () => {
  const h = createHistory(d(0));
  // 模拟拖动：每帧一次 push，同 tag
  for (let i = 1; i <= 50; i++) h.push(d(i), 'drag:n1');
  assert.equal(h.size, 2, `50 帧拖动不该产生 50 个栈帧，实际 ${h.size}`);
  assert.equal(h.current.title, 't50');
  // 一次撤销就该回到拖动前
  assert.equal(h.undo().title, 't0');
});

test('不同 tag 不合并', () => {
  const h = createHistory(d(0));
  h.push(d(1), 'drag:n1');
  h.push(d(2), 'drag:n2');
  assert.equal(h.size, 3);
});

test('无 tag 的操作从不合并', () => {
  const h = createHistory(d(0));
  h.push(d(1));
  h.push(d(2));
  h.push(d(3));
  assert.equal(h.size, 4);
});

test('撤销会切断合并窗口（撤销后的同 tag push 不被并进旧操作）', () => {
  const h = createHistory(d(0));
  h.push(d(1), 'drag:n1');
  h.undo(); // 回到 t0
  h.push(d(2), 'drag:n1'); // 同 tag，但中间撤过，不能再合并
  assert.equal(h.size, 2, `撤销后同 tag 被错误合并，size=${h.size}`);
  assert.equal(h.current.title, 't2');
  assert.equal(h.undo().title, 't0');
});

test('超过 limit 时丢最旧的，仍能正常撤销', () => {
  const h = createHistory(d(0), { limit: 3 });
  h.push(d(1));
  h.push(d(2));
  h.push(d(3));
  h.push(d(4));
  assert.equal(h.size, 3, `limit=3 时栈不该超过 3，实际 ${h.size}`);
  assert.equal(h.current.title, 't4');
  assert.equal(h.undo().title, 't3');
  assert.equal(h.undo().title, 't2');
  assert.equal(h.undo(), null, '最旧的已被丢弃');
});

test('reset 清空历史', () => {
  const h = createHistory(d(0));
  h.push(d(1));
  h.push(d(2));
  h.reset(d(7));
  assert.equal(h.current.title, 't7');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.size, 1);
});

test('合并窗口可配置为 0（禁用合并）', () => {
  const h = createHistory(d(0), { mergeMs: 0 });
  h.push(d(1), 'drag:n1');
  h.push(d(2), 'drag:n1');
  assert.equal(h.size, 3, 'mergeMs=0 时不该合并');
});
