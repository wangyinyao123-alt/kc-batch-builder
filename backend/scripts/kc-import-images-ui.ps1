# kc-import-images-ui.ps1  (UTF-8 with BOM)
# ============================================================================
# KC 批量导入图片 · 弹窗版（单文件、无外部依赖，只依赖 ISHRemote 模块）
#
# 流程：
#   1) 弹 Windows 登录框（账号密码）→ 登录 KC，失败就停
#   2) 登录成功后弹输入框：本地图片文件夹（可浏览）+ KC 目标文件夹（可浏览/可粘贴）+ 操作模式
#   3) 点"开始"→ 解析落点 → **预检（只读）**：比对两个文件夹的同名图与内容哈希
#   4) 弹预检结果确认 → 用户点"是"才写入 → 逐张建/改 → 回读校验 → 台账
#   5) 重新扫一遍目标文件夹，导出「名称 / GUID 对照表」（整表覆盖）
#   6) 结束弹结果框，可直接打开 logs 目录
#
# 两种操作模式：
#   Import（默认）  只补 KC 里没有的图；目标文件夹内同名一律跳过
#   Update          同名图内容替换成本地图；KC 里没有的补建（-NoCreate 可关掉补建）
#                   替换前默认把 KC 原图备份到 backup\<时间戳>\（-NoBackup 关掉）
#                   内容完全相同的标 UNCHANGED 跳过，所以"更新"可反复跑（幂等）
#
# 已实测的关键配置（2026-10-21，别再改回去）：
#   * IshType      = ISHIllustration
#   * EDT          = 按扩展名映射，PNG → EDTPNG
#                    （cmdlet 默认 EDTXML 会把 PNG 当 XML 解析，报
#                      [-1] Invalid character in the given encoding）
#   * FRESOLUTION  = 走 -Resolution 'High'（服务端吃标签值，不吃 VRESHIGH）
#                    写进 -Metadata 会报 [-108001] ActionProtectedField
#   * 查重         分两层：目标文件夹内同名 → 真重复（是不是要跳过，看模式）；
#                   全库别处同名 → 只提示、照建（不同手册同名截图很常见）。
#                   注意 Find-IshDocumentObj 没有文件夹参数，只能全库按标题查，
#                   17:07 那次正是拿它当判重依据，把 VAC3000 的图误判成已存在。
#
#   * 更新         用 Set-IshDocumentObj -LogicalId -Version -Lng -FilePath 直接换内容，
#                   ObjectRef 不变、topic 引用不断。2026-10-23 实测：回写同一份文件后
#                   回读 SHA256 完全一致（728A810C…，60317 B），状态仍 Draft / version 1。
#                   注意 -WhatIf 不能用（报 [-105001] version "-1" invalid），
#                   所以预检必须自己算，别指望 -WhatIf 兜底。
#                   Get-IshFolderContent 每个对象按语言返回多行（6 个对象 18 行），
#                   必须按 ObjectRef 去重，否则一张图会被算三遍。
#
#   * 登录          先正常校验证书；失败逐级降级（自己放行证书 → 再加 ISHRemote 开关）。
#                   每级失败都打完整异常链，不再吞错。
#                   **只有证书/TLS 类失败才降级重试**：账号密码错立刻停（每试一次就多提交
#                   一次错误凭据，域策略 5 次锁号）；说不清的错只再给一次机会。
#                   证书诊断也只在 TLS 类失败时跑，密码错不再刷一屏证书信息。
#
#   * 分辨率        Get-IshFolderContent 返回的是"每对象 × 每语言 × 每分辨率一行"，
#                   ObjectRef 全一样。必须先归组再挑代表行：**High 优先，其次 zh-CN**。
#                   别用先到先得 —— 组内顺序由服务端决定，之前侥幸拿到 High，不是保证。
#                   挑出来的行既用于下载比对，也把 -Resolution 显式传给 Set-IshDocumentObj。
#                   分辨率有两个字段别搞混（2026-10-26 实测）：fresolution = 标签值 High，
#                   fresolution_lng_element = 元素名 VRESHIGH。一律用标签值 —— Set 要它，
#                   KC 界面里的对象标识也写成 =High。
#
#   * 安全边界      ① 缺失目录只在**确认执行之后**才建（预检阶段零写入）
#                   ② 替换前备份要做三步校验：拿到原图 → 哈希与预检一致 → 落盘后哈希仍一致，
#                      任一步不过就拒绝覆盖（KC 没有回收站，备份是唯一回滚途径）
#                   ③ STEP 5 用 try/finally 关进度窗，脚本顶层有 trap 兜底，
#                      任何未捕获异常都不会把进度窗留在屏幕上
#                   ④ 更新闸门 fail-closed：2026-10-26 实测 Get-IshFolderContent 默认返回
#                      checkedout / checkedoutby / fstatus（18 行全空），所以判据是
#                      **字段不存在 → BLOCKED**、**值为空 → 放行**。万一某版本不返回这些字段，
#                      更新会被全部拦下（可见、可解释），确认没检出后加 -IgnoreStateGate 放行。
#                   ⑤ 只在更新模式跑闸门；新增导入从不覆盖，同名直接 SKIPPED。
#
#   * 文件夹类型    KC 把"这个文件夹能装什么"绑在文件夹类型上，插图只能进 ISHIllustration：
#                   whx（ISHNone）→ [-129] InvalidDocTypeforFolder；whx\image（ISHIllustration）→ 通过。
#                   （2026-10-26 实测对照，同一张图、同一账号）
#                   所以两处都把类型当硬约束：① 落点已存在 → 在 STEP 3 预检就校验并拦下；
#                   ② 落点要新建 → Add-IshFolder 一律按 -FolderType（默认 ISHIllustration）建。
#                   上一版建目录写死 ISHNone，等于"自动创建的目录永远装不了图"，别再改回去。
#
#   * 依赖          脚本自己找 ISHRemote 模块：已加载 → 直接用；装了 → Import；
#                   都没有 → 自动 Install-Module 从 PowerShell Gallery 拉。
#                   内网连不上 Gallery 时加 -NoAutoInstall 跳过安装，只报离线方案。
#
#   * 浏览          KC 是服务端目录，本地 FolderBrowserDialog 选不到，所以自己做了个逐层浏览窗：
#                   用 Get-IshFolder -FolderId <id> -Recurse -Depth 2 拿直接子文件夹。
#                   **-Depth 是含自身计数的**（实测）：1 = 只有自己，2 = 自己 + 直接子文件夹，
#                   3 = 铺到孙子层且是扁平的（分不出父子）。上一版写成 1，浏览窗永远空白。
#                   默认 2147483647，别传 -Recurse 不带 -Depth。
#                   Get-IshFolderContent 只列文档、不列子文件夹（对文件夹返回 0 行），别拿它当兜底。
#                   每层结果缓存，双击进下一层、"上一级"回退；路径框仍可手打/粘贴。
#                   万一服务端对 FolderId+Recurse 组合不认，退回 Get-IshFolderContent 里挑带
#                   IshFolderType 的行兜底；两条都空就只提示、不阻断，手打照样能用。
#
# 产物（都在 logs\ 子目录，脚本目录保持干净）：
#   logs\kc-import-<时间戳>.txt   每轮一份 transcript，自动只留最近 -KeepLogs 份（默认 20）
#   logs\kc-import-ledger.csv     单一滚动台账，只追加"真写入"的行（建成/更新/失败）；
#                                 纯预检不留痕，所以反复预检不会堆文件
#   logs\<文件夹名>_GUID_<导出时间>.csv
#                                 名称 / GUID 对照表（文件名里的 GUID 是字面四个字母）。**由用户决定要不要**：
#                                 界面跑完会问一次（默认「否」，不选就不生成文件）；
#                                 命令行模式默认导出，加 -NoIndex 关掉。
#                                 表内容永远是"重查一遍当前文件夹"的结果，不累加。
#                                 另：主窗体有「批量导出图片 GUID」按钮，只读导出，不导入也能用。
#   backup\<时间戳>\              更新模式替换前的原图备份（-NoBackup 关掉）
#
# 红线：不删、不移动。建的用 Add-IshDocumentObj/-IshFolder，改的只换内容（Set-IshDocumentObj）。
#
# 自动化/调试（三个都给了就跳过弹窗，便于无人值守）：
#   powershell.exe -File kc-import-images-ui.ps1 -IshUser u -IshPassword p `
#       -ImageDir "D:\png" -KcFolder "General\...\image" -Mode Update -Commit
#   不加 -Commit 只预检，一个字节都不写。
#   更新闸门万一全部 BLOCKED（服务端不给检出/状态字段），确认没检出后加 -IgnoreStateGate。
# ============================================================================

param(
    [string]$IshUser = '',
    [string]$IshPassword = '',
    [string]$ImageDir = '',
    [string]$KcFolder = '',
    [ValidateSet('Import', 'Update')]
    [string]$Mode = 'Import',
    [switch]$NoCreate,
    [switch]$NoBackup,
    [switch]$IgnoreStateGate,
    # 名称 / GUID 对照表：界面上跑完会问一次（默认不导出）；
    # 命令行（-ImageDir + -KcFolder，无人值守）默认导出，要关掉加 -NoIndex。
    [switch]$NoIndex,
    # 新建缺失目录时用的文件夹类型。默认必须是 ISHIllustration：
    # KC 只允许在 ISHIllustration 文件夹里建插图，往 type=ISHNone 的文件夹里建会报
    # [-129] InvalidDocTypeforFolder（2026-10-26 实测）。上一版这里写死 ISHNone，
    # 等于"自动创建目录"建出来的层永远装不了图，下一轮再进来照样 -129。
    [ValidateSet('ISHIllustration', 'ISHNone', 'ISHLibrary', 'ISHModule', 'ISHMasterDoc',
        'ISHTemplate', 'ISHPublication', 'ISHReference', 'ISHQuery')]
    [string]$FolderType = 'ISHIllustration',
    [int]$KeepLogs = 20,
    [switch]$Recurse,
    [switch]$IgnoreSslPolicyErrors,
    [switch]$NoAutoInstall,
    [switch]$Commit
)

$ErrorActionPreference = 'Stop'
$selfPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path $selfPath
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# 产物统一放 logs\ 子目录，脚本目录本身保持干净：
#   logs\kc-import-<时间戳>.txt   每轮一份 transcript，只留最近 $KeepLogs 份
#   logs\kc-import-ledger.csv     单一滚动台账，只追加"真正写入"的动作
$logDir = Join-Path $scriptDir 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logPath = Join-Path $logDir ("kc-import-$stamp.txt")
$ledgerPath = Join-Path $logDir 'kc-import-ledger.csv'

# 自动化模式判定放前面：后面的模块检查等早期步骤要用到
$headless = [bool]($ImageDir -and $KcFolder)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Log($m) {
    Write-Host $m
    Add-Content -Path $logPath -Value $m -Encoding UTF8
}
function Head($m) { Log ""; Log ("=" * 74); Log $m; Log ("=" * 74) }

# transcript 轮转：只留最近 N 份，免得 logs\ 越堆越多。$KeepLogs <= 0 表示不清理。
function Clear-OldKcLog([string]$dir, [int]$keep) {
    if ($keep -le 0) { return }
    $old = @(Get-ChildItem -LiteralPath $dir -File -Filter 'kc-import-*.txt' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $keep)
    foreach ($f in $old) {
        try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch { }
    }
    if ($old.Count -gt 0) { Log ("[..] 清理旧日志 {0} 份（保留最近 {1} 份）" -f $old.Count, $keep) }
}

function Get-Prop($obj, [string[]]$names) {
    foreach ($n in $names) {
        $p = $obj.PSObject.Properties[$n]
        if ($p -and $p.Value) { return $p.Value }
    }
    return $null
}

# 标题比对键：全角转半角（FormKC）+ 去掉所有空白 + 转小写。
# 只做"看起来就是同一个名字"的归一，绝不做模糊匹配 —— 图片名差一个字就是另一张图。
function Get-TitleKey([string]$t) {
    if (-not $t) { return '' }
    try { $s = $t.Normalize([System.Text.NormalizationForm]::FormKC) } catch { $s = $t }
    return ($s -replace '\s+', '').ToLowerInvariant()
}

