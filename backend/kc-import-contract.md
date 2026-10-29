# kc-import-images 接口契约（Electron 注入依据）

> 来源：`kc-import-images-ui.ps1`（用户 2026-10-29 提供，已实测通过）。
> 脚本本体由用户持有维护，本仓不存副本；本文档是 Electron 主进程/解析器的唯一对接依据。
> 脚本有新版本时，用户重新发送，本文档同步更新。

## 1. 调用形态

Electron 主进程 **永远以 headless 模式调用**（给全 ImageDir + KcFolder 即不弹任何 Windows 窗体）：

```powershell
# Windows PowerShell 5.1（用户机实测环境）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File kc-import-images-ui.ps1 `
  -IshUser <账号> -IshPassword <密码> `
  -ImageDir "<本地图片文件夹>" -KcFolder "General\...\image" `
  -Mode Import|Update [-NoCreate] [-NoBackup] [-Recurse] `
  [-NoIndex] [-Commit] [-IgnoreStateGate] [-IgnoreSslPolicyErrors] [-NoAutoInstall]
```

主进程探测顺序：`powershell.exe`（5.1）→ `pwsh`（7+）→ 都没有则提示"仅支持 Windows"。
macOS 开发机走 mock runner（见第 7 节）。

### 两段式调用（对应 P3 预检 → P4 执行）

1. **预检**：不带 `-Commit`。零写入，跑完 STEP 4 输出预检清单后退出（exit 0）。
2. **执行**：带 `-Commit`。脚本会重新登录、重新预检（幂等，安全），然后写入。
   这是脚本固有行为：第二次调用的预检阶段同样只读，可接受。

### 凭据安全

- 当前密码走命令行参数（内网工具可接受，但进程列表可见）。
- P5"记住密码"：Electron safeStorage 加密存本地，不落明文。
- 待办（低优先）：脚本改从 stdin/环境变量读密码。

## 2. 参数 ↔ P3 表单字段

