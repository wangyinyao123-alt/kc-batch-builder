# KC 内容生产助手 · Electron 客户端

把 `backend/scripts/` 下两个 PowerShell 脚本包装成桌面应用：登录、选目录、填参数、预检、执行、看明细。

## 快速开始

```bash
cd kc-app
npm install          # 若 electron 下载被拦：ELECTRON_CACHE=$PWD/.electron-cache npm install
npm run dev          # 只跑界面（浏览器打开 http://localhost:5173，走内置假数据）
npm start            # 构建 + 起 Electron 桌面窗口
npm test             # 解析器自测
```

- **不接脚本、只看界面**：`npm run dev`，浏览器直开。`src/mockBridge.js` 会注入假的 `window.kc`，预检/执行/明细/产物全流程都能点。
- **真实调用脚本**：必须在 **Windows** 上 `npm start`。脚本用 `powershell.exe` 调，macOS/Linux 上没有 ISHRemote 依赖，会退回 mock。

## 目录

```
kc-app/
├── electron/
│   ├── main.js                  主进程：窗口、IPC、进程管理
│   ├── preload.js               contextBridge 暴露 window.kc
│   ├── runner/
│   │   ├── index.js             按平台选 psRunner / mockRunner
│   │   ├── psRunner.js          UI 字段 → 命令行参数映射（关键文件）
│   │   └── mockRunner.js        macOS 回放录制日志
│   └── parsers/
│       ├── kc-log-parser.js     脚本 stdout 行协议 → 结构化事件
│       └── kc-log-parser.test.js
├── src/
│   ├── main.jsx                 路由 + 全局状态
│   ├── store.js                 本地持久化、任务类型表、路径清洗、标题解析
│   ├── mockBridge.js            浏览器兜底假桥（评审用）
│   ├── hooks/useRun.js          一次脚本调用的状态机
│   ├── components/
│   │   ├── FolderPicker.jsx     KC 目录浏览（走 -ListFolders）
│   │   ├── Hint.jsx             「?」悬浮说明 + Field 容器
│   │   ├── Modal.jsx            通用弹窗
│   │   └── RunResult.jsx        明细 / 日志双 Tab
│   └── pages/
│       ├── LoginPage.jsx
│       ├── TaskCenterPage.jsx
│       ├── NewTaskPage.jsx      四类任务表单（核心）
│       └── SettingsPage.jsx
├── mock/fixtures/               录制的真实日志（可选，放这里就自动回放）
└── package.json
```

## 四类任务与脚本参数

`electron/runner/psRunner.js` 是唯一做字段映射的地方。改表单字段时同步改这里。

| 任务 | 脚本 | 关键参数 |
|---|---|---|
| 导入图片 | `kc-import-images-ui.ps1` | `-ImageDir` `-KcFolder` `-Mode Import\|Update` `-NoCreate` `-NoBackup` `-Recurse` `-NoIndex` `-IgnoreStateGate` |
| 新建 Topic | `kc-create-objects-ui.ps1 -Type Topic` | `-FolderPath` `-XmlDir` / `-SourceFile` `-SourceText` `-TopicType` `-AttachMap` `-NoCreateFolder` |
| 新建 Map | `kc-create-objects-ui.ps1 -Type Map` | `-MapXmlFile` / `-SourceText` `-MasterType` `-AttachPub` |
| 新建 Pub | `kc-create-objects-ui.ps1 -Type Pub` | `-Title` `-OutputFormat` `-PubSwitchMode` `-LanguageCombination` `-LanguageElement` |
| 浏览目录 | 两者皆可 `-ListFolders` | `-FolderPath`，脚本回 `KCJSON {...}` |

两段式：`mode=precheck` 不加 `-Commit`（只读），`mode=commit` 才加。

## 事件协议

脚本每行 stdout 被 `kc-log-parser.js` 转成一个事件，经 IPC 推给渲染进程：

```js
{ type: 'step',     n, label }
{ type: 'login',    ok, version?, user?, error? }
{ type: 'item',     state, title, tag, path, note }      // 预检明细行
{ type: 'summary',  phase: 'precheck'|'result', counts }
{ type: 'progress', i, n, title, state, error? }
{ type: 'folder',   data }                                // KCJSON
{ type: 'artifact', kind, path }
{ type: 'attach',   kind, ok, skipped?, note }
{ type: 'warn' } { type: 'error' } { type: 'log' } { type: 'exit', code }
```

解析依据 `backend/kc-import-contract.md §3` 与 `backend/kc-create-contract.md §3`。脚本改了输出格式，先改解析器再改 UI。

## 已做的取舍

- **密码存 localStorage**：内网工具、单机运行。要上生产建议换 `safeStorage.encryptString` 落盘。
- **目录浏览器走脚本**：没有直接的 KC HTTP 客户端，复用脚本的 `-ListFolders` 读 KCJSON，保证和真实执行看到的是同一棵树。
- **任务记录在渲染进程**：`localStorage` 前缀 `kc:`。脚本产物（台账、对照表、transcript）在 `logs\`，两者不重复。
- **UI 说明文字全部收进「?」悬浮**：表单里只留标签和控件，减少视觉噪音（对应设计稿 P3）。

## 还没做

- 断点续跑（脚本闪退后从中断处继续）
- 多任务并发（当前一次只跑一个，符合脚本假设）
- 打包（`electron-builder` 未配置；Windows 上需打 `nsis` 目标并把 `backend/scripts` 放进 `resources/`）
- P4 任务详情页的设计稿对齐（当前详情是弹窗，不是独立页面）
