/**
 * 导入流程的安全边界测试。
 *
 * 这个文件只回答一个问题：**预检阶段会不会真写 KC？**
 * 脚本里 `$proceed` 控制所有写入（Add-IshDocumentObj / Add-IshFolder），
 * 而 `$proceed` 只可能由 -Commit 或界面上的「是」置真。
 * 所以只要保证"预检不带 -Commit"，就保证了预检零写入 —— 这条性质值得钉死。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildArgs } = require('./psRunner');

const SCRIPT_DIR = path.join(__dirname, '../../../backend/scripts');
const IMPORT_SCRIPT = path.join(SCRIPT_DIR, 'kc-import-images-ui.ps1');
const CREATE_SCRIPT = path.join(SCRIPT_DIR, 'kc-create-objects-ui.ps1');

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-')) continue;
    const next = args[i + 1];
    out[args[i].slice(1)] = next === undefined || next.startsWith('-') ? true : next;
  }
  return out;
}

test('预检（precheck）绝不带 -Commit —— 四种任务全查', () => {
  const types = ['import', 'topic', 'map', 'pub'];
  for (const taskType of types) {
    const args = buildArgs({
      taskType,
      mode: 'precheck',
      params: {
        user: 'u',
        password: 'p',
        folderPath: 'General\\x',
        imageDir: 'C:\\i',
        sourceText: 't',
        title: 'T',
      },
    });
    assert.ok(!args.includes('-Commit'), `${taskType} 的预检带了 -Commit，会直接写 KC`);
  }
});

test('只有 commit 模式带 -Commit', () => {
  const args = buildArgs({
    taskType: 'import',
    mode: 'commit',
    params: { user: 'u', password: 'p', folderPath: 'General\\x', imageDir: 'C:\\i' },
  });
  assert.ok(args.includes('-Commit'));
});

test('导入脚本存在且带三个补丁参数', () => {
  assert.ok(fs.existsSync(IMPORT_SCRIPT), `找不到 ${IMPORT_SCRIPT}`);
  const src = fs.readFileSync(IMPORT_SCRIPT, 'utf8');
  assert.ok(src.includes('[string]$WsBaseUrl'), '缺补丁① 的 WsBaseUrl 参数');
  assert.ok(src.includes('[switch]$ListFolders'), '缺补丁② 的 ListFolders 参数');
  assert.ok(
    src.includes('if (-not $script:headless) { Start-Progress'),
    '缺补丁③ 的 headless 拦 Start-Progress'
  );
  assert.ok(src.includes('[switch]$NoCreateFolder'), '缺 -NoCreateFolder 参数');
});

test('导入脚本的 -ListFolders 分支在登录之后（必须先有 $ish 会话）', () => {
  const src = fs.readFileSync(IMPORT_SCRIPT, 'utf8');
  const loginFailExit = src.indexOf('# 登录成功后才问路径');
  const listBranch = src.indexOf('if ($ListFolders) {');
  assert.ok(loginFailExit > 0, '找不到登录成功后的分界注释');
  assert.ok(listBranch > 0, '找不到 -ListFolders 分支');
  assert.ok(
    listBranch < loginFailExit,
    'ListFolders 分支必须在"登录成功后才问路径"之前，但要在登录之后'
  );
  // 登录失败是 exit 1，成功才往下走 —— 分支落在它后面即代表需要 $ish
  const loginStep = src.indexOf("Head 'STEP 1  登录 KC'");
  assert.ok(loginStep > 0 && loginStep < listBranch, 'ListFolders 分支跑到登录之前了');
});

test('创建脚本与导入脚本的路径参数名不同（这是刻意的，别统一）', () => {
  const imp = fs.readFileSync(IMPORT_SCRIPT, 'utf8');
  const cre = fs.readFileSync(CREATE_SCRIPT, 'utf8');
  assert.ok(imp.includes('[string]$KcFolder'), '导入脚本应使用 $KcFolder');
  assert.ok(!imp.includes('[string]$FolderPath'), '导入脚本不该有 $FolderPath');
  assert.ok(cre.includes('[string]$FolderPath'), 'create 脚本应使用 $FolderPath');
});

test('Create 脚本的 -ListFolders 输出 KCJSON 后立即退出（不写任何东西）', () => {
  const src = fs.readFileSync(CREATE_SCRIPT, 'utf8');
  const i = src.indexOf('if ($ListFolders) {');
  assert.ok(i > 0);
  const block = src.slice(i, i + 2500);
  assert.ok(block.includes('KCJSON'), '没有输出 KCJSON');
  assert.ok(block.includes('exit 0'), '列目录分支没有 exit 0');
  assert.ok(!block.includes('Add-IshFolder'), '列目录分支里出现了 Add-IshFolder');
  assert.ok(!block.includes('Add-IshDocumentObj'), '列目录分支里出现了 Add-IshDocumentObj');
});

test('导入脚本的红线函数只在 $proceed 之后调用', () => {
  const src = fs.readFileSync(IMPORT_SCRIPT, 'utf8');
  const lines = src.split('\n');

  // $proceed 的判定块起点
  const proceedLine = lines.findIndex((l) => /^\$proceed = \$false/.test(l) || /^if \(\$proceed\) \{/.test(l));
  assert.ok(proceedLine > 0, '找不到 $proceed 判定');

  // 真实调用 = 该行出现函数名，且不是注释、不是模块名清单里的字符串字面量
  const callRe = /\b(Add-IshDocumentObj|Add-IshFolder)\s+-/;
  const offenders = [];
  lines.forEach((line, i) => {
    if (!callRe.test(line)) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return; // 注释里提到函数名是说明，不是调用
    if (i < proceedLine) offenders.push(`${i + 1}: ${trimmed}`);
  });

  assert.deepEqual(
    offenders,
    [],
    `这些行在 $proceed 判定之前就调用了写入函数，预检会写 KC：\n${offenders.join('\n')}`
  );
});