| 参数 | P3 控件 | 说明 |
|---|---|---|
| `-ImageDir` | 本地图片文件夹 | Electron 原生 dialog 选目录（设计稿"图片多选"落为"选目录"） |
| `-KcFolder` | KC 目标路径 | 文本框手贴 + 「浏览目录」按钮（浏览依赖补丁 ② 的 `-ListFolders`，用户确认脚本已支持） |
| 落点标签 | "图片" | 固定 ISHIllustration；`-ListFolders` 返回的 `folderType` 非 ISHIllustration 时 UI 立即提示"这层不能放插图，改到 \image 层" |
| `-Mode Import/Update` | 模式单选 | Import=只补没有的；Update=同名替换内容（幂等） |
| `-NoCreate` | "只替换，不新建"勾选 | 仅 Update 可用 |
| `-NoBackup` | "替换前备份原图"反选 | 默认备份到 `backup\<时间戳>\` |
| `-Recurse` | "包含子文件夹"勾选 | 标题带目录前缀（` - ` 连接） |
| `-NoIndex` | "导出名称/GUID 对照表"反选 | headless 默认导出 |
| `-Commit` | P4"开始执行"按钮 | 见两段式调用 |
| `-IgnoreStateGate` | 预检出现 BLOCKED 时的"确认放行" | fail-closed 闸门：检出/状态字段缺失→全拦 |
| `-IgnoreSslPolicyErrors` | P5 高级设置（候选） | 跳过第 1 级标准证书校验 |
| `-FolderType` | 不暴露 | 恒 ISHIllustration（写死，见脚本注释 -129 坑） |

## 3. stdout 行协议（解析器按行消费）

`Log()` 同时写控制台和 transcript，以下均为逐行匹配：

### 阶段与登录
| 模式 | 事件 |
|---|---|
| `^STEP (\d)` | 阶段推进（1登录 2收集 3落点 4预检 5执行 6台账 7对照表） |
| `[OK] 登录成功：(.+) / 账号 (.+)` | 登录成功（版本/账号） |
| `[..] 判定：账号或密码不正确` | 认证失败（脚本主动停止降级，防锁号） |
| `[..] 判定：证书/TLS 校验没谈拢，继续降级` | TLS 降级中 |
| `[X] 登录失败：(.+)` | 登录失败（最终） |

### 预检（STEP 4）
| 模式 | 事件 |
|---|---|
| `[预检] 新建 (\d+) / 更新 (\d+) / 无变化 (\d+) / 跳过 (\d+) / 阻塞 (\d+) / 失败 (\d+) / 共 (\d+)` | 预检汇总 → P3 预检报告六宫格 |
| `^    (\S+)\s{2,}(.+?)(?:\s+\[(\w+)\])?\s+<(.+?)>\s+(.*)$` | 逐项清单：状态 文件名 [分辨率] <类型> 备注 |

**headless 预检期间无逐项进度输出**（进度窗被 `-not $headless` 抑制），只有跑完后的汇总+清单。解析器对预检阶段按"转圈→出结果"处理即可。

### 执行（STEP 5）
| 模式 | 事件 |
|---|---|
| `\[(\d+)/(\d+)\] (.+?)  —— 建成 ObjectRef=(\S+)` | 单项建成 → 进度 i/N + 当前项 |
| `\[(\d+)/(\d+)\] (.+?)  —— (?:更新)?失败：(.+)` | 单项失败 |
| `\[(\d+)/(\d+)\] (.+?)  —— 替换内容（ObjectRef=(\S+) v(\S+) (\S+) (\S+)）` | 单项更新中 |
| `原图已备份并校验 (.+)（(\d+) B，(\w+)）` | 备份留痕 |
| `回读 SHA256 一致，更新确认` | 更新校验通过 |
| `[!] 回读哈希不一致：(.+)` / `[!] 回读失败（更新已提交）：(.+)` | UPDATED_UNVERIFIED |
| `[NEW] (.+)  FolderId=(\d+)  type=(\S+)` | 新建目录（执行阶段才建） |

### 结果与产物
| 模式 | 事件 |
|---|---|
| `[结果] 新建 (\d+) / 更新 (\d+)（其中未校验 (\d+)）? / 无变化 (\d+) / 跳过 (\d+) / 阻塞 (\d+) / 失败 (\d+) / 共 (\d+)` | 最终汇总 → P4 结束态 |
| `[OK] 对照表已写出：(.+)` | GUID 对照表路径 |
| `[OK] 台账追加 (\d+) 行，累计 (\d+) 行：(.+)` | 台账路径 |
| `transcript : (.+)` | 本轮日志路径（P4"导出结果/打开落点"用） |
| `[X] 未捕获的异常，脚本已中止：` + 后续行 | 顶层 trap → D1 通用报错 |

### 退出码
`失败数 > 0` → exit 1；否则 exit 0。exit 0 不等于"全部写入"（可能全跳过/全UNCHANGED），以 `[结果]` 行为准。

## 4. 单项状态机

```
（初始）→ 预检判定：
  TOCREATE      新建（KC 没有）
  TOUPDATE      更新（同名、哈希不同、过闸门）
  UNCHANGED     哈希相同，跳过（幂等）
  SKIPPED       Import 模式遇同名
  SKIP_NOEXIST  Update+NoCreate 遇 KC 没有
  BLOCKED       被检出 / 非草稿 / 字段缺失（fail-closed）
  FAILED        预检期失败（标题空/无EDT/批次重名/下载失败）
→ 执行后：
  CREATED / UPDATED / UPDATED_UNVERIFIED（写了但回读没对上）/ FAILED
