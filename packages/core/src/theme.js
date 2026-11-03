/**
 * 设计令牌层：配色（palette）、排版规格（DEFAULT_SPEC）、网格工具。
 *
 * 这一层不知道「模板」是什么 —— 模板是 templates.js 在它之上叠的一层。
 * 颜色角色全部来自 diagram-design 的 references/style-guide.md（语义 token），
 * 排版与描边来自同一份 style guide 的 Typography / Stroke, radius, spacing 两节。
 */

/** 4px 网格：所有坐标、尺寸、间距都必须是它的倍数（硬规则）。 */
export const GRID = 4;

/**
 * 节点宽高的量化步长 = 2 个网格。
 *
 * 为什么宽高必须是 8 的倍数、而不是 4 就够了：连线端口取的是「框边中点」，
 * 也就是 x + w/2。若 w 只是 4 的倍数（比如 148 → w/2 = 74），中心点就会落在
 * 半格上（74 % 4 === 2）。这时两个框的端口一竖一横，正交路由必须用一个
 * 2px 的小折角去消化这半个格差 —— 画出来就是肉眼可见的「线是歪的」。
 * 宽高取 8 的倍数后 w/2、h/2 必为 4 的倍数，中心点与端口全部落回网格。
 */
export const CELL = GRID * 2;

export const LIGHT = {
  name: 'light',
  paper: '#f5f5f5',
  paper2: '#ececec',
  ink: '#2d3142',
  inkStrong: '#111111',
  muted: '#4f5d75',
  soft: '#5a6580',
  rule: 'rgba(45,49,66,0.12)',
  ruleSolid: '#bfc0c0',
  accent: '#bf4520',
  accentTint: 'rgba(191,69,32,0.08)',
  link: '#2e5aa8',
};

export const DARK = {
  name: 'dark',
  paper: '#2d3142',
  paper2: '#393e53',
  ink: '#f5f5f5',
  inkStrong: '#111111',
  muted: '#bfc0c0',
  soft: '#949eb2',
  rule: 'rgba(245,245,245,0.12)',
  ruleSolid: 'rgba(191,192,192,0.25)',
  accent: '#f08a59',
  accentTint: 'rgba(240,138,89,0.10)',
  link: '#739fdf',
};

/**
 * 排版规格。字体栈按 diagram-design 的「CJK 不收字」规则延伸：
 * Geist 无汉字，中文名走自己的族栈，绝不换 skin。
 */
export const DEFAULT_SPEC = {
  // 字体来源：system（默认，无网络）或 web（引 Google Fonts）
  fontSource: 'system',
  fontSans:
    "'Geist','Noto Sans TC','PingFang TC','PingFang SC','Microsoft JhengHei','Microsoft YaHei',sans-serif",
  fontSerif: "'Instrument Serif','Noto Serif TC','Noto Serif SC',serif",
  fontMono: "'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace",

  // 字号：汉字有 12px 下限，所以 nodeName 就是 12px
  nodeName: { size: 12, weight: 600, lineHeight: 18 },
  title: { size: 28, weight: 400 },
  // 箭头标签默认是 8px 等宽 + 0.06em 字距；含汉字时切到 12px 无衬线 500、无字距
  arrowLabel: { size: 8, weight: 400, tracking: 0.06, cjkSize: 12, cjkWeight: 500 },

  stroke: { thin: 0.8, default: 1, strong: 1.2 },
  radius: { sm: 4, md: 6, lg: 8 },

  /**
   * 连线的可调项。模板可以整块覆盖（见 templates.js 的 edge）。
   *
   * arrowSize 默认 12 而不是 8：8px 的实心三角在 12px 字号的图里太小，
   * 屏幕上要放大才看得见，用户第一反应是「箭头没有了」。
   *
   * corner 是转折处的圆角半径（px）。0 = 严格直角；给到段长一半以上
   * 就会自然收敛成曲线 —— 所以「圆角」和「曲线」是同一条路径算法的两端，
   * 不需要两套实现。
   */
  edge: {
    color: 'muted',
    width: 1,
    // arrow 取 triangle / open / diamond / circle / none
    arrow: 'triangle',
    arrowSize: 12,
    // dash 取 solid / dashed / dotted
    dash: 'solid',
    corner: 0,
  },
  // 起止椭圆的圆角、汇合点的半径，直接来自 type-flowchart.md
  ovalRadius: 20,
  mergeDotRadius: 4,

  // 版面（模板可覆盖，见 templates.js 的 spacing）
  padding: 32,
  titleGap: 24,
  nodeGap: 40,
  rankGap: 56,
  minRowHeight: 48,
  maxNodeTextWidth: 200,
  lineHeightRatio: {
    // 各节点类型的文字占框比例，决定框比文字大多少
    process: { padX: 32, padY: 24, minW: 120 },
    terminal: { padX: 40, padY: 24, minW: 96 },
    decision: { aspect: 1.6, maxTextWidth: 160 },
  },
};

/**
 * 标题占的高度（0 表示不画标题）。
 * SVG 与 vsdx 两条导出路径必须用同一个值，否则页高对不上。
 */
export function titleHeight(spec, hasTitle) {
  if (!hasTitle) return 0;
  return ceilGrid(spec.title.size * 1.4 + spec.titleGap);
}

/** 向上取整到 4 的倍数（框宽、坐标一律向上取整，避免文字被切）。 */
export function ceilGrid(v, grid = GRID) {
  return Math.ceil(v / grid) * grid;
}

/**
 * 向上取整到 8 的倍数（节点宽、高专用）。
 *
 * 与 ceilGrid 的区别只有一处，但很关键：尺寸走这个函数，中心点才会落在网格上。
 * 坐标 x/y 仍然用 ceilGrid/snapGrid（4 的倍数）—— 中心 = x + w/2，
 * w/2 是 4 的倍数 ⇒ 中心也是 4 的倍数，端口与折线才对得齐。
 */
export function ceilCell(v, grid = CELL) {
  return Math.ceil(v / grid) * grid;
}

/** 就近取整到 4 的倍数（坐标用）。 */
export function snapGrid(v, grid = GRID) {
  return Math.round(v / grid) * grid;
}
