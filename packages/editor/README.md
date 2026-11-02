# @flowchart-elf/editor — 画布编辑器

在 `@flowchart-elf/core` 之上的一层：把「MD → 自动排版 → SVG」这条单向流水线，
补上「拖拽 / 改字 / 连线 / 撤销 / 回存」这些编辑能力。

## 跑起来

```bash
cd packages/editor
npm install          # 首次
npm run build        # esbuild 打包到 dist/（~40ms）
npm run serve        # http://127.0.0.1:5173
```

开发时用 `npm run dev`（构建 + 起服务一条命令）。
改完源码要重新 `npm run build` —— 页面加载的是 `dist/editor.js`，不是 `src/`。

## 项目结构

| 文件 | 职责 |
|---|---|
| `src/doc.js` | **文档模型**。与 core 的 IR 不同：id 是流水号（n1/n2），文字是文字 |
| `src/history.js` | 撤销/重做栈（快照式） |
| `src/viewport.js` | 缩放平移（world ↔ screen 坐标换算） |
| `src/scene.js` | 文档 → 屏幕上要画的东西（含 `sceneToLaid`） |
| `src/hit.js` | 命中测试（点到了哪个节点/连线/标签/端口） |
| `src/canvas.js` | 把 scene 变成 SVG 字符串（复用 core 的 paint.js） |
| `src/app.js` | 交互、状态、事件绑定、导出 |
| `src/vsdx-bridge.js` | VSDX 导出桥（动态 import，独立 chunk） |
| `src/shims/` | 浏览器替身：`fs` / `crypto` / `buffer` |
| `src/waui.js` | Web Awesome 组件按需注册（按钮 / 下拉 / 数字框 / 文本域 / 单选组） |
| `src/waui.css` | 只引组件库的 layers + theme 两层，esbuild 单独打 `dist/waui.css` |

## 关键设计：为什么编辑器不用 core 的 IR

core 的 `DiagramNode.id` **就是节点名**（`parse.js` 用 `refKey` 从文字推出来）。
如果编辑器直接改 IR，用户把「开始」改成「起点」的那一刻，节点 id 就从 `开始`
变成 `起点`，所有指向它的连线立刻断掉。

所以编辑器另立文档模型：

```js
{ id: 'n1', type: 'start', text: '开始', x: 100, y: 40 }   // id 稳定，text 可变
```

id 一旦生成就不再变，改文字只改 `text`。这也是撤销能可靠回滚的前提 ——
快照里的 id 永远指向同一个东西。导出前才经 `docToDiagram()` 转回 IR。

## 导出

四种格式，全部复用 core，没有第二份绘制代码：

- **SVG** → `renderSvg(sceneToLaid(scene), spec)`
- **PNG** → SVG 光栅化到 canvas，2 倍图
- **VSDX** → `toVsdxInput()` + `tools/vsdx-export`（ts-visio）
- **JSON** → 文档本身，可再打开继续编辑

`sceneToLaid()` 统一做「平移使包围盒归零 + 补 width/height」。
SVG 和 VSDX 都走它 —— 之前两处各写一遍，VSDX 那次漏了宽高，页面尺寸变成 NaN。

## 浏览器里的三个 Node 依赖

ts-visio 是 CJS 且假设跑在 Node：

| 模块 | 为什么需要 | 替身行为 |
|---|---|---|
| `fs/promises` | 只在 `VisioDocument.load(path)` 用 | 调用即抛「浏览器里不能按路径读文件」 |
| `node:crypto` | 只用于图片 sha1 去重 | 调用即抛「浏览器里没有同步 sha1」 |
| **`Buffer`** | `getFileText()` 用它判断二进制 | **必须补真实现**（见下） |

`Buffer` 这一条是踩过的坑：`VisioPackage.getFileText()` 第一行是
`if (Buffer.isBuffer(content)) throw ...`，而 `PageManager.load()` 把读取包在
`try/catch` 里静默返回 `[]`。浏览器没有 `Buffer` → `ReferenceError` → 被当成
「读不到页面」→ `doc.pages` 是空数组 → `pages[0]` 为 undefined → 报
`Cannot read properties of undefined (reading 'setSize')`。

这个报错和「页面真的有问题」长得一模一样，极难定位。修法是用 npm 的
`buffer` 包做真 polyfill，通过 esbuild 的 `inject` 注入（见 `build.mjs`）。

## 模板与配色

