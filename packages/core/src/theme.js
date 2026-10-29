/**
 * 模板 = 一组参数，不是一套素材。
 *
 * 颜色角色全部来自 diagram-design 的 references/style-guide.md（语义 token），
 * 排版与描边来自同一份 style guide 的 Typography / Stroke, radius, spacing 两节。
 * 换模板只换这里，解析与排版逻辑不受影响。
 */

/** 4px 网格：所有坐标、尺寸、间距都必须是它的倍数（硬规则）。 */
export const GRID = 4;

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

const THEMES = { light: LIGHT, dark: DARK };

/** @param {'light'|'dark'|object} theme */
export function resolveTheme(theme) {
  if (!theme) return LIGHT;
  if (typeof theme === 'string') return THEMES[theme] || LIGHT;
  return { ...LIGHT, ...theme };
}

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
  // 起止椭圆的圆角、汇合点的半径，直接来自 type-flowchart.md
  ovalRadius: 20,
  mergeDotRadius: 4,

  // 版面
  padding: 32,
  titleGap: 24,
  minRowHeight: 48,
  maxNodeTextWidth: 200,
  lineHeightRatio: {
    // 各节点类型的文字占框比例，决定框比文字大多少
    process: { padX: 32, padY: 24, minW: 120 },
    terminal: { padX: 40, padY: 24, minW: 96 },
    decision: { aspect: 1.6, maxTextWidth: 160 },
  },
};

/** 主题 + 规格合成一份完整的绘制参数。 */
export function resolveSpec(theme, spec) {
  return {
    ...DEFAULT_SPEC,
    ...spec,
    theme: resolveTheme(theme),
    stroke: { ...DEFAULT_SPEC.stroke, ...(spec && spec.stroke) },
    radius: { ...DEFAULT_SPEC.radius, ...(spec && spec.radius) },
    nodeName: { ...DEFAULT_SPEC.nodeName, ...(spec && spec.nodeName) },
    arrowLabel: { ...DEFAULT_SPEC.arrowLabel, ...(spec && spec.arrowLabel) },
  };
}

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

/** 就近取整到 4 的倍数（坐标用）。 */
export function snapGrid(v, grid = GRID) {
  return Math.round(v / grid) * grid;
}
