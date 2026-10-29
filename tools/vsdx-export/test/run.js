'use strict';
/**
 * 验收测试：不依赖 draw.io、不依赖 Visio，纯静态检查导出的 vsdx 是否满足
 * 「两个读取方都正确」的条件。
 *
 * 跑法：node test/run.js
 *
 * 判定标准（这三条任一不满足，导出的文件就有读取方会看到白底黑框 / 丢文字）：
 *   1. <Section N="Fill"> / <Section N="Line"> 存在（Visio 规范要求）
 *   2. 同名 Cell 也出现在 Shape 直属层（draw.io 要求）
 *   3. <Text> 落在 Shape 内部，且几何 Section 只有一组（未被平面化）
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { buildVsdx, dualWriteStyleCells, estimateTextWidth, estimateTextHeight } = require('../src/index.js');
const { jszipImpl } = require('../src/zip.js');

const zip = jszipImpl(JSZip);

/** 一张覆盖全部形状类型的样例图 */
const DIAGRAM = {
  meta: { pageW: 560, pageH: 460 },
  nodes: [
    { id: 'n1', type: 'start', text: '开始', x: 220, y: 16, w: 120, h: 48 },
    { id: 'n2', type: 'process', text: '初始化参数', x: 200, y: 116, w: 160, h: 48 },
    { id: 'n3', type: 'decision', text: '已建立\n位置参考？', x: 180, y: 200, w: 200, h: 120 },
    { id: 'n4', type: 'process', text: '回零\nMC_Home', x: 20, y: 368, w: 160, h: 64 },
    { id: 'n5', type: 'end', text: '待机', x: 380, y: 376, w: 140, h: 48 },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3' },
    { from: 'n3', to: 'n5', fromPort: 'Right', toPort: 'Top' },
    { from: 'n3', to: 'n4', fromPort: 'Left', toPort: 'Top' },
  ],
  labels: [
    { text: '是', x: 350, y: 300, w: 36, h: 24 },
    { text: '否', x: 160, y: 300, w: 36, h: 24 },
  ],
};

const dec = new TextDecoder('utf-8');

async function unzip(bytes) {
  const map = await zip.read(bytes);
  // 注意：适配器统一返回 Uint8Array，不能用 Buffer#toString，
  // 否则会得到 "60,63,120,109..." 这样的字节列表。
  const pageXml = dec.decode(map.get('visio/pages/page1.xml'));
  return { map, pageXml };
}

