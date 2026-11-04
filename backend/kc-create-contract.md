# kc-create-objects 接口契约（Electron 注入依据）

> 来源：`kc-create-objects-ui.ps1`（用户 2026-11-03 提供，头注标 v1.0 语义未注；以本仓 `backend/scripts/` 副本为准）。
> 一个脚本覆盖**新建 Topic / 新建 Map / 新建 Pub** 三类任务（P3 类型卡片的另外三张）。
> 行协议、两段式调用、登录梯、证书诊断与 [kc-import-contract.md](kc-import-contract.md) 完全一致的部分不重复，只写差异。

## 0. 与导入图片脚本的关系

| 维度 | import-images | create-objects（本文档） |
|---|---|---|
| 覆盖 | 导入图片（Update 模式=改） | 新建 Topic/Map/Pub（纯新建，不更新不删除） |
| 挂接 | 无 | Topic→Map（改 map XML，强制备份）、Map→Pub（写 FISHMASTERREF） |
| 文件夹类型闸门 | ISHIllustration | ISHModule / ISHMasterDoc / ISHPublication；**自动建容器**（Topics\ / Maps\ / Publications\） |
| `-ListFolders` / `-WsBaseUrl` | 用户口径已支持 | **2026-11-03 已合入本仓脚本**（见第 10 节补丁记录） |

**红线（脚本自审 AST 强制）**：只允许白名单内的 `*-Ish*` cmdlet（Add-IshFolder / Add-IshDocumentObj / Add-IshPublicationOutput / Set-IshDocumentObj / Set-IshPublicationOutput + 只读查询）。不删、不移动；唯一的"改"是挂接且强制备份。Electron 侧不需要做任何事，但要知道脚本会自审，被改过的脚本会直接 ABORT。

## 1. headless 判定（与 import 不同）

```powershell
$script:headless = [bool]($Type -and $FolderPath -and ($Title -or $XmlDir -or $MapXmlFile -or $SourceFile -or $SourceText))
```

必须给 `-Type` + `-FolderPath` + 至少一个内容来源。`Type` ∈ `Topic|Map|Pub`。

## 2. 参数 ↔ P3 表单字段（三张类型卡）

### 共用
| 参数 | UI | 说明 |
|---|---|---|
| `-Type Topic/Map/Pub` | 类型卡片 | headless 必填 |
| `-FolderPath` | KC 目标目录 | 手贴 + 浏览（浏览窗本脚本也有 WinForms 版；Electron 里仍需 `-ListFolders` 类能力，见第 0 节） |
| `-NoCreateFolder` | 「缺失的目录自动创建」反选 | 默认创建 |
| `-Commit` | P4「开始执行」 | 两段式同 import |
| `-IgnoreSslPolicyErrors` | P5 高级 | 同 import |
| `-IshUser / -IshPassword` | P1 登录 | 同 import |
| `-KeepLogs 20` | P5 日志保留天数 | transcript 轮转 |

