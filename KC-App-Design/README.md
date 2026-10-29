# KC 批量建库工具｜开发交付包

KC 批量建库工具的 UI 设计交付包。可编辑源稿在 Pixso，本包提供开发实现所需的素材、规范与状态说明。

- 画布：**1280 × 800**（桌面 App 尺寸，非手机尺寸）
- 页面：P1 登录、P2 任务中心、P3 新建任务、P4 任务详情、P5 设置、D1 弹窗

## 目录结构

```text
KC-App-Design/
├── README.md                    本文件
├── pixso-source.txt             设计源稿链接与文件 ID
├── PROJECT_MEMORY.md            页面结构、素材使用、字体和背景约定
├── design-tokens.json           颜色、字号、圆角、描边、状态色（Pixso 实测精确值）
├── interaction-spec.md          交互状态与业务规则 + 状态-视觉对照表（含五态）
├── component-map.md             页面→组件映射表（Pixso 节点名 ↔ 建议 React 组件名，含精确尺寸）
├── screens/                     页面预览图 2560×1600 @2x PNG（已通过 Pixso MCP 导出）
├── dsl/                         每页完整节点 DSL JSON（精确坐标/尺寸/颜色/文本，开发查数用）
└── assets/
    ├── README.md                素材来源与用途总表
    ├── sticker-library.json     115 枚贴纸的路径/尺寸/来源索引
    ├── backgrounds/             画板实际使用的 1280×800 背景（2 张）
    ├── screen-stickers/         已被具体页面使用的裁切贴纸（16 枚）
    ├── stickers/                完整贴纸库，6 类共 115 枚透明 PNG
    │   ├── handdrawn/            手绘猫咪 23
    │   ├── pixel/                像素功能图标 22
    │   ├── watercolor/           粉色水彩贴纸 17
    │   ├── pixel_kawaii/         猫咪像素贴纸 21
    │   ├── extra_a/              粉色猫咪 UI 元素 15
    │   └── extra_b/              场景与复古元素 17
    └── previews/                素材总览图（评审用，不参与打包）
```

## 设计源稿

- [打开 Pixso 文件](https://pixso.net/app/design/gti8TP-GucHUL6Ed2XgaWg?showQuickFrame=true&new=1&icon_type=1&page-id=0%3A1)
- 文件 ID：`gti8TP-GucHUL6Ed2XgaWg`
- 链接同样记录在 [pixso-source.txt](pixso-source.txt)

尺寸、间距、颜色、字体的精确值已写入 `design-tokens.json`、`component-map.md` 和 `dsl/*.json`（均通过 Pixso MCP 从源稿实测）。如有出入以 Pixso 检查模式为准。

## 页面预览

`screens/` 内含 6 张 2560×1600（@2x）PNG：`P1-login`、`P2-task-center`、`P3-new-task`、`P4-task-detail`、`P5-settings`、`D1-dialog`，另有一张 `Frame-82-extra`（画布上的小元素，非页面）。

## 程序化访问（Pixso MCP）

本仓库可通过 Pixso MCP（Streamable HTTP，端点 `https://pixso.net/mcp`）直接读取设计稿：OAuth2 + PKCE 动态注册授权后，可用 `get_export_image` 导出任意节点 PNG/SVG、`get_node_dsl` 取节点树精确数据。授权工具链在 `/tmp/pixso-mcp/`（token 有效期 7200s，含 refresh_token）。注意设计稿在国际版 pixso.net，账号与国内版 pixso.cn 不互通。

## 交付边界

页面源稿用于**视觉验收**。真实功能需要开发接入：KC 登录、任务队列、预检、执行日志、结果清单、失败项重试、设置持久化、本地文件读写（KC 仓库路径校验、图片多选、打开落点、导出结果）。

由于要读写本地文件，这必须是桌面壳（Electron 或 Tauri），不能做成纯 Web 应用。

HTML/D2C 导出只能作为静态视觉参考或切图依据，不能作为最终 App，也不能替代后端接口与本地任务执行逻辑。

中文界面统一使用 **Noto Sans TC**（Regular 400 / Bold 700），建议随应用打包字体，保证 macOS 与 Windows 渲染一致。

## 归档说明

原始贴纸大表（4 张，每张 1536×1024）、未被画板直接使用的原图、中间联络表，以及上一代 Flowchart Elf 的 `ui-concept.html` 概念稿，均已移出本包，存放在工作区 `_design-archive/`。它们只在需要重新裁切素材时才用得上，不随交付包分发。
