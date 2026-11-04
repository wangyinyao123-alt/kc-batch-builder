/**
 * kc-log-parser.js
 * 把 PowerShell 脚本 stdout 的行协议转成结构化事件流。
 * 唯一依据：backend/kc-import-contract.md §3 与 backend/kc-create-contract.md §3。
 *
 * 事件形状（渲染进程消费）：
 *   { type: 'step', n, label }
 *   { type: 'login', ok, version?, user?, error? }
 *   { type: 'item', index, total, title, state, note }
 *   { type: 'summary', phase: 'precheck'|'result', counts: {...} }
 *   { type: 'progress', i, n, title, state }
 *   { type: 'folder', ... }           ← KCJSON
 *   { type: 'artifact', kind, path }
 *   { type: 'attach', kind, ok, note }
 *   { type: 'warn', text }
 *   { type: 'error', text }
 *   { type: 'log', text }             ← 未匹配的原样透传（折叠区显示）
 */

function createParserState(taskType) {
  return {
    taskType,
    step: 0,
    stepLabel: '',
    phase: 'idle', // idle | precheck | commit
    summary: {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
      total: 0,
    },
    items: [],
    artifacts: [],
    attachFail: false,
    attachSkipped: false,
    folder: null,
  };
}

const RE = {
  step: /^STEP\s+(\d+[a-z]?)\s*(.*)$/,
  loginOk: /^\[OK\]\s*登录成功：(.+?)\s*\/\s*账号\s*(.+)$/,
  loginFail: /^\[X\]\s*登录失败：(.+)$/,
  authBad: /判定：账号或密码不正确/,
  tlsDown: /判定：证书\/TLS 校验没谈拢/,
  certWarn: /^\[!\]\s*是靠放行证书校验才连上的/,

  precheckSummary:
    /^\[预检\]\s*(?:新建|将创建)\s*(\d+)\s*\/\s*(?:更新\s*(\d+)\s*\/\s*)?(?:无变化\s*(\d+)\s*\/\s*)?(?:跳过|将跳过)\s*(\d+)\s*\/\s*(?:阻塞|将阻塞)\s*(\d+)\s*\/\s*(?:失败|将失败)\s*(\d+)\s*\/\s*共\s*(\d+)/,
  // [结果] 新建 2 / 更新 0（其中未校验 0） / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 1 / 共 4
  resultSummary: /^\[结果\]\s*(.+)$/,
  resultNum: /(新建|创建|更新|无变化|跳过|阻塞|失败|共)\s*(\d+)/g,

  // import：  TOCREATE  cover.png [1920x1080] <EDTPNG> <General\x\cover.png>
  itemLineImport: /^ {2,}(\S+)\s+(.+?)\s+<(\w+)>\s+<(.+?)>\s*(.*)$/,
  // create：  TOCREATE Topic:TASK 任务一  <General\demo\任务一>  (将新建)
  itemLineCreate: /^ {2,}(\S+)\s+(.+?)\s+<(.+?)>\s*(.*)$/,
  created:
    /^\[(\d+)\/(\d+)\]\s*(.+?)\s*——\s*建成\s*ObjectRef=(\S+)(?:\s+IshRef=(\S+))?(?:\s+落点\s+FolderId=(\d+))?/,
  updated: /^\[(\d+)\/(\d+)\]\s*(.+?)\s*——\s*替换内容/,
  itemFail: /^\[(\d+)\/(\d+)\]\s*(.+?)\s*——\s*(?:更新)?失败：(.+)$/,
  readback: /^\[OK\]\s*回读\s*FolderId=(\d+)：本轮\s*(\d+)\s*个，未见\s*(\d+)\s*个/,
  newFolder: /^\[NEW\]\s*(.+?)\s+FolderId=(\d+)\s+type=(\S+)/,
  missingSeg: /^\[!\]\s*缺失\s*(\d+)\s*层：(.+)$/,

  kcjson: /^KCJSON\s*(\{.*\})$/,

  backup: /^\[BK\]\s*已备份\s*map\s*XML：(.+)$/,
  attachWrite: /^\[OK\]\s*已写入\s*(map|pub[^\s：]*)[：:]\s*(.+)$/,
  attachOk: /^\[OK\]\s*回读校验通过：topicref\s*(\d+)\s*→\s*(\d+)/,
  attachFail: /^\[X\]\s*(Topic\s*→\s*Map|Map\s*→\s*Pub)\s*挂接失败：(.+)$/,
  attachUnavailable: /^\[!\]\s*(Topic\s*→\s*Map|Map\s*→\s*Pub)\s*挂接不可用：(.+)$/,

  ledger: /^\[OK\]\s*台账追加\s*(\d+)\s*行，累计\s*(\d+)\s*行：(.+)$/,
  guidTable: /^\[OK\]\s*对照表已写出：(.+)$/,
  transcript: /^transcript\s*:\s*(.+)$/,
  lovOutputFormat: /^\[OK\]\s*OutputFormat\s*(\d+)\s*个/,
  lovMasterType: /^\[OK\]\s*Map\s*类型\s*(\d+)\s*个/,
  selfcheck: /^\[OK\]\s*自审通过（AST）/,

  fatal: /^\[X\]\s*未捕获的异常，脚本已中止：/,
  abort: /^ABORT:\s*(.+)$/,
};

