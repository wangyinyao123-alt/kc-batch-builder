import {
  ASCII_WIDTHS,
  EXTRA_WIDTHS,
  FALLBACK_WIDTH,
  FULLWIDTH_RANGES,
} from './widths.js';

/** 判断是否全角字符（含 CJK、全角标点、emoji）。 */
export function isFullWidth(ch) {
  const cp = ch.codePointAt(0);
  for (const [lo, hi] of FULLWIDTH_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/**
 * 单个字符的宽度，单位 em。
 * 优先级：全角区间 → 半角扩展表 → ASCII 表 → 保底值。
 */
export function charWidth(ch) {
  if (isFullWidth(ch)) return 1;
  const ascii = ASCII_WIDTHS[ch];
  if (ascii !== undefined) return ascii;
  const extra = EXTRA_WIDTHS[ch];
  if (extra !== undefined) return extra;
  return FALLBACK_WIDTH;
}

/** 整串宽度（px）。不做字距调整，因为 Arial 本身没有（实测逐字和与整串差 < 0.1%）。 */
export function textWidth(text, fontSize) {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return em * fontSize;
}

// 禁则：不能出现在行首的字符（收尾类标点）
const NO_LINE_START = new Set([
  '。', '，', '、', '；', '：', '？', '！', '）', '】', '》', '」', '』', '”', '’',
  '·', '…', '—', '～', '%', '‰', '℃',
  '.', ',', ';', ':', '?', '!', ')', ']', '}', '%',
]);

// 禁则：不能出现在行尾的字符（起始类标点）
const NO_LINE_END = new Set(['（', '【', '《', '「', '『', '“', '‘', '(', '[', '{']);

/**
 * 把一段文本按最大宽度折行。
 *
 * 规则：
 *   - CJK 逐字可断，但遵守禁则（标点不落行首、开引号不落行尾）
 *   - 西文按空格 / 连字符断开，单个超长单词强制硬断
 *   - 保留原文的 `\n` 作为强制换行
 *
 * @returns {string[]} 折好的行（不含空行占位）
 */
export function wrapText(text, maxWidthPx, fontSize) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    out.push(...wrapParagraph(paragraph, maxWidthPx, fontSize));
  }
  return out;
}

function wrapParagraph(paragraph, maxWidthPx, fontSize) {
  // 先切成「不可再分的断点单元」：CJK 单字成块，西文连续非空格成词
  const tokens = [];
  let buf = '';
  for (const ch of paragraph) {
    if (isFullWidth(ch) || ch === ' ') {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      tokens.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);

  const lines = [];
  let line = '';
  let lineWidth = 0;

  const pushLine = () => {
    lines.push(line.replace(/\s+$/, ''));
    line = '';
    lineWidth = 0;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const tokW = textWidth(tok, fontSize);

    // 行首空格直接吞掉
    if (tok === ' ' && line === '') continue;

    if (lineWidth + tokW <= maxWidthPx) {
      line += tok;
      lineWidth += tokW;
      continue;
    }

    // 放不下，需要换行。先看禁则。
    const prev = line.slice(-1);
    const next = tokens[i + 1] || '';

    // 如果当前 token 是禁则行首字符，把它挤到上一行（即使略微超宽）
    if (NO_LINE_START.has(tok) && line !== '') {
      line += tok;
      lineWidth += tokW;
      pushLine();
      continue;
    }

    // 如果上一行末尾是禁则行尾字符（开引号/开括号），把它挪到下一行行首。
    // 注意：必须真的带走，不能直接删掉，否则字符会消失。
    let carry = '';
    if (NO_LINE_END.has(prev) && line.length > 1) {
      carry = prev;
      line = line.slice(0, -1);
      lineWidth = textWidth(line, fontSize);
    }

    if (line !== '') {
      pushLine();
      if (carry) {
        line = carry;
        lineWidth = textWidth(carry, fontSize);
      }
      // 换行后重新尝试当前 token（吞掉行首空格）
      if (tok === ' ') continue;
      i--;
      continue;
    }

    // 空行还放不下 → 单个 token 超宽，硬断
    if (tokW > maxWidthPx) {
      let chunk = '';
      let chunkW = 0;
      for (const ch of tok) {
        const cw = charWidth(ch) * fontSize;
        if (chunkW + cw > maxWidthPx && chunk !== '') {
          lines.push(chunk);
          chunk = '';
          chunkW = 0;
        }
        chunk += ch;
        chunkW += cw;
      }
      line = chunk;
      lineWidth = chunkW;
      continue;
    }

    line = tok;
    lineWidth = tokW;
    void next;
  }

  if (line !== '' || lines.length === 0) pushLine();
  return lines;
}

/**
 * 多行文本的尺寸。
 * @returns {{ lines: string[], width: number, height: number }}
 */
export function measureBlock(text, maxWidthPx, fontSize, lineHeight) {
  const lines = wrapText(text, maxWidthPx, fontSize);
  const width = lines.reduce((m, l) => Math.max(m, textWidth(l, fontSize)), 0);
  return { lines, width, height: lines.length * lineHeight };
}