```

P4 结果清单分组：成功 = CREATED+UPDATED；需处理 = FAILED + UPDATED_UNVERIFIED + BLOCKED。

## 5. 错误码 → D1 报错弹窗映射

| 错误码/特征 | 含义 | UI 文案 |
|---|---|---|
| `[-129] InvalidDocTypeforFolder` | 落点文件夹类型不是 ISHIllustration | "目标文件夹不能放插图"+改到 `\image` 层的提示（脚本预检已拦，执行期出现=漏网） |
| `[-108001] ActionProtectedField` | 元数据写了保护字段 | 不应出现（脚本已规避），出现即报脚本 bug |
| `[-105001] version "-1" invalid` | WhatIf 误用 | 同上 |
| 401 / Unauthorized / 密码 / 凭据 | 认证失败 | P1"密码错误"态；注意脚本已主动停止重试防锁号 |
| `AuthenticationException / SSL / TLS / 证书 / 信任关系` | 证书问题 | P1"连接失败"态 + 证书诊断摘要 |

## 6. 前端必须移植的清洗逻辑（与脚本对齐）

### KC 路径清洗（Normalize-KcPath 等价物）
1. 去 BOM / 零宽字符（U+200B-200D）/ 不换行空格（U+00A0）
2. 去首尾引号（含中文引号 ""''）
3. `/` → `\`，压掉连续 `\`
4. 去首尾 `\` 和空白
5. 若中部含 `general\`（不区分大小写、不在开头）→ 从该处截断
6. 开头 `general`（不区分大小写）→ 规范为 `General`

### 标题比对键（Get-TitleKey 等价物）
Unicode NFKC 归一 → 去所有空白 → 转小写。**不做模糊匹配**。

### EDT 映射（展示用）
png→EDTPNG, jpg/jpeg→EDTJPEG, gif→EDTGIF, bmp→EDTBMP, tif/tiff→EDTTIF, svg→EDTSVG, svgz→EDTSVGZ, eps→EDTEPS, wmf→EDTWMF, emf→EDTEMF, cgm→EDTCGM, psd→EDTPSD

### 产物路径（相对脚本目录）
- `logs\kc-import-<yyyyMMdd-HHmmss>.txt` 本轮 transcript（保留最近 20 份）
- `logs\kc-import-ledger.csv` 滚动台账（只记真写入）
- `logs\<文件夹名>_GUID_<时间>.csv` 对照表
- `backup\<时间戳>\` 更新模式原图备份

## 7. mock runner（macOS 开发用）

主进程 `runner/` 两个实现同接口：
- `psRunner.js`：spawn powershell.exe，逐行 stdout → 解析器
- `mockRunner.js`：读 `mock/fixtures/*.log`（录制的真实日志），按行延迟回放 → 同一解析器

解析器（`kc-log-parser.js`）对两者一视同仁，输出第 3 节定义的事件流。

## 8. 脚本补丁状态（用户持 canonical 版本，UI 侧按"已合入"对接）

| 补丁 | 内容 | 状态（2026-10-29 用户口径） |
|---|---|---|
| ① `-WsBaseUrl` | P5 服务器地址可配置，默认 `https://kc-prod.hikvision.com/ISHWS/` | 用户已同意；如手边脚本尚无此参数，按下方案例合入 |
| ② `-ListFolders` | P3 目标路径「浏览目录」按钮所需 | **用户口径：脚本已改好**。UI 浏览树依赖 `KCJSON ` 前缀整行 JSON 输出；实测不符时以用户新版脚本为准并更新本文档 |
| ③ headless 拦 `Start-Progress` | 避免 Electron 调用时弹出脚本自带进度窗 | 建议合入（不拦会多一个原生进度窗） |

### 补丁①参考代码（如脚本尚无）
param 块加：
```powershell
[string]$WsBaseUrl = 'https://kc-prod.hikvision.com/ISHWS/',
```
正文 `$wsUrl = 'https://kc-prod.hikvision.com/ISHWS/'` 改为 `$wsUrl = $WsBaseUrl`。默认值保持 kc-prod，行为不变。

### 补丁② `-ListFolders` 输出协议（UI 对接约定）
调用：`powershell.exe -File ... -IshUser u -IshPassword p -ListFolders "General\x"`（只读，列出子目录后 exit 0）。
解析器认 `KCJSON ` 前缀整行 JSON，字段约定：
```json
{
  "path": "General\\x", "resolved": true, "leaf": "x",
  "missing": ["y"],               // 未创建的路径段（自动创建候选）
  "folderType": "ISHIllustration",// 非 ISHIllustration → UI 立即提示"这层不能放插图"
  "folderId": "12345",
  "children": [{ "name": "image", "id": "…", "type": "ISHIllustration" }]
}
```
浏览树 = 从 General 起逐层调 `-ListFolders`（脚本内 `$kcChildCache` 是进程级缓存，跨调用不保留，由前端缓存补）。
若手头脚本尚无此模式，参考实现见 git 历史（用户确认脚本已改后，canonical 以用户版本为准）。

### 补丁③参考代码
`Start-Progress 'KC 批量导入图片'`（STEP 5 内）改为：
```powershell
if (-not $headless) { Start-Progress 'KC 批量导入图片' }
```
（`Update-Progress`/`Stop-Progress` 本来就是空操作安全的，只需拦 Start。）

## 9. 已确认决策（2026-10-29）

1. **技术栈：React + Electron**（用户明确选定）。
2. **P2 任务列表口径：接受** —— 任务历史由 App 本地记录（每次执行存一条到本地存储），不从 KC 实时拉取；脚本无"列出历史任务"能力。
3. **服务器地址抽参：接受** —— `-WsBaseUrl` 默认 kc-prod，P5 可改。
4. **KC 路径：手贴 + 浏览都要** —— 用户确认脚本已支持目录浏览，UI 提供「浏览」按钮打开目录树对话框 + 文本框手贴（前端做 Normalize-KcPath 同款清洗）。
5. **目标平台：Windows**（powershell 依赖）；macOS 仅作开发机，走 mock runner。
