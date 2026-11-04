/**
 * 日志解析器测试。
 *
 * 这里用的日志样例行**逐字取自脚本源码的 Log 格式串**，不是凭印象编的：
 *   - 预检明细行：kc-import-images-ui.ps1:1823
 *       "    {0,-16} {1}{2}  <{3}>  {4}" -f State, Name, resTag, TypeShort, Note
 *     → 只有一个尖括号（类型），没有落点路径，说明是纯文本。
 *   早先的用例写成两个尖括号（`<EDTPNG> <路径>`），与真实输出不符，
 *   于是解析器里要求两个尖括号的正则一路绿灯，直到真跑一遍才发现 items 恒为 0。
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseLine, createParserState } = require('./kc-log-parser');

function parseAll(log, taskType) {
  const st = createParserState(taskType);
  const events = [];
  for (const line of log.split('\n')) {
    for (const evt of parseLine(line, st)) events.push(evt);
  }
  return { st, events };
}
const ofType = (events, t) => events.filter((e) => e.type === t);

// ---------------------------------------------------------------- 预检明细行
test('导入预检明细行：单尖括号（真实脚本格式）', () => {
  const { events } = parseAll(
    [
      '[预检] 新建 1 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 0 / 共 2',
      '    TOCREATE         cover.png [1920x1080]  <EDTPNG>  新图',
      '    UNCHANGED        sticker-01.png  <EDTPNG>  SHA256 相同',
    ].join('\n'),
    'import'
  );
  const items = ofType(events, 'item');
  assert.equal(items.length, 2, '两条明细行都应该解析出来');
  assert.deepEqual(
    { state: items[0].state, title: items[0].title, tag: items[0].tag, note: items[0].note },
    { state: 'TOCREATE', title: 'cover.png', tag: 'EDTPNG', note: '新图' }
  );
  assert.deepEqual(
    { state: items[1].state, title: items[1].title, tag: items[1].tag, note: items[1].note },
    { state: 'UNCHANGED', title: 'sticker-01.png', tag: 'EDTPNG', note: 'SHA256 相同' }
  );
});

test('导入明细行：分辨率方括号不污染标题', () => {
  const { events } = parseAll('    TOUPDATE         bulb.webp [800x600]  <EDTWEBP>  已有同名', 'import');
  const it = ofType(events, 'item')[0];
  assert.equal(it.title, 'bulb.webp', '方括号里的分辨率被吃进标题了');
  assert.equal(it.state, 'TOUPDATE');
});

test('导入明细行：五种状态都能识别', () => {
  const states = ['TOCREATE', 'TOUPDATE', 'UNCHANGED', 'SKIPPED', 'BLOCKED'];
  const log = states.map((s) => `    ${s.padEnd(16)} x.png  <EDTPNG>  note`).join('\n');
  const { events } = parseAll(log, 'import');
  assert.deepEqual(
    ofType(events, 'item').map((e) => e.state),
    states
  );
});

test('导入明细行：说明文字为空也能解析', () => {
  const { events } = parseAll('    TOCREATE         bare.png  <EDTPNG>  ', 'import');
  assert.equal(ofType(events, 'item')[0].title, 'bare.png');
});

// ---------------------------------------------------------------- 新建对象明细行
test('新建对象预检明细行：标题与类型标签拆分', () => {
  const { events } = parseAll(
    '    TOCREATE Topic:TASK 任务一  <General\\demo\\任务一>  (将新建)',
    'topic'
  );
  const it = ofType(events, 'item')[0];
  assert.equal(it.state, 'TOCREATE');
  assert.equal(it.tag, 'Topic:TASK');
  assert.equal(it.title, '任务一');
  assert.equal(it.path, 'General\\demo\\任务一');
});

// ---------------------------------------------------------------- 汇总
test('预检汇总：六项计数全部解析', () => {
  const { st, events } = parseAll(
    '[预检] 新建 3 / 更新 2 / 无变化 1 / 跳过 4 / 阻塞 5 / 失败 6 / 共 21',
    'import'
  );
  const sum = ofType(events, 'summary')[0];
  assert.equal(sum.phase, 'precheck');
  assert.deepEqual(sum.counts, {
    created: 3, updated: 2, unchanged: 1, skipped: 4, blocked: 5, failed: 6, total: 21,
  });
  assert.equal(st.summary.created, 3);
});

test('新建对象预检汇总：「将创建/将跳过」措辞也能解析', () => {
  const { events } = parseAll('[预检] 将创建 3 / 将跳过 1 / 将阻塞 0 / 将失败 0 / 共 4', 'topic');
  assert.equal(ofType(events, 'summary')[0].counts.created, 3);
});

test('结果汇总：合并进 summary 且带 phase', () => {
  const { st, events } = parseAll(
    '[结果] 新建 2 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 1 / 共 4',
    'import'
  );
  const e = ofType(events, 'summary')[0];
  assert.equal(e.phase, 'result');
  assert.equal(e.counts.failed, 1);
  assert.equal(st.summary.total, 4);
});

// ---------------------------------------------------------------- 执行进度
test('执行进度：built 行带 ObjectRef/IshRef/FolderId', () => {
  const { events } = parseAll(
    '[1/3] cover.png  —— 建成 ObjectRef=GUID-COVER IshRef=ISH-COVER 落点 FolderId=10087',
    'import'
  );
  const p = ofType(events, 'progress')[0];
  assert.deepEqual(
    { i: p.i, n: p.n, title: p.title, objectRef: p.objectRef, ishRef: p.ishRef, folderId: p.folderId, state: p.state },
    { i: 1, n: 3, title: 'cover.png', objectRef: 'GUID-COVER', ishRef: 'ISH-COVER', folderId: '10087', state: 'CREATED' }
  );
});

test('执行进度：失败行带错误码原文', () => {
  const { events } = parseAll('[3/3] bulb.webp  —— 失败：[-129] InvalidDocTypeforFolder', 'import');
  const p = ofType(events, 'progress')[0];
  assert.equal(p.state, 'FAILED');
  assert.match(p.error, /-129/);
});

test('回读：全部找到时标 ok', () => {
  const { events } = parseAll('[OK] 回读 FolderId=10087：本轮 3 个，未见 0 个', 'import');
  assert.equal(ofType(events, 'readback')[0].ok, true);
});

test('回读：有未见时降级成 warn 而不是静默通过', () => {
  const { events } = parseAll('[OK] 回读 FolderId=10087：本轮 3 个，未见 2 个', 'import');
  const w = ofType(events, 'warn')[0];
  assert.ok(w, '回读缺对象时必须给出 warn');
  assert.match(w.text, /2/);
});

// ---------------------------------------------------------------- 登录
test('登录成功与失败分别产出事件', () => {
  const ok = parseAll('[OK] 登录成功：ISHRemote 9.0.0 / 账号 zhangsan', 'import');
  const login = ofType(ok.events, 'login')[0];
  assert.equal(login.ok, true);
  assert.equal(login.user, 'zhangsan');

  const bad = parseAll('[X] 登录失败：无法连接到 https://kc.hikvision.com/ISHWS/', 'import');
  const f = ofType(bad.events, 'login')[0];
  assert.equal(f.ok, false);
  assert.match(f.error, /无法连接/);
});

// ---------------------------------------------------------------- 列目录
test('KCJSON 行解析成 folder 事件', () => {
  const line =
    'KCJSON {"path":"General\\\\demo","resolved":true,"leaf":"demo","missing":[],"folderType":"ISHModule","folderId":"10088","children":[{"name":"image","id":"10087","type":"ISHIllustration"}]}';
  const { events } = parseAll(line, 'topic');
  const f = ofType(events, 'folder')[0];
  assert.equal(f.data.folderId, '10088');
  assert.equal(f.data.children[0].name, 'image');
});

// ---------------------------------------------------------------- 杂项
test('台账与对照表行解析出 artifact', () => {
  const { events } = parseAll(
    ['[OK] 台账追加 3 行，累计 128 行：logs\\kc-import-ledger.csv', '[OK] 对照表已写出：logs\\demo_GUID_20261103-1600.csv'].join('\n'),
    'import'
  );
  const arts = ofType(events, 'artifact');
  assert.equal(arts.length, 2);
  assert.match(arts[0].path, /ledger\.csv$/);
  assert.match(arts[1].path, /GUID_20261103-1600\.csv$/);
});

test('STEP 行解析出阶段名', () => {
  const { events } = parseAll('STEP 4  预检（只读）', 'import');
  const s = ofType(events, 'step')[0];
  assert.equal(s.n, 4);
  assert.match(s.label, /预检/);
});
