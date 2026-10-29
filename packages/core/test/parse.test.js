import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, refKey, stripPrefix } from '../src/parse.js';

const ids = (d) => d.nodes.map((n) => n.id);
const triples = (d) => d.edges.map((e) => `${e.from}>${e.to}${e.label ? `[${e.label}]` : ''}`);

test('PRD 原示例：四节点四连线，无诊断', () => {
  const d = parseMarkdown(`# 运动控制流程

1. 初始化
2. 判断：已建立位置参考？
   - 否 → 回零：调用 MC_Home
   - 是 → 待机：检查模式和范围
3. 回零 => 待机
`);
  assert.equal(d.title, '运动控制流程');
  assert.deepEqual(ids(d), ['初始化', '已建立位置参考', '回零', '待机']);
  assert.deepEqual(triples(d), [
    '初始化>已建立位置参考',
    '已建立位置参考>回零[否]',
    '已建立位置参考>待机[是]',
    '回零>待机',
  ]);
  assert.deepEqual(d.diagnostics, [], '不应有任何诊断');
});

test('分支右侧的目标必须建成节点（原型最大的洞）', () => {
  const d = parseMarkdown(`1. 判断：继续？
   - 是 → 下一步
   - 否 → 退出
`);
  assert.deepEqual(ids(d), ['继续', '下一步', '退出']);
  // 每个边两端都真实存在
  for (const e of d.edges) {
    assert.ok(d.nodes.some((n) => n.id === e.from), `缺少源节点 ${e.from}`);
    assert.ok(d.nodes.some((n) => n.id === e.to), `缺少目标节点 ${e.to}`);
  }
});

test('``@`` 支持前向引用：先写 @待机，后定义', () => {
  const d = parseMarkdown(`1. 判断：已建立位置参考？
   - 是 → @待机
   - 否 → 回零
2. 待机：检查模式和范围
`);
  assert.deepEqual(ids(d), ['已建立位置参考', '待机', '回零']);
  // 定义处的完整说明覆盖了引用处的裸名字
  assert.equal(d.nodes.find((n) => n.id === '待机').text, '待机：检查模式和范围');
  assert.deepEqual(d.diagnostics.filter((x) => x.level === 'error'), []);
});

test('引用未定义的节点 → error 且定位到行', () => {
  const d = parseMarkdown(`1. 开始
2. 回零 => @不存在
`);
  const err = d.diagnostics.find((x) => x.code === 'ref-undefined');
  assert.ok(err, '应报 ref-undefined');
  assert.equal(err.level, 'error');
  assert.equal(err.line, 2);
});

test('判断节点出口超过 3 个 → warn', () => {
  const d = parseMarkdown(`1. 判断：哪种情况？
   - 一 → A
   - 二 → B
   - 三 → C
   - 四 → D
`);
  const w = d.diagnostics.find((x) => x.code === 'too-many-exits');
  assert.ok(w);
  assert.match(w.message, /4 个出口/);
});

test('分支没有上级判断 → error', () => {
  const d = parseMarkdown(`   - 是 → 某某
`);
  const err = d.diagnostics.find((x) => x.code === 'branch-without-parent');
  assert.ok(err);
  assert.equal(err.line, 1);
});

test('判断后直接跟步骤 → 警告缺汇合，且不静默连边', () => {
  const d = parseMarkdown(`1. 判断：可以继续？
   - 是 → 继续做
   - 否 → 报错
2. 收尾
`);
  const w = d.diagnostics.find((x) => x.code === 'missing-merge');
  assert.ok(w, '应提示缺汇合');
  // 判断节点不该直连「收尾」
  assert.ok(!d.edges.some((e) => e.from === '可以继续' && e.to === '收尾'));
});

test('同一条边只保留一条', () => {
  // 判判断的「是」出口指向 @收尾，后面又用 => 汇合到同一个 @收尾
  const d = parseMarkdown(`1. 判断：继续？
   - 是 → @收尾
   - 否 → 退出
2. 收尾
`);
  const toShouwei = d.edges.filter((e) => e.to === '收尾');
  assert.equal(toShouwei.length, 1, '重复的边应被合并');
  assert.equal(toShouwei[0].label, '是');
});

test('自连边给出警告但不崩溃', () => {
  const d = parseMarkdown(`1. 甲
2. 甲 => 甲
`);
  const w = d.diagnostics.find((x) => x.code === 'self-loop');
  assert.ok(w, '应提示自连');
  assert.equal(w.level, 'warn');
});

test('开始 / 结束 识别为起止节点', () => {
  const d = parseMarkdown(`1. 开始
2. 做点什么
3. 结束
`);
  assert.equal(d.nodes[0].type, 'start');
  assert.equal(d.nodes.at(-1).type, 'end');
  assert.equal(d.nodes[1].type, 'process');
});

test('问号结尾自动成菱形，并去掉问号后的 ID 不含标点', () => {
  const d = parseMarkdown(`1. 判断：温度超限？
   - 是 → 报警
   - 否 → 继续
`);
  const n = d.nodes.find((x) => x.type === 'decision');
  assert.equal(n.id, '温度超限');
  assert.equal(n.text, '温度超限？');
});

test('非列表行被忽略但有警告，不会静默消失', () => {
  const d = parseMarkdown(`这是一段说明
1. 第一步
`);
  assert.deepEqual(ids(d), ['第一步']);
  const w = d.diagnostics.find((x) => x.code === 'line-not-list');
  assert.ok(w);
  assert.equal(w.level, 'warn');
});

test('标题、分隔线、代码块不产生节点', () => {
  const d = parseMarkdown(`# 标题

---

1. 一
`);
  assert.deepEqual(ids(d), ['一']);
  assert.deepEqual(d.diagnostics, []);
});

test('空输入不抛异常', () => {
  const d = parseMarkdown('');
  assert.deepEqual(d.nodes, []);
  assert.deepEqual(d.edges, []);
});

test('refKey 与 stripPrefix 的边界', () => {
  assert.equal(refKey('回零：调用 MC_Home'), '回零');
  assert.equal(refKey('@待机'), '待机');
  assert.equal(refKey('已建立位置参考？'), '已建立位置参考');
  assert.equal(refKey('开始'), '开始');
  assert.equal(stripPrefix('判断：已建立位置参考？'), '已建立位置参考？');
  assert.equal(stripPrefix('开始：初始化'), '初始化');
  assert.equal(stripPrefix('普通步骤'), '普通步骤');
});

test('节点顺序稳定：按首次出现顺序输出', () => {
  const d = parseMarkdown(`1. 甲
2. 判断：乙？
   - 是 → 丙
   - 否 → 丁
3. 丙 => 甲
`);
  assert.deepEqual(ids(d), ['甲', '乙', '丙', '丁']);
});