右侧面板第一组就是模板选择器：**5 张带真渲染缩略图的卡片**，点一下整张图立刻换样式。
下面那条「配色」下拉是独立维度 —— 选「模板自带」时用模板预设的配色，选具体某一项则在当前模板上覆盖配色。

| 模板 | 形状 | 配色 | 适合 |
|---|---|---|---|
| 默认 | 胶囊起止 + 圆角矩形 | 浅色 | 通用 |
| 商务 | 起止反白实心、判断淡底、笔画加粗 | 石板 | 汇报材料 |
| 极简 | 全直角矩形、无填充、细线 | 浅色 | 打印 / 论文 |
| 技术 | 深色底、等宽分支标签 | 深色 | 技术文档 |
| 纸感 | 衬线标题、暖白纸底 | 纸感 | 说明性插图 |

两种设计约束：

1. **缩略图必须真渲染**（`templateThumb()` 调 core 的 `renderSvg` 画一张迷你图再塞进卡片），
   不能手画示意图。模板改了缩略图要跟着变，否则预览和点下去的效果是两回事。
2. **换模板要重置配色**（`applyTemplate()` 先 `setTemplate` 再 `setPalette('')`）。
   不重置的话，从深色自定义状态切到极简模板，屏幕还是深色，用户会以为点了没反应。

配色和模板都写在文档 JSON 里（`template` / `palette` 两个字段），所以保存、重开、撤销都能带回来。

## 为什么用 Web Awesome 而不是自己写控件

右侧面板原来是一排原生 `<select>` / `<input>` / `<button>`。原生控件在
macOS、Windows、Linux 上是三套完全不同的外观，而且没法定制（`appearance: none`
之后下拉箭头、聚焦环、禁用态全要自己画）。

选 `@awesome.me/webawesome`（MIT，Shoelace 的后续版本，Fonticons 维护）：

- 组件是标准 Web Component，**不需要 React/Vue 运行时**，与本项目「零框架」的前提一致。
- 它的样式全写在 `@layer wa-component` 里，我们的 `styles.css` 是普通 CSS，
  天然在它之上 —— 想改外观不用 `!important`。
- 语义变量整套公开（`--wa-color-brand-fill-normal`、`--wa-form-control-height`
  等），把项目 token 灌进去就完成主题化，不逐个组件覆盖。

**没有引 `native.css`**：那份 1442 行会把 `html/body/h1..h6/p/ul` 全重置，
一进来就把编辑器自己的排版打乱。只引 `layers.css`（图层声明）+ `themes/default.css`
（变量）两层，`dist/waui.css` 打包后 57KB / gzip 7KB。

顶栏控件 30px、面板控件 26px：靠 `.topbar { --wa-form-control-height: 30px }`
一处覆盖，不写每按钮的 height。

## 交互备忘

- **双击进就地编辑**不用原生 `dblclick`：第一次点击的 `reselect()` 会 `render()`，
  把 `innerHTML` 整个换掉，第一次点的元素已不在文档里，浏览器凑不出双击。
  改成自己记「上一次按在哪个对象上」，同对象 + 350ms 内就算双击。
- **双击后不能立刻 `focus()`**：`pointerdown` 之后浏览器还派发兼容的 `mousedown`，
  它会把焦点移到事件目标最近的焦点祖先（`<g>`/`<text>` 都不可聚焦 → 焦点落到
  `#stage`），刚 `focus()` 的 textarea 立刻 blur。所以 `beginEdit` 要
  `setTimeout(..., 0)` 推迟到整串鼠标事件派发完之后。
- **保存立即落盘**（250ms 防抖），不依赖 `beforeunload` —— 标签页被杀会丢数据。

## 测试

```bash
npm test     # 95 个
```

`doc` (23) / `history` (11) / `viewport` (15) / `scene` (18) / `hit` (18) / `export` (8)。

`export.test.js` 专门钉住「模板样式必须传到 vsdx」这件事 —— 手拼 payload
曾导致所有形状变成同一个 `#f5f5f5`，屏上与导出完全不一致。

## 已知限制

- 竖排（TB）与横排（LR）都支持，但只有这两档；斜向/自由方向没有。
- 连线是正交路由，不支持用户手动加拐点。
- 撤销基于全量快照，文档很大时内存会涨（当前规模无所谓）。
- VSDX 未在真 Visio 里验证过（本机没有 Visio），只用 draw.io 与 XML 静态断言验过。
