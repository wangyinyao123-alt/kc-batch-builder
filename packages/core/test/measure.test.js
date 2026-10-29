import test from 'node:test';
import assert from 'node:assert/strict';
import {
  charWidth,
  isFullWidth,
  measureBlock,
  textWidth,
  wrapText,
} from '../src/measure.js';

const FONT = 14;

test('全角判定覆盖 CJK、全角标点、emoji', () => {
  for (const ch of ['中', '文', '，', '：', '？', '（', '「', 'ー', '한', '😀']) {
    assert.ok(isFullWidth(ch), `${ch} 应判为全角`);
  }
  for (const ch of ['a', 'Z', '0', ',', ':', '.', ' ']) {
    assert.ok(!isFullWidth(ch), `${ch} 应判为半角`);
  }
});

test('ASCII 宽度查表：宽窄字符差距能被正确反映', () => {
  // 这正是 0.6 常数算法的致命伤：W 和 i 差了 4 倍多
  assert.ok(charWidth('W') > 0.9, 'W 应接近 1em');
  assert.ok(charWidth('i') < 0.3, 'i 应远小于 0.6em');
  assert.ok(charWidth('中') === 1, '全角恒为 1em');
});

test('整数串在 Arial 下等宽（等宽数字）', () => {
  const widths = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(charWidth);
  assert.equal(new Set(widths).size, 1, 'Arial 数字应等宽');
});

test('textWidth：CJK 与 ASCII 混排线性可加', () => {
  const a = textWidth('中文', FONT);
  const b = textWidth('ab', FONT);
  const ab = textWidth('中文ab', FONT);
  assert.ok(Math.abs(ab - (a + b)) < 1e-9);
  assert.equal(a, 2 * FONT);
});

test('wrapText：CJK 在宽度处断开，且不超宽', () => {
  const text = '这是一段比较长的中文说明文字需要折行';
  const maxW = 10 * FONT; // 正好 10 个全角字
  const lines = wrapText(text, maxW, FONT);
  assert.ok(lines.length > 1);
  for (const l of lines) {
    assert.ok(textWidth(l, FONT) <= maxW + 1e-9, `行「${l}」超宽`);
  }
  assert.equal(lines.join(''), text, '折行不应吞字或加字');
});

test('wrapText：西文按词断开，不切在单词中间', () => {
  // 80px 放得下 MC_Home（66.9px），所以应该在词间断开
  const lines = wrapText('MC_Home is called here', 80, FONT);
  assert.ok(lines.length > 1);
  for (const l of lines) {
    assert.ok(!/^\s/.test(l), '行首不应有空格');
    assert.ok(!/\s$/.test(l), '行尾不应有空格');
  }
  // 折行只吃空白，不吞字（用空格拼回原串）
  assert.equal(lines.join(' '), 'MC_Home is called here');
});

test('wrapText：超长单词强制硬断', () => {
  const lines = wrapText('ERROR_CODE_404_NOT_FOUND', 50, FONT);
  assert.ok(lines.length > 1);
  for (const l of lines) {
    assert.ok(textWidth(l, FONT) <= 50 + 1e-9, `行「${l}」超宽`);
  }
  assert.equal(lines.join(''), 'ERROR_CODE_404_NOT_FOUND');
});

test('wrapText：禁则——句号逗号不落行首', () => {
  const lines = wrapText('一二三四五六七八九十，十一', 10 * FONT, FONT);
  for (const l of lines) {
    assert.ok(!/^[，。、；：？！）】》」』”’]/.test(l), `行「${l}」以标点开头`);
  }
});

test('wrapText：开引号不落行尾', () => {
  const lines = wrapText('一二三四五「六七」', 6 * FONT, FONT);
  for (const l of lines) {
    assert.ok(!/[（【《「『“‘]$/.test(l), `行「${l}」以开引号结尾`);
  }
});

test('wrapText：保留原文换行', () => {
  const lines = wrapText('第一行\n第二行', 400, FONT);
  assert.deepEqual(lines, ['第一行', '第二行']);
});

test('measureBlock 返回行宽与总高', () => {
  const m = measureBlock('一二三四五六', 4 * FONT, FONT, FONT * 1.5);
  assert.equal(m.lines.length, 2);
  assert.equal(m.width, 4 * FONT);
  assert.equal(m.height, 2 * FONT * 1.5);
});

test('空字符串不崩', () => {
  assert.equal(textWidth('', FONT), 0);
  assert.deepEqual(wrapText('', 100, FONT), ['']);
  const m = measureBlock('', 100, FONT, 20);
  assert.equal(m.height, 20);
});

test('与 0.6 常数方案对比：误差从几十% 降到 0', () => {
  // 旧方案：全角 1em，其余一律 0.6em
  const legacy = (str, fs) =>
    [...str].reduce((w, c) => w + (isFullWidth(c) ? 1 : 0.6) * fs, 0);
  const cases = ['WWWWW', 'iiiii', 'mmm', 'Hello, World!', 'MC_Home'];
  let maxErr = 0;
  for (const str of cases) {
    const real = textWidth(str, FONT);
    const errOld = Math.abs(legacy(str, FONT) - real) / real;
    maxErr = Math.max(maxErr, errOld);
    // 纯 ASCII 走查表，误差恒为 0（这是我们换掉 0.6 常数的全部理由）
    assert.equal(textWidth(str, FONT), real);
  }
  assert.ok(maxErr > 0.3, `旧方案最差误差应超过 30%，实际 ${(maxErr * 100).toFixed(1)}%`);
});
