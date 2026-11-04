/** 本地持久化：localStorage，前缀 kc: */
const PREFIX = 'kc:';

export function loadState(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveState(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 忽略配额错误 */
  }
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 任务类型元数据 */
export const TASK_TYPES = {
  import: {
    key: 'import',
    name: '导入图片',
    icon: '🖼',
    sticker: './img/stickers/p3-import-envelope-sticker.png',
    desc: '把本地图片批量上传到 KC 的插图目录',
    folderType: 'ISHIllustration',
    folderHint: '目标必须是插图目录（\\image 层），普通目录放不了图片',
  },
  topic: {
    key: 'topic',
    name: '新建 Topic',
    icon: '📄',
    sticker: './img/stickers/p3-topic-notepad-sticker.png',
    desc: '批量创建 topic，可从 XML 目录或标题清单生成',
    folderType: 'ISHModule',
    folderHint: '目标必须是 Topic 目录；类型不符时脚本会自动建 Topics\\ 子容器',
  },
  map: {
    key: 'map',
    name: '新建 Map',
    icon: '🗺',
    sticker: './img/stickers/p3-map-folder-sticker.png',
    desc: '批量创建 map，可从本地 map XML 或标题清单生成',
    folderType: 'ISHMasterDoc',
    folderHint: '目标必须是 Map 目录；类型不符时脚本会自动建 Maps\\ 子容器',
  },
  pub: {
    key: 'pub',
    name: '新建 Pub',
    icon: '📚',
    sticker: './img/stickers/p3-pub-floppy-sticker.png',
    desc: '创建空的 Publication，输出格式决定 pub 类型',
    folderType: 'ISHPublication',
    folderHint: '目标必须是 Publication 目录；类型不符时脚本会自动建 Publications\\ 子容器',
  },
};

/** KC 路径清洗：与脚本 Normalize-KcPath 对齐（见 kc-import-contract.md §6） */
export function normalizeKcPath(raw) {
  if (!raw) return '';
  let s = String(raw);
  // 去 BOM / 零宽字符 / 不换行空格
  s = s.replace(/[\uFEFF\u200B-\u200D]/g, '').replace(/\u00A0/g, ' ');
  // 去首尾引号（含中文引号）
  s = s.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '');
  // / → \
  s = s.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  // 去首尾 \
  s = s.replace(/^\\+|\\+$/g, '').trim();
  // 中部含 general\ → 从该处截断
  const idx = s.toLowerCase().indexOf('general\\');
  if (idx > 0) s = s.slice(idx);
  // 开头 general → General
  s = s.replace(/^general(\\|$)/i, (m, sep) => 'General' + (sep || ''));
  return s;
}

/** 从标题清单文本解析标题（Lines/Csv/Markdown/Auto） */
export function parseTitles(text, mode = 'auto', fileName = '') {
  if (!text) return [];
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  let m = mode;
  if (m === 'auto') {
    if (ext === 'csv') m = 'csv';
    else if (ext === 'md' || ext === 'markdown') m = 'markdown';
    else m = 'lines';
  }

  const raw = text.replace(/^\uFEFF/, '');

  if (m === 'lines') {
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  if (m === 'markdown') {
    const out = [];
    let inCode = false;
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const mm = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (mm) out.push(mm[1].trim());
    }
    return out;
  }

  if (m === 'csv') {
    const rows = parseCsv(raw);
    if (!rows.length) return [];
    // 找表头列
    const header = rows[0].map((c) => c.trim().toLowerCase());
    const idx = header.findIndex((h) => ['title', '标题', '名称', 'topic', 'map'].includes(h));
    if (idx >= 0) {
      return rows
        .slice(1)
        .map((r) => (r[idx] || '').trim())
        .filter(Boolean);
    }
    return rows.map((r) => (r[0] || '').trim()).filter(Boolean);
  }

  return [];
}

function parseCsv(text) {
  const rows = [];
  let cur = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cur.push(cell);
      cell = '';
    } else if (ch === '\n') {
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** 状态 → 展示文案与色 */
export const STATE_UI = {
  TOCREATE: { label: '待创建', cls: 'tag-green' },
  TOUPDATE: { label: '待更新', cls: 'tag-blue' },
  UNCHANGED: { label: '无变化', cls: 'tag-gray' },
  SKIPPED: { label: '跳过', cls: 'tag-gray' },
  SKIP_NOEXIST: { label: 'KC 无此项', cls: 'tag-gray' },
  BLOCKED: { label: '阻塞', cls: 'tag-amber' },
  FAILED: { label: '失败', cls: 'tag-red' },
  CREATED: { label: '已创建', cls: 'tag-green' },
  UPDATED: { label: '已更新', cls: 'tag-green' },
  UPDATED_UNVERIFIED: { label: '已写未校验', cls: 'tag-amber' },
};

export const TASK_STATUS_UI = {
  draft: { label: '待预检', cls: 'tag-gray' },
  prechecking: { label: '预检中', cls: 'tag-blue' },
  ready: { label: '可执行', cls: 'tag-pink' },
  running: { label: '执行中', cls: 'tag-blue' },
  done: { label: '已完成', cls: 'tag-green' },
  partial: { label: '部分失败', cls: 'tag-amber' },
  failed: { label: '失败', cls: 'tag-red' },
  canceled: { label: '已取消', cls: 'tag-gray' },
};