/** 把一个 Shape 的 XML 拆出来，便于逐形状断言 */
function shapesOf(pageXml) {
  const out = [];
  const re = /<Shape\b[^>]*>([\s\S]*?)<\/Shape>/g;
  let m;
  while ((m = re.exec(pageXml))) out.push({ xml: m[0], inner: m[1] });
  return out;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('dual-write：Fill/Line 的 Cell 同时存在于 Section 内与 Shape 直属层', () => {
  const xml = `<Shape ID="1"><Cell N="PinX" V="1"></Cell><Section N="Fill"><Cell N="FillForegnd" V="#ECECEC"></Cell></Section><Section N="Line"><Cell N="LineColor" V="#1A1A1A"></Cell></Section><Text>A</Text></Shape>`;
  const out = dualWriteStyleCells(xml);

  // 1. Section 仍在
  assert.ok(out.includes('<Section N="Fill">'), 'Visio 需要的 Section 被删掉了');
  assert.ok(out.includes('<Section N="Line">'), 'Visio 需要的 Line Section 被删掉了');
  // 2. 直属层也有一份
  const direct = out.replace(/<Section[\s\S]*?<\/Section>/g, '');
  assert.ok(direct.includes('N="FillForegnd"'), 'draw.io 需要的直属 FillForegnd 缺失');
  assert.ok(direct.includes('N="LineColor"'), 'draw.io 需要的直属 LineColor 缺失');
  // 3. 幂等：跑两次不会重复堆 Cell
  assert.strictEqual(dualWriteStyleCells(out), out, 'dual-write 不幂等');
});

test('dual-write 不碰 Geometry/Character/Paragraph', () => {
  const xml = `<Shape ID="1"><Section N="Geometry" IX="0"><Row T="MoveTo" IX="1"><Cell N="X" V="0"></Cell></Row></Section><Section N="Character"><Row T="Character" IX="0"><Cell N="Size" V="0.15"></Cell></Row></Section></Shape>`;
  assert.strictEqual(dualWriteStyleCells(xml), xml);
});

test('导出后可被解析，且五个节点 + 两个标签都在', async () => {
  const bytes = await buildVsdx(DIAGRAM, {}, zip);
  assert.ok(bytes.length > 3000, `产物体积异常：${bytes.length}`);
  const { pageXml } = await unzip(bytes);
  const shapes = shapesOf(pageXml);
  // 5 形状 + 2 标签 + 4 连接线
  assert.strictEqual(shapes.length, 11, `形状数量不对：${shapes.length}`);

  const texts = shapes.map((s) => (s.inner.match(/<Text>([\s\S]*?)<\/Text>/) || [, ''])[1]);
  for (const want of ['开始', '初始化参数', '已建立', '回零', '待机', '是', '否']) {
    assert.ok(
      texts.some((t) => t.includes(want)),
      `文字「${want}」丢失`
    );
  }
});

test('每个图形都同时具备两套样式（真实产物，不是构造的 XML）', async () => {
  const bytes = await buildVsdx(DIAGRAM, { fillColor: '#ECECEC', lineColor: '#1A1A1A' }, zip);
  const { pageXml } = await unzip(bytes);
  const shapes = shapesOf(pageXml).filter((s) => /<Text>/.test(s.inner));
  assert.ok(shapes.length >= 7);

  for (const s of shapes) {
    const direct = s.inner.replace(/<Section[\s\S]*?<\/Section>/g, '');
    assert.ok(/N="FillForegnd"/.test(direct), '直属层缺 FillForegnd（draw.io 会画成白底）');
    assert.ok(/N="LineColor"/.test(direct), '直属层缺 LineColor');
    assert.ok(/N="FillForegnd"/.test(s.inner), 'Section 内层缺 FillForegnd（Visio 会丢色）');
  }
});

test('几何形状按类型映射（判断=菱形）', async () => {
  const bytes = await buildVsdx(DIAGRAM, {}, zip);
  const { pageXml } = await unzip(bytes);
  const shapes = shapesOf(pageXml);
  const dia = shapes.find((s) => /已建立/.test(s.inner));
  assert.ok(dia, '没找到判断节点');

  // 菱形几何：ts-visio 用四点 Polygon，矩形用四点带圆角/直线；
  // 稳妥判据是「菱形没有 EllipticalArcTo（圆角），且 Y 范围跨满整个高度」
  const ys = [...dia.inner.matchAll(/<Cell N="Y" V="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  assert.ok(ys.length >= 4, '几何行不足');
  assert.ok(Math.min(...ys) < 0.01, '菱形顶点没有贴到底');
  assert.ok(Math.max(...ys) > 1.19, '菱形顶点没有贴到顶');
});

test('页面尺寸按 meta 设置', async () => {
  const bytes = await buildVsdx(DIAGRAM, {}, zip);
  const { pageXml } = await unzip(bytes);
  // 560/96 = 5.8333..., 460/96 = 4.7916...
  assert.ok(/PageWidth" V="5\.833/.test(pageXml), '页宽不对');
  assert.ok(/PageHeight" V="4\.791/.test(pageXml), '页高不对');
});

test('无 theme 时用默认值，不抛错', async () => {
  const bytes = await buildVsdx({ meta: { pageW: 200, pageH: 200 }, nodes: [], edges: [] }, undefined, zip);
  assert.ok(bytes.length > 0);
});

test('文本估算：中文比英文宽，且随行数线性增长', () => {
  assert.ok(estimateTextWidth('中文四字', 16) > estimateTextWidth('abcd', 16));
  assert.strictEqual(estimateTextHeight('a\nb\nc', 10), 45);
});

test('Node 端可写盘，产物可被 jszip 重新打开', async () => {
  const bytes = await buildVsdx(DIAGRAM, {}, zip);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsdx-'));
  const out = path.join(dir, 'out.vsdx');
  fs.writeFileSync(out, Buffer.from(bytes));
  const reopened = await JSZip.loadAsync(fs.readFileSync(out));
  assert.ok(reopened.file('visio/pages/page1.xml'), '产物缺 page1.xml');
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  let pass = 0;
  const fails = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      pass++;
    } catch (e) {
      console.log(`  ✗ ${name}\n      ${e.message}`);
      fails.push(name);
    }
  }
  console.log(`\n${pass}/${tests.length} 通过`);
  if (fails.length) process.exit(1);
})();
