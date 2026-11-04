const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { createRunner } = require('./runner');
const { parseLine, createParserState } = require('./parsers/kc-log-parser');

// 开发态 = 未打包且显式要求连 vite（KC_DEV=1），否则一律加载 dist。
// 直接 `electron .` 跑打包前的产物时不该去连 5173，否则白屏。
const isDev = !app.isPackaged && process.env.KC_DEV === '1';
const DEV_URL = process.env.KC_DEV_URL || 'http://localhost:5173';
let win = null;
/** @type {Map<string, import('node:child_process').ChildProcess>} */
const running = new Map();

// ---------------------------------------------------------------- 启动日志
// Windows 上双击启动失败时看不到任何提示（无控制台），必须落盘才能诊断。
// 优先写桌面（用户一眼就能找到并截图发回来），失败再退回 userData。
let logFile = null;
function resolveLogFile() {
  if (logFile) return logFile;
  const fs = require('node:fs');
  const name = `KC-启动日志-${new Date().toISOString().slice(0, 10)}.log`;
  const candidates = [];
  try {
    candidates.push(path.join(app.getPath('desktop'), name));
  } catch {
    /* 无桌面目录（部分服务器版 Windows）时跳过 */
  }
  candidates.push(path.join(app.getPath('userData'), 'crash.log'));
  for (const c of candidates) {
    try {
      fs.appendFileSync(c, '', 'utf8');
      logFile = c;
      return c;
    } catch {
      /* 换下一个候选位置 */
    }
  }
  return null;
}

function crashLog(tag, err) {
  try {
    const fs = require('node:fs');
    const f = resolveLogFile();
    if (!f) return;
    const line =
      `[${new Date().toISOString()}] [${tag}] ` +
      (err ? `${err.stack || err.message || err}` : '') +
      '\n';
    fs.appendFileSync(f, line, 'utf8');
  } catch {
    /* 日志本身失败不能影响主流程 */
  }
}

// 启动全程打点：卡在哪一步，日志里就能看出来
crashLog('boot', `version=${app.getVersion()} packaged=${app.isPackaged} platform=${process.platform} arch=${process.arch}`);
crashLog('boot', `exe=${process.execPath}`);
crashLog('boot', `resources=${process.resourcesPath}`);

process.on('uncaughtException', (err) => {
  crashLog('uncaughtException', err);
  dialog.showErrorBox('KC 内容生产助手 启动失败', String(err?.stack || err));
  app.exit(1);
});
process.on('unhandledRejection', (err) => crashLog('unhandledRejection', err));

