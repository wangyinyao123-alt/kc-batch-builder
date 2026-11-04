/**
 * psRunner：Windows 上真实调用 PowerShell 脚本。
 * 依据 backend/kc-import-contract.md §1 与 backend/kc-create-contract.md §1-2。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { resolveScriptDir } = require('./index');

const SCRIPTS = {
  import: 'kc-import-images-ui.ps1',
  topic: 'kc-create-objects-ui.ps1',
  map: 'kc-create-objects-ui.ps1',
  pub: 'kc-create-objects-ui.ps1',
};

/** 探测 powershell.exe（5.1 优先）→ pwsh */
function pickShell() {
  const candidates = [
    { exe: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] },
    { exe: 'pwsh.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] },
    { exe: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] },
  ];
  // 不做实际探测（spawn 时失败会走 error 事件），直接用第一个；Windows 一定有 powershell.exe
  return candidates[0];
}

/** 参数映射：UI 字段 → 脚本命令行参数 */
function buildArgs(payload) {
  const { taskType, mode, params = {} } = payload;
  const out = [];

  // 凭据
  if (params.user) out.push('-IshUser', params.user);
  if (params.password) out.push('-IshPassword', params.password);
  if (params.wsBaseUrl) out.push('-WsBaseUrl', params.wsBaseUrl);
  if (params.ignoreSsl) out.push('-IgnoreSslPolicyErrors');

  // 只读：列目录
  // 路径参数名两个脚本不一样，写错时 PowerShell 不报错、只把值当位置参数丢掉：
  //   导入脚本叫 $KcFolder，create 脚本叫 $FolderPath。
  // FolderPicker 是用 taskType='topic' 调 listFolders 的（走 create 脚本），
  // 所以这里必须按 taskType 分流，不能一律写死 -KcFolder。
  if (mode === 'listFolders') {
    out.push('-ListFolders');
    if (params.folderPath) {
      out.push(taskType === 'import' ? '-KcFolder' : '-FolderPath', params.folderPath);
    }
    return out;
  }

  // ---------------------------------------------------------------- 导入图片
  if (taskType === 'import') {
    if (params.imageDir) out.push('-ImageDir', params.imageDir);
    if (params.folderPath) out.push('-KcFolder', params.folderPath);
    if (params.importMode) out.push('-Mode', params.importMode); // Import | Update
    if (params.noCreate) out.push('-NoCreate');
    // UI 的「自动创建目录」是正向开关，脚本侧是反向 switch（默认 true），必须取反
    if (params.autoCreateFolder === false) out.push('-NoCreateFolder');
    if (params.noBackup) out.push('-NoBackup');
    if (params.recurse) out.push('-Recurse');
    if (params.noIndex) out.push('-NoIndex');
    if (params.ignoreStateGate) out.push('-IgnoreStateGate');
    if (params.folderType) out.push('-FolderType', params.folderType);
    if (params.keepLogs) out.push('-KeepLogs', String(params.keepLogs));
  }

  // ---------------------------------------------------------------- 新建对象
  if (taskType === 'topic' || taskType === 'map' || taskType === 'pub') {
    const typeMap = { topic: 'Topic', map: 'Map', pub: 'Pub' };
    out.push('-Type', typeMap[taskType]);
    if (params.folderPath) out.push('-FolderPath', params.folderPath);
    if (!params.autoCreateFolder) out.push('-NoCreateFolder');

    if (taskType === 'topic') {
      if (params.sourceKind === 'xmlDir' && params.xmlDir) {
        out.push('-XmlDir', params.xmlDir);
      } else {
        if (params.sourceFile) out.push('-SourceFile', params.sourceFile);
        if (params.sourceText) out.push('-SourceText', params.sourceText);
        if (params.topicType) out.push('-TopicType', params.topicType);
      }
      if (params.attachMap) out.push('-AttachMap', params.attachMap);
    }

    if (taskType === 'map') {
      if (params.sourceKind === 'mapXml' && params.mapXmlFile) {
        out.push('-MapXmlFile', params.mapXmlFile);
      } else {
        if (params.sourceFile) out.push('-SourceFile', params.sourceFile);
        if (params.sourceText) out.push('-SourceText', params.sourceText);
      }
      if (params.mapMasterType) out.push('-MasterType', params.mapMasterType);
      if (params.attachPub) out.push('-AttachPub', params.attachPub);
    }

    if (taskType === 'pub') {
      if (params.title) out.push('-Title', params.title);
      if (params.outputFormat) out.push('-OutputFormat', params.outputFormat);
      if (params.pubSwitchMode) out.push('-PubSwitchMode', params.pubSwitchMode);
      if (params.languageCombination) out.push('-LanguageCombination', params.languageCombination);
      if (params.languageElement) out.push('-LanguageElement', params.languageElement);
    }

    if (params.keepLogs) out.push('-KeepLogs', String(params.keepLogs));
  }

  // 两段式：执行才带 -Commit
  if (mode === 'commit') out.push('-Commit');

  return out;
}

module.exports = function psRunner(payload) {
  const scriptDir = resolveScriptDir();
  const scriptName = SCRIPTS[payload.taskType];
  const scriptPath = path.join(scriptDir, scriptName);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`找不到脚本：${scriptPath}`);
  }

  const shell = pickShell();
  const child = spawn(shell.exe, [...shell.args, scriptPath, ...buildArgs(payload)], {
    cwd: scriptDir,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  return child;
};

// 导出内部函数供单测直接断言命令行参数，避免"参数名写错但 PowerShell 静默忽略"这类
// 只在 Windows 真机上才暴露的问题只能靠人肉跑一遍才能发现。
module.exports.buildArgs = buildArgs;
module.exports.SCRIPTS = SCRIPTS;
