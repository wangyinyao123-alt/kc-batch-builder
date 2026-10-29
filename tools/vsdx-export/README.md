# vsdx-export — 流程图 JSON → Visio 文件

把本工具的图数据 JSON 直接导出成 `.vsdx`，**不需要安装 Visio，也不需要调用 draw.io**。

## 为什么不用 draw.io 转

PRD 原计划是「先导出 .drawio，再调 draw.io 命令行 `-f vsdx` 转」。实测不成立：

| 尝试 | 结果 |
|---|---|
| `drawio -x -f vsdx` | 不报错，但输出的是**未压缩的 drawio XML**，不是 vsdx 包 |
| `drawio -x -f vdx` | 同上 |
| 本机版本 | draw.io 30.0.2（`/Applications/draw.io.app`） |

draw.io 桌面版只支持「**读** vsdx」，不支持「写」vsdx。所以导出 vsdx 必须自己生成。

## 怎么做的

用 `ts-visio`（MIT，纯 JS，能在浏览器跑）直接构造 OOXML 包。

### 坑一：draw.io 读不到 Section 里的样式

`ts-visio` 把填充色写成 Visio 规范要求的 `<Section N="Fill">`：

```xml
<Shape ID="1">
  <Cell N="PinX" V="2.91"></Cell>
  <Section N="Fill">
    <Cell N="FillForegnd" V="#ECECEC"></Cell>
  </Section>
</Shape>
```

这是**正确的 Visio 写法**，但 draw.io 的 vsdx 导入器（`mxVsdxShape.getCellElement`）只查 Shape 直属的 `<Cell>`，读不到 Section 内层 → 导入后整张图变成白底黑框。

### 修法：dual-write（两份都写）

把 Fill/Line 的 Cell **同时**写进 Section 和 Shape 直属层：

```xml
<Shape ID="1">
  <Cell N="PinX" V="2.91"></Cell>
  <Cell N="FillForegnd" V="#ECECEC"></Cell>   <!-- draw.io 读这份 -->
  <Section N="Fill">
    <Cell N="FillForegnd" V="#ECECEC"></Cell>  <!-- Visio 读这份 -->
  </Section>
</Shape>
```

两个读取方各取所需，互不干扰。

> 试过更"干净"的做法——把 Section 整个删掉、只留直属 Cell：draw.io 好了，但违反了 Visio 规范，真 Visio 打开会丢样式。所以只能 dual-write。

**只对 Fill/Line 这么做。** Geometry / Character / Paragraph 一旦平面化，Visio 里的几何形状和字体就会错乱。

## 坐标系

两套坐标必须显式换算，别混：

| | 原点 | y 方向 | 单位 |
|---|---|---|---|
| 图数据 | 左上 | 向下 | 画布像素 @96dpi |
| Visio | 左下 | 向上 | 英寸 |

换算只走两个函数：`toInches(px)` 和 `toVisioY(yTopPx, pageHpx)`。全项目只有这一处做转换。

## 用法

```js
const JSZip = require('jszip');
const { buildVsdx } = require('./src/index.js');
const { jszipImpl } = require('./src/zip.js');

const bytes = await buildVsdx(diagram, theme, jszipImpl(JSZip));
fs.writeFileSync('out.vsdx', Buffer.from(bytes));
```

`diagram` 结构：

```js
{
  meta:   { pageW: 560, pageH: 460 },          // 画布尺寸，px
  nodes:  [{ id, type, text, x, y, w, h }],    // type: start|process|decision|end|data|note
  edges:  [{ from, to, fromPort, toPort }],    // port: Top|Right|Bottom|Left
  labels: [{ text, x, y, w, h }],              // 分支标签「是 / 否」
}
```

`theme` 用到的是 PRD 那 18 个参数里的排版子集：

```js
{ fontFamily, fontSize, fillColor, lineColor, fontColor, lineWeightPt, cornerRadiusPx }
```

## 已知限制

1. **字号在 draw.io 里会丢。** draw.io 的导入器不读 `<Section N="Character">` 的行内字号，所以从 vsdx 转出来的 drawio 文件没有 `fontSize`。Visio 本身正常。因为只影响"再转一手"的场景，暂不处理。
2. **没在真 Visio 里打开验证过。** 本机没有 Visio。目前只验证了：结构符合 Visio 2013+ 规范、ts-visio 自己的 `VisioValidator` 通过、draw.io 能正确读取并渲染。**首次交付前需要找一台有 Visio 的机器实测。**
3. **只支持单页。** 多页需要 `doc.addPage()`，接口已留好。

## 测试

```bash
node test/run.js      # 9 个用例，纯静态检查，不需要 draw.io 或 Visio
```

测试查的是"两个读取方都能读对"的三条硬条件：

1. Section 存在（Visio 要求）
2. 同名 Cell 也在直属层（draw.io 要求）
3. 几何 Section 未被平面化（否则 Visio 变形）

人工验证渲染效果：

```bash
# 后台跑，前台会卡住
/Applications/draw.io.app/Contents/MacOS/draw.io --no-sandbox \
  -x -f png -s 2 -b 20 -o out.png in.vsdx &
sleep 12 && kill %1
```