### Topic（`-Type Topic`）
| 参数 | UI | 说明 |
|---|---|---|
| `-XmlDir <目录>` | 来源①：本地 XML 目录 | 递归；标题取各 XML 的 `<title>`；**类型按根元素** concept/task/reference 自动判定；KC 侧按本地子目录**镜像建同名文件夹** |
| `-SourceFile` / `-SourceText` | 来源②：标题列表（txt/csv/md） | 用内置最小空 topic 模板创建 |
| `-TopicType Concept/Task/Reference` | 空 topic 类型下拉 | 仅来源②生效（来源①由根元素定） |
| `-AttachMap <IshRef/GUID>` | 「创建后挂到指定 Map」勾选 + 搜索框 | 需 `scripts\templates\` 下有带 `<topicref>` 的 map XML 样例，否则只预检不写挂接 |

### Map（`-Type Map`）
| 参数 | UI | 说明 |
|---|---|---|
| `-SourceFile` / `-SourceText` | 来源①：标题列表 | 内置最小空 map 模板 |
| `-MapXmlFile <文件>` | 来源②：本地 map XML | 单文件；标题取 `<title>`；根元素须 map/bookmap |
| `-MasterType` | Map 类型下拉 | 默认 `VMASTERTYPEUSERMANUALMAP`；**运行时从 KC 拉 DMASTERTYPE LOV** 填充 |
| `-AttachPub <IshRef/GUID>` | 「创建后挂到指定 Pub」勾选 + 搜索框 | **批量 Map 不挂 Pub**（标题>1 时表单直接拒绝）；pub 已挂 master 时跳过 |

### Pub（`-Type Pub`）
| 参数 | UI | 说明 |
|---|---|---|
| `-Title` | 标题（单条） | headless 必填 |
| `-OutputFormat` | OutputFormat 下拉 | 默认 `VOUTPUTFORMATPDF1-MANUAL-A4`；**运行时从 KC 拉**（Find-IshOutputFormat，只列 VOUTPUTFORMAT*）；决定 Publication 类型（`VPUBLICATIONTYPE` + 后缀） |
| `-PubSwitchMode DISPLAY/HIDE` | 海康 7 个 Switch 字段统一取值 | 8 个字段（FHIKMODEL/FUNCTION/APPLICATION/SCENE/USERTYPE/CLIENTTYPE/PRODUCTTYPE/**USERJOURNEY**SWITCH）全部填 DISPLAY 或 HIDE，LOV 必填；默认 DISPLAY |
| `-LanguageCombination zh-CN` | 语言组合（只读展示） | headless 默认 zh-CN |
| `-LanguageElement VLANGUAGEZHCN` | 语言元素 | 默认 VLANGUAGEZHCN |

建的是**空 pub**（不挂 master），baseline 由服务端生成；Publisher/作者由登录账号推导（`VUSER`+账号大写字母数字）。

## 3. stdout 行协议（差异部分）

阶段编号：`STEP 1 登录` → `STEP 2 生成对象清单` → `STEP 4 预检（只读）` → `STEP 5 执行` → `回读核对` → `STEP 5b 挂接` → `STEP 6 台账` → `STEP 7 结果`。（无 STEP 3；编号跟随 import 脚本习惯。）

### 清单与预检
| 模式 | 事件 |
|---|---|
| `[OK] 自审通过（AST）：调用 (\d+) 个 -> (.+)` | 启动自审（失败则 `ABORT: 未授权 cmdlet:` → exit 1） |
| `[OK] OutputFormat (\d+) 个…` / `[OK] Map 类型 (\d+) 个` | 启动时从 KC 拉的下拉数据（可用于 P3 表单预填） |
| `[OK] 清单 (\d+) 项（Topic (\d+) / Map (\d+) / Pub (\d+)）` | STEP 2 完成 |
| `[预检] 将创建 (\d+) / 跳过 (\d+) / 阻塞 (\d+) / 失败 (\d+) / 共 (\d+)` | 预检汇总（注意：字段比 import 少，无"更新/无变化"） |
| `    (STATE) (类型标签) (标题)  <目标路径>  (备注)` | 逐项清单；类型标签如 `Topic:TASK` / `Map:USERMANUALMAP` / `Pub:VPUBLICATIONTYPE…` |
| `[OK] 目标目录最深已存在：(.+)（(\d+)/(\d+) 层）FolderId=(\d+) type=(\S+)` | 落点解析 |
| `[!] 缺失 (\d+) 层：(.+)` | 将自动创建的路径段 |
| `[USE] … 改用已有子文件夹 (.+)（FolderId=\d+, type=\S+）` | 落点类型不符→复用容器（Topics/Maps/Publications） |
| `[NEW?] … 将在其下新建 (.+)（(\S+)）` | 落点类型不符→将新建容器 |
| `[!] Topic → Map 挂接不可用：(.+)` / `[!] Map → Pub 挂接不可用：(.+)` | 挂接预检失败（不阻断创建） |
| `[OK] 挂接目标 map：(.+)（(\S+)，现有 topicref (\d+) 个，样例 (.+)）` | 挂接目标解析成功 |

### 执行与挂接
| 模式 | 事件 |
|---|---|
| `\[(\d+)/(\d+)\] (.+?)  —— 建成 ObjectRef=(\S+) IshRef=(\S+)  落点 FolderId=(\d+)` | 单项建成（比 import 多 IshRef） |
| `\[(\d+)/(\d+)\] (.+?)  —— 失败：(.+)` | 单项失败 |
| `[OK] 回读 FolderId=(\d+)：本轮 (\d+) 个，未见 (\d+) 个` | 创建回读核对（未见>0 → 可能索引延迟） |
| `[OK] pub 回读：FTITLE=… / TYPE=… / FORMAT=… / BASELINE=… / VERSION=…` | pub 回读 |
| `[BK] 已备份 map XML：(.+)` | 挂接前备份（强制，哈希校验） |
| `[OK] 已写入 map：(.+)（追加 topicref (\d+) 个）` | Topic→Map 挂接写入 |
| `[OK] 回读校验通过：topicref (\d+) → (\d+)` | 挂接回读 |
| `[OK] 已写入 pub FISHMASTERREF：(.+) → (.+)` | Map→Pub 挂接写入 |
| `[X] Topic → Map 挂接失败：(.+)` / `[X] Map → Pub 挂接失败：(.+)` | 挂接失败（已创建对象保留） |
| `[NEW] (.+)  FolderId=(\d+)  type=(\S+)` | 执行阶段建目录（同 import） |

### 结果
`STEP 7 结果` 后输出汇总块（创建/跳过/阻塞/失败/合计 + 挂接结果行 + 日志/台账/备份路径）。
**退出码**：`failed>0 或 挂接失败>0 或 (headless 且 挂接被跳过)` → exit 1；否则 0。
注意：headless 下挂接"不可用被跳过"也算 exit 1（比 import 严格），UI 应把"挂接跳过"作为结果区醒目提示。

### headless 下的进度
**2026-11-03 已打补丁**：STEP 5 与 STEP 1 的两处 `Start-Progress` 均包在 `if (-not $script:headless)` 内，Electron 调用不再弹脚本自带进度窗（见第 10 节）。

## 4. 单项状态机

```
预检判定：TOCREATE / SKIPPED（目标目录已有同名同类 / 已存在同标题同语言 pub）/ BLOCKED（目录不存在且未勾选自动创建 / OutputFormat 不在库中 / 落点读不到）/ FAILED（XML 无 <title> / 根元素非法 / 批次内重名）
执行后：  CREATED / FAILED
挂接：    ATTACHED / ATTACH_FAILED / 跳过（Ready=false）
```

## 5. 标题来源解析（Get-KcTitleList，前端要提示用户）

- **Auto**：按来源文件扩展名（.csv→Csv，.md/.markdown→Markdown，其他→Lines）
- **Lines**：每行一个标题（去 BOM/空白）
- **Csv**：优先找表头列 `Title|标题|名称|topic|map`（表头可不在第一列）；无表头取每行第一列（支持引号转义）
- **Markdown**：`#{1,6}` 标题行，跳过 ``` 代码块
- 文件读取：BOM(UTF-8/16LE/16BE) → 严格 UTF-8 → 系统 ANSI（GBK）三级回退——**前端文件选择器要接受 txt/csv/md/markdown**

