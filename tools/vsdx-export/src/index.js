'use strict';
/**
 * flowchart-elf → .vsdx
 *
 * 输入：本工具自己的图数据 JSON（与画布、SVG 导出共用同一份）
 * 输出：.vsdx 二进制
 *
 * 关键设计（勿改）：
 * 1) 坐标系。图数据用「画布像素，左上原点，y 向下，96dpi」；
 *    Visio 用「英寸，左下原点，y 向上」。唯一换算入口是 toInches()/toVisioY()。
 * 2) dual-write。ts-visio 把 FillForegnd 等放在 <Section N="Fill"> 里，这是
 *    Visio 规范的正确写法，但 draw.io 的 vsdx 导入器只读 Shape 直属 <Cell>，
 *    读不到 Section 内层 → 导入后全部变成白底黑框。所以在补丁里把 Fill/Line
 *    的 Cell 同时提升一份到直属层；两份并存，Visio 与 draw.io 都能正确读。
 * 3) 文字宽度。不做浏览器测量，用 estimateTextWidth() 的等宽保守估算；
 *    vsdx 里的形状尺寸由调用方（排版层）给定，这里只负责忠实写入。
 */

const { VisioDocument, ArrowHeads, StandardConnectionPoints } = require('ts-visio');

const INCH_PX = 96; // 1 英寸 = 96 画布像素

/** 画布像素 → 英寸 */
const toInches = (px) => px / INCH_PX;

/** 画布 y（向上为负）→ Visio y（向上为正）。pageH 为整页高度，单位画布像素。 */
const toVisioY = (yTopPx, pageHpx) => toInches(pageHpx - yTopPx);

/**
 * 由两个框的相对位置推断连线该接哪两个连接点。
 * 与 packages/core 的 toVsdxInput 同一套规则（主要沿 y 就用上下，否则左右），
 * 保证「调用方给了端口」与「没给由这里兜底」两种情况的产物一致。
 */
function inferPorts(from, to) {
  if (!from || !to) return { fromPort: 'Bottom', toPort: 'Top' };
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { fromPort: 'Bottom', toPort: 'Top' }
      : { fromPort: 'Top', toPort: 'Bottom' };
  }
  return dx >= 0
    ? { fromPort: 'Right', toPort: 'Left' }
    : { fromPort: 'Left', toPort: 'Right' };
}

const GEOMETRY_MAP = {
  start: 'rounded-rectangle',
  end: 'rounded-rectangle',
  process: 'rectangle',
  decision: 'diamond',
  data: 'parallelogram',
  note: 'rectangle',
};

/**
 * 估算文本像素宽度（全角=1em，半角=0.6em，行高=1.5em）。
 * 与 SVG 导出共用同一套常数，保证屏上与导出到 Visio 的换行位置一致。
 */
function estimateTextWidth(text, fontSizePx) {
  let max = 0;
  for (const line of String(text).split('\n')) {
    let w = 0;
    for (const ch of line) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.6;
    max = Math.max(max, w * fontSizePx);
  }
  return max;
}

function estimateTextHeight(text, fontSizePx) {
  const lines = String(text).split('\n').length;
  return lines * fontSizePx * 1.5;
}

const CELL_RE = /<Cell [^>]*?(?:\/>|><\/Cell>)/g;

/**
 * 把 <Section N="Fill"> / <Section N="Line"> 里的 Cell 复制一份到 Shape 直属层，
 * 同时保留原 Section（Visio 需要它，draw.io 需要直属 Cell）。
 *
 * 幂等：已经出现在直属层的同名 Cell 不会重复插入，所以对同一个文件跑多次结果一致。
 * 只处理 Fill/Line 这类「形状属性」Section；Geometry/Character/Paragraph 不能动，
 * 一旦平面化，Visio 里的几何与字体就会错乱。
 *
 * @param {string} pageXml  单页 page1.xml 的文本
 * @returns {string}        修补后的 XML
 */
function dualWriteStyleCells(pageXml) {
  return pageXml.replace(/<Shape\b[^>]*>[\s\S]*?<\/Shape>/g, (shapeXml) => {
    // 直属层（去掉所有 Section 之后）已有的 Cell 名称
    const sections = [];
    const directOnly = shapeXml.replace(/<Section\b[^>]*>[\s\S]*?<\/Section>/g, (s) => {
      sections.push(s);
      return '';
    });
    const existing = new Set();
    for (const m of directOnly.match(CELL_RE) || []) {
      const n = /\bN="([^"]+)"/.exec(m);
      if (n) existing.add(n[1]);
    }

    let inserted = false;
    for (const section of sections) {
      const head = /<Section N="([^"]+)"/.exec(section);
      if (!head || (head[1] !== 'Fill' && head[1] !== 'Line')) continue;
      const toAdd = [];
      for (const cell of section.match(CELL_RE) || []) {
        const n = /\bN="([^"]+)"/.exec(cell);
        if (!n || existing.has(n[1])) continue;
        existing.add(n[1]);
        toAdd.push(cell);
      }
      if (toAdd.length) inserted = true;
      // 插在 <Shape ...> 开标签之后，与 ts-visio 自己的直属 Cell 放一起
      if (toAdd.length) {
        shapeXml = shapeXml.replace(/^(<Shape\b[^>]*>)/, `$1${toAdd.join('')}`);
      }
    }
    return inserted ? shapeXml : shapeXml;
  });
}