/** 解析标题清单里的状态词 → 统一状态值 */
const STATE_MAP = {
  TOCREATE: 'TOCREATE',
  TOUPDATE: 'TOUPDATE',
  UNCHANGED: 'UNCHANGED',
  SKIPPED: 'SKIPPED',
  SKIP_NOEXIST: 'SKIP_NOEXIST',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  UPDATED_UNVERIFIED: 'UPDATED_UNVERIFIED',
};

function normState(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return STATE_MAP[s] || s || 'UNKNOWN';
}

/**
 * @param {string} line 单行
 * @param {object} st   createParserState() 的返回值
 * @returns {object[]}  事件数组（一行可能产生多事件，也可能 0 个）
 */
function parseLine(line, st) {
  const events = [];
  const s = line.replace(/\u00a0/g, ' ').trimEnd();
  let m;

  // ---------------------------------------------------------------- 阶段
  if ((m = s.match(RE.step))) {
    st.step = m[1];
    st.stepLabel = m[2] || '';
    if (st.step === 4) st.phase = 'precheck';
    if (st.step === 5) st.phase = 'commit';
    events.push({ type: 'step', n: st.step, label: st.stepLabel });
    return events;
  }

  // ---------------------------------------------------------------- KCJSON（-ListFolders）
  if ((m = s.match(RE.kcjson))) {
    try {
      const data = JSON.parse(m[1]);
      st.folder = data;
      events.push({ type: 'folder', data });
      return events;
    } catch {
      events.push({ type: 'warn', text: 'KCJSON 解析失败' });
      return events;
    }
  }

  // ---------------------------------------------------------------- 登录
  if ((m = s.match(RE.loginOk))) {
    events.push({ type: 'login', ok: true, version: m[1].trim(), user: m[2].trim() });
    return events;
  }
  if ((m = s.match(RE.loginFail))) {
    events.push({ type: 'login', ok: false, error: m[1].trim() });
    return events;
  }
  if (RE.authBad.test(s)) {
    events.push({ type: 'login', ok: false, error: '账号或密码不正确（已停止重试，防锁号）' });
    return events;
  }
  if (RE.certWarn.test(s)) {
    events.push({ type: 'warn', text: '本机不信任 KC 证书，本次会话跳过校验（仅限内网）' });
    return events;
  }

  // ---------------------------------------------------------------- 预检 / 结果汇总
  if ((m = s.match(RE.precheckSummary))) {
    st.summary.created = Number(m[1]);
    st.summary.updated = Number(m[2] || 0);
    st.summary.unchanged = Number(m[3] || 0);
    st.summary.skipped = Number(m[4] || 0);
    st.summary.blocked = Number(m[5] || 0);
    st.summary.failed = Number(m[6] || 0);
    st.summary.total = Number(m[7] || 0);
    events.push({ type: 'summary', phase: 'precheck', counts: { ...st.summary } });
    return events;
  }
  if ((m = s.match(RE.resultSummary))) {
    const counts = {};
    for (const g of m[1].matchAll(RE.resultNum)) {
      const k = { 新建: 'created', 创建: 'created', 更新: 'updated', 无变化: 'unchanged', 跳过: 'skipped', 阻塞: 'blocked', 失败: 'failed', 共: 'total' }[g[1]];
      if (k) counts[k] = Number(g[2]);
    }
    st.summary = { ...st.summary, ...counts };
    events.push({ type: 'summary', phase: 'result', counts });
    return events;
  }

  // ---------------------------------------------------------------- 单项清单（预检明细行）
  if (s.startsWith('    ') && !s.startsWith('    [')) {
    const im = s.match(RE.itemLineImport);
    if (im && STATE_MAP[normState(im[1])]) {
      const item = {
        state: normState(im[1]),
        title: im[2].trim(),
        tag: im[3],
        path: im[4].trim(),
        note: (im[5] || '').trim(),
      };
      st.items.push(item);
      events.push({ type: 'item', ...item });
      return events;
    }
    const cm = s.match(RE.itemLineCreate);
    if (cm && STATE_MAP[normState(cm[1])]) {
      // 标题与类型标签可能挤在一起：Topic:TASK 任务一
      const rest = cm[2].trim();
      const tagM = rest.match(/^(Topic|Map|Pub):(\w+)\s+(.+)$/);
      const item = {
        state: normState(cm[1]),
        tag: tagM ? `${tagM[1]}:${tagM[2]}` : '',
        title: tagM ? tagM[3].trim() : rest,
        path: cm[3].trim(),
        note: (cm[4] || '').trim(),
      };
      st.items.push(item);
      events.push({ type: 'item', ...item });
      return events;
    }
  }

  // ---------------------------------------------------------------- 执行进度
  if ((m = s.match(RE.created))) {
    const item = {
      i: Number(m[1]),
      n: Number(m[2]),
      title: m[3].trim(),
      objectRef: m[4],
      ishRef: m[5] || '',
      folderId: m[6] || '',
      state: 'CREATED',
    };
    events.push({ type: 'progress', ...item });
    return events;
  }
  if ((m = s.match(RE.updated))) {
    events.push({
      type: 'progress',
      i: Number(m[1]),
      n: Number(m[2]),
      title: m[3].trim(),
      state: 'UPDATED',
    });
    return events;
  }
  if ((m = s.match(RE.itemFail))) {
    events.push({
      type: 'progress',
      i: Number(m[1]),
      n: Number(m[2]),
      title: m[3].trim(),
      state: 'FAILED',
      error: m[4].trim(),
    });
    return events;
  }
  if ((m = s.match(RE.readback))) {
    const unseen = Number(m[3]);
    if (unseen > 0) {
      events.push({
        type: 'warn',
        text: `回读未见 ${unseen} 个对象（可能是 KC 索引延迟，稍后在任务中心刷新确认）`,
      });
    } else {
      events.push({ type: 'readback', ok: true, count: Number(m[2]) });
    }
    return events;
  }
  if ((m = s.match(RE.newFolder))) {
    events.push({ type: 'newFolder', path: m[1].trim(), folderId: m[2], folderType: m[3] });
    return events;
  }
  if ((m = s.match(RE.missingSeg))) {
    events.push({ type: 'missingSegments', count: Number(m[1]), path: m[2].trim() });
    return events;
  }

  // ---------------------------------------------------------------- 挂接
  if ((m = s.match(RE.backup))) {
    events.push({ type: 'artifact', kind: 'backup', path: m[1].trim() });
    return events;
  }
  if ((m = s.match(RE.attachWrite))) {
    events.push({ type: 'attach', kind: m[1], ok: true, note: m[2].trim() });
    return events;
  }
  if ((m = s.match(RE.attachOk))) {
    events.push({ type: 'attach', kind: 'verify', ok: true, note: `topicref ${m[1]} → ${m[2]}` });
    return events;
  }
  if ((m = s.match(RE.attachFail))) {
    st.attachFail = true;
    events.push({ type: 'attach', kind: m[1], ok: false, note: m[2].trim() });
    return events;
  }
  if ((m = s.match(RE.attachUnavailable))) {
    st.attachSkipped = true;
    events.push({
      type: 'attach',
      kind: m[1],
      ok: false,
      skipped: true,
      note: m[2].trim(),
    });
    return events;
  }

  // ---------------------------------------------------------------- 产物
  if ((m = s.match(RE.guidTable))) {
    st.artifacts.push({ kind: 'guidTable', path: m[1].trim() });
    events.push({ type: 'artifact', kind: 'guidTable', path: m[1].trim() });
    return events;
  }
  if ((m = s.match(RE.ledger))) {
    st.artifacts.push({ kind: 'ledger', path: m[3].trim() });
    events.push({ type: 'artifact', kind: 'ledger', path: m[3].trim(), rows: Number(m[1]) });
    return events;
  }
  if ((m = s.match(RE.transcript))) {
    st.artifacts.push({ kind: 'transcript', path: m[1].trim() });
    events.push({ type: 'artifact', kind: 'transcript', path: m[1].trim() });
    return events;
  }

  // ---------------------------------------------------------------- LOV / 自审
  if ((m = s.match(RE.lovOutputFormat))) {
    events.push({ type: 'lov', kind: 'outputFormat', count: Number(m[1]) });
    return events;
  }
  if ((m = s.match(RE.lovMasterType))) {
    events.push({ type: 'lov', kind: 'masterType', count: Number(m[1]) });
    return events;
  }
  if (RE.selfcheck.test(s)) {
    events.push({ type: 'selfcheck', ok: true });
    return events;
  }

  // ---------------------------------------------------------------- 异常
  if (RE.fatal.test(s) || (m = s.match(RE.abort))) {
    events.push({ type: 'error', text: s });
    return events;
  }
  if (/^\[X\]/.test(s)) {
    events.push({ type: 'error', text: s });
    return events;
  }
  if (/^\[!\]/.test(s)) {
    events.push({ type: 'warn', text: s });
    return events;
  }

  // ---------------------------------------------------------------- 未匹配透传
  if (s.trim()) events.push({ type: 'log', text: s });
  return events;
}

module.exports = { createParserState, parseLine, normState, STATE_MAP };