function Get-FileSha([string]$path) {
    if (-not $path) { return '' }
    try { return (Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash } catch { return '' }
}

# Get-IshFolderContent 不是"一个对象一行"：同一个对象会按 **语言 × 分辨率** 各返回一行，
# 而这几行的 ObjectRef 完全相同（实测 2 个对象 6 行 = 每个对象 3 行）。
# 文档原话是 "returns an object for all the latest versions in all language and resolution"。
# 所以必须先按 ObjectRef 归组，再从组里挑**一行代表**去下载/替换。
# 挑法：分辨率 High 优先 → Low → Thumbnail，同档再看语言 zh-CN。
# 别用"先到先得"：组内顺序由服务端决定，之前侥幸拿到 High，那是运气不是保证 ——
# 万一取到 Thumbnail 那一行，回读比对永远对不上，甚至可能把缩略图当原图换掉。
# 分辨率取值只在这一处定义，四个调用点共用（rank / 归组 / 预检 / 对照表）。
# 有两个字段别搞混（2026-10-26 实测）：fresolution = 标签值 High，
# fresolution_lng_element = 元素名 VRESHIGH。**一律取标签值** —— Set-IshDocumentObj -Resolution 要它，
# KC 界面里的对象标识也写成 =High。中间的 _lng_value 只是给别的前端留的兜底（本环境不存在）。
function Get-KcResName($row) {
    return "$(Get-Prop $row @('fresolution', 'fresolution_lng_value', 'fresolution_lng_element'))"
}

function Get-KcRowRank($row) {
    $res = Get-KcResName $row
    $lng = "$(Get-Prop $row @('doclanguage', 'doclanguage_lng_value'))"
    $score = 0
    if ($res -match 'High') { $score += 8 }
    elseif ($res -match 'Low') { $score += 4 }
    elseif ($res -match 'Thumb') { $score += 1 }
    if ($lng -match 'zh[-_]?CN') { $score += 2 }
    return $score
}

# 按 ObjectRef 归组，返回 @{ ObjectRef; Row(代表行); Rows(原始组); ResCount(组内不同分辨率数) }
function Get-KcUniqueRows([object[]]$rows) {
    $groups = [ordered]@{}
    foreach ($row in $rows) {
        $oref = "$(Get-Prop $row @('ObjectRef'))"
        if (-not $oref) { continue }
        if (-not $groups.Contains($oref)) { $groups[$oref] = New-Object System.Collections.ArrayList }
        [void]$groups[$oref].Add($row)
    }
    $out = @()
    foreach ($k in @($groups.Keys)) {
        $grp = @($groups[$k])
        $best = $null; $bestScore = -1
        foreach ($r in $grp) {
            $s = Get-KcRowRank $r
            if ($s -gt $bestScore) { $best = $r; $bestScore = $s }
        }
        # 分辨率一律取标签值（见 Get-KcResName）：High / Low / Thumbnail
        $resSet = @($grp | ForEach-Object { Get-KcResName $_ } |
                Where-Object { $_ } | Select-Object -Unique)
        $out += [pscustomobject]@{
            ObjectRef = $k
            Row       = $best
            Rows      = $grp
            ResCount  = $resSet.Count
            ResList   = ($resSet -join '/')
        }
    }
    return $out
}

# 完整对象标识，形如 GUID-9126E781-...=1=zh-CN=High（KC 界面/下载文件名里的那个）
function Get-KcFullId($o) {
    if (-not $o) { return '' }
    $parts = @($o.IshRef, $o.Version, $o.Lng, $o.Resolution) | Where-Object { "$_".Trim() }
    return ($parts -join '=')
}

# 文件夹名 → 安全的文件名片段。
# KC 文件夹名里出现 & 空格 中文 很正常，也可能出现 \ / : * ? " < > |（手工建目录时）
# 或尾部点号 —— 这些在 Windows 文件名里要么非法要么会出怪事。
function Get-KcSafeFileName([string]$name) {
    $n = "$name".Trim()
    if (-not $n) { return 'folder' }
    $n = $n -replace '[\\/:*?"<>|\x00-\x1F]', '_'
    $n = $n -replace '\s+', ' '
    $n = $n.Trim().TrimEnd('.')
    if (-not $n) { return 'folder' }
    if ($n.Length -gt 60) { $n = $n.Substring(0, 60).Trim() }
    return $n
}

# 对照表文件名：<目标文件夹名称>_GUID_<导出时间>.csv
# 中间那段是**字面的 GUID 四个字母**，不是文件夹的 GUID 值 —— 用户 2026-10-26 明确要这个形式，
# 就是个固定标记，别再费劲去取文件夹 GUID（ISHRemote 8.2.1 也取不到自身 GUID，见 memory）。
function Get-KcIndexFileName([string]$folderName, [string]$stamp) {
    $safe = Get-KcSafeFileName $folderName
    $s = "$stamp".Trim()
    if (-not $s) { $s = Get-Date -Format 'yyyyMMdd-HHmmss' }
    return ('{0}_GUID_{1}.csv' -f $safe, $s)
}

# 导出某文件夹的「名称 / GUID 对照表」，写一个 CSV。
# STEP 7 与主窗体的「批量导出图片 GUID」按钮共用这一份实现 ——
# 两处各写一遍必然漂移（列名、High 优先、类型过滤都是踩过坑才定下来的）。
# 只读：只 Get-IshFolderContent + 写本地 csv，不碰 KC 任何东西。
# 返回 $null 表示没导出（没图/出错）；否则返回 pscustomobject 供调用方出话术。
function Export-KcImageIndex {
    param($ish, $folder, [string]$outDir)

    if (-not $folder) { return $null }
    if (-not $outDir) { $outDir = $logDir }
    if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    $rowsIdx = @(Get-IshFolderContent -IshSession $ish -FolderId $folder.IshFolderRef -ErrorAction Stop)
    # 一个对象按 语言 × 分辨率 返回多行，必须按 ObjectRef 归组，代表行取 High
    $grpIdx = @(Get-KcUniqueRows $rowsIdx)

    # 只要图片。IshType 拿得到就按 ISHIllustration 过滤；整批取不到就不过滤
    #（宁可多列，也不交一张空表）
    $nonImg = 0
    $typed = @($grpIdx | Where-Object { "$(Get-Prop $_.Row @('IshType', 'ishtype', 'objtype'))".Trim() })
    if ($typed.Count -gt 0) {
        $pickedG = @($grpIdx | Where-Object { "$(Get-Prop $_.Row @('IshType', 'ishtype', 'objtype'))" -eq 'ISHIllustration' })
        $nonImg = $grpIdx.Count - $pickedG.Count
    } else {
        $pickedG = $grpIdx
        if ($grpIdx.Count -gt 0) {
            Log '[!] 服务端没返回 IshType，无法区分类型，本次把文件夹内全部对象都列进表里'
        }
    }

    $pickedG = @($pickedG | Sort-Object { "$(Get-Prop $_.Row @('ftitle_logical_value', 'ftitle'))" })
    $multiIdx = @($pickedG | Where-Object { $_.ResCount -gt 1 }).Count

    $idxRows = @()
    $n = 0
    foreach ($g in $pickedG) {
        $n++
        $row = $g.Row
        $o = [pscustomobject]@{
            IshRef     = "$(Get-Prop $row @('IshRef'))"
            Version    = "$(Get-Prop $row @('version_version_value', 'version'))"
            Lng        = "$(Get-Prop $row @('doclanguage_lng_value', 'doclanguage'))"
            Resolution = (Get-KcResName $row)
        }
        $idxRows += [pscustomobject]@{
            '序号'       = $n
            '名称'       = "$(Get-Prop $row @('ftitle_logical_value', 'ftitle'))"
            'ObjectRef'  = $g.ObjectRef
            '逻辑ID'     = $o.IshRef
            '版本'       = $o.Version
            '语言'       = $o.Lng
            '分辨率'     = $o.Resolution
            '状态'       = "$(Get-Prop $row @('fstatus_lng_value', 'fstatus'))"
            '类型'       = "$(Get-Prop $row @('IshType', 'ishtype'))"
            # KC 界面/下载文件名里的那个完整标识：GUID-...=1=zh-CN=High
            '全标识'     = (Get-KcFullId $o)
            '可选分辨率' = $g.ResList
        }
    }

    $res = [pscustomobject]@{
        Path     = ''
        Rows     = $idxRows.Count
        Total    = $grpIdx.Count
        RawRows  = $rowsIdx.Count
        NonImg   = $nonImg
        MultiRes = $multiIdx
        Items    = $idxRows
    }
    if ($idxRows.Count -eq 0) { return $res }

    # 文件名：<目标文件夹名称>_GUID_<导出时间>.csv（GUID 是字面四个字母）
    # 导出时间取**此刻**而不是脚本启动时间 —— 一轮跑很久时启动时间已经不代表"导出时间"了。
    $stampOut = Get-Date -Format 'yyyyMMdd-HHmmss'
    $fileName = Get-KcIndexFileName "$($folder.name)" $stampOut
    $path = Join-Path $outDir $fileName
    $dup = 1
    while (Test-Path -LiteralPath $path) {
        $dup++
        $path = Join-Path $outDir ('{0}_{1}.csv' -f [IO.Path]::GetFileNameWithoutExtension($fileName), $dup)
    }
    $idxRows | Export-Csv -LiteralPath $path -NoTypeInformation -Encoding UTF8
    $res.Path = $path
    return $res
}

# 插图类型短名，日志里看着省地方
function Get-TypeShort([string]$t) {
    if (-not $t) { return '' }
    if ($t -match 'DIAGRAM') { return '框图' }
    if ($t -match 'SCREENSHOT') { return '截图' }
    return $t
}

# 更新闸门判定：返回 $null = 放行；返回字符串 = 阻塞原因。
# fail-closed 的正确写法是"**字段不存在** → 拦"，不是"值为空 → 拦" ——
# 实测（2026-10-26 探针）字段在、值全空，按空值拦会把所有更新永久拦死。
# 单独抽成函数是为了能跑单元测试：这是唯一"判断错就覆盖别人正在改的东西"的地方。
function Get-KcUpdateGateNote($kc) {
    if (-not $kc) { return $null }
    if (-not $kc.HasCheckout) { return '服务端未返回检出字段，无法确认是否被检出' }
    if ($kc.CheckedOut -and "$($kc.CheckedOut)".Trim()) { return ('已被 {0} 检出' -f $kc.CheckedOut) }
    if (-not $kc.HasStatus) { return '服务端未返回状态字段，无法确认是否为草稿' }
    if ($kc.Status -and $kc.Status -notmatch 'Draft|VSTATUSDRAFT') { return ('状态为 {0}，不是草稿' -f $kc.Status) }
    return $null
}

# 落点文件夹类型闸门（2026-10-26 实测）
# KC 只允许在 ISHIllustration 文件夹里创建插图，往 ISHNone 里建直接报
# [-129] InvalidDocTypeforFolder —— 那是"目标选错"，不是写入 bug，所以要在预检阶段拦。
# 返回 $null = 放行；返回字符串 = 拦下的原因。
# 注意空串（服务端没给类型）**放行**：拿不到证据就不该一刀切，且手打路径常常是对的，
# 真选错了执行时服务端还会再报一次 -129，不会静默写坏东西。
function Get-KcFolderTypeGate([string]$type) {
    $t = "$type".Trim()
    if (-not $t) { return $null }
    if ($t -eq 'ISHIllustration') { return $null }
    return ('文件夹类型是 {0}，KC 只允许在 ISHIllustration 里放插图' -f $t)
}

# 标题关键词 / 宽高比 → 插图类型
function Get-IllustrationType([string]$title, [string]$path) {
    if ($title -match '流程|示意|架构|结构|关系|框图|原理|拓扑|总线|对比') { return 'VILLUSTRATIONTYPEDIAGRAM' }
    $ratio = 0
    try {
        $img = [System.Drawing.Image]::FromFile($path)
        if ($img.Height -gt 0) { $ratio = [math]::Round($img.Width / $img.Height, 2) }
        $img.Dispose()
    } catch { }
    if ($ratio -ge 3.0) { return 'VILLUSTRATIONTYPEDIAGRAM' }
    return 'VILLUSTRATIONTYPESCREENSHOT'
}

# 从最深层往前试，返回能解析到的最深文件夹
# 规范化用户手打 / 粘贴进来的 KC 路径。
# 从 KC 界面、记事本、聊天窗口、资源管理器属性里拷来的路径常带脏东西：
#   引号（含中文引号）、正斜杠、首尾反斜杠、重复分隔符、BOM、零宽字符、不换行空格，
#   甚至前面还粘着一坨别的内容（"D:\spec\General\..."）。
# 这些在 Resolve 里不会报"格式错"，只会表现为"路径解析不到"，很难自查，所以统一在这里洗干净。
# 规则保守：只做清理和明显的纠错，不改写用户真实的层级名。
function Normalize-KcPath([string]$path) {
    $t = "$path"
    if (-not $t) { return '' }

    # BOM / 零宽字符 / 不换行空格：从网页或 Word 里复制几乎必带
    $t = $t -replace "[\uFEFF\u200B\u200C\u200D\u00A0]", ''

    # 首尾引号（含中文全角引号）：复制路径属性时常见 "D:\xxx" 这种
    $quoteChars = ('"' + "'" + [char]0x201C + [char]0x201D + [char]0x2018 + [char]0x2019).ToCharArray()
    $t = $t.Trim().Trim($quoteChars).Trim()

    # 正斜杠归一 + 压掉重复分隔符（\\ 一次有时是转义残留）
    $t = $t -replace '/', '\'
    $t = $t -replace '\\{2,}', '\'

    # 首尾反斜杠、首尾空格
    $t = $t.Trim('\').Trim()

    # 连前缀一起粘进来的（D:\xxx\General\Chinese\...）→ 从 General 开始截。
    # 只在 General 不在开头时才截，避免误伤正常的 General\... 路径。
    $idx = $t.IndexOf('general\', [System.StringComparison]::OrdinalIgnoreCase)
    if ($idx -gt 0) { $t = $t.Substring($idx) }

    # KC 根目录叫 General，用户小写成 general 也认
    if ($t -match '^(?i)general(\\|$)') { $t = 'General' + $t.Substring(7) }

    return $t
}

# 浏览窗「确定」到底该返回哪个路径 —— 这条规则曾经出过 bug，单独抽出来锁住：
# 用户单击选中 image、再点确定，旧版返回的是当前所在层（父级 whx），
# 于是"我明明选了 image，日志却只到 whx"。
#   $typed        路径框里的文本（可能被手改/粘贴过）
#   $statePath    当前列表对应的那一层
#   $leaf         已解析到的完整路径（路径框里可能有还不存在的尾部时，拼子层要用它）
#   $selectedName 列表里选中的子文件夹名（没选中传空）
# 规则：路径框被改过 → 一律以文本为准；没改过且有选中 → 选它；否则 → 当前层。
function Get-KcPickedPath([string]$typed, [string]$statePath, [string]$leaf, [string]$selectedName) {
    $t = Normalize-KcPath $typed
    if (-not $t) { return '' }
    if ($t -ne $statePath -or -not $selectedName) { return $t }
    $base = if ($leaf) { $leaf } else { $t }
    return ($base.TrimEnd('\') + '\' + $selectedName)
}

function Resolve-KcFolderPath($ish, [string]$path) {
    $segs = @($path -split '[\\/]' | Where-Object { $_ })
    for ($n = $segs.Count; $n -ge 1; $n--) {
        $try = (@($segs[0..($n - 1)]) -join '\')
        try {
            $f = Get-IshFolder -IshSession $ish -FolderPath $try -ErrorAction Stop
            return [pscustomobject]@{ Folder = $f; Segments = $segs; Found = $n; Leaf = $try }
        } catch { }
    }
    return [pscustomobject]@{ Folder = $null; Segments = $segs; Found = 0; Leaf = '' }
}

# ---------------------------------------------------------------- KC 目录浏览
# 列出某个 KC 文件夹的**直接**子文件夹。按 folderId 缓存，来回翻不重复打服务端。
# 2026-10-26 实测（kc-probe-folders-readonly，日志 logs\kc-probe-folders-20261026-110824.txt）：
#   -Depth 是**含自身**计数的，这是上一版浏览窗一片空白的真凶：
#     -Depth 1 → 只有自己（1 行），剔掉自身后 0 条 → 「没有子文件夹」
#     -Depth 2 → 自己 + 直接子文件夹（General 实测 1+6 = 7 行）★ 正确用法
#     -Depth 3 → 一路铺到孙子层，而且是**扁平**的，分不出谁是谁的孩子
#   另：Get-IshFolderContent 只列文档，对文件夹返回 0 行 —— 上一版那条"兜底"从来没可能生效，
#   留着只会制造"能浏览，但慢一点"这种假消息。删掉，取不到就如实说取不到。
$script:kcChildCache = @{}
function Get-KcChildFolders($ish, [string]$folderId) {
    $key = [string]$folderId
    if ($script:kcChildCache.ContainsKey($key)) { return $script:kcChildCache[$key] }

    $out = @()
    try {
        $all = @(Get-IshFolder -IshSession $ish -FolderId ([int64]$folderId) -Recurse -Depth 2 -ErrorAction Stop)
        $seen = @{}
        foreach ($f in $all) {
            $ref = "$(Get-Prop $f @('IshFolderRef'))"
            if (-not $ref -or $ref -eq $key) { continue }   # 结果里含自身，剔掉
            if ($seen.ContainsKey($ref)) { continue }
            $nm = "$(Get-Prop $f @('name', 'fname'))"
            if (-not $nm) { continue }
            $seen[$ref] = $true
            $out += [pscustomobject]@{ Name = $nm; Id = $ref; Type = "$(Get-Prop $f @('IshFolderType'))" }
        }
    } catch {
        Log ("    [!] 列子文件夹失败（Get-IshFolder -Depth 2）：{0}" -f $_.Exception.Message)
    }
    $out = @($out | Sort-Object Name)
    $script:kcChildCache[$key] = $out
    return $out
}

# 给 TextBox 挂右键菜单。Ctrl+V 本来就能用，但不是所有人都知道，
# 尤其从 KC 网页/文档里拷路径的人，第一反应是右键。
function Add-KcTextBoxMenu($tb) {
    $tb.ShortcutsEnabled = $true
    $cm = New-Object System.Windows.Forms.ContextMenuStrip
    $miCut = New-Object System.Windows.Forms.ToolStripMenuItem('剪切')
    $miCut.Add_Click({ $tb.Cut() })
    $miCopy = New-Object System.Windows.Forms.ToolStripMenuItem('复制')
    $miCopy.Add_Click({ $tb.Copy() })
    $miPaste = New-Object System.Windows.Forms.ToolStripMenuItem('粘贴')
    $miPaste.Add_Click({ $tb.Paste() })
    $miAll = New-Object System.Windows.Forms.ToolStripMenuItem('全选')
    $miAll.Add_Click({ $tb.SelectAll() })
    [void]$cm.Items.Add($miCut)
    [void]$cm.Items.Add($miCopy)
    [void]$cm.Items.Add($miPaste)
    [void]$cm.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void]$cm.Items.Add($miAll)
    $tb.ContextMenuStrip = $cm
    return $cm
}

# KC 目标文件夹浏览窗：逐层下钻 + 路径框可手打/粘贴。
# 返回选中的路径字符串；取消返回 $null。
function Show-KcFolderPicker {
    param($ish, [string]$startPath)

    # 状态放哈希表，避免嵌套脚本块读写局部变量时的作用域坑
    $state = @{ Path = ''; Children = @(); Leaf = '' }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = '选择 KC 目标文件夹'
    $form.ClientSize = New-Object System.Drawing.Size(624, 436)   # 用 ClientSize，省掉边框/标题栏的高度换算
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $lbPath = New-Object System.Windows.Forms.Label
    $lbPath.Text = '路径'
    $lbPath.SetBounds(18, 17, 50, 22)

    $tbPath = New-Object System.Windows.Forms.TextBox
    $tbPath.SetBounds(74, 14, 532, 24)
    Add-KcTextBoxMenu $tbPath | Out-Null

    $lbList = New-Object System.Windows.Forms.Label
    $lbList.Text = '子文件夹（双击进入）'
    $lbList.ForeColor = [System.Drawing.Color]::Gray
    $lbList.SetBounds(18, 48, 300, 20)

    $btnUp = New-Object System.Windows.Forms.Button
    $btnUp.Text = '▲ 上一级'
    $btnUp.SetBounds(18, 70, 86, 26)

    $btnRoot = New-Object System.Windows.Forms.Button
    $btnRoot.Text = '⟲ 回 General'
    $btnRoot.SetBounds(110, 70, 96, 26)

    $btnRefresh = New-Object System.Windows.Forms.Button
    $btnRefresh.Text = '刷新'
    $btnRefresh.SetBounds(212, 70, 76, 26)

    $lblStatus = New-Object System.Windows.Forms.Label
    $lblStatus.Text = ''
    $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
    $lblStatus.TextAlign = 'MiddleRight'
    $lblStatus.SetBounds(296, 73, 310, 20)

    $lst = New-Object System.Windows.Forms.ListBox
    $lst.SetBounds(18, 102, 588, 266)
    $lst.IntegralHeight = $false
    $lst.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $lblHint = New-Object System.Windows.Forms.Label
    $lblHint.Text = '双击进入下一层；选中某项后点「确定」就是选它。路径框可直接 Ctrl+V / 右键粘贴，引号、正斜杠会自动纠正。'
    $lblHint.ForeColor = [System.Drawing.Color]::Gray
    $lblHint.SetBounds(18, 376, 588, 20)

    $btnOK = New-Object System.Windows.Forms.Button
    $btnOK.Text = '确定'
    $btnOK.SetBounds(404, 398, 100, 28)
    $btnOK.DialogResult = [System.Windows.Forms.DialogResult]::None

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = '取消'
    $btnCancel.SetBounds(512, 398, 90, 28)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.AcceptButton = $btnOK
    $form.CancelButton = $btnCancel

    # 载入某个路径：解析到最深已存在层 → 列它的子文件夹
    function Set-KcPickPath([string]$p) {
        # 粘贴进来的路径可能带引号/正斜杠/BOM，先规范化，否则 Resolve 只会说"不存在"
        $p = Normalize-KcPath $p
        if (-not $p) { $p = 'General' }

        $state.Path = $p
        $tbPath.Text = $p
        $lst.Items.Clear()
        $lblStatus.Text = '读取中…'
        $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
        [System.Windows.Forms.Application]::DoEvents()

        $r = $null
        try { $r = Resolve-KcFolderPath $ish $p } catch { $r = $null }
        if (-not $r -or -not $r.Folder) {
            $state.Children = @()
            $lblStatus.Text = '这个路径在 KC 里不存在'
            $form.Cursor = [System.Windows.Forms.Cursors]::Default
            return
        }
        $state.Leaf = $r.Leaf
        $kids = @(Get-KcChildFolders $ish $r.Folder.IshFolderRef)
        $state.Children = $kids
        foreach ($k in $kids) {
            $tag = if ($k.Type -and $k.Type -notin @('ISHNone', 'ISHFOLDER')) { '   [' + $k.Type + ']' } else { '' }
            [void]$lst.Items.Add('  ' + $k.Name + $tag)
        }
        $tail = ''
        if ($r.Found -lt $r.Segments.Count) {
            $tail = '（后面 {0} 层还不存在，开始时会按需创建）' -f ($r.Segments.Count - $r.Found)
        }
        if ($kids.Count -eq 0) {
            $lblStatus.Text = '没有子文件夹' + $tail
        } else {
            $lblStatus.Text = ('{0} 个子文件夹{1}' -f $kids.Count, $tail)
        }
        $form.Cursor = [System.Windows.Forms.Cursors]::Default
        [System.Windows.Forms.Application]::DoEvents()
    }

    # 选中列表里的子文件夹时，把"这个会被选中"直接写在确定按钮上。
    # 旧版的坑：单击选中 image 再点确定，返回的是当前所在层（父级 whx），
    # 用户明明看着 image 是高亮的，落点却是父级 —— 现在按钮文案会告诉他选的是谁。
    $lst.Add_SelectedIndexChanged({
            $i = $lst.SelectedIndex
            if ($i -ge 0 -and $i -lt $state.Children.Count) {
                $btnOK.Text = '确定（选它）'
                $lblStatus.Text = '已选中：' + $state.Children[$i].Name + '（点确定即选这一层）'
            } else {
                $btnOK.Text = '确定'
            }
        })

    $lst.Add_DoubleClick({
            $i = $lst.SelectedIndex
            if ($i -lt 0 -or $i -ge $state.Children.Count) { return }
            $k = $state.Children[$i]
            $base = if ($state.Leaf) { $state.Leaf } else { $state.Path }
            Set-KcPickPath ($base.TrimEnd('\') + '\' + $k.Name)
        })
    $btnUp.Add_Click({
            $p = $state.Path.TrimEnd('\')
            $i = $p.LastIndexOf('\')
            if ($i -lt 0) { return }
            Set-KcPickPath $p.Substring(0, $i)
        })
    $btnRoot.Add_Click({ Set-KcPickPath 'General' })
    $btnRefresh.Add_Click({
            $script:kcChildCache = @{}
            Set-KcPickPath $state.Path
        })
    $btnOK.Add_Click({
            $i = $lst.SelectedIndex
            $selName = ''
            if ($i -ge 0 -and $i -lt $state.Children.Count) { $selName = $state.Children[$i].Name }
            $p = Get-KcPickedPath $tbPath.Text $state.Path $state.Leaf $selName
            if (-not $p) {
                [System.Windows.Forms.MessageBox]::Show('路径不能为空。', '提示', 'OK', 'Warning') | Out-Null
                return
            }
            $r = $null
            try { $r = Resolve-KcFolderPath $ish $p } catch { $r = $null }
            if (-not $r -or -not $r.Folder) {
                [System.Windows.Forms.MessageBox]::Show(("这个路径在 KC 里解析不到：`r`n$p`r`n`r`n以 General 开头，反斜杠分隔。"), '提示', 'OK', 'Warning') | Out-Null
                return
            }
            $state.Path = $p
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
        })

    $form.Controls.AddRange(@($lbPath, $tbPath, $lbList, $btnUp, $btnRoot, $btnRefresh, $lblStatus, $lst, $lblHint, $btnOK, $btnCancel))

    if (-not $startPath) { $startPath = 'General' }
    Set-KcPickPath $startPath

    $res = $form.ShowDialog()
    $out = $null
    if ($res -eq [System.Windows.Forms.DialogResult]::OK) { $out = $state.Path }
    $form.Dispose()
    return $out
}

$resValue = 'High'
$edtMap = @{
    'png' = 'EDTPNG'; 'jpg' = 'EDTJPEG'; 'jpeg' = 'EDTJPEG'; 'gif' = 'EDTGIF'
    'bmp' = 'EDTBMP'; 'tif' = 'EDTTIF';  'tiff' = 'EDTTIFF'; 'svg' = 'EDTSVG'
    'svgz' = 'EDTSVGZ'; 'eps' = 'EDTEPS'; 'wmf' = 'EDTWMF'; 'emf' = 'EDTEMF'
    'cgm' = 'EDTCGM'; 'psd' = 'EDTPSD'
}

# ---------------------------------------------------------------- 进度窗
$script:pf = $null
function Start-Progress([string]$title) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = $title
    $f.Size = New-Object System.Drawing.Size(520, 130)
    $f.StartPosition = 'CenterScreen'
    $f.FormBorderStyle = 'FixedDialog'
    $f.MaximizeBox = $false
    $f.MinimizeBox = $false
    $f.ControlBox = $false
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.AutoSize = $false
    $lbl.SetBounds(16, 14, 470, 40)
    $lbl.Text = '准备中…'
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.SetBounds(16, 58, 470, 20)
    $bar.Style = 'Marquee'
    $bar.MarqueeAnimationSpeed = 30
    $f.Controls.AddRange(@($lbl, $bar))
    $f.Show()
    $f.Refresh()
    $script:pf = @{ Form = $f; Label = $lbl }
    [System.Windows.Forms.Application]::DoEvents()
}
function Update-Progress([string]$text) {
    if (-not $script:pf) { return }
    $script:pf.Label.Text = $text
    $script:pf.Form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
}
function Stop-Progress {
    if (-not $script:pf) { return }
    $script:pf.Form.Close()
    $script:pf.Form.Dispose()
    $script:pf = $null
    [System.Windows.Forms.Application]::DoEvents()
}

# 统一出口：自动化模式下不弹窗（否则无人值守会卡在模态框）
function Show-Msg([string]$text, [string]$icon = 'Information') {
    if ($script:headless) { Log ("    [MSG] " + ($text -replace "`r`n", ' ')); return 'OK' }
    return [System.Windows.Forms.MessageBox]::Show($text, 'KC 批量导入图片', 'OK', $icon)
}

# ---------------------------------------------------------------- 顶层兜底
# $ErrorActionPreference = 'Stop' 下，任何一处没被 catch 的终止错误都会让脚本当场暴死。
# 而进度窗是独立窗口（ControlBox = $false，用户点不掉），脚本一死它就永远留在屏幕上；
# 台账、汇总、退出码也全都没有。所以在脚本作用域里挂一个 trap 统一收口：
# 关进度窗 → 写日志 → 清临时目录 → 弹一条能看懂的错 → 退出 1。
trap {
    $e = $_
    try { Stop-Progress } catch { }
    $chain = @()
    $ex = $e.Exception
    while ($ex) { $chain += ($ex.Message -replace "`r?`n", ' '); $ex = $ex.InnerException }
    $txt = ($chain -join ' <- ')
    try {
        Log ''
        Log '[X] 未捕获的异常，脚本已中止：'
        Log ('    ' + $txt)
        Log ('    位置：第 {0} 行' -f $e.InvocationInfo.ScriptLineNumber)
    } catch { }
    try {
        if ($tmpRoot -and (Test-Path -LiteralPath $tmpRoot)) {
            Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch { }
    try {
        Show-Msg ("脚本因未预期的错误中止，未完成的项请看日志。`r`n`r`n$txt`r`n`r`n日志：$logPath") 'Error' | Out-Null
    } catch { }
    exit 1
}

# ---------------------------------------------------------------- 输入窗
function Show-ImportForm {
    param($ish)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'KC 批量导入图片'
    $form.Size = New-Object System.Drawing.Size(620, 430)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $lb1 = New-Object System.Windows.Forms.Label
    $lb1.Text = '本地图片文件夹'
    $lb1.SetBounds(18, 16, 140, 22)
    $tb1 = New-Object System.Windows.Forms.TextBox
    $tb1.SetBounds(18, 40, 460, 24)
    $btn1 = New-Object System.Windows.Forms.Button
    $btn1.Text = '浏览…'
    $btn1.SetBounds(486, 39, 96, 26)

    $lb2 = New-Object System.Windows.Forms.Label
    $lb2.Text = 'KC 目标文件夹'
    $lb2.SetBounds(18, 74, 140, 22)
    $tb2 = New-Object System.Windows.Forms.TextBox
    $tb2.SetBounds(18, 98, 460, 24)
    Add-KcTextBoxMenu $tb2 | Out-Null
    $btn2 = New-Object System.Windows.Forms.Button
    $btn2.Text = '浏览…'
    $btn2.SetBounds(486, 97, 96, 26)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = '例：General\Chinese\手册\机器视觉\9 测试&练习专用\测试\whx\image（反斜杠，无前导符号；也可在框内直接 Ctrl+V）'
    $hint.ForeColor = [System.Drawing.Color]::Gray
    $hint.SetBounds(18, 126, 564, 36)

    $chk = New-Object System.Windows.Forms.CheckBox
    $chk.Text = '包含子文件夹'
    $chk.SetBounds(18, 166, 140, 24)

    $chk2 = New-Object System.Windows.Forms.CheckBox
    $chk2.Text = '缺失的 KC 目录自动创建'
    $chk2.Checked = $true
    $chk2.SetBounds(170, 166, 220, 24)

    # ---- 操作模式 ----
    $grp = New-Object System.Windows.Forms.GroupBox
    $grp.Text = '操作模式'
    $grp.SetBounds(18, 196, 564, 108)

    $rb1 = New-Object System.Windows.Forms.RadioButton
    $rb1.Text = '新增导入 —— 只补 KC 里没有的图，同名一律跳过'
    $rb1.SetBounds(14, 18, 520, 22)
    $rb1.Checked = $true

    $rb2 = New-Object System.Windows.Forms.RadioButton
    $rb2.Text = '更新已有 —— 同名图把内容换成本地图（对象不重建，引用不断）'
    $rb2.SetBounds(14, 40, 520, 22)

    $cbNoCreate = New-Object System.Windows.Forms.CheckBox
    $cbNoCreate.Text = '只替换，不新建 KC 里缺失的图'
    $cbNoCreate.SetBounds(34, 62, 400, 22)
    $cbNoCreate.Enabled = $false

    $grp.Controls.AddRange(@($rb1, $rb2, $cbNoCreate))

    # 独立于导入/更新：纯只读导出，选个 KC 文件夹就能出一份名称 / GUID 对照表，
    # 不需要填本地图片目录、也不写 KC 任何东西。
    $btnExport = New-Object System.Windows.Forms.Button
    $btnExport.Text = '批量导出图片 GUID'
    $btnExport.SetBounds(18, 320, 200, 30)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = '开始导入'
    $ok.SetBounds(330, 320, 120, 30)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = '取消'
    $cancel.SetBounds(462, 320, 120, 30)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.AcceptButton = $ok
    $form.CancelButton = $cancel

    $btn1.Add_Click({
            $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
            $dlg.Description = '选择本地图片所在文件夹'
            if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $tb1.Text = $dlg.SelectedPath }
        })
    $btnExport.Add_Click({
            # 起点用路径框里已有的内容（没有就 General），浏览窗本身也支持粘贴
            $start = Normalize-KcPath $tb2.Text
            if (-not $start) { $start = 'General' }
            $sel = Show-KcFolderPicker $ish $start
            if (-not $sel) { return }

            $r = $null
            try { $r = Resolve-KcFolderPath $ish $sel } catch { $r = $null }
            if (-not $r -or -not $r.Folder) {
                [System.Windows.Forms.MessageBox]::Show("路径在 KC 里解析不到：`r`n$sel", '导出图片 GUID', 'OK', 'Warning') | Out-Null
                return
            }
            try {
                $ex = Export-KcImageIndex $ish $r.Folder $logDir
                if (-not $ex -or $ex.Rows -eq 0) {
                    $t = if ($ex) { "该文件夹 {0} 个对象里没有图片。" -f $ex.Total } else { '没有可导出的对象。' }
                    [System.Windows.Forms.MessageBox]::Show(("$t`r`n`r`n文件夹：{0}" -f $sel), '导出图片 GUID', 'OK', 'Information') | Out-Null
                    return
                }
                $short = $ex.Path
                if ($short.Length -gt 90) { $short = '…' + $short.Substring($short.Length - 88) }
                [System.Windows.Forms.MessageBox]::Show(
                    ("已导出 $($ex.Rows) 条。`r`n`r`n文件夹：$($r.Folder.name)`r`n文件：$short"),
                    '导出完成', 'OK', 'Information') | Out-Null
                # 顺手回填到路径框，接着导入/更新时不用再选一次
                $tb2.Text = $sel
            } catch {
                [System.Windows.Forms.MessageBox]::Show("导出失败：`r`n$($_.Exception.Message)", '导出图片 GUID', 'OK', 'Error') | Out-Null
            }
        })
    $btn2.Add_Click({
            $sel = Show-KcFolderPicker $ish $tb2.Text
            if ($sel) { $tb2.Text = $sel }
        })
    $rb1.Add_CheckedChanged({
            $ok.Text = '开始导入'
            $cbNoCreate.Enabled = $false
            $cbNoCreate.Checked = $false
        })
    $rb2.Add_CheckedChanged({
            $ok.Text = '开始更新'
            $cbNoCreate.Enabled = $true
        })

    $form.Controls.AddRange(@($lb1, $tb1, $btn1, $lb2, $tb2, $btn2, $hint, $chk, $chk2, $grp, $btnExport, $ok, $cancel))

    while ($true) {
        $r = $form.ShowDialog()
        if ($r -ne [System.Windows.Forms.DialogResult]::OK) { $form.Dispose(); return $null }
        if (-not $tb1.Text.Trim() -or -not (Test-Path -LiteralPath $tb1.Text.Trim())) {
            [System.Windows.Forms.MessageBox]::Show('本地图片文件夹不存在，请重新选择。', '提示', 'OK', 'Warning') | Out-Null
            continue
        }
        if (-not (Normalize-KcPath $tb2.Text)) {
            [System.Windows.Forms.MessageBox]::Show('KC 目标文件夹不能为空。', '提示', 'OK', 'Warning') | Out-Null
            continue
        }
        $res = @{
            ImageDir     = $tb1.Text.Trim()
            KcFolder     = (Normalize-KcPath $tb2.Text)
            Recurse      = [bool]$chk.Checked
            CreateFolder = [bool]$chk2.Checked
            Mode         = $(if ($rb2.Checked) { 'Update' } else { 'Import' })
            NoCreate     = [bool]$cbNoCreate.Checked
            FolderType   = $FolderType
        }
        $form.Dispose()
        return $res
    }
}

# ---------------------------------------------------------------- 依赖检查
# 显式加载 ISHRemote。不能指望"首次使用自动加载"——那要求模块在本机 PSModulePath 里，
# 同事机器没装时只会得到一句「无法将 New-IshSession 项识别为 cmdlet」。
function Ensure-KcModule {
    $installErr = $null
    $showPg = -not $script:headless
    $loaded = @(Get-Module -Name ISHRemote)
    if ($loaded.Count -gt 0) {
        Log ("[OK] ISHRemote 已加载：{0}" -f $loaded[0].Version)
        return
    }
    $avail = @(Get-Module -ListAvailable -Name ISHRemote | Sort-Object Version -Descending)
    if ($avail.Count -gt 0) {
        try {
            Import-Module ISHRemote -ErrorAction Stop
            Log ("[OK] ISHRemote 已加载：{0}（{1}）" -f $avail[0].Version, $avail[0].ModuleBase)
            return
        } catch {
            Log ("[X] ISHRemote 加载失败：{0}" -f $_.Exception.Message)
            # 双击启动时控制台一闪就没，Write-Host 等于没提示 —— 走统一出口
            Show-Msg ("加载 ISHRemote 失败：`r`n{0}`r`n`r`n日志：{1}" -f $_.Exception.Message, $logPath) 'Error' | Out-Null
            exit 1
        }
    }

    # ---- 本机没有：自动从 PowerShell Gallery 安装 ----
    if ($NoAutoInstall) {
        Log '[..] 已指定 -NoAutoInstall，跳过自动安装'
        $installErr = $null
    } else {
        Log '[..] 本机未找到 ISHRemote，尝试自动安装（需能访问 PowerShell Gallery）'
        # 无界面模式（-ImageDir/-KcFolder 已给）不弹进度窗，免得干扰无人值守
        if ($showPg) {
            Start-Progress 'KC 批量导入图片'
            Update-Progress '正在安装依赖 ISHRemote（首次约十几秒）…'
        }
        $installErr = $null
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            if (Get-Command Install-Module -ErrorAction SilentlyContinue) {
                if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
                    Log '[..] 安装 NuGet 包提供程序…'
                    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue | Out-Null
                }
                # 不再改 PSGallery 的 InstallationPolicy：
                # Install-Module -Force 本来就跳过「是否信任该存储库」的确认，
                # 这行只是把"信任"永久写进同事机器的全局设置，副作用白留。
                Log '[..] Install-Module -Name ISHRemote -Scope CurrentUser -Force'
                Install-Module -Name ISHRemote -Scope CurrentUser -Force -ErrorAction Stop
            } elseif (Get-Command Install-PSResource -ErrorAction SilentlyContinue) {
                Log '[..] Install-PSResource -Name ISHRemote -Scope CurrentUser'
                Install-PSResource -Name ISHRemote -Scope CurrentUser -TrustRepository -ErrorAction Stop
            } else {
                throw '本机没有 Install-Module / Install-PSResource，无法自动安装'
            }
        } catch {
            $installErr = $_
            Log ("[X] 自动安装失败：{0}" -f $_.Exception.Message)
        }
        if ($showPg) { Stop-Progress }
    }

    # 装完可能不在本会话的模块缓存里，直接按 CurrentUser 路径再试一次
    # （PS 5.1 是 Documents\WindowsPowerShell\Modules，PS 7 是 Documents\PowerShell\Modules）
    $myDocs = [Environment]::GetFolderPath('MyDocuments')
    $candPaths = @(
        (Join-Path $myDocs 'WindowsPowerShell\Modules\ISHRemote'),
        (Join-Path $myDocs 'PowerShell\Modules\ISHRemote')
    )
    $localPath = $candPaths[0]
    $ok = $false
    foreach ($cp in $candPaths) {
        if ($ok) { continue }
        if (-not (Test-Path -LiteralPath $cp)) { continue }
        try {
            Import-Module $cp -ErrorAction Stop
            $ok = $true
            $localPath = $cp
        } catch {
            Log ("[X] 从 {0} 加载失败：{1}" -f $cp, $_.Exception.Message)
        }
    }
    if (-not $ok) {
        try { Import-Module ISHRemote -ErrorAction Stop; $ok = $true } catch { }
    }
    if ($ok) {
        $v = (@(Get-Module -Name ISHRemote) | Select-Object -First 1).Version
        if (-not $v) { $v = '版本未知' }
        Log ("[OK] ISHRemote 已加载：{0}（{1}）" -f $v, $localPath)
        Log '[..] 首次运行会多花十几秒，之后直接复用'
        return
    }
    # ---- 安装也失败：给出可离线照做的方案 ----
    $paths = (@($env:PSModulePath -split ';' | Where-Object { $_ }) -join "`r`n    ")
    $reason = if ($installErr) { "   原因：$($installErr.Exception.Message)" } else { '   原因：已用 -NoAutoInstall 跳过自动安装' }
    $msg = @"
ISHRemote 模块未就绪，无法连接 KC。
$reason

当前环境：PowerShell $($PSVersionTable.PSVersion)（$($PSVersionTable.PSEdition)）
模块搜索路径：
    $paths

手动解决（任选）：
1) 离线复制（内网最稳）
   从已装好的同事机器拷整个目录：
     C:\Users\<他>\Documents\WindowsPowerShell\Modules\ISHRemote
   放到本机同名位置：
     $($candPaths[0])
2) 能连 Gallery 时手动装（管理员可加 -Scope AllUsers 给全机器装）
   Install-Module ISHRemote -Scope CurrentUser -Force
3) 内网连不上 Gallery：说明自动下载走不通，按第 1 条离线复制即可，
   以后加 -NoAutoInstall 直接跳过这段检测
4) 确认用 64 位 Windows PowerShell（powershell.exe, 5.1），不是 PowerShell 7 / ISE 的 32 位
"@
    if ($showPg) { Stop-Progress }
    Log '[X] 依赖未能就绪，终止'
    Log $msg
    # 同上：双击启动没有控制台可看，必须弹窗
    Show-Msg $msg 'Error' | Out-Null
    exit 1
}

Ensure-KcModule

# ---------------------------------------------------------------- 自审（AST）
$allow = @(
    'New-IshSession', 'Get-IshVersion', 'Get-IshFolder', 'Add-IshFolder', 'Get-IshFolderContent',
    'Find-IshDocumentObj',
    'Set-IshMetadataField', 'Set-IshMetadataFilterField', 'Set-IshRequestedMetadataField',
    'Add-IshDocumentObj',
    'Set-IshDocumentObj', 'Get-IshDocumentObjData'
)
$tok = $null; $parseErr = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($selfPath, [ref]$tok, [ref]$parseErr)
$called = @(
    $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) |
        ForEach-Object { $_.GetCommandName() } |
        Where-Object { $_ -and $_ -match '-Ish' } |
        ForEach-Object { ($_ -split '\\')[-1] } |
        Sort-Object -Unique
)
$notAllowed = @($called | Where-Object { $allow -notcontains $_ })
if ($notAllowed.Count -gt 0) {
    Write-Host ("ABORT: 未授权 cmdlet: " + ($notAllowed -join ', ')) -ForegroundColor Red
    Write-Host ("       本次实际调用: " + ($called -join ', ')) -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Head ("KC 批量导入图片  @ " + (Get-Date -Format o))
Log ("[OK] 自审通过（AST）：调用 {0} 个 -> {1}" -f $called.Count, ($called -join ', '))

# ---------------------------------------------------------------- 登录辅助
# 证书放行有几处坑，别踩回去：
#  1) 不能用 scriptblock 当证书回调：异步 HTTP 在校验证书时跑在线程池线程上，
#     PowerShell 会抛「此线程中没有可用于运行脚本的运行空间」，
#     结果把「证书不受信任」变成一句莫名其妙的 runspace 报错。必须用编译好的 C# 委托。
#  2) 光靠 ISHRemote 的 -IgnoreSslPolicyErrors 不够：那个开关只往
#     ServicePointManager 挂回调（日志里 "Applying certificate validation overwrite
#     for the AppDomain" 就是它），而它内部 HttpClientHandler 在部分 .NET 版本上
#     不采纳全局回调，于是照样按默认校验拒掉。
#  3) 还得把 SecurityProtocol 钉上 Tls12：PS 5.1 可能只留 Ssl3|Tls，服务端直接断。
$script:kcTlsReady = $false
function Enable-KcLooseTls {
    if (-not ('KcTlsBypass' -as [type])) {
        $cs = @'
using System;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

public static class KcTlsBypass
{
    public static string LastSubject = "";
    public static string LastIssuer = "";
    public static string LastErrors = "";
    public static bool Installed = false;

    public static void Install()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        ServicePointManager.ServerCertificateValidationCallback = Validate;
        Installed = true;
    }

    public static string Report()
    {
        if (!Installed) { return "未安装"; }
        return "subject=" + LastSubject + " issuer=" + LastIssuer + " sslErrors=" + LastErrors;
    }

    private static bool Validate(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors)
    {
        try
        {
            if (cert != null) { LastSubject = cert.Subject; LastIssuer = cert.Issuer; }
            LastErrors = errors.ToString();
        }
        catch { }
        return true;
    }
}
'@
        try {
            Add-Type -TypeDefinition $cs -Language CSharp -ErrorAction Stop
        } catch {
            Log ("[!] 编译证书放行组件失败：{0}" -f $_.Exception.Message)
            return
        }
    }
    try {
        [KcTlsBypass]::Install()
        $script:kcTlsReady = $true
        Log '[..] 已放行证书校验（Tls12 + C# 委托回调）'
    } catch {
        Log ("[!] 安装证书放行回调失败：{0}" -f $_.Exception.Message)
    }
}

# 完整打错误链，别只留一句 Exception.Message
function Write-KcErr([string]$label, $err) {
    Log ("[X] {0} 失败" -f $label)
    if (-not $err) { return }
    $e = $err.Exception
    $d = 0
    while ($e -and $d -lt 4) {
        Log ("       ├ {0}: {1}" -f $e.GetType().Name, ($e.Message -replace "`r?`n", ' '))
        $e = $e.InnerException
        $d++
    }
}

# 只读证书探针：单独开一条 TLS 连接看服务端证书链，不发任何账号信息。
# 目的是把「缺的是哪个 CA」直接写进日志，而不是只丢一句「证书无效」。
function Get-KcCertDiag {
    # 主机名跟着 -WsBaseUrl 走，别写死：换域名/测试环境时这里最容易忘记改
    $h = 'kc-prod.hikvision.com'
    try { if ($wsUrl) { $h = ([uri]$wsUrl).Host } } catch { }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('---- 证书诊断（只读，不含账号信息）----')
    $tcp = $null
    $ssl = $null
    $script:kcCert = $null
    try {
        $tcp = New-Object Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($h, 443, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(5000)) { throw "连接 $h`:443 超时（可能被防火墙/代理拦了）" }
        $tcp.EndConnect($iar)

        $cb = [Net.Security.RemoteCertificateValidationCallback] {
            param($snd, $cert, $chain, $errs)
            $st = ''
            try { $st = (@($chain.ChainStatus) | ForEach-Object { ($_.StatusInformation -replace '\s+', ' ').Trim() }) -join ' / ' } catch { }
            $script:kcCert = [pscustomobject]@{
                Errors   = [string]$errs
                Subject  = $cert.Subject
                Issuer   = $cert.Issuer
                Thumb    = $cert.Thumbprint
                NotAfter = $cert.GetExpirationDateString()
                Chain    = $st
            }
            return $true
        }
        $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, $cb)
        $ssl.AuthenticateAsClient($h)

        $c = $script:kcCert
        if ($c) {
            [void]$sb.AppendLine("  服务端证书主题 : $($c.Subject)")
            [void]$sb.AppendLine("  颁发者         : $($c.Issuer)")
            [void]$sb.AppendLine("  指纹 SHA1      : $($c.Thumb)")
            [void]$sb.AppendLine("  有效期至       : $($c.NotAfter)")
            [void]$sb.AppendLine("  默认校验结论   : $(if ($c.Errors) { $c.Errors } else { 'None（证书本身有效）' })")
            [void]$sb.AppendLine("  链状态         : $(if ($c.Chain) { $c.Chain } else { '无异常' })")
            if ($c.Errors -match 'ChainErrors') {
                [void]$sb.AppendLine('  => 本机缺根证书/中间证书。把上面「颁发者」这个 CA 装进「受信任的根证书颁发机构」即可根治')
            } elseif ($c.Errors -match 'NameMismatch') {
                [void]$sb.AppendLine("  => 证书域名与 $h 不匹配，需找 KC 管理员确认入口地址")
            } elseif ($c.Errors -match 'None') {
                [void]$sb.AppendLine('  => 证书链本身没问题，说明失败原因不在证书，看上面的错误链（大概率是网络/代理/账号）')
            }
        } else {
            [void]$sb.AppendLine('  （握手成功但未取到证书对象）')
        }
    } catch {
        [void]$sb.AppendLine("  探针失败：$($_.Exception.Message)")
    } finally {
        if ($ssl) { try { $ssl.Dispose() } catch { } }
        if ($tcp) { try { $tcp.Close() } catch { } }
    }
    # 真实登录请求里回调记录下来的东西，比独立探针更能说明问题：
    # sslErrors 为空且请求仍失败 => 证书这关已经过了，问题在网络/代理/账号
    try {
        if ('KcTlsBypass' -as [type]) {
            [void]$sb.AppendLine("  登录时回调记录 : $([KcTlsBypass]::Report())")
        }
    } catch { }
    return $sb.ToString().TrimEnd()
}

# ---------------------------------------------------------------- STEP 1 登录
if ($headless) {
    Log '[..] 命令行已给全参数，跳过弹窗（自动化模式）'
    $p = @{ ImageDir = $ImageDir; KcFolder = (Normalize-KcPath $KcFolder); Recurse = [bool]$Recurse; CreateFolder = $true; FolderType = $FolderType }
} else {
    $p = $null
}
if ($IshUser -and $IshPassword) {
    $sec = ConvertTo-SecureString $IshPassword -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($IshUser, $sec)
} else {
    $cred = Get-Credential -Message '请输入 KC 账号和密码'
    if (-not $cred) { exit 0 }
}

Head 'STEP 1  登录 KC'

# 登录失败分两类，处理方式完全不同：
#   TLS/证书 类  → 降级重连有意义（换一种放行方式再试）
#   账号密码/网络 → 降级重连毫无意义，而且**每试一次就多提交一次错误凭据**，
#                   域账号策略通常 5 次就锁，锁了要找 IT 解 —— 必须立刻停。
# 上一版是无条件降三级：密码打错一次，这一轮就提交 3 次。附带两个毛病一起解决：
#   ① 第 2 级起全进程不校验证书，而密码正走在这条连接上；
#   ② 证书诊断不管什么原因都跑，密码错的时候刷一屏证书信息，纯误导。
function Get-KcErrText($err) {
    if (-not $err) { return '' }
    $all = @()
    $e = $err.Exception
    $d = 0
    while ($e -and $d -lt 5) { $all += ('{0} {1}' -f $e.GetType().Name, $e.Message); $e = $e.InnerException; $d++ }
    try { if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $all += $err.ErrorDetails.Message } } catch { }
    return ($all -join ' ')
}