/**
 * 把所有页面的 Fill/Line 做 dual-write。
 * @param {Uint8Array} vsdxBytes
 * @param {FileLike} zipImpl  需要 { read(buf) -> Map<name, Buffer>, write(Map) -> Buffer }
 */
async function patchVsdx(vsdxBytes, zipImpl) {
  const dec = new TextDecoder('utf-8');
  const enc = new TextEncoder();
  const files = await zipImpl.read(vsdxBytes);
  for (const [name, buf] of files) {
    if (!/^visio\/pages\/page\d+\.xml$/.test(name)) continue;
    // 适配器返回 Uint8Array（Node 与浏览器统一），不能用 Buffer#toString，
    // 否则拿到的是 "60,63,120,..." 字节列表，正则永远匹配不上。
    const xml = dec.decode(buf);
    const patched = dualWriteStyleCells(xml);
    if (patched !== xml) files.set(name, enc.encode(patched));
  }
  return zipImpl.write(files);
}

/**
 * 主入口：把图数据渲染成 vsdx。
 *
 * @param {object} diagram  { nodes:[{id,type,text,x,y,w,h}], edges:[...], meta:{pageW,pageH} }
 * @param {object} theme    模板参数（见 PRD 的 18 个值，这里只用到排版子集）
 * @param {object} zipImpl  zip 读写适配器
 * @returns {Promise<Uint8Array>} vsdx 字节
 */
async function buildVsdx(diagram, theme, zipImpl) {
  const t = {
    fontFamily: 'PingFang SC',
    fontSize: 11, // pt
    fillColor: '#FFFFFF',
    lineColor: '#1A1A1A',
    fontColor: '#000000',
    lineWeightPt: 1,
    cornerRadiusPx: 6,
    ...theme,
  };

  const pageW = diagram.meta?.pageW ?? 800;
  const pageH = diagram.meta?.pageH ?? 600;

  const doc = await VisioDocument.create();
  const page = doc.pages[0];
  page.setSize(toInches(pageW), toInches(pageH));

  const shapeStyle = {
    fillColor: t.fillColor,
    lineColor: t.lineColor,
    fontColor: t.fontColor,
    fontSize: t.fontSize,
    fontFamily: t.fontFamily,
    horzAlign: 'center',
    verticalAlign: 'middle',
    connectionPoints: StandardConnectionPoints.cardinal,
  };

  /** id → Shape 句柄，供连线使用 */
  const handles = new Map();
  /** id → 节点框（中心点），用于推断连线端口 */
  const nodeById = new Map();
  for (const n of diagram.nodes || []) {
    nodeById.set(n.id, {
      cx: n.x + n.w / 2,
      cy: n.y + n.h / 2,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    });
  }

  for (const n of diagram.nodes || []) {
    const geometry = GEOMETRY_MAP[n.type] || 'rectangle';
    const props = {
      text: n.text ?? '',
      x: toInches(n.x + n.w / 2),
      y: toVisioY(n.y + n.h / 2, pageH),
      width: toInches(n.w),
      height: toInches(n.h),
      geometry,
      ...shapeStyle,
    };
    if (geometry === 'rounded-rectangle') props.cornerRadius = toInches(t.cornerRadiusPx);
    const shape = await page.addShape(props);
    handles.set(n.id, shape);
  }

  // 分支标签：无边框、无填充的文字块。放在连线中点附近，由排版层给出 x/y/w/h。
  for (const lab of diagram.labels || []) {
    await page.addShape({
      text: lab.text,
      x: toInches(lab.x + lab.w / 2),
      y: toVisioY(lab.y + lab.h / 2, pageH),
      width: toInches(lab.w),
      height: toInches(lab.h),
      geometry: 'rectangle',
      fillColor: t.fillColor,
      lineColor: t.fillColor, // 同色即视觉上无边框
      fontColor: t.fontColor,
      fontSize: Math.max(8, t.fontSize - 1),
      fontFamily: t.fontFamily,
      horzAlign: 'center',
      verticalAlign: 'middle',
    });
  }

  for (const e of diagram.edges || []) {
    const fromShape = handles.get(e.from);
    const toShape = handles.get(e.to);
    if (!fromShape || !toShape) continue;

    // 端口不能省略：不传端口时 ts-visio 落成 ToCell="PinX"（粘到形状中心），
    // 连线会打穿框体。调用方没给就按两者相对位置推一个。
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    const infer = inferPorts(a, b);
    const fromPort = e.fromPort || infer.fromPort;
    const toPort = e.toPort || infer.toPort;

    await page.connectShapes(
      fromShape,
      toShape,
      ArrowHeads.None,
      // 注意：枚举名是 Open，不是 OpenArrow。
      // 写成 ArrowHeads.OpenArrow 会得到 undefined，最终 EndArrow="0"，图上没有箭头。
      ArrowHeads.Open,
      { lineColor: t.lineColor, lineWeight: t.lineWeightPt, routing: 'orthogonal' },
      { name: fromPort },
      { name: toPort }
    );
  }

  const raw = await doc.save();
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return zipImpl ? patchVsdx(bytes, zipImpl) : bytes;
}

module.exports = {
  // 浏览器端用 jszipImpl(JSZip)，Node 端用 nodeImpl()
  ...require('./zip.js'),
  buildVsdx,
  patchVsdx,
  dualWriteStyleCells,
  estimateTextWidth,
  estimateTextHeight,
  toInches,
  toVisioY,
  GEOMETRY_MAP,
  INCH_PX,
  inferPorts,
};
