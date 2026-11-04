/**
 * mockRunner：macOS/Linux 开发机上回放录制的真实日志，喂给同一个解析器。
 * 录制文件放 kc-app/mock/fixtures/<taskType>-<mode>.log
 * 每次回放按行延迟，模拟真实执行节奏。
 */
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '../../mock/fixtures');

function pickFixture(payload) {
  const { taskType, mode } = payload;
  // 只认精确匹配。早先这里会在 commit 时回落到 precheck 的录制文件，
  // 但 precheck 录制里没有 STEP 5/6/7，commit 会跑出一份"零进度零结果"的假日志，
  // 让人误以为执行链路坏了。宁可回落到 synthesize() 生成完整流程。
  const names = [`${taskType}-${mode}.log`, 'fallback.log'];
  for (const n of names) {
    const p = path.join(FIXTURE_DIR, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 没有录制文件时，生成一段"像样"的假日志，保证 UI 流程可跑通 */
function synthesize(payload) {
  const { taskType, mode, params = {} } = payload;
  const lines = [];
  const label = { import: '批量导入图片', topic: '新建 Topic', map: '新建 Map', pub: '新建 Pub' }[taskType] || '任务';

  lines.push(`STEP 1  登录 KC`);
  lines.push(`[..] 第 1 级 标准校验登录…`);
  lines.push(`[OK] 登录成功：ISHRemote 9.0.0 / 账号 ${params.user || 'demo'}`);

  if (mode === 'listFolders') {
    lines.push(
      'KCJSON ' +
        JSON.stringify({
          path: params.folderPath || 'General\\demo',
          resolved: true,
          leaf: 'demo',
          missing: [],
          folderType: 'ISHModule',
          folderId: '10086',
          children: [
            { name: 'image', id: '10087', type: 'ISHIllustration' },
            { name: 'Topics', id: '10088', type: 'ISHModule' },
            { name: 'Maps', id: '10089', type: 'ISHMasterDoc' },
          ],
        })
    );
    return lines;
  }

  lines.push(`STEP 2  生成对象清单`);
  if (taskType === 'import') {
    lines.push(`STEP 3  落点解析`);
    lines.push(`[OK] 目标目录最深已存在：${params.folderPath || 'General\\demo\\image'}（3/3 层）FolderId=10087 type=ISHIllustration`);
    lines.push(`STEP 4  预检（只读）`);
    lines.push(`[预检] 新建 3 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 0 / 共 4`);
    // 格式必须与真实脚本一致（kc-import-images-ui.ps1:1823）：
    //   "    {0,-16} {1}{2}  <{3}>  {4}" -f State, Name, resTag, TypeShort, Note
    // 只有类型一个尖括号，没有落点路径 —— 写成两个尖括号会让解析器全部匹配不上。
    lines.push(`    TOCREATE         cover.png [1920x1080]  <EDTPNG>  新图`);
    lines.push(`    TOCREATE         logo.svg  <EDTSVG>  新图`);
    lines.push(`    TOCREATE         bulb.webp [800x600]  <EDTWEBP>  新图`);
    lines.push(`    UNCHANGED        sticker-01.png  <EDTPNG>  SHA256 相同`);
    if (mode === 'commit') {
      lines.push(`STEP 5  执行`);
      lines.push(`[1/3] cover.png  —— 建成 ObjectRef=GUID-COVER IshRef=ISH-COVER 落点 FolderId=10087`);
      lines.push(`[2/3] logo.svg  —— 建成 ObjectRef=GUID-LOGO IshRef=ISH-LOGO 落点 FolderId=10087`);
      lines.push(`[3/3] bulb.webp  —— 建成 ObjectRef=GUID-BULB IshRef=ISH-BULB 落点 FolderId=10087`);
      lines.push(`[OK] 回读 FolderId=10087：本轮 3 个，未见 0 个`);
      lines.push(`STEP 6  台账`);
      lines.push(`[OK] 台账追加 3 行，累计 128 行：logs\\kc-import-ledger.csv`);
      lines.push(`STEP 7  名称 / GUID 对照表`);
      lines.push(`[结果] 新建 3 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 0 / 共 4`);
      lines.push(`[OK] 对照表已写出：logs\\demo_GUID_20261103-1600.csv`);
    }
  } else {
    lines.push(`[OK] 清单 3 项（Topic 3 / Map 0 / Pub 0）`);
    lines.push(`STEP 4  预检（只读）`);
    lines.push(`[预检] 将创建 3 / 跳过 0 / 阻塞 0 / 失败 0 / 共 3`);
    lines.push(`    TOCREATE Topic:TASK 任务一  <${params.folderPath || 'General\\demo'}\\任务一>  (将新建)`);
    lines.push(`    TOCREATE Topic:TASK 任务二  <${params.folderPath || 'General\\demo'}\\任务二>  (将新建)`);
    lines.push(`    TOCREATE Topic:CONCEPT 概念一  <${params.folderPath || 'General\\demo'}\\概念一>  (将新建)`);
    if (mode === 'commit') {
      lines.push(`STEP 5  执行`);
      lines.push(`[1/3] 任务一  —— 建成 ObjectRef=GUID-T1 IshRef=ISH-T1  落点 FolderId=10088`);
      lines.push(`[2/3] 任务二  —— 建成 ObjectRef=GUID-T2 IshRef=ISH-T2  落点 FolderId=10088`);
      lines.push(`[3/3] 概念一  —— 建成 ObjectRef=GUID-T3 IshRef=ISH-T3  落点 FolderId=10088`);
      lines.push(`[OK] 回读 FolderId=10088：本轮 3 个，未见 0 个`);
      lines.push(`STEP 6  台账`);
      lines.push(`[OK] 台账追加 3 行，累计 12 行：logs\\kc-create-ledger.csv`);
      lines.push(`STEP 7  结果`);
    }
  }

  return lines;
}

module.exports = function mockRunner(payload) {
  const emitter = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = -1;
  child.kill = () => {
    clearTimeout(timer);
    child.stdout.emit('data', Buffer.from(''));
    child.emit('close', 0);
  };

  const fixture = pickFixture(payload);
  const lines = fixture
    ? fs.readFileSync(fixture, 'utf8').split(/\r?\n/).filter((l) => l.length)
    : synthesize(payload);

  let i = 0;
  let timer = null;
  const step = () => {
    if (i >= lines.length) {
      child.emit('close', 0);
      return;
    }
    child.stdout.emit('data', Buffer.from(lines[i] + '\n', 'utf8'));
    i += 1;
    timer = setTimeout(step, 140);
  };
  timer = setTimeout(step, 260);

  return child;
};