function Test-KcTlsError($err) {
    $txt = Get-KcErrText $err
    if (-not $txt) { return $false }
    return [bool]($txt -match 'AuthenticationException|SslStream|SSL|TLS|secure channel|基础连接已经关闭|证书|信任关系|trust relationship')
}

function Test-KcAuthError($err) {
    $txt = Get-KcErrText $err
    if (-not $txt) { return $false }
    return [bool]($txt -match '401|Unauthorized|unauthorized|未授权|凭据|凭证|密码|password|credential|logon|登录失败|Logon failure|Access is denied|拒绝访问')
}

# 三级降级，每级失败都把完整错误链写进日志。
# 上一版第 2 级用 `catch { $ish = $null }` 把异常吞了，结果只显示第 1 级的
# 「发送请求时出错」，白丢一次定位机会 —— 别再这么写。
$wsUrl = 'https://kc-prod.hikvision.com/ISHWS/'
$ish = $null
$lastErr = $null
$win = $null
$authFailed = $false
$unknownTries = 0
$tried = New-Object System.Collections.ArrayList

$ladder = @(
    @{ Label = '第 1 级 标准校验登录';                         Loose = $false; Flag = $false },
    @{ Label = '第 2 级 自己放行证书校验重连';                 Loose = $true;  Flag = $false },
    @{ Label = '第 3 级 自己放行 + ISHRemote 证书开关重连';    Loose = $true;  Flag = $true }
)
if ($IgnoreSslPolicyErrors) {
    Log '[..] 已指定 -IgnoreSslPolicyErrors：跳过第 1 级，直接从降级开始'
    $ladder = @($ladder[1], $ladder[2])
}