## 6. 文件夹类型闸门（P3 落点校验文案依据）

| 对象 | 需要文件夹类型 | 类型不符时行为 |
|---|---|---|
| Topic | ISHModule | 目标已存在→自动找/建 `Topics\` 子容器（ISHModule） |
| Map | ISHMasterDoc | 同上，容器名 `Maps\` |
| Pub | ISHPublication | 同上，容器名 `Publications\` |

- 容器名可经表单配置覆盖（`ContainerName`，headless 参数未暴露——UI 暂不暴露）。
- `ISHNone` 普通容器**什么对象都装不了**。
- 新建目录链：中间层一律 ISHNone，**只有最后一层带对象类型**（写死 ISHNone 曾导致 -129）。
- 执行前有"写前终检"（预检后文件夹可能被人改），拿到类型才判，拿不到不阻断。

## 7. 挂接详解（D1/结果区文案依据）

### Topic → Map（`-AttachMap`）
- 前提：`scripts\templates\` 下有带**指向 topic 的** `<topicref>` 的 map XML 样例（href 格式从它学；`format="ditamap"` 的挂子 map 样例被跳过并告警）
- 目标 map 被检出 → 挂接不可用
- 流程：下载 map XML → 在最后一个 `</map>` 前插入 topicref（id/keys/copy-to 属性剥掉）→ XML 合法性校验 → **备份到 `backup\<时间戳>\`（SHA256 校验一致才继续）** → Set-IshDocumentObj → 回读校验（topicref 数 + 每个 IshRef 都在）
- 任一环节失败：已建 topic 保留，挂接记 ATTACH_FAILED

### Map → Pub（`-AttachPub`）
- 仅单条 Map；pub 已挂 master → 跳过（防覆盖）
- 写 `FISHMASTERREF`（需求书 R-09b，**API 尚未实测**——头注原话，UI 结果区应如实提示"该功能未实测"）
- Set-IshPublicationOutput 后回读校验

## 8. 产物

- `logs\kc-create-<时间戳>.txt` transcript（保留最近 20 份）
- `logs\kc-create-ledger.csv` 滚动台账（CREATED/FAILED/ATTACHED/ATTACH_FAILED，只记真写入）
- `backup\<时间戳>\` 挂接前 map XML 备份

## 9. 待确认项（2026-11-03 已全部关闭）

1. ~~`-WsBaseUrl` / `-ListFolders` 是否已改~~ → **已改，见第 10 节**。
2. ~~STEP 5 `Start-Progress` 的 headless 判断~~ → **已补（两处）**。
3. ~~templates 样例~~ → **用户已提供两份真实 map XML**，存于 `backend/scripts/templates/`（`sample-map-basic.ditamap`、`sample-map-content-reuse.ditamap`）。Electron 打包时随脚本一起放应用资源目录。
4. ~~Map→Pub 挂接未实测~~ → **用户决定暂不开发该功能**，UI 中该入口保留"暂未开放"标记，不进入验收范围。

## 10. 脚本补丁记录（2026-11-03，已合入本仓 `scripts/kc-create-objects-ui.ps1`）

| # | 补丁 | 落点（行号为补丁后） | 内容 |
|---|---|---|---|
| ① | `-WsBaseUrl` | param 块 L82；L1159 | 新增 `[string]$WsBaseUrl = ''`；`$script:wsUrl = if ($WsBaseUrl) { $WsBaseUrl } else { 'https://kc-prod.hikvision.com/ISHWS/' }`。默认行为不变 |
| ② | `-ListFolders` | param L81；headless 判定 L3087；分支 L3121–3152 | 新增 `[switch]$ListFolders`；headless 判定加 `$ListFolders -or`；登录后立即进入只读分支：`Resolve-KcFolderPath` 解析路径 → `Get-KcChildFolders` 列子目录 → 输出单行 `KCJSON {json}` → `exit 0` |
| ③ | headless 拦 `Start-Progress` | L532（STEP 1）、L2919（STEP 5） | `Start-Progress 'KC 新建对象'` → `if (-not $script:headless) { Start-Progress 'KC 新建对象' }` |

### ② 的 `KCJSON` 输出（与 import 契约第 8 节补丁②同协议）

```
KCJSON {"path":"General\x","resolved":true,"leaf":"x","missing":[],"folderType":"ISHModule","folderId":"12345","children":[{"name":"image","id":"...","type":"ISHIllustration"}]}
```

- `resolved=false` + `missing:[...]` → 路径尚不存在，UI 展示"将自动创建"清单
- `folderType` 与任务类型不匹配（Topic 要 ISHModule / Map 要 ISHMasterDoc / Pub 要 ISHPublication）→ UI 立即提示，不让用户提交到错层
- 只读分支**不写任何东西**，`exit 0`

### 自审影响

AST 自审白名单只校验 `*-Ish*` cmdlet。`-ListFolders` 分支只调 `Resolve-KcFolderPath`（内部 `Get-IshFolder`）与 `Get-KcChildFolders`（内部 `Get-IshFolder`），两个都在白名单内，**自审不受影响**。
