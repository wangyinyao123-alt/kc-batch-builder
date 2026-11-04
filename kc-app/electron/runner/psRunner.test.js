/**
 * psRunner 参数映射测试。
 *
 * 为什么值得单独测：PowerShell 对**不存在的命名参数**不会报错，只会把紧跟其后的值
 * 当成位置参数丢掉。所以 `-FolderPath` 写成导入脚本不认识的 `-KcFolder` 时，
 * 表现不是"报错"，而是"列目录永远返回 General"、"目标路径空着走到 STEP 3 才失败"。
 * 这类问题在 macOS 开发机上永远测不出来（这里走 mockRunner），只能靠断言钉住。
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildArgs } = require('./psRunner');

/** 把 ['-A','1','-B'] 变成 { A:'1', B:true }，方便断言参数名而不是猜顺序 */
function parse(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-')) continue;
    const key = args[i].slice(1);
    const next = args[i + 1];
    out[key] = next === undefined || next.startsWith('-') ? true : next;
  }
  return out;
}

const base = { user: 'u', password: 'p' };

test('导入：路径参数名是 -KcFolder（不是 -FolderPath）', () => {
  const a = parse(
    buildArgs({
      taskType: 'import',
      mode: 'precheck',
      params: { ...base, imageDir: 'C:\\img', folderPath: 'General\\a\\image' },
    })
  );
  assert.equal(a.KcFolder, 'General\\a\\image');
  assert.equal(a.ImageDir, 'C:\\img');
  assert.equal(a.FolderPath, undefined, '导入脚本没有 -FolderPath 参数');
});

test('导入：autoCreateFolder=false 时传 -NoCreateFolder', () => {
  const off = parse(
    buildArgs({
      taskType: 'import',
      mode: 'commit',
      params: { ...base, imageDir: 'C:\\img', folderPath: 'General\\a', autoCreateFolder: false },
    })
  );
  assert.equal(off.NoCreateFolder, true);

  const on = parse(
    buildArgs({
      taskType: 'import',
      mode: 'commit',
      params: { ...base, imageDir: 'C:\\img', folderPath: 'General\\a', autoCreateFolder: true },
    })
  );
  assert.equal(on.NoCreateFolder, undefined, '勾选自动创建时不能传这个 switch');
});

test('导入：-Commit 只在 commit 模式出现', () => {
  const pre = buildArgs({ taskType: 'import', mode: 'precheck', params: { ...base, imageDir: 'C:\\i', folderPath: 'General\\a' } });
  assert.ok(!pre.includes('-Commit'), '预检绝不能带 -Commit，否则会直接写 KC');

  const com = buildArgs({ taskType: 'import', mode: 'commit', params: { ...base, imageDir: 'C:\\i', folderPath: 'General\\a' } });
  assert.ok(com.includes('-Commit'));
});

test('列目录：导入脚本用 -KcFolder，create 脚本用 -FolderPath', () => {
  // FolderPicker 用 taskType='topic' 调 listFolders，所以必须走 create 的参数名。
  // 写错时 PowerShell 静默忽略 → 表现是"列目录永远返回 General"。
  const viaImport = parse(
    buildArgs({ taskType: 'import', mode: 'listFolders', params: { ...base, folderPath: 'General\\x' } })
  );
  assert.equal(viaImport.ListFolders, true);
  assert.equal(viaImport.KcFolder, 'General\\x');
  assert.equal(viaImport.FolderPath, undefined);
  assert.equal(viaImport.Commit, undefined, '列目录是纯只读，绝不能带 -Commit');

  const viaTopic = parse(
    buildArgs({ taskType: 'topic', mode: 'listFolders', params: { ...base, folderPath: 'General\\x' } })
  );
  assert.equal(viaTopic.ListFolders, true);
  assert.equal(viaTopic.FolderPath, 'General\\x');
  assert.equal(viaTopic.KcFolder, undefined, 'create 脚本没有 -KcFolder');
  assert.equal(viaTopic.Commit, undefined);
  assert.equal(viaTopic.Type, undefined, '列目录不需要 -Type');
});

test('新建对象：路径参数名是 -FolderPath（与导入相反）', () => {
  const a = parse(
    buildArgs({
      taskType: 'topic',
      mode: 'precheck',
      params: { ...base, folderPath: 'General\\t', sourceText: '任务一', topicType: 'Task' },
    })
  );
  assert.equal(a.FolderPath, 'General\\t');
  assert.equal(a.KcFolder, undefined, 'create 脚本没有 -KcFolder');
  assert.equal(a.Type, 'Topic');
});

test('Topic 标题走 -SourceText，xmlDir 走 -XmlDir，二者互斥', () => {
  const byText = parse(
    buildArgs({
      taskType: 'topic',
      mode: 'precheck',
      params: { ...base, folderPath: 'General\\t', sourceKind: 'titles', sourceText: '任务一', topicType: 'Task' },
    })
  );
  assert.equal(byText.SourceText, '任务一');
  assert.equal(byText.XmlDir, undefined);

  const byXml = parse(
    buildArgs({
      taskType: 'topic',
      mode: 'precheck',
      params: { ...base, folderPath: 'General\\t', sourceKind: 'xmlDir', xmlDir: 'D:\\xml' },
    })
  );
  assert.equal(byXml.XmlDir, 'D:\\xml');
  assert.equal(byXml.SourceText, undefined);
});

test('Map：mapXmlFile 走 -MapXmlFile', () => {
  const a = parse(
    buildArgs({
      taskType: 'map',
      mode: 'precheck',
      params: { ...base, folderPath: 'General\\m', sourceKind: 'mapXml', mapXmlFile: 'D:\\m.ditamap' },
    })
  );
  assert.equal(a.MapXmlFile, 'D:\\m.ditamap');
  assert.equal(a.Type, 'Map');
});

test('Pub：标题与输出格式', () => {
  const a = parse(
    buildArgs({
      taskType: 'pub',
      mode: 'precheck',
      params: { ...base, folderPath: 'General\\p', title: '手册', outputFormat: 'VOUTPUTFORMATPDF1-MANUAL-A4', pubSwitchMode: 'HIDE' },
    })
  );
  assert.equal(a.Type, 'Pub');
  assert.equal(a.Title, '手册');
  assert.equal(a.OutputFormat, 'VOUTPUTFORMATPDF1-MANUAL-A4');
  assert.equal(a.PubSwitchMode, 'HIDE');
});

test('凭据与服务器地址透传', () => {
  const a = parse(
    buildArgs({
      taskType: 'import',
      mode: 'precheck',
      params: {
        user: 'alice',
        password: 'secret',
        wsBaseUrl: 'https://kc-test.hikvision.com/ISHWS/',
        ignoreSsl: true,
        imageDir: 'C:\\i',
        folderPath: 'General\\a',
      },
    })
  );
  assert.equal(a.IshUser, 'alice');
  assert.equal(a.IshPassword, 'secret');
  assert.equal(a.WsBaseUrl, 'https://kc-test.hikvision.com/ISHWS/');
  assert.equal(a.IgnoreSslPolicyErrors, true);
});

test('scripts 映射：import 用导入脚本，其余三个共用 create 脚本', () => {
  const { SCRIPTS } = require('./psRunner');
  assert.equal(SCRIPTS.import, 'kc-import-images-ui.ps1');
  assert.equal(SCRIPTS.topic, 'kc-create-objects-ui.ps1');
  assert.equal(SCRIPTS.map, 'kc-create-objects-ui.ps1');
  assert.equal(SCRIPTS.pub, 'kc-create-objects-ui.ps1');
});
