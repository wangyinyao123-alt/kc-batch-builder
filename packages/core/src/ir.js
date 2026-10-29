/**
 * 中间数据（IR）—— 全项目唯一的图数据结构。
 *
 * 三条硬规矩（PRD 第七节）：
 *   1. 中间数据先定死。节点必须有稳定 ID，改了布局还能对应回原文。
 *   2. 坐标不写回 Markdown。位置单独存（见 layout.js 的输出），不污染文档。
 *   3. 文字宽度自己算（见 measure.js），不问浏览器要。
 *
 * 这个文件只定义形状和构造函数，不含任何业务逻辑。
 */

/** @typedef {'start'|'end'|'process'|'decision'|'note'} NodeType */

/**
 * @typedef {object} DiagramNode
 * @property {string}   id          稳定 ID，等于解析出的节点名（同名即同一节点）
 * @property {NodeType} type        决定渲染形状，不决定颜色
 * @property {string}   text        显示文本（已去掉 `判断：` 之类的语法前缀）
 * @property {number}   sourceLine  在原文中的行号（1-based），用于报错定位
 * @property {number}   sourceCol   列号（1-based）
 */

/**
 * @typedef {object} DiagramEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {string} label       分支标签（`是` / `否` / 空）
 * @property {'flow'|'merge'} kind
 * @property {number} sourceLine
 * @property {number} sourceCol
 */

/**
 * @typedef {object} Diagnostic
 * @property {'error'|'warn'} level
 * @property {string} code
 * @property {string} message
 * @property {number} line
 * @property {number} col
 */

/**
 * @typedef {object} Diagram
 * @property {1} version
 * @property {string} title
 * @property {DiagramNode[]} nodes
 * @property {DiagramEdge[]} edges
 * @property {Diagnostic[]} diagnostics
 */

export const DIAGRAM_VERSION = 1;

/** @returns {Diagram} */
export function emptyDiagram() {
  return {
    version: DIAGRAM_VERSION,
    title: '',
    nodes: [],
    edges: [],
    diagnostics: [],
  };
}

/** 图是否可渲染（无 error 级诊断）。 */
export function isRenderable(diagram) {
  return !diagram.diagnostics.some((d) => d.level === 'error');
}

/** 稳定节点 ID 生成器，供无法从文本取 ID 的场景使用。 */
export function makeId(prefix, seq) {
  return `${prefix}_${seq}`;
}
