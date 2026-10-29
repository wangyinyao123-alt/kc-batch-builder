/**
 * 模板 = 颜色 + 字体 + 形状 + 密度 + 连线样式，一份对象说清。
 *
 * 为什么不只换颜色：只换色的话四套模板只是同一个东西的四种染色，
 * 用户一眼就知道「模板」是假的。真正拉开差距的是形状处理
 * （起止是空心胶囊还是反白实心块）、笔画粗细、字号与间距。
 *
 * 两层正交：
 *   模板（template）  → 排版、形状、字体、密度
 *   配色（palette）   → 只负责颜色
 * 所以 `--template business --theme dark` 是合法的：商务风骨架 + 深色配色。
 * 每个模板自带推荐配色，单独给模板名时用它自己的。
 *
 * 所有几何量仍守 4px 网格（GRID），换模板不会破坏版式不变量。
 */
import { DARK, DEFAULT_SPEC, LIGHT, ceilGrid, snapGrid, titleHeight } from './theme.js';

/** 预置配色。模板里的 fill/stroke/text 写的是这里的角色名，不是色值。 */
export const PALETTES = {
  light: LIGHT,
  dark: DARK,
  // 商务：偏冷的深蓝墨色，纸是纯白，强调色用稳重的砖蓝
  slate: {
    name: 'slate',
    paper: '#ffffff',
    paper2: '#eef2f8',
    ink: '#1b2733',
    inkStrong: '#0b1118',
    muted: '#5b6b7f',
    soft: '#8494a8',
    rule: 'rgba(27,39,51,0.12)',
    ruleSolid: '#c8d2de',
    accent: '#2b5d8a',
    accentTint: 'rgba(43,93,138,0.08)',
    link: '#2b5d8a',
  },
  // 纸感：暖白 + 褐黑，像印在纸上
  paper: {
    name: 'paper',
    paper: '#fbf9f4',
    paper2: '#f2ede2',
    ink: '#2a2622',
    inkStrong: '#141210',
    muted: '#6b6359',
    soft: '#9a9084',
    rule: 'rgba(42,38,34,0.14)',
    ruleSolid: '#d8d0c2',
    accent: '#a4441f',
    accentTint: 'rgba(164,68,31,0.08)',
    link: '#8a5a2b',
  },
};

/** 形状种类。渲染器只认这几个，新增种类要同时改 render.js。 */
export const SHAPE_KINDS = ['rect', 'pill', 'diamond'];

/** 一套默认的形状表，模板只写要改的部分。 */
const BASE_SHAPE = {
  start: { kind: 'pill', fill: 'paper2', stroke: 'ink', text: 'ink' },
  end: { kind: 'pill', fill: 'paper2', stroke: 'ink', text: 'ink' },
  process: { kind: 'rect', fill: 'paper', stroke: 'ink', text: 'ink' },
  decision: { kind: 'diamond', fill: 'paper', stroke: 'ink', text: 'ink' },
  note: { kind: 'rect', fill: 'paper2', stroke: 'soft', text: 'muted' },
};

/**
 * 模板定义。
 *
 * 每个模板只写与默认不同的部分，其余继承 DEFAULT_SPEC。
 * `shape` 按节点类型覆盖，`edge` 控制连线，`spacing`/`geometry` 控制密度。
 */