foreach ($step in $ladder) {
    if ($step.Loose) { Enable-KcLooseTls }
    Log ("[..] {0}…" -f $step.Label)
    $caught = $null
    try {
        if ($step.Flag) {
            $ish = New-IshSession -WsBaseUrl $wsUrl -PSCredential $cred -IgnoreSslPolicyErrors -ErrorAction Stop
        } else {
            $ish = New-IshSession -WsBaseUrl $wsUrl -PSCredential $cred -ErrorAction Stop
        }
    } catch {
        $ish = $null
        $caught = $_
        $lastErr = $_
        [void]$tried.Add($step.Label)
        Write-KcErr $step.Label $_
        try {
            if ('KcTlsBypass' -as [type]) { Log ("       └ 回调记录: {0}" -f [KcTlsBypass]::Report()) }
        } catch { }
    }
    if ($ish) { $win = $step; break }

    # 只有"证书/TLS 谈不拢"才值得换一种连法再试；
    # 账号类错误立刻停（每多试一次就多提交一次错误凭据，域策略 5 次就锁）；
    # 说不清的错只再给一次机会 —— 既不至于因为一条被包装过的报错把降级路径全丢掉，
    # 也不会出现"密码错还连撞 3 次"。
    if (Test-KcAuthError $caught) {
        $authFailed = $true
        Log '[..] 判定：账号或密码不正确 —— 停止降级重试（不再重复提交凭据）'
        break
    }
    if (Test-KcTlsError $caught) {
        Log '[..] 判定：证书/TLS 校验没谈拢，继续降级'
        continue
    }
    if ($unknownTries -ge 1) {
        Log '[..] 判定：既不像证书问题也不像账号问题，已多试过一次，停止'
        break
    }
    $unknownTries++
    Log '[..] 判定：错误说不清，再换一种连法试一次'
}

