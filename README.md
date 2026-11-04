# KC 批量建库工具

面向海康内容生产（KC）的桌面客户端：把「批量导入图片 / 新建 Topic / 新建 Map / 新建 Pub」
四类重复建库工作，做成一个可预检、可看进度、可重试的图形界面。

当前状态：**界面已按 Pixso 设计稿逐像素对齐，功能链路在 mock 下跑通，尚未接入真实 KC 环境验证。**

## 目录

```
kc-app/              Electron 桌面应用（React + Vite）
  src/               渲染进程：6 个页面 + 组件 + 样式
  electron/          主进程、preload、runner（psRunner / mockRunner）、日志解析器
  build/             应用图标与打包说明
  release/           打包产物（不入库）
backend/
  scripts/           实际执行建库的 PowerShell 脚本
  *.md               脚本参数契约（导入、创建对象、API）
KC-App-Design/       设计交付包：DSL 几何、页面截图、素材、交互规范
docs/                开发过程中的验证截图与对比图
```

## 技术选型

Electron 33 + React 18 + Vite 6。选 Electron 而非 Tauri，是因为「本地文件处理 + 调用
Windows PowerShell 脚本」是主干逻辑，Electron 的 Node 主进程与子进程管理更直接；
代价是包体较大（安装包 87 MB）。

## 开发

```bash
cd kc-app
npm install
npm run dev          # 只跑前端，浏览器打开 5173
npm run dev:electron # 前端 + Electron 窗口
npm test             # 日志解析器单测
```

## 打包 Windows 版

```bash
cd kc-app
npm run dist:win
```

产物在 `kc-app/release/`。macOS 上交叉编译的注意事项见 `kc-app/build/README-打包说明.md`。

## 界面基准

界面尺寸基准是 `KC-App-Design/dsl/*.json`（从 Pixso 导出的节点几何树，单位 css px，
画布 1280×800）。六张画板 P1 登录 / P2 任务中心 / P3 新建任务 / P4 任务详情 / P5 设置 /
D1 弹窗，逐页对齐到 0px 偏差，验收截图在 `docs/ui-current/`。

## 已知缺口

1. **导入图片任务缺脚本**：`electron/runner/psRunner.js` 的 `SCRIPTS.import` 指向
   `kc-import-images-ui.ps1`，但仓库里只有 `kc-create-objects-ui.ps1`（负责另外三类）。
   补上脚本即可，代码不用改。
2. **未接真实环境联调**：登录、预检、执行在 mock runner 下跑通，真实 KC 服务器的
   凭据校验、目录树读取、对象创建尚未验证。
3. **D1 弹窗的「取消任务」只弹提示**：脚本侧没有 cancel 参数，没有伪造成功状态。
4. **未签名**：Windows 首次运行会弹 SmartScreen「未知发布者」。