export const TEMPLATES = {
  /** 默认：冷暖中性、细描边、浅灰起止块。就是这一期一直在用的样子。 */
  default: {
    name: 'default',
    label: '默认',
    description: '冷灰纸面、细笔画、浅色起止块。适合贴进文档。',
    palette: 'light',
    shape: {},
  },

  /**
   * 商务：白纸、起止反白实心、判断带底色、笔画加粗一档。
   * 靠「实心块 + 描边」区分层级，远看有节奏。
   */
  business: {
    name: 'business',
    label: '商务',
    description: '纯白纸面、起止反白实心、判断淡底、笔画偏粗。适合汇报材料。',
    palette: 'slate',
    stroke: { default: 1.2 },
    radius: { sm: 2, md: 4, lg: 6 },
    nodeName: { size: 13, weight: 600, lineHeight: 20 },
    shape: {
      start: { kind: 'pill', fill: 'accent', stroke: 'accent', text: 'paper' },
      end: { kind: 'pill', fill: 'ink', stroke: 'ink', text: 'paper' },
      process: { kind: 'rect', fill: 'paper', stroke: 'ink', text: 'ink' },
      decision: { kind: 'diamond', fill: 'paper2', stroke: 'accent', text: 'ink' },
    },
    edge: { color: 'muted', width: 1.2, arrow: 'triangle' },
    spacing: { padding: 36, titleGap: 28, nodeGap: 48, rankGap: 64 },
  },

  /**
   * 极简：全直角、无填充色差、只靠线和文字。字号最小、间距最紧。
   * 唯一用色是强调色，且只用在判断框描边上。
   */
  minimal: {
    name: 'minimal',
    label: '极简',
    description: '直角、无填充、细线、紧凑。只有判断框用一点强调色。',
    palette: 'light',
    stroke: { thin: 0.6, default: 0.8, strong: 1 },
    radius: { sm: 0, md: 0, lg: 0 },
    ovalRadius: 0,
    nodeName: { size: 12, weight: 500, lineHeight: 17 },
    title: { size: 22, weight: 500 },
    shape: {
      start: { kind: 'rect', fill: 'none', stroke: 'ink', text: 'ink' },
      end: { kind: 'rect', fill: 'none', stroke: 'ink', text: 'ink' },
      process: { kind: 'rect', fill: 'none', stroke: 'ink', text: 'ink' },
      decision: { kind: 'diamond', fill: 'none', stroke: 'accent', text: 'ink' },
      note: { kind: 'rect', fill: 'none', stroke: 'soft', text: 'muted' },
    },
    edge: { color: 'ink', width: 0.8, arrow: 'open' },
    spacing: { padding: 28, titleGap: 20, nodeGap: 32, rankGap: 44, minRowHeight: 44 },
  },

  /**
   * 技术：深底、等宽字体标签、强调色描边。给设计文档与架构图用。
   * 正文仍用无衬线（等宽汉字不好看），只有分支标签切等宽。
   */
  tech: {
    name: 'tech',
    label: '技术',
    description: '深色底、等宽分支标签、强调色描边。适合设计与架构文档。',
    palette: 'dark',
    stroke: { thin: 0.8, default: 1, strong: 1.4 },
    radius: { sm: 4, md: 6, lg: 8 },
    nodeName: { size: 12, weight: 500, lineHeight: 18 },
    shape: {
      start: { kind: 'pill', fill: 'accent', stroke: 'accent', text: 'inkStrong' },
      end: { kind: 'pill', fill: 'muted', stroke: 'muted', text: 'inkStrong' },
      process: { kind: 'rect', fill: 'paper2', stroke: 'soft', text: 'ink' },
      decision: { kind: 'diamond', fill: 'paper', stroke: 'accent', text: 'ink' },
      note: { kind: 'rect', fill: 'none', stroke: 'soft', text: 'muted' },
    },
    edge: { color: 'soft', width: 1, arrow: 'triangle' },
    spacing: { padding: 32, titleGap: 24, nodeGap: 40, rankGap: 56 },
  },

  /** 纸感：暖白底、褐黑墨、衬线标题。 */
  paper: {
    name: 'paper',
    label: '纸感',
    description: '暖白纸面、褐黑墨、衬线标题。适合打印与手册。',
    palette: 'paper',
    stroke: { default: 1 },
    radius: { sm: 3, md: 5, lg: 7 },
    nodeName: { size: 12, weight: 500, lineHeight: 18 },
    shape: {
      start: { kind: 'pill', fill: 'paper2', stroke: 'ink', text: 'ink' },
      end: { kind: 'pill', fill: 'accent', stroke: 'accent', text: 'paper' },
      process: { kind: 'rect', fill: 'paper', stroke: 'ink', text: 'ink' },
      decision: { kind: 'diamond', fill: 'paper2', stroke: 'ink', text: 'ink' },
    },
    edge: { color: 'muted', width: 1, arrow: 'triangle' },
    spacing: { padding: 32, titleGap: 24, nodeGap: 40, rankGap: 56 },
  },
};