if ($ish) {
    if ($win.Loose) {
        Log ("[!] 是靠放行证书校验才连上的（{0}）" -f $win.Label)
        Log '[!] 说明本机不信任 KC 的证书 —— 本次会话不校验，仅限内网可信环境'
        Log '[..] 根治办法见下方证书诊断里的「颁发者」'
        $diagTxt = Get-KcCertDiag
        Log $diagTxt
    }
    Log ("[OK] 登录成功：{0} / 账号 {1}" -f (Get-IshVersion -IshSession $ish), $cred.UserName)
} else {
    $msg = if ($lastErr) { $lastErr.Exception.Message } else { '未知错误' }
    Log ("[X] 登录失败：{0}" -f $msg)
    Log ("[X] 试过：{0}" -f ($tried -join ' / '))
    # 证书诊断只在真是 TLS 问题时跑；密码错还刷一屏证书信息只会带偏方向
    $diagTxt = ''
    if (Test-KcTlsError $lastErr) {
        $diagTxt = Get-KcCertDiag
        Log $diagTxt
    } else {
        Log '[..] 不是证书/TLS 问题，跳过证书诊断'
    }
    if (-not $headless) {
        $hint = if ($authFailed) { "`r`n先确认账号密码（已主动停止降级重试，不会把账号撞锁）。" } else { '' }
        $brief = @"
登录失败：$msg$hint

试过的连法（$($tried.Count) 种）：
  $(($tried) -join "`r`n  ")

$diagTxt

完整日志：$logPath
"@
        Show-Msg $brief.Trim() 'Error' | Out-Null
    }
    exit 1
}

