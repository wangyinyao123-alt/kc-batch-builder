/**
 * runner 工厂：按运行环境选择 psRunner（Windows 真实调用）或 mockRunner（开发机回放）。
 *
 * payload = {
 *   id, taskType: 'import'|'topic'|'map'|'pub',
 *   mode: 'precheck'|'commit'|'listFolders',
 *   params: { ...表单字段 }
 * }
 *
 * 两个实现返回同一形状：
 *   { spawn(): ChildProcess, stdout: EventEmitter, stderr: EventEmitter }
 * 实际上直接复用 ChildProcess 的 stdout/stderr 流即可。
 */
const path = require('node:path');
const fs = require('node:fs');

function createRunner(payload) {
  if (process.platform === 'win32' && !process.env.KC_MOCK) {
    return require('./psRunner')(payload);
  }
  return require('./mockRunner')(payload);
}

/**
 * 脚本目录。查找顺序：
 *   1. KC_SCRIPTS_DIR 环境变量（运维把脚本放任意位置时用）
 *   2. 打包后 resources/scripts
 *   3. 仓库内 backend/scripts（electron/runner → 上三级到仓库根）
 *   4. kc-app/scripts（把脚本随应用一起分发时）
 */
function resolveScriptDir() {
  const candidates = [
    process.env.KC_SCRIPTS_DIR,
    path.join(process.resourcesPath || '', 'scripts'),
    path.join(__dirname, '../../../backend/scripts'),
    path.join(__dirname, '../../scripts'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[2];
}

module.exports = { createRunner, resolveScriptDir };
