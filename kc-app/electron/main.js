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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#111826',
    title: 'KC 内容生产助手',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- IPC

/** 选目录 */
ipcMain.handle('dialog:pick-dir', async () => {
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