# 登录成功后才问路径
if (-not $headless) {
    $p = Show-ImportForm $ish
    if (-not $p) { Log '[..] 用户取消，未执行任何写入'; exit 0 }
    # 弹窗里选的模式覆盖命令行默认值
    $Mode = $p.Mode
    $NoCreate = [bool]$p.NoCreate
    # 这里不再直接置 $Commit —— 预检跑完还要用户确认一次才写
}
Log ("[..] 操作模式：{0}{1}" -f $Mode, $(if ($Mode -eq 'Update' -and $NoCreate) { '（只替换，不新建）' } else { '' }))

# 作者值取的是**用户名**，不是域：
# 上一版 'DOMAIN\user' -split '[\\@]' 取 [0]，拿到的是 DOMAIN（'a\b' 先按 \ 切，第一段就是域名）。
# 正确取法：含 \ 取末段，含 @ 取首段，都没有就用原样。
$uRaw = "$($cred.UserName)".Trim()
if ($uRaw -match '\\') {
    $uName = ($uRaw -split '\\')[-1]
} elseif ($uRaw -match '@') {
    $uName = ($uRaw -split '@')[0]
} else {
    $uName = $uRaw
}
$myAuthorElem = 'VUSER' + ($uName -replace '[^A-Za-z0-9]', '').ToUpper()

# ---------------------------------------------------------------- STEP 2 收集
Head 'STEP 2  收集图片'

$extList = @($edtMap.Keys)
$files = @(
    Get-ChildItem -LiteralPath $p.ImageDir -File -Recurse:([bool]$p.Recurse) |
        Where-Object { $extList -contains $_.Extension.TrimStart('.').ToLower() } |
        Sort-Object FullName
)
Log ("[OK] 图片目录：{0}" -f $p.ImageDir)
Log ("[OK] 命中 {0} 张（扩展名：{1}）" -f $files.Count, (($extList | Sort-Object) -join ', '))
if ($files.Count -eq 0) {
    Stop-Progress
    Show-Msg '该文件夹下没有找到可导入的图片。' | Out-Null
    Log '[..] 无可导入文件，结束'
    exit 0
}

