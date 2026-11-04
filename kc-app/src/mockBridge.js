/**
 * 浏览器开发兜底：不在 Electron 里跑（npm run dev 直接用浏览器打开）时，
 * 用一套假的 window.kc 让 UI 全流程可点可看，方便评审界面。
 * 真正打包运行时 window.kc 由 preload 注入，这里不生效。
 */

const now = () => Date.now();

function fakeFolder(path) {
  const segs = String(path || 'General').split('\\').filter(Boolean);
  const leaf = segs[segs.length - 1] || 'General';
  return {
    path: segs.join('\\'),
    resolved: true,
    leaf,
    missing: [],
    folderType: 'ISHModule',
    folderId: '10088',
    children: [
      { name: 'image', id: '10087', type: 'ISHIllustration' },
      { name: 'Topics', id: '10088', type: 'ISHModule' },
      { name: 'Maps', id: '10089', type: 'ISHMasterDoc' },
      { name: 'Publications', id: '10090', type: 'ISHPublication' },
      { name: 'archive', id: '10091', type: 'ISHNone' },
    ],
  };
}

function emitSequence(handler, taskType, mode, folderPath) {
  const push = (evt, delay) => setTimeout(() => handler({ at: now(), ...evt }), delay);
  let t = 120;

  push({ type: 'started', payload: { taskType, mode } }, (t += 0));
  push({ type: 'step', n: 1, label: '登录 KC' }, (t += 180));
  push({ type: 'login', ok: true, version: 'ISHRemote 9.0.0', user: 'demo' }, (t += 300));

  if (mode === 'listFolders') {
    push({ type: 'folder', data: fakeFolder(folderPath) }, (t += 200));
    push({ type: 'exit', code: 0 }, (t += 200));
    return;
  }

  const isImport = taskType === 'import';
  push({ type: 'step', n: 4, label: '预检（只读）' }, (t += 260));

  const titles = isImport
    ? [
        ['TOCREATE', 'cover.png', 'EDTPNG', 'General\\demo\\image\\cover.png'],
        ['TOCREATE', 'logo.svg', 'EDTSVG', 'General\\demo\\image\\logo.svg'],
        ['UNCHANGED', 'sticker-01.png', 'EDTPNG', 'General\\demo\\image\\sticker-01.png'],
      ]
    : [
        ['TOCREATE', 'Topic:TASK 任务一', '', 'General\\demo\\任务一'],
        ['TOCREATE', 'Topic:TASK 任务二', '', 'General\\demo\\任务二'],
        ['TOCREATE', 'Topic:CONCEPT 概念一', '', 'General\\demo\\概念一'],
      ];

  titles.forEach(([state, title, tag, path], i) => {
    push({ type: 'item', state, title, tag, path, note: '' }, (t += 90));
  });

  push(
    {
      type: 'summary',
      phase: 'precheck',
      counts: isImport
        ? { created: 2, updated: 0, unchanged: 1, skipped: 0, blocked: 0, failed: 0, total: 3 }
        : { created: 3, updated: 0, unchanged: 0, skipped: 0, blocked: 0, failed: 0, total: 3 },
    },
    (t += 160)
  );

  if (mode === 'precheck') {
    push({ type: 'exit', code: 0 }, (t += 240));
    return;
  }

  push({ type: 'step', n: 5, label: '执行' }, (t += 300));
  const n = isImport ? 2 : 3;
  for (let i = 1; i <= n; i++) {
    push(
      {
        type: 'progress',
        i,
        n,
        title: isImport ? ['cover.png', 'logo.svg'][i - 1] : ['任务一', '任务二', '概念一'][i - 1],
        state: isImport ? 'CREATED' : 'CREATED',
      },
      (t += 420)
    );
  }

  push({ type: 'step', n: 6, label: '台账' }, (t += 200));
  if (isImport) {
    push({ type: 'artifact', kind: 'ledger', path: 'logs\\kc-import-ledger.csv', rows: 2 }, (t += 160));
    push({ type: 'artifact', kind: 'guidTable', path: 'logs\\demo_GUID_20261103-1600.csv' }, (t += 140));
  } else {
    push({ type: 'artifact', kind: 'ledger', path: 'logs\\kc-create-ledger.csv', rows: 3 }, (t += 160));
  }
  push(
    {
      type: 'summary',
      phase: 'result',
      counts: isImport
        ? { created: 2, updated: 0, unchanged: 1, skipped: 0, blocked: 0, failed: 0, total: 3 }
        : { created: 3, updated: 0, unchanged: 0, skipped: 0, blocked: 0, failed: 0, total: 3 },
    },
    (t += 200)
  );
  push({ type: 'exit', code: 0 }, (t += 260));
}

export function installMockBridge() {
  if (window.kc) return;

  const listeners = new Map();

  window.kc = {
    pickDir: async () => 'C:\\工作\\发布资料\\演示目录',
    pickFile: async () => 'C:\\工作\\发布资料\\标题清单.txt',
    reveal: async (p) => console.info('[mock] reveal', p),
    readText: async () => ({
      ok: true,
      text: '任务一\n任务二\n概念一\n',
    }),

    startRun: async (payload) => {
      const { id, taskType, mode, params = {} } = payload;
      const handler = (evt) => {
        const fns = listeners.get(id) || [];
        fns.forEach((f) => f(evt));
      };
      emitSequence(handler, taskType, mode, params.folderPath);
      return { ok: true, id };
    },

    cancelRun: async (id) => {
      emitTo(id, { type: 'exit', code: -1, at: now() });
      return { ok: true };
    },

    onRunEvent: (id, handler) => {
      const arr = listeners.get(id) || [];
      arr.push(handler);
      listeners.set(id, arr);
      return () => {
        const next = (listeners.get(id) || []).filter((f) => f !== handler);
        listeners.set(id, next);
      };
    },
  };

  function emitTo(id, evt) {
    (listeners.get(id) || []).forEach((f) => f(evt));
  }
}