// 注意：这里刻意不加 app.requestSingleInstanceLock()。
// 锁文件建不了（%APPDATA% 被杀软锁、目录权限不足）时它返回 false，
// 若按常规写法直接 app.quit()，用户看到的就是「双击没反应」——比多开更糟。

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#fdf3f7',
    title: 'KC 内容生产助手',
    // hiddenInset 只有 macOS 有；Windows 用默认边框，否则标题栏按钮会消失
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 加载失败必须可见：白屏是最难远程诊断的故障
  win.webContents.on('did-fail-load', (_e, code, desc, validUrl) => {
    crashLog('did-fail-load', `${code} ${desc} ${validUrl}`);
    dialog.showErrorBox('页面加载失败', `${code} ${desc}\n${validUrl}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    crashLog('render-process-gone', JSON.stringify(details));
  });
  win.webContents.on('did-finish-load', () => crashLog('did-finish-load', win.webContents.getURL()));

  crashLog('createWindow', `dev=${isDev}`);
  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html');
    const fs = require('node:fs');
    crashLog('loadFile', `${indexHtml} exists=${fs.existsSync(indexHtml)}`);
    win.loadFile(indexHtml).catch((err) => {
      crashLog('loadFile-failed', err);
      dialog.showErrorBox('无法加载界面', String(err?.message || err));
    });
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  crashLog('whenReady', err);
  dialog.showErrorBox('初始化失败', String(err?.stack || err));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- IPC

/**
 * 连通性探测：真正发一次 HTTP 请求到 KC 服务器。
 *
 * 判定口径很重要：KC 的接口未经认证会返回 401/403，这**说明服务器是通的**，
 * 不能当成失败。只有 DNS 解析失败、连接被拒、超时、证书错误才算连不上。
 * 返回 { ok, status, code, error, url, ms }，UI 据此分开提示「地址错」「证书问题」
 * 和「网络不通」，而不是笼统一句「请检查网络」。
 */
ipcMain.handle('net:ping', async (_e, { url, ignoreSsl } = {}) => {
  const started = Date.now();
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, code: 'E_URL', error: '地址必须以 http:// 或 https:// 开头', url: target };
  }

  let cur = target;
  // 跟随最多 3 次跳转，手工处理以便在 ignoreSsl 时逐跳放行
  for (let hop = 0; hop < 3; hop++) {
    const res = await new Promise((resolve) => {
      let u;
      try {
        u = new URL(cur);
      } catch {
        resolve({ kind: 'error', code: 'E_URL', error: '地址格式不正确' });
        return;
      }
      const mod = u.protocol === 'https:' ? require('node:https') : require('node:http');
      const req = mod.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: 'GET',
          timeout: 8000,
          rejectUnauthorized: !ignoreSsl,
          headers: { 'User-Agent': `kc-batch-builder/${app.getVersion()}`, Accept: '*/*' },
        },
        (r) => {
          r.resume(); // 不读响应体，只要状态码
          resolve({ kind: 'response', status: r.statusCode, location: r.headers.location });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ kind: 'error', code: 'ETIMEDOUT', error: '连接超时（8 秒无响应）' });
      });
      req.on('error', (err) => {
        const code = err.code || 'ENETWORK';
        const map = {
          ENOTFOUND: '域名解析失败：检查地址里主机名是否正确',
          ECONNREFUSED: '服务器拒绝连接：端口未开放或服务未启动',
          ECONNRESET: '连接被重置：可能被防火墙或代理拦截',
          ETIMEDOUT: '连接超时：网络不通或被安全策略阻断',
          EAI_AGAIN: 'DNS 暂时不可用：检查网络或 VPN',
          DEPTH_ZERO_SELF_SIGNED_CERT: '证书是自签的，请勾选「忽略证书错误」',
          SELF_SIGNED_CERT_IN_CHAIN: '证书链含自签证书，请勾选「忽略证书错误」',
          UNABLE_TO_VERIFY_LEAF_SIGNATURE: '证书无法验证，请勾选「忽略证书错误」',
          CERT_HAS_EXPIRED: '服务器证书已过期',
        };
        resolve({ kind: 'error', code, error: map[code] || err.message || String(err) });
      });
      req.end();
    });

    if (res.kind === 'error') {
      return { ok: false, code: res.code, error: res.error, url: cur, ms: Date.now() - started };
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      cur = new URL(res.location, cur).href;
      continue;
    }
    return {
      ok: true,
      status: res.status,
      url: cur,
      // 401/403 代表服务在线只是要认证，如实说明避免用户误判
      note:
        res.status === 401 || res.status === 403
          ? `服务器可达（HTTP ${res.status}，需要登录后才会返回数据）`
          : `服务器可达（HTTP ${res.status}）`,
      ms: Date.now() - started,
    };
  }
  return { ok: false, code: 'E_REDIRECT', error: '跳转次数过多（超过 3 次）', url: cur, ms: Date.now() - started };
});

/** 选目录 */
ipcMain.handle('dialog:pick-dir', async () => {
  // 自动化测试钩子：系统弹窗无法被脚本点击，端到端用例用环境变量直接喂路径。
  // 仅在设置了 KC_E2E_PICK_DIR 时生效，正常运行时该变量不存在，行为不变。
  if (process.env.KC_E2E_PICK_DIR) return process.env.KC_E2E_PICK_DIR;
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/** 选文件（标题清单 / map xml） */
ipcMain.handle('dialog:pick-file', async (_e, filters) => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [
      { name: '标题清单', extensions: ['txt', 'csv', 'md', 'markdown'] },
      { name: 'Map XML', extensions: ['xml', 'ditamap'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

/** 在系统文件管理器中定位文件 */
ipcMain.handle('shell:reveal', async (_e, p) => {
  if (p) shell.showItemInFolder(p);
});

/** 读取本地文本文件（标题清单预览用） */
ipcMain.handle('fs:read-text', async (_e, p) => {
  const fs = require('node:fs/promises');
  try {
    return { ok: true, text: await fs.readFile(p, 'utf8') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

/**
 * 导出文本（P4「导出结果」）。
 * 一次性完成：弹保存框 → 写文件，避免渲染进程拿到路径后再回调。
 * 返回 { ok, path } 或 { ok:false, canceled:true }。
 */
ipcMain.handle('fs:save-text', async (_e, { text, defaultName, filters } = {}) => {
  if (!win) return { ok: false, error: '窗口不可用' };
  const fs = require('node:fs/promises');
  try {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'result.txt',
      filters: filters || [
        { name: 'CSV 表格', extensions: ['csv'] },
        { name: '文本', extensions: ['txt'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    // 加 BOM，Excel 直接双击打开 CSV 不乱码
    const body =
      /\.csv$/i.test(r.filePath) && !String(text).startsWith('\ufeff') ? '\ufeff' + text : String(text);
    await fs.writeFile(r.filePath, body, 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

/**
 * 启动一次脚本调用。
 * payload: { id, taskType, mode: 'precheck'|'commit'|'listFolders', params: {...} }
 * 事件通过 webContents.send(`run:event:${id}`, event) 逐条推给渲染进程。
 */
ipcMain.handle('run:start', async (_e, payload) => {
  const { id } = payload;
  if (running.has(id)) return { ok: false, error: '该任务已在运行' };

  const TASK_TYPES = ['import', 'topic', 'map', 'pub'];
  const MODES = ['precheck', 'commit', 'listFolders'];
  if (!TASK_TYPES.includes(payload.taskType)) {
    return { ok: false, error: `未知任务类型：${payload.taskType}` };
  }
  if (!MODES.includes(payload.mode)) {
    return { ok: false, error: `未知调用模式：${payload.mode}` };
  }

  // 脚本缺失 / 平台不支持时 createRunner 会直接抛，必须转成结构化错误，
  // 否则 IPC 把异常抛回渲染进程，界面会停在"运行中"转圈。
  // 两个 runner 都直接返回 ChildProcess（不是 { spawn() } 包装体）。
  let child;
  try {
    child = createRunner(payload);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  const parser = createParserState(payload.taskType);
  const emit = (event) => {
    const target = win && win.webContents;
    if (target && !target.isDestroyed()) target.send(`run:event:${id}`, event);
  };

  running.set(id, child);

  emit({ type: 'started', at: Date.now(), payload });

  child.stdout.on('data', (buf) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      for (const evt of parseLine(line, parser)) emit(evt);
    }
  });

  child.stderr.on('data', (buf) => {
    const text = buf.toString('utf8').trim();
    if (text) emit({ type: 'stderr', text });
  });

  child.on('close', (code) => {
    running.delete(id);
    emit({ type: 'exit', code, summary: parser.summary, at: Date.now() });
  });

  child.on('error', (err) => {
    running.delete(id);
    emit({ type: 'error', message: String(err.message || err) });
  });

  return { ok: true, id };
});

/** 中止一次运行 */
ipcMain.handle('run:cancel', async (_e, id) => {
  const child = running.get(id);
  if (!child) return { ok: false, error: '没有正在运行的任务' };
  try {
    if (process.platform === 'win32') {
      // 强制结束整棵进程树，避免 powershell 子进程残留
      require('node:child_process').execFile('taskkill', ['/pid', String(child.pid), '/f', '/t']);
    } else {
      child.kill('SIGTERM');
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