$rootFull = (Resolve-Path -LiteralPath $p.ImageDir).Path.TrimEnd('\', '/')
$plan = @()
foreach ($f in $files) {
    $title = [IO.Path]::GetFileNameWithoutExtension($f.Name).Trim()
    if ($p.Recurse) {
        $rel = $f.FullName.Substring($rootFull.Length).TrimStart('\', '/')
        if ($f.Extension) { $rel = $rel.Substring(0, $rel.Length - $f.Extension.Length) }
        $title = ($rel -replace '[\\/]', ' - ').Trim()
    }
    $ext = $f.Extension.TrimStart('.').ToLower()
    $plan += [pscustomobject]@{
        File      = $f.FullName
        Name      = $f.Name
        SizeKB    = [math]::Round($f.Length / 1KB, 1)
        Title     = $title
        Key       = (Get-TitleKey $title)
        Edt       = $(if ($edtMap.ContainsKey($ext)) { $edtMap[$ext] } else { '' })
        Type      = Get-IllustrationType $title $f.FullName
        Sha       = ''
        State     = ''
        Note      = ''
        IshRef    = ''
        ObjectRef = ''
        KcObj     = $null
        KcSize    = 0
        KcSha     = ''
        KcFile    = ''
        Backup    = ''
        Exec      = $false
    }
}

# 批次内自查
# 重名判定必须和"跟 KC 比对"用同一把尺子（Key），否则 "图 1.png" 和 "图1.png"
# 会被当成两张不同的图放行，到了 Update 模式又匹配到同一个 KC 对象，
# 于是同一张图被替换两次。
foreach ($x in $plan) {
    if (-not $x.Title) {
        $x.State = 'FAILED'; $x.Note = '标题为空'
    } elseif (-not $x.Edt) {
        $x.State = 'FAILED'; $x.Note = '后缀没有对应 EDT'
    } elseif ($x.Key -and @($plan | Where-Object { $_.Key -eq $x.Key }).Count -gt 1) {
        $x.State = 'FAILED'; $x.Note = '批次内重名（勾选"包含子文件夹"可带目录前缀）'
    }
}
if (@($plan | Where-Object { $_.State -eq 'FAILED' }).Count -gt 0) {
    Log '[!] 批次内有问题条目：'
    $plan | Where-Object { $_.State -eq 'FAILED' } | ForEach-Object { Log ("    {0}  —— {1}" -f $_.Name, $_.Note) }
}

# ---------------------------------------------------------------- STEP 3 落点
Head 'STEP 3  解析 KC 目标文件夹'

$folder = $null
$r = Resolve-KcFolderPath $ish $p.KcFolder
if ($r.Found -gt 0) {
    Log ("[OK] 最深已存在：{0}（{1}/{2} 层）FolderId={3} type={4}" -f $r.Leaf, $r.Found, $r.Segments.Count, $r.Folder.IshFolderRef, $r.Folder.IshFolderType)
} else {
    Log '[X] 目标路径第一层就解析不到，检查是否以 General 开头'
    Show-Msg ("KC 目标路径无法解析：`r`n$($p.KcFolder)") 'Error' | Out-Null
    exit 1
}

# 缺失目录**只记不建**：建目录同样是写 KC，必须等你按了"开始执行"之后再做。
# 上一版在这里直接 Add-IshFolder，用户点「否」时 KC 里已经挂上一串空目录，收不回来。
$missing = @()
if ($r.Found -lt $r.Segments.Count) {
    $missing = @($r.Segments[$r.Found..($r.Segments.Count - 1)])
    Log ("[!] 缺失 {0} 层：{1}" -f $missing.Count, ($missing -join ' > '))
    if (-not $p.CreateFolder) {
        Log '[X] 未勾选"自动创建目录"，终止'
        Show-Msg '目标目录不存在，且未勾选自动创建。' 'Warning' | Out-Null
        exit 1
    }
    Log '[..] 这几层目录在你确认执行之后才创建（预检阶段一个字节都不写）'
}
$folder = $r.Folder
Log ("[OK] 当前最深已存在层：{0}  FolderId={1}  type={2}" -f $folder.name, $folder.IshFolderRef, $folder.IshFolderType)

# ------------------------------------------------------------------ 落点类型闸门
# KC 把"文件夹能装什么"写死在文件夹类型上：type=ISHIllustration 才能放插图，
# 往 type=ISHNone 的文件夹里 Add-IshDocumentObj 会被服务端拒掉：
#   [-129] The object cannot be created in the given folder due to the folder content type None.
#           [129;InvalidDocTypeforFolder]
# 2026-10-26 实测对照：whx（2695031, ISHNone）→ 129；whx\image（2695140, ISHIllustration）→ 通过。
# 这是个**目标选错**的问题，不是写入 bug；所以放在预检里拦，不让你按完"开始执行"才吃错。
# 判据分两种，取决于落点是不是本轮要新建的：
#   * 缺失层 = 0 → 落点就是 KC 里那个现成文件夹，只能看它的真实类型
#   * 缺失层 > 0 → 落点由本脚本建，类型可控（$p.FolderType），但若传错也提前说清
$leafType = ''
if ($missing.Count -eq 0) {
    $leafType = "$($folder.IshFolderType)".Trim()
    $typeNote = Get-KcFolderTypeGate $leafType
    if (-not $leafType) {
        # 字段拿不到时不能一刀切拦死：手打路径照样可能对。给提示，放行。
        Log '[!] 服务端没返回该文件夹的类型，无法预判能不能放插图；若执行时报 [-129]，就是这里'
    } elseif ($typeNote) {
        Log ("[X] 落点类型不合格：{0} 是 {1}，KC 只允许在 ISHIllustration 文件夹里放插图" -f $folder.name, $leafType)
        Log ("[..] 正确做法：把目标路径写到它下面的图片文件夹，例如 ...\{0}\image" -f $folder.name)
        Show-Msg @"
目标文件夹不能放插图。

落点：$($folder.name)   （type=$leafType）

KC 只允许在 ISHIllustration 类型的文件夹里创建插图，
而这个文件夹是 $leafType，所以写入会被服务端拒绝
（[-129] InvalidDocTypeforFolder）。

请改成它下面的图片文件夹，例如：
    $($p.KcFolder)\image

如果这层下面还没有图片文件夹，就勾上"自动创建目录"，
并把路径多写一层（新建的目录会按 $($p.FolderType) 建）。
"@ 'Error' | Out-Null
        exit 1
    } else {
        Log '[OK] 落点类型校验通过（ISHIllustration，可放插图）'
    }
} else {
    if ($p.FolderType -ne 'ISHIllustration') {
        Log ("[!] 你指定新建目录的类型是 {0}，它装不了插图，执行时会报 [-129]；建议用默认的 ISHIllustration" -f $p.FolderType)
    } else {
        Log ("[..] 落点将由本脚本新建，类型按 {0} 建（可放插图）" -f $p.FolderType)
    }
}

# 目标文件夹现有对象 —— 判重与更新的唯一基准
# 注意：Get-IshFolderContent 不是一对象一行，而是按 **语言 × 分辨率** 各返回一行
#（实测 2 个对象返回 6 行，ObjectRef 三行全一样），必须归组后再挑代表行，
# 否则一张图会被算三遍。
$kcAll = @()
$kcByTitle = @{}
if ($missing.Count -gt 0) {
    # 目标文件夹还不存在 → 里面必然没有任何对象。
    # 这里**不能**去读父文件夹的内容，那是别的图，拿它比同名会把新图误判成"已存在"。
    Log '[..] 目标文件夹尚不存在，现有对象按 0 计（本轮同名图都会判为新建）'
} else {
    try {
        $fc = @(Get-IshFolderContent -IshSession $ish -FolderId $folder.IshFolderRef -ErrorAction Stop)
        # 字段可用性只判一次（同一批返回的 schema 一致）。
        # 2026-10-26 只读探针实测：默认调用就带 checkedout / checkedoutby / fstatus / fresolution
        #（39 个属性，实测 18 行里 checkedout 全为空），但别的 KC 版本未必，
        # 所以闸门要在运行期看"字段在不在"，而不是写死假设它在。
        $rowFields = @()
        # 空文件夹的行数是 0，**连 schema 都拿不到**（没有样本行可看属性）。
        # 这时候如果照直报"检出 无 / 状态 无"，就是假报警：0 个对象要过闸门，
        # 字段在不在都不影响结果。所以空文件夹单独走一条口径，别装成"服务端不给字段"。
        $isEmptyFolder = ($fc.Count -eq 0)
        if (-not $isEmptyFolder) { $rowFields = @($fc[0].PSObject.Properties | ForEach-Object { $_.Name }) }
        if ($isEmptyFolder) {
            # 置 $true 只是"没有样本可阻塞"，不代表服务端真的返回了这些字段
            $hasCoField = $true
            $hasStField = $true
        } else {
            $hasCoField = ($rowFields -contains 'checkedout') -or ($rowFields -contains 'checkedoutby')
            $hasStField = ($rowFields -contains 'fstatus') -or ($rowFields -contains 'fstatus_lng_value')
        }
        $uniqKc = @(Get-KcUniqueRows $fc)
        $multiRes = @($uniqKc | Where-Object { $_.ResCount -gt 1 })
        $coWithValue = 0
        foreach ($g in $uniqKc) {
            $row = $g.Row
            $ttl = "$(Get-Prop $row @('ftitle_logical_value', 'ftitle'))"
            $co = "$(Get-Prop $row @('checkedout', 'checkedoutby'))"
            if ($co.Trim()) { $coWithValue++ }
            $o = [pscustomobject]@{
                Title       = $ttl
                Key         = (Get-TitleKey $ttl)
                ObjectRef   = $g.ObjectRef
                IshRef      = "$(Get-Prop $row @('IshRef'))"
                Version     = "$(Get-Prop $row @('version_version_value', 'version'))"
                Lng         = "$(Get-Prop $row @('doclanguage', 'doclanguage_lng_value'))"
                Resolution  = (Get-KcResName $row)
                Status      = "$(Get-Prop $row @('fstatus', 'fstatus_lng_value'))"
                CheckedOut  = $co
                HasCheckout = $hasCoField
                HasStatus   = $hasStField
                Rows        = $g.Rows
                ResList     = $g.ResList
                Row         = $row
            }
            $kcAll += $o
            if ($o.Key -and -not $kcByTitle.ContainsKey($o.Key)) { $kcByTitle[$o.Key] = $o }
        }
        Log ("[OK] 目标文件夹现有 {0} 个对象（按 ObjectRef 归组去重；原始返回 {1} 行）" -f $kcAll.Count, $fc.Count)
        if ($isEmptyFolder) {
            Log '[..] 这是个空文件夹：本轮凡是同名图都会判为新建，也没有检出/状态可判'
        } else {
            Log ("[..] 字段可用性：检出 {0} / 状态 {1}（缺字段时更新闸门保守阻塞，加 -IgnoreStateGate 可放行）" -f `
                    $(if ($hasCoField) { '有' } else { '无' }), $(if ($hasStField) { '有' } else { '无' }))
        }
        if ($multiRes.Count -gt 0) {
            Log ("[..] 其中 {0} 个对象有多份分辨率，代表行一律取 High（其次 zh-CN）：" -f $multiRes.Count)
            foreach ($m in $multiRes) { Log ("    ObjectRef={0}  可选 {1}  → 取 {2}" -f $m.ObjectRef, $m.ResList, (Get-KcResName $m.Row)) }
        }
        Log ("[..] 检出字段：有值 {0} 个 / 无值 {1} 个" -f $coWithValue, ($kcAll.Count - $coWithValue))
    } catch {
        Log ("[X] 读取 KC 目标文件夹失败：{0}" -f $_.Exception.Message)
        Show-Msg ("读取 KC 目标文件夹失败，无法判断同名：`r`n$($_.Exception.Message)") 'Error' | Out-Null
        exit 1
    }
}

# ---------------------------------------------------------------- STEP 4 预检
# 只读，一个字节都不写。
# 不能靠 Set-IshDocumentObj -WhatIf：实测报 [-105001] version "-1" invalid，
# 这个 cmdlet 在 WhatIf 下不解析版本号，所以预检只能自己算。
Head 'STEP 4  预检（只读）'

$tmpRoot = Join-Path $env:TEMP ('kc_precheck_' + $stamp)
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$backupDir = Join-Path $scriptDir ('backup\' + $stamp)
$reqTitle = @(Set-IshRequestedMetadataField -IshSession $ish -Name FTITLE -Level Logical)

$i = 0
# 逐张下载 + 算 SHA256，图多的时候没反应会像卡死，所以给个进度窗。
# 张数太少就不弹了，一闪而过反而晃眼。
$showPrecheckPg = (-not $headless) -and ($plan.Count -ge 5)
if ($showPrecheckPg) { Start-Progress '预检（只读）'; Update-Progress ('逐张比对（{0} 张）…' -f $plan.Count) }
foreach ($x in $plan) {
    $i++
    if ($showPrecheckPg -and ($i % 3 -eq 0)) { Update-Progress ('[{0}/{1}] {2}' -f $i, $plan.Count, $x.Name) }
    $x.Sha = Get-FileSha $x.File
    $szLocal = 0
    try { $szLocal = [int64](Get-Item -LiteralPath $x.File -ErrorAction Stop).Length } catch { }
    if ($x.State -eq 'FAILED') { continue }

    $kc = $null
    if ($x.Key -and $kcByTitle.ContainsKey($x.Key)) { $kc = $kcByTitle[$x.Key] }

    if (-not $kc) {
        if ($Mode -eq 'Update' -and $NoCreate) {
            $x.State = 'SKIP_NOEXIST'
            $x.Note = 'KC 里没有，且勾了只替换'
        } else {
            $x.State = 'TOCREATE'
            $x.Note = $(if ($Mode -eq 'Update') { 'KC 里没有，补建' } else { '新图' })
            # 全库同名只做提示，不作为跳过依据（不同手册同名截图太常见；
            # Find-IshDocumentObj 没有文件夹参数，只能整库按标题查）
            try {
                $flt = @(Set-IshMetadataFilterField -IshSession $ish -Name FTITLE -Level Logical -FilterOperator Equal -Value $x.Title)
                $glob = @(Find-IshDocumentObj -IshSession $ish -IshType 'ISHIllustration' -MetadataFilter $flt -RequestedMetadata $reqTitle -ErrorAction Stop)
                if ($glob.Count -gt 0) { $x.Note += ('；全库另有 {0} 条同名' -f $glob.Count) }
            } catch { }
        }
        continue
    }

    $x.KcObj = $kc
    $x.ObjectRef = $kc.ObjectRef
    $x.IshRef = $kc.IshRef

    # 新增导入模式下同名一律跳过、根本不会写 —— 先短路。
    # 否则闸门一收紧，导入模式会冒出一堆 BLOCKED，看着像出了事，其实什么都没写。
    if ($Mode -ne 'Update') {
        $x.State = 'SKIPPED'
        $x.Note = '目标文件夹内已有同名插图'
        continue
    }

    # ---- 第二道闸门：只对"会覆盖内容"的更新模式生效 ----
    $gate = Get-KcUpdateGateNote $kc
    if ($gate) {
        if ($IgnoreStateGate) {
            Log ("    [!] {0}：{1} —— 已按 -IgnoreStateGate 放行" -f $x.Name, $gate)
            $x.Note = $gate + '；已按 -IgnoreStateGate 放行'
        } else {
            $x.State = 'BLOCKED'
            $x.Note = $gate + '（确认无碍可加 -IgnoreStateGate 放行）'
            continue
        }
    }

    # 更新模式：先把 KC 现有内容下下来比哈希，相同就不写（让"更新"可反复跑）
    $shaKc = ''
    $extKc = ''
    $dirKc = Join-Path $tmpRoot ('kc_' + $kc.ObjectRef)
    try {
        New-Item -ItemType Directory -Path $dirKc -Force | Out-Null
        # 按代表行下载 —— 行里已经带了分辨率，拿到的才是 High 那份原图，不是缩略图
        $null = Get-IshDocumentObjData -IshSession $ish -IshObject $kc.Row -FolderPath $dirKc -ErrorAction Stop
        $fk = Get-ChildItem -LiteralPath $dirKc -File | Select-Object -First 1
        if ($fk) {
            $shaKc = Get-FileSha $fk.FullName
            $x.KcSize = $fk.Length
            # 存下来：执行阶段做备份直接复制这份已验证的字节，不再重复下载一遍
            $x.KcFile = $fk.FullName
            # 下载文件名带着 KC 侧的原扩展名 —— 比 EDT 更直观，
            # 而且 Get-IshFolderContent 压根不返回 EDT 字段（探针实测 39 个属性里没有）
            $extKc = $fk.Extension.ToLower()
        }
    } catch {
        $x.State = 'FAILED'
        $x.Note = ('下载现有内容失败：' + $_.Exception.Message)
        continue
    }
    $x.KcSha = $shaKc
    if (-not $shaKc) {
        $x.State = 'TOUPDATE'
        $x.Note = '比对不到现有内容，按不同处理（备份时会重新下载并校验）'
        continue
    }
    if ($shaKc -eq $x.Sha) {
        $x.State = 'UNCHANGED'
        $x.Note = 'SHA256 相同'
    } else {
        $x.State = 'TOUPDATE'
        $note = '内容不同（KC {0} B / 本地 {1} B）' -f $x.KcSize, $szLocal
        # 扩展名变了要说一声：同一个对象换掉文件类型，EDT 跟着变，KC 侧渲染也可能跟着变
        $extLocal = [IO.Path]::GetExtension($x.File).ToLower()
        if ($extKc -and $extKc -ne $extLocal) {
            $note += ('；扩展名会从 {0} 变成 {1}（EDT {2} → {3}）' -f $extKc, $extLocal, $extKc.TrimStart('.').ToUpper(), $x.Edt)
        }
        $x.Note = $note
    }
    # 放行也要留痕：不然台账里只看到"更新"，看不出这道闸门当时是被 -IgnoreStateGate 放过的
    if ($gate) { $x.Note += ('；{0}（已按 -IgnoreStateGate 放行）' -f $gate) }
}
if ($showPrecheckPg) { Stop-Progress }

$tc = @($plan | Where-Object { $_.State -eq 'TOCREATE' }).Count
$tu = @($plan | Where-Object { $_.State -eq 'TOUPDATE' }).Count
$un = @($plan | Where-Object { $_.State -eq 'UNCHANGED' }).Count
$sk = @($plan | Where-Object { $_.State -in @('SKIPPED', 'SKIP_NOEXIST') }).Count
$bl = @($plan | Where-Object { $_.State -eq 'BLOCKED' }).Count
$fa = @($plan | Where-Object { $_.State -eq 'FAILED' }).Count

Log ''
Log ("[预检] 新建 {0} / 更新 {1} / 无变化 {2} / 跳过 {3} / 阻塞 {4} / 失败 {5} / 共 {6}" -f $tc, $tu, $un, $sk, $bl, $fa, $plan.Count)
foreach ($x in $plan) {
    # 顺带把"将替换哪个分辨率"和插图类型露出来 —— 之前只看到名字，判断不了具体动哪份
    $resTag = if ($x.KcObj -and $x.KcObj.Resolution) { ' [' + $x.KcObj.Resolution + ']' } else { '' }
    Log ("    {0,-16} {1}{2}  <{3}>  {4}" -f $x.State, $x.Name, $resTag, (Get-TypeShort $x.Type), $x.Note)
}

# ---------------------------------------------------------------- 确认
$proceed = $false
if (($tc + $tu) -eq 0) {
    Log '[..] 没有需要写入的变更'
} elseif ($Commit) {
    $proceed = $true
    Log '[..] 命令行给了 -Commit，直接执行'
} elseif ($headless) {
    Log '[..] 未给 -Commit，只预检，不写入'
} else {
    $backupNote = if ($tu -le 0) { '' } elseif ($NoBackup) { '注意：已指定 -NoBackup，替换前不做备份。' } else { "替换前会把 KC 原图备份到：`r`n$backupDir" }
    $q = @"
预检完成，尚未写入任何内容。

新建：$tc 张
更新：$tu 张
无变化：$un 张（SHA256 相同，跳过）
跳过：$sk 张
阻塞：$bl 张（被检出或非草稿）
失败：$fa 张

$backupNote

开始执行吗？
"@
    $ans = [System.Windows.Forms.MessageBox]::Show($q.Trim(), '确认执行', 'YesNo', 'Question')
    $proceed = ($ans -eq [System.Windows.Forms.DialogResult]::Yes)
    if (-not $proceed) { Log '[..] 用户取消执行，未写入任何东西' }
}

# ---------------------------------------------------------------- STEP 5 执行
Head 'STEP 5  执行'

$createdCount = 0
$updatedCount = 0
$unverifiedCount = 0
if ($proceed) {
    # 缺失目录在这里才建 —— 已经过了确认这一关。
    # （预检阶段只记 $missing，一个字节都不碰 KC）
    if ($missing.Count -gt 0) {
        Log ("[..] 创建缺失目录 {0} 层…" -f $missing.Count)
        try {
            $parentId = [int64]$r.Folder.IshFolderRef
            foreach ($name in $missing) {
                # 类型必须给对：默认 ISHIllustration，否则建出来的空目录装不了图，
                # 下一轮进来又要报 [-129]（本脚本上一版就是写死 ISHNone，踩过）。
                $new = Add-IshFolder -IshSession $ish -ParentFolderId $parentId -FolderType $p.FolderType -FolderName $name -ErrorAction Stop
                $parentId = [int64]$new.IshFolderRef
                Log ("    [NEW] {0}  FolderId={1}  type={2}" -f $name, $parentId, $p.FolderType)
            }
            $folder = Get-IshFolder -IshSession $ish -FolderId $parentId -ErrorAction Stop
            Log ("[OK] 落点（新建后）：{0}  FolderId={1}" -f $folder.name, $folder.IshFolderRef)
        } catch {
            Log ("[X] 建目录失败：{0}" -f $_.Exception.Message)
            Show-Msg ("建目录失败，已中止，本次没有导入任何图片：`r`n$($_.Exception.Message)") 'Error' | Out-Null
            exit 1
        }
    }

    Start-Progress 'KC 批量导入图片'
    # 用 try/finally 兜住：进度窗 ControlBox=$false，异常跑出去就永远关不掉
    try {
        $i = 0
        foreach ($x in $plan) {
            $i++
            if ($x.State -notin @('TOCREATE', 'TOUPDATE')) { continue }
            Update-Progress ("[{0}/{1}] {2}" -f $i, $plan.Count, $x.Name)

            if ($x.State -eq 'TOCREATE') {
                # 元数据构造也放进 try —— 它同样会抛终止错误（$ErrorActionPreference = 'Stop'），
                # 放外面等于让一张图的异常带走整轮执行
                $x.Exec = $true
                try {
                    $metadata = @(
                        Set-IshMetadataField -IshSession $ish -Name FTITLE -Level Logical -Value $x.Title
                        Set-IshMetadataField -IshSession $ish -Name DOC-LANGUAGE -Level Lng -ValueType Element -Value 'VLANGUAGEZHCN'
                        Set-IshMetadataField -IshSession $ish -Name FSTATUS -Level Lng -ValueType Element -Value 'VSTATUSDRAFT'
                        Set-IshMetadataField -IshSession $ish -Name FILLUSTRATIONTYPE -Level Logical -ValueType Element -Value $x.Type
                        Set-IshMetadataField -IshSession $ish -Name FAUTHOR -Level Lng -ValueType Element -Value $myAuthorElem
                    )
                    $created = Add-IshDocumentObj -IshSession $ish -IshType 'ISHIllustration' -Lng 'zh-CN' -FolderId $folder.IshFolderRef -FilePath $x.File -Resolution $resValue -Edt $x.Edt -Metadata $metadata -ErrorAction Stop
                    $x.IshRef = "$(Get-Prop $created @('IshRef'))"
                    $x.ObjectRef = "$(Get-Prop $created @('ObjectRef'))"
                    $x.State = 'CREATED'
                    $createdCount++
                    Log ("[{0}/{1}] {2}  —— 建成 ObjectRef={3}" -f $i, $plan.Count, $x.Name, $x.ObjectRef)
                } catch {
                    $chain = @(); $ex = $_.Exception
                    while ($ex) { $chain += $ex.Message; $ex = $ex.InnerException }
                    $x.State = 'FAILED'; $x.Note = ($chain -join ' <- ')
                    Log ("[{0}/{1}] {2}  —— 失败：{3}" -f $i, $plan.Count, $x.Name, $x.Note)
                }
                continue
            }

            # ---- TOUPDATE：先备份（且校验），再换内容，最后回读比对 ----
            $x.Exec = $true
            try {
                if (-not $NoBackup) {
                    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
                    # 备份三件事都得成立才算安全：①拿到原图 ②哈希跟预检一致 ③落进备份目录后还是这个哈希。
                    # 少一步就等于"没备份就覆盖" —— Set-IshDocumentObj 是直接盖当前版本，KC 侧没有回收站。
                    $stage = Join-Path $tmpRoot ('bk_' + $x.ObjectRef)
                    New-Item -ItemType Directory -Path $stage -Force | Out-Null
                    if ($x.KcFile -and (Test-Path -LiteralPath $x.KcFile)) {
                        # 预检已经下过一份并算过 SHA256，直接复制，不重复拉一遍
                        Copy-Item -LiteralPath $x.KcFile -Destination $stage -Force
                    } else {
                        $null = Get-IshDocumentObjData -IshSession $ish -IshObject $x.KcObj.Row -FolderPath $stage -ErrorAction Stop
                    }
                    $fb = Get-ChildItem -LiteralPath $stage -File | Select-Object -First 1
                    if (-not $fb) { throw '备份失败：拿到手的原图是空的' }
                    $shaBk = Get-FileSha $fb.FullName
                    if (-not $shaBk) { throw '备份失败：算不出原图哈希' }
                    if ($x.KcSha -and $shaBk -ne $x.KcSha) {
                        throw ('备份失败：原图哈希与预检不一致（预检 {0} / 备份 {1}），拒绝覆盖' -f $x.KcSha.Substring(0, 12), $shaBk.Substring(0, 12))
                    }
                    $bkPath = Join-Path $backupDir ($x.ObjectRef + '_' + $fb.Name)
                    Copy-Item -LiteralPath $fb.FullName -Destination $bkPath -Force
                    if ((Get-FileSha $bkPath) -ne $shaBk) { throw '备份失败：写进备份目录后哈希不一致，拒绝覆盖' }
                    $x.Backup = $bkPath
                    Log ('          原图已备份并校验 {0}（{1} B，{2}）' -f $bkPath, $fb.Length, $shaBk.Substring(0, 12))
                } else {
                    Log '          [..] 已指定 -NoBackup：直接覆盖，KC 侧无法回滚'
                }

                Log ("[{0}/{1}] {2}  —— 替换内容（ObjectRef={3} v{4} {5} {6}）" -f $i, $plan.Count, $x.Name, $x.ObjectRef, $x.KcObj.Version, $x.KcObj.Lng, $x.KcObj.Resolution)
                $setArgs = @{
                    IshSession  = $ish
                    LogicalId   = $x.IshRef
                    Version     = $x.KcObj.Version
                    Lng         = $x.KcObj.Lng
                    FilePath    = $x.File
                    Edt         = $x.Edt
                    Confirm     = $false
                    ErrorAction = 'Stop'
                }
                # 分辨率必须显式带上：同一对象有 High/Low/Thumbnail 三份内容，
                # 不带就听服务端默认，可能改的不是你要改的那份
                if ($x.KcObj.Resolution) { $setArgs['Resolution'] = $x.KcObj.Resolution }
                $null = Set-IshDocumentObj @setArgs
            } catch {
                $chain = @(); $ex = $_.Exception
                while ($ex) { $chain += $ex.Message; $ex = $ex.InnerException }
                $x.State = 'FAILED'; $x.Note = ($chain -join ' <- ')
                Log ("[{0}/{1}] {2}  —— 更新失败：{3}" -f $i, $plan.Count, $x.Name, $x.Note)
                continue
            }

            $dirV = Join-Path $tmpRoot ('v_' + $x.ObjectRef)
            try {
                New-Item -ItemType Directory -Path $dirV -Force | Out-Null
                $null = Get-IshDocumentObjData -IshSession $ish -IshObject $x.KcObj.Row -FolderPath $dirV -ErrorAction Stop
                $fv = Get-ChildItem -LiteralPath $dirV -File | Select-Object -First 1
                $shaNew = if ($fv) { Get-FileSha $fv.FullName } else { '' }
                if ($shaNew -eq $x.Sha) {
                    $x.State = 'UPDATED'; $updatedCount++
                    Log '          回读 SHA256 一致，更新确认'
                } else {
                    $x.State = 'UPDATED_UNVERIFIED'; $updatedCount++; $unverifiedCount++
                    $x.Note = ('回读哈希不一致：{0}' -f $(if ($shaNew) { $shaNew.Substring(0, 12) } else { '空' }))
                    Log ("          [!] {0}" -f $x.Note)
                }
            } catch {
                $x.State = 'UPDATED_UNVERIFIED'; $updatedCount++; $unverifiedCount++
                $x.Note = ('回读失败：' + $_.Exception.Message)
                Log ("          [!] 回读失败（更新已提交）：{0}" -f $_.Exception.Message)
            }
        }
    } finally {
        Stop-Progress
    }
} else {
    Log '[..] 未执行任何写入'
}

# 执行期才变 FAILED 的条目必须回算一次，否则汇总框和退出码都在说谎：
# 预检时失败 0 张，执行时挂了 2 张，结果框还写"失败：0"、exit 0，台账里却躺着 FAILED。
$fa = @($plan | Where-Object { $_.State -eq 'FAILED' }).Count

# ---------------------------------------------------------------- STEP 6 台账
# 单一滚动台账：追加而不是每轮一个新文件。
# 只记"真正动过手"的行（建成/更新/失败），纯预检不留痕 —— 这样反复预检也不会堆文件。
Head 'STEP 6  台账'

$ledgerRows = @(
    # 建成 / 更新 / 更新未校验 一律记；
    # FAILED 只在**真的动过手**（$_.Exec）时才记 —— 预检阶段就判失败的（批次内重名、后缀不识别）
    # 从来没碰过 KC，记进去只会给台账添噪声。
    # 上一版用 ($proceed -and FAILED) 判，只要有任意一项执行了，预检失败的条目也会被塞进来。
    $plan | Where-Object {
        $_.State -in @('CREATED', 'UPDATED', 'UPDATED_UNVERIFIED') -or ($_.Exec -and $_.State -eq 'FAILED')
    } |
        Select-Object @{n = '时间'; e = { $stamp } },
                      @{n = '模式'; e = { $Mode } },
                      @{n = '文件'; e = { $_.Name } },
                      @{n = '标题'; e = { $_.Title } },
                      @{n = '动作'; e = { $_.State } },
                      @{n = 'EDT'; e = { $_.Edt } },
                      @{n = '分辨率'; e = { if ($_.KcObj) { $_.KcObj.Resolution } else { $resValue } } },
                      @{n = '本地KB'; e = { $_.SizeKB } },
                      @{n = 'KC字节'; e = { $_.KcSize } },
                      @{n = 'ObjectRef'; e = { $_.ObjectRef } },
                      @{n = 'IshRef'; e = { $_.IshRef } },
                      @{n = '备份'; e = { $_.Backup } },
                      @{n = '备注'; e = { $_.Note } },
                      @{n = '落点'; e = { $folder.IshFolderRef } }
)
if ($ledgerRows.Count -gt 0) {
    $ledgerRows | Export-Csv -LiteralPath $ledgerPath -NoTypeInformation -Encoding UTF8 -Append
    $ledgerTotal = 1
    try { $ledgerTotal = @(Import-Csv -LiteralPath $ledgerPath -Encoding UTF8 -ErrorAction Stop).Count } catch { }
    Log ("[OK] 台账追加 {0} 行，累计 {1} 行：{2}" -f $ledgerRows.Count, $ledgerTotal, $ledgerPath)
} else {
    Log '[..] 台账未改动（本次没有写入动作）'
}
Log ("[结果] 新建 {0} / 更新 {1}（其中未校验 {2}） / 无变化 {3} / 跳过 {4} / 阻塞 {5} / 失败 {6} / 共 {7}" -f `
        $createdCount, $updatedCount, $unverifiedCount, $un, $sk, $bl, $fa, $plan.Count)

# ---------------------------------------------------------------- STEP 7 名称 / GUID 对照表
# 必须重新查一遍，不能复用 STEP 3 那份 $kcAll —— 那是写入前的快照，本轮新建的图不在里面。
# 导不导出由用户当场决定：弹一次，默认「否」，不选就不生成任何文件。
Head 'STEP 7  名称 / GUID 对照表'

$indexPath = ''
$idxCount = 0
# 目标文件夹本轮还没建出来（只预检、用户取消了）就别查了 ——
# 此时 $folder 还是父目录，查出来的会把父目录的图当成这个文件夹的图，比空表更误导。
$wantIndex = $false
if ($missing.Count -gt 0 -and -not $proceed) {
    Log '[..] 目标文件夹尚未创建（本轮没有执行），跳过对照表'
} elseif ($headless) {
    # 自动化模式没人可问：默认导出（既有批处理行为不变），要关掉加 -NoIndex
    $wantIndex = -not $NoIndex
    if ($wantIndex) { Log '[..] 自动化模式：默认导出对照表（加 -NoIndex 可关掉）' }
    else { Log '[..] 自动化模式且指定了 -NoIndex：不导出对照表' }
} else {
    $ansIdx = [System.Windows.Forms.MessageBox]::Show(
        ("已处理 {0} 张图。要不要导出一份「名称 / GUID 对照表」？`r`n`r`n" -f $plan.Count) +
        ("文件夹：{0}`r`n`r`n" -f $folder.name) +
        "表里是每张图的 名称 / GUID / 版本 / 语言 / 分辨率 / 全标识。`r`n`r`n" +
        "选「否」就不生成任何文件。",
        '导出对照表', 'YesNo', 'Question', 'Button2')
    $wantIndex = ($ansIdx -eq [System.Windows.Forms.DialogResult]::Yes)
    if (-not $wantIndex) { Log '[..] 选择不导出对照表，本轮不生成文件' }
}

if ($wantIndex) {
    try {
        $ex = Export-KcImageIndex $ish $folder $logDir
        if (-not $ex) {
            Log '[..] 没有可导出的文件夹，跳过'
        } elseif ($ex.Rows -eq 0) {
            Log ("[..] 目标文件夹对象 {0} 个，其中没有图片，未写对照表" -f $ex.Total)
        } else {
            $indexPath = $ex.Path
            $idxCount = $ex.Rows
            Log ("[OK] 目标文件夹对象 {0} 个（按 ObjectRef 归组；原始返回 {1} 行），其中图片 {2} 个{3}" -f `
                    $ex.Total, $ex.RawRows, $ex.Rows, $(if ($ex.NonImg -gt 0) { "，非图片 $($ex.NonImg) 个已排除" } else { '' }))
            if ($ex.MultiRes -gt 0) { Log ("[..] 其中 {0} 个对象有多份分辨率，表里取的是 High，其余见「可选分辨率」列" -f $ex.MultiRes) }
            Log ("[OK] 对照表已写出：{0}" -f $indexPath)
            Log ''
            Log '    名称                                     全标识'
            Log ('    ' + ('-' * 96))
            foreach ($z in @($ex.Items | Select-Object -First 10)) {
                Log ("    {0,-40} {1}" -f $z.'名称', $z.'全标识')
            }
            if ($ex.Rows -gt 10) { Log ("    …其余 {0} 行见 CSV" -f ($ex.Rows - 10)) }
        }
    } catch {
        Log ("[X] 生成对照表失败：{0}" -f $_.Exception.Message)
    }
}

if (Test-Path -LiteralPath $tmpRoot) { Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue }

# ---------------------------------------------------------------- 结果框
$headline = if (-not $proceed) { '预检结束，未写入任何东西。' } elseif ($Mode -eq 'Update') { '更新结束。' } else { '导入结束。' }
$backupLine = ''
if ($updatedCount -gt 0 -and $proceed -and -not $NoBackup) { $backupLine = "`r`n原图备份：$backupDir`r`n" }
$ledgerLine = if ($ledgerRows.Count -gt 0) { $ledgerPath } else { '（本次无写入，台账未改动）' }
$indexLine = if ($idxCount -gt 0) { "$indexPath（$idxCount 条）" } elseif ($missing.Count -gt 0 -and -not $proceed) { '（目标文件夹未创建，未生成）' } elseif (-not $wantIndex) { '（按你的选择未导出）' } else { '（该文件夹里没有图片，未生成）' }
$msg = @"
$headline

新建：$createdCount
更新：$updatedCount$(if ($unverifiedCount -gt 0) { '（其中 ' + $unverifiedCount + ' 张已写入但回读未校验通过）' })$backupLine
无变化（内容相同）：$un
跳过：$sk
阻塞（被检出/非草稿）：$bl
失败：$fa
合计：$($plan.Count)

模式：$(if ($Mode -eq 'Update') { '更新已有' } else { '新增导入' })
落点：$($folder.name)（FolderId=$($folder.IshFolderRef)，type=$($folder.IshFolderType)）

名称/GUID 对照表：$indexLine
滚动台账：$ledgerLine
本轮日志：$logPath

点"是"打开 logs 文件夹。
"@

if ($headless) {
    Log $msg
} else {
    # 有失败或有"写了但没验证成功"的，都用警告图标 —— 别让用户以为一切顺利
    $icon = if ($fa -gt 0 -or $unverifiedCount -gt 0) { 'Warning' } else { 'Information' }
    $ans = [System.Windows.Forms.MessageBox]::Show($msg, 'KC 批量导入图片', 'YesNo', $icon)
    if ($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
        try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $logPath + '"') } catch { }
    }
}

Clear-OldKcLog $logDir $KeepLogs
Log "transcript : $logPath"
Log ("logs dir   : {0}（保留最近 {1} 份 transcript）" -f $logDir, $KeepLogs)
if ($fa -gt 0) { exit 1 } else { exit 0 }

Clear-OldKcLog $logDir $KeepLogs
Log "transcript : $logPath"
Log ("logs dir   : {0}（保留最近 {1} 份 transcript）" -f $logDir, $KeepLogs)
if ($fa -gt 0) { exit 1 } else { exit 0 }