/** 所有可用模板名，供 CLI 提示。 */
export function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    palette: t.palette,
  }));
}

/** 所有可用配色名。 */
export function listPalettes() {
  return Object.keys(PALETTES);
}

/**
 * 把模板名（或配色名）解析成一份完整的绘制参数。
 *
 * 兼容旧签名：传 'light' / 'dark' 会用默认模板 + 该配色，
 * 得到与模板系统引入前完全一致的输出。
 *
 * @param {string} [name='default'] 模板名或配色名
 * @param {object} [overrides] 额外覆盖（如 { palette: 'dark' }）
 * @returns {object} spec
 */
export function resolveSpec(name = 'default', overrides = {}) {
  let tpl;
  let paletteName;

  if (PALETTES[name] && !TEMPLATES[name]) {
    // 旧用法：resolveSpec('light') —— 默认模板换配色
    tpl = TEMPLATES.default;
    paletteName = name;
  } else if (TEMPLATES[name]) {
    tpl = TEMPLATES[name];
    paletteName = tpl.palette;
  } else if (name) {
    throw new Error(
      `未知模板 "${name}"。可用模板：${Object.keys(TEMPLATES).join(' / ')}；` +
        `可用配色：${Object.keys(PALETTES).join(' / ')}`
    );
  } else {
    tpl = TEMPLATES.default;
    paletteName = tpl.palette;
  }

  if (overrides.palette) {
    if (!PALETTES[overrides.palette]) {
      throw new Error(
        `未知配色 "${overrides.palette}"。可用配色：${Object.keys(PALETTES).join(' / ')}`
      );
    }
    paletteName = overrides.palette;
  }

  const spec = {
    ...DEFAULT_SPEC,
    ...pick(tpl, ['nodeName', 'title', 'arrowLabel', 'stroke', 'radius', 'ovalRadius', 'fontSans', 'fontSerif', 'fontMono']),
    template: tpl.name,
    templateLabel: tpl.label,
    palette: paletteName,
    theme: PALETTES[paletteName],
    stroke: { ...DEFAULT_SPEC.stroke, ...(tpl.stroke || {}) },
    radius: { ...DEFAULT_SPEC.radius, ...(tpl.radius || {}) },
    nodeName: { ...DEFAULT_SPEC.nodeName, ...(tpl.nodeName || {}) },
    title: { ...DEFAULT_SPEC.title, ...(tpl.title || {}) },
    arrowLabel: { ...DEFAULT_SPEC.arrowLabel, ...(tpl.arrowLabel || {}) },
    shape: resolveShapes(tpl.shape),
    edge: { color: 'muted', width: DEFAULT_SPEC.stroke.default, arrow: 'triangle', ...(tpl.edge || {}) },
    ...Object.fromEntries(
      Object.entries(tpl.spacing || {}).map(([k, v]) => [k, v])
    ),
  };

  return { ...spec, ...stripKeys(overrides, ['palette']) };
}

/** 形状表补齐：模板只写要改的类型，其余继承 BASE_SHAPE。 */
function resolveShapes(shape) {
  const out = {};
  for (const type of Object.keys(BASE_SHAPE)) {
    out[type] = { ...BASE_SHAPE[type], ...((shape && shape[type]) || {}) };
  }
  return out;
}

/** 取节点类型对应的形状；没有就退回 process 的形状。 */
export function shapeOf(spec, type) {
  return (spec.shape && spec.shape[type]) || (spec.shape && spec.shape.process) || BASE_SHAPE.process;
}

/**
 * 把颜色角色名换成色值。支持直接写 #rrggbb、'none'、'transparent'。
 */
export function colorOf(spec, role) {
  if (!role) return 'none';
  if (role === 'none' || role === 'transparent') return role;
  if (typeof role === 'string' && role.startsWith('#')) return role;
  const v = spec.theme && spec.theme[role];
  if (!v) throw new Error(`配色 "${spec.palette}" 里没有颜色角色 "${role}"`);
  return v;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function stripKeys(obj, keys) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

export { ceilGrid, snapGrid, titleHeight };
