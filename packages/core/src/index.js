/**
 * @flowchart-elf/core —— MD → 图数据 → 排版 → 矢量输出，全部纯函数。
 *
 * 离线可用：没有网络、没有浏览器、没有 AI。Node 与浏览器共用同一份实现。
 */
export { parseMarkdown, refKey, stripPrefix } from './parse.js';
export { wrapText, textWidth, charWidth, isFullWidth, measureBlock } from './measure.js';
export { ASCII_WIDTHS, EXTRA_WIDTHS, FULLWIDTH_RANGES, FALLBACK_WIDTH } from './widths.js';
export { DIAGRAM_VERSION, emptyDiagram, isRenderable, makeId } from './ir.js';
export { layout, measureNode } from './layout.js';
export { renderSvg } from './render.js';
export {
  GRID,
  LIGHT,
  DARK,
  DEFAULT_SPEC,
  resolveTheme,
  resolveSpec,
  ceilGrid,
  snapGrid,
  titleHeight,
} from './theme.js';
export { toVsdxInput, toVsdxTheme, inferPorts, pxToPt } from './vsdx-input.js';
