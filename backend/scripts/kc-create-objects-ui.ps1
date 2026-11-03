# kc-create-objects-ui.ps1  (UTF-8 with BOM - do not remove the BOM)
# ============================================================================
# KC 新建对象 · 统一弹窗版（Topic / Map / Pub）
#
# 交互（与 kc-import-images-ui.ps1 一致）：
#   1) 弹 Windows 登录框 → 登录 KC
#   2) 一个弹窗：顶部选 Topic / Map / Pub，填目标目录与对象参数
#   3) 点“预检并继续”→ 只读预检（查重 / 目录 / 字段 / 挂接目标）
#   4) 弹预检结果 → 点“是”才写入
#   5) 逐条创建 → 回读 → 台账 → 结果框
#
# Topic 两种来源：
#   A. 本地目录中的 XML（递归子目录；KC 侧镜像同名子目录；类型按根元素）
#   B. Text / CSV / Markdown 提取标题 → 用内置最小空 topic 模板创建
# Map 两种来源：
#   A. Text / CSV / Markdown 提取标题 → 内置最小空 map 模板
#   B. 本地 map XML（标题取 XML 的 <title>）
# Pub：标题 + OutputFormat（运行时从 KC 拉取）
#
# 挂接（默认只预检，确认后才写）：
#   * Topic → Map：改 map XML，改前备份，只追加 <topicref>，改后回读
#     需要 scripts\templates\ 下有一份带 <topicref> 的 map XML 样例（href 格式从它学）
#   * Map → Pub：Set-IshPublicationOutput 写 FISHMASTERREF（需求书 R-09b，API 尚未实测）
#     批量 Map 不挂 Pub，避免一个 pub 被反复覆盖
#
# 红线：不删、不移动。只 Add-IshFolder / Add-IshDocumentObj / Add-IshPublicationOutput；
#       唯一的“改”是挂接（Set-IshDocumentObj / Set-IshPublicationOutput），且强制备份。
#
# 产物：
#   logs\kc-create-<时间戳>.txt   每轮 transcript（保留最近 -KeepLogs 份）
#   logs\kc-create-ledger.csv     滚动台账，只追加真写入
#   backup\<时间戳>\              挂接前备份的 map XML
#
# 自动化（给全参数就跳过弹窗；不加 -Commit 只预检）：
#   powershell.exe -File kc-create-objects-ui.ps1 -Type Topic -FolderPath "General\..." `
#       -XmlDir "D:\xml" -Commit
# ============================================================================

param(
    [ValidateSet('Topic', 'Map', 'Pub')]
    [string]$Type = '',

    [string]$Title = '',
    [string]$FolderPath = '',

    # Topic：本地 XML 目录（递归），或标题来源
    [string]$XmlDir = '',

    # Map：本地 map XML
    [string]$MapXmlFile = '',

    # 标题来源（Text / CSV / Markdown）
    [string]$SourceFile = '',
    [string]$SourceText = '',

    [ValidateSet('Concept', 'Task', 'Reference')]
    [string]$TopicType = 'Concept',

    [string]$MasterType = 'VMASTERTYPEUSERMANUALMAP',
    [string]$OutputFormat = 'VOUTPUTFORMATPDF1-MANUAL-A4',

    # Pub 必填：Hikvision 的 7 个 *Switch 字段（LOV，fmin=1 fmax=1，只能填一个）
    # 取值只有 DISPLAY / HIDE 两种，对应元素名 V<字段>DISPLAY / V<字段>HIDE
    [ValidateSet('DISPLAY', 'HIDE')]
    [string]$PubSwitchMode = 'DISPLAY',
    [string]$LanguageCombination = 'zh-CN',
    [string]$LanguageElement = 'VLANGUAGEZHCN',

    # 挂接目标（IshRef / GUID）
    [string]$AttachMap = '',
    [string]$AttachPub = '',

    # 自动化登录
    [string]$IshUser = '',
    [string]$IshPassword = '',

    [switch]$NoCreateFolder,
    [switch]$Commit,
    [switch]$IgnoreSslPolicyErrors,
    [switch]$NoAutoInstall,
    [int]$KeepLogs = 20
)

$ErrorActionPreference = 'Stop'
$selfPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path $selfPath
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:utf8Bom = New-Object System.Text.UTF8Encoding($true)

# 产物统一放 logs\ 子目录
$script:logDir = Join-Path $scriptDir 'logs'
if (-not (Test-Path -LiteralPath $script:logDir)) {
    New-Item -ItemType Directory -Path $script:logDir -Force | Out-Null
}
$logPath = Join-Path $script:logDir ("kc-create-$stamp.txt")
$script:ledgerPath = Join-Path $script:logDir 'kc-create-ledger.csv'
$script:tmpRoot = Join-Path $env:TEMP ('kc_create_' + $stamp)
$script:backupDir = Join-Path $scriptDir ('backup\' + $stamp)

# 全局状态
$script:headless = $false
$script:kcIsh = $null
$script:plan = @()
$script:cfg = $null
$script:authorElem = ''
$script:publisherElem = ''
$script:outputFormats = @('VOUTPUTFORMATPDF1-MANUAL-A4')
$script:outputFormatsFromServer = $false
$script:masterTypes = @()
$script:createCount = 0
$script:skipCount = 0
$script:blockCount = 0
$script:failCount = 0
$script:attachOk = 0
$script:attachFail = 0
$script:topicAttachFail = $false
$script:pubAttachFail = $false
$script:attachMapInfo = $null
$script:attachPubInfo = $null
$script:lastMapBackup = ''
$script:ledgerWritten = 0
$script:didExecute = $false
$script:unverifiedCount = 0
$script:contentIndex = @{}
$script:folderIdCache = @{}
$script:containerCache = @{}
$script:ledgerRows = New-Object System.Collections.ArrayList
$script:kcChildCache = @{}
$script:kcChildMode = ''

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------------------------------------------------------------- 日志
function Log($m) {
    Write-Host $m
    try { Add-Content -LiteralPath $logPath -Value $m -Encoding UTF8 } catch { }
}
function Head($m) {
    Log ''
    Log ('=' * 78)
    Log $m
    Log ('=' * 78)
}

# transcript 轮转：只留最近 N 份
function Clear-OldKcLog([string]$dir, [int]$keep) {
    if ($keep -le 0) { return }
    $old = @(Get-ChildItem -LiteralPath $dir -File -Filter 'kc-create-*.txt' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $keep)
    foreach ($f in $old) {
        try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch { }
    }
    if ($old.Count -gt 0) { Log ("[..] 清理旧日志 {0} 份（保留最近 {1} 份）" -f $old.Count, $keep) }
}

# ---------------------------------------------------------------- 基础工具
function Get-Prop($obj, [string[]]$names) {
    if (-not $obj) { return $null }
    foreach ($n in $names) {
        $p = $obj.PSObject.Properties[$n]
        if ($p -and $p.Value) { return $p.Value }
    }
    return $null
}

# 标题比对键：全角转半角 + 去所有空白 + 小写。
# 只做“看起来就是同一个名字”的归一，不做模糊匹配。
function Get-TitleKey([string]$t) {
    if (-not $t) { return '' }
    try { $s = $t.Normalize([System.Text.NormalizationForm]::FormKC) } catch { $s = $t }
    return ($s -replace '\s+', '').ToLowerInvariant()
}

function Normalize-KcPath([string]$p) {
    $s = "$p".Trim()
    if (-not $s) { return '' }
    $s = $s -replace '/', '\'
    $s = $s -replace '\\{2,}', '\'
    $s = $s.Trim('\')
    return $s
}

# 读 XML 的根元素与标题；DTD 不外取。
function Get-KcXmlInfo([string]$path) {
    $res = [pscustomobject]@{ Path = $path; Root = ''; Title = ''; Ok = $false; Error = '' }
    $reader = $null
    try {
        $settings = New-Object System.Xml.XmlReaderSettings
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
        $settings.XmlResolver = $null
        $reader = [System.Xml.XmlReader]::Create($path, $settings)
        $doc = New-Object System.Xml.XmlDocument
        $doc.XmlResolver = $null
        $doc.Load($reader)
        if ($doc.DocumentElement) {
            $res.Root = $doc.DocumentElement.LocalName
            $t = $doc.DocumentElement.SelectSingleNode("*[local-name()='title']")
            if ($t) { $res.Title = (($t.InnerText -replace '\s+', ' ').Trim()) }
        }
        $res.Ok = $true
    } catch {
        if ($reader) { try { $reader.Dispose(); $reader = $null } catch { } }
        $res.Error = $_.Exception.Message
        # 兜底：正则取 title / 根元素。DTD 实体解析失败时仍能拿到标题。
        try {
            $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
            $m = [regex]::Match($raw, '(?is)<title\b[^>]*>(.*?)</title>')
            if ($m.Success) {
                $t = $m.Groups[1].Value -replace '(?s)<[^>]+>', ''
                $t = $t -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"' -replace '&apos;', "'" -replace '&amp;', '&'
                $res.Title = (($t -replace '\s+', ' ').Trim())
            }
            $m2 = [regex]::Match($raw, '(?is)<\s*([A-Za-z][A-Za-z0-9_.-]*)[\s>]')
            if ($m2.Success) { $res.Root = $m2.Groups[1].Value }
        } catch { }
    } finally {
        if ($reader) { try { $reader.Dispose() } catch { } }
    }
    return $res
}

function Test-KcXmlText([string]$text) {
    if (-not $text) { return $false }
    $reader = $null
    try {
        $settings = New-Object System.Xml.XmlReaderSettings
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
        $settings.XmlResolver = $null
        $sr = New-Object System.IO.StringReader -ArgumentList $text
        $reader = [System.Xml.XmlReader]::Create($sr, $settings)
        $doc = New-Object System.Xml.XmlDocument
        $doc.XmlResolver = $null
        $doc.Load($reader)
        return $true
    } catch {
        return $false
    } finally {
        if ($reader) { try { $reader.Dispose() } catch { } }
    }
}

# 标题提取：
#   Lines    每行一个
#   Markdown # / ## / ### 标题行（跳过代码块）
#   Csv      Title / 标题 列；无表头取第一列
#   Auto     按来源文件扩展名判断，否则按 Lines
function Get-KcTitleList([string]$text, [string]$mode, [string]$sourceFile) {
    $out = New-Object System.Collections.ArrayList
    $text = "$text"
    $mode = "$mode"
    if (-not $mode -or $mode -eq 'Auto') {
        $ext = ''
        if ($sourceFile) { $ext = [IO.Path]::GetExtension($sourceFile).ToLowerInvariant() }
        if ($ext -eq '.csv') { $mode = 'Csv' }
        elseif ($ext -eq '.md' -or $ext -eq '.markdown') { $mode = 'Markdown' }
        else { $mode = 'Lines' }
    }

    if ($mode -eq 'Lines') {
        foreach ($line in ($text -split "\r?\n")) {
            $t = $line.Trim().TrimStart([char]0xFEFF).Trim()
            if ($t) { [void]$out.Add($t) }
        }
        return @($out)
    }

    if ($mode -eq 'Markdown') {
        $inFence = $false
        foreach ($line in ($text -split "\r?\n")) {
            $l = $line.Trim()
            if ($l -match '^(```|~~~)') { $inFence = -not $inFence; continue }
            if ($inFence) { continue }
            $m = [regex]::Match($line, '^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$')
            if ($m.Success) {
                $t = $m.Groups[1].Value.Trim()
                if ($t) { [void]$out.Add($t) }
            }
        }
        return @($out)
    }

    if ($mode -eq 'Csv') {
        $lines = @($text -split "\r?\n" | Where-Object { $_.Trim() })
        if ($lines.Count -eq 0) { return @() }
        $first = $lines[0]

        # 表头可能不在第一列（如 ID,Title,Type），所以先解析第一行的列名。
        $headerNames = @()
        try { $headerNames = @(($first | ConvertFrom-Csv).PSObject.Properties.Name) } catch { }
        $prop = $null
        foreach ($p in $headerNames) {
            $pn = "$p".TrimStart([char]0xFEFF).Trim()
            if ($pn -match '^(?i)(title|标题|名称|topic|map)$') { $prop = $p; break }
        }

        if ($prop) {
            $rows = @($lines | ConvertFrom-Csv)
            if ($rows.Count -eq 0) { return @() }
            foreach ($r in $rows) {
                $t = "$($r.$prop)".Trim()
                if ($t) { [void]$out.Add($t) }
            }
            return @($out)
        }

        # 无表头：取每行第一列
        foreach ($line in $lines) {
            $t = ''
            if ($line.TrimStart().StartsWith('"')) {
                $m = [regex]::Match($line, '^\s*"((?:[^"]|"")*)"')
                if ($m.Success) { $t = $m.Groups[1].Value -replace '""', '"' }
            } else {
                $t = ($line -split ',')[0]
            }
            $t = $t.Trim().TrimStart([char]0xFEFF).Trim()
            if ($t) { [void]$out.Add($t) }
        }
        return @($out)
    }

    throw ("未知的标题解析方式：" + $mode)
}

# 内置最小 DITA 骨架
function New-KcEmptyTopicXml([string]$title, [string]$typeElement, [int]$index) {
    $esc = [System.Security.SecurityElement]::Escape($title)
    $id = 'kc-gen-' + $index
    if ($typeElement -eq 'VMODULETYPETASK') {
        return @"
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE task PUBLIC "-//OASIS//DTD DITA Task//EN" "task.dtd">
<task id="$id" xml:lang="zh-CN">
  <title>$esc</title>
  <taskbody>
    <steps>
      <step><cmd/></step>
    </steps>
  </taskbody>
</task>
"@
    }
    if ($typeElement -eq 'VMODULETYPEREFERENCE') {
        return @"
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE reference PUBLIC "-//OASIS//DTD DITA Reference//EN" "reference.dtd">
<reference id="$id" xml:lang="zh-CN">
  <title>$esc</title>
  <refbody>
    <section><p/></section>
  </refbody>
</reference>
"@
    }
    return @"
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd">
<concept id="$id" xml:lang="zh-CN">
  <title>$esc</title>
  <conbody>
    <p/>
  </conbody>
</concept>
"@
}

function New-KcEmptyMapXml([string]$title, [int]$index) {
    $esc = [System.Security.SecurityElement]::Escape($title)
    $id = 'kc-gen-map-' + $index
    return @"
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">
<map id="$id" xml:lang="zh-CN">
  <title>$esc</title>
</map>
"@
}

function New-KcTempXmlFile([string]$content, [string]$name) {
    if (-not (Test-Path -LiteralPath $script:tmpRoot)) {
        New-Item -ItemType Directory -Path $script:tmpRoot -Force | Out-Null
    }
    $p = Join-Path $script:tmpRoot $name
    [IO.File]::WriteAllText($p, $content, $script:utf8Bom)
    return $p
}

# Get-IshFolderContent 每个对象按 语言 × 分辨率 返回多行，必须按 ObjectRef 归组。
function Get-KcRowRank($row) {
    $res = "$(Get-Prop $row @('fresolution_lng_value', 'fresolution_lng_element', 'fresolution'))"
    $lng = "$(Get-Prop $row @('doclanguage_lng_value', 'doclanguage'))"
    $score = 0
    if ($res -match 'High') { $score += 8 }
    elseif ($res -match 'Low') { $score += 4 }
    elseif ($res -match 'Thumb') { $score += 1 }
    if ($lng -match 'zh[-_]?CN') { $score += 2 }
    return $score
}

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
        $best = $null
        $bestScore = -1
        foreach ($r in $grp) {
            $s = Get-KcRowRank $r
            if ($s -gt $bestScore) { $best = $r; $bestScore = $s }
        }
        $out += [pscustomobject]@{
            ObjectRef = $k
            Row       = $best
            Rows      = $grp
        }
    }
    return $out
}

# ---------------------------------------------------------------- 进度窗
$script:pf = $null
function Start-Progress([string]$title) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = $title
    $f.Size = New-Object System.Drawing.Size(540, 130)
    $f.StartPosition = 'CenterScreen'
    $f.FormBorderStyle = 'FixedDialog'
    $f.MaximizeBox = $false
    $f.MinimizeBox = $false
    $f.ControlBox = $false
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.AutoSize = $false
    $lbl.SetBounds(16, 14, 490, 40)
    $lbl.Text = '准备中…'
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.SetBounds(16, 58, 490, 20)
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
    try {
        $script:pf.Form.Close()
        $script:pf.Form.Dispose()
    } catch { }
    $script:pf = $null
    [System.Windows.Forms.Application]::DoEvents()
}

function Show-Msg([string]$text, [string]$icon = 'Information') {
    if ($script:headless) {
        Log ("    [MSG] " + ($text -replace "`r`n", ' '))
        return 'OK'
    }
    return [System.Windows.Forms.MessageBox]::Show($text, 'KC 新建对象', 'OK', $icon)
}

# ---------------------------------------------------------------- 顶层兜底
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
    try { Write-KcLedger | Out-Null } catch { }
    try {
        if ($script:tmpRoot -and (Test-Path -LiteralPath $script:tmpRoot)) {
            Remove-Item -LiteralPath $script:tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch { }
    try {
        Show-Msg ("脚本因未预期的错误中止，已完成的项见台账。`r`n`r`n$txt`r`n`r`n日志：$logPath") 'Error' | Out-Null
    } catch { }
    exit 1
}

# ---------------------------------------------------------------- 依赖检查
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
            Show-Msg ("加载 ISHRemote 失败：`r`n{0}`r`n`r`n日志：{1}" -f $_.Exception.Message, $logPath) 'Error' | Out-Null
            exit 1
        }
    }

    if ($NoAutoInstall) {
        Log '[..] 已指定 -NoAutoInstall，跳过自动安装'
        $installErr = $null
    } else {
        Log '[..] 本机未找到 ISHRemote，尝试自动安装（需能访问 PowerShell Gallery）'
        if ($showPg) {
            Start-Progress 'KC 新建对象'
            Update-Progress '正在安装依赖 ISHRemote（首次约十几秒）…'
        }
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            if (Get-Command Install-Module -ErrorAction SilentlyContinue) {
                if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
                    Log '[..] 安装 NuGet 包提供程序…'
                    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue | Out-Null
                }
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
    Show-Msg $msg 'Error' | Out-Null
    exit 1
}

# ---------------------------------------------------------------- KC 目录浏览
# 列出某个 KC 文件夹的直接子文件夹。按 folderId 缓存。
function Get-KcChildFolders($ish, [string]$folderId) {
    $key = [string]$folderId
    if ($script:kcChildCache.ContainsKey($key)) { return $script:kcChildCache[$key] }

    $out = @()
    try {
        # 实测（scripts\logs\kc-probe-folders-20261026-110824.txt）：
        #   -Depth 1 只返回文件夹自身；-Depth 2 才是「自身 + 直接子文件夹」。
        $all = @(Get-IshFolder -IshSession $ish -FolderId ([int64]$folderId) -Recurse -Depth 2 -ErrorAction Stop)
        foreach ($f in $all) {
            $ref = "$(Get-Prop $f @('IshFolderRef', 'IshRef'))"
            if (-not $ref -or $ref -eq $key) { continue }
            $nm = "$(Get-Prop $f @('name', 'Title'))"
            if (-not $nm) { continue }
            $out += [pscustomobject]@{ Name = $nm; Id = $ref; Type = "$(Get-Prop $f @('IshFolderType'))" }
        }
        Log ("[..] 列子文件夹 FolderId={0}：返回 {1} 行（含自身），子文件夹 {2} 个" -f $folderId, $all.Count, $out.Count)
    } catch {
        Log ("    [!] 列子文件夹失败：{0}" -f $_.Exception.Message)
    }
    $out = @($out | Sort-Object Name)
    $script:kcChildCache[$key] = $out
    return $out
}

# 从最深层往前试，返回能解析到的最深文件夹
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

# KC 目标文件夹浏览窗：逐层下钻 + 路径框可手打/粘贴。
function Show-KcFolderPicker {
    param($ish, [string]$startPath)

    $state = @{ Path = ''; Children = @(); Leaf = '' }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = '选择 KC 目标文件夹'
    $form.ClientSize = New-Object System.Drawing.Size(624, 436)
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
    $lblHint.Text = '双击子文件夹进入下一层；也可以直接改上面的路径后按「确定」。反斜杠分隔，不带前导符号。'
    $lblHint.ForeColor = [System.Drawing.Color]::Gray
    $lblHint.SetBounds(18, 376, 588, 20)

    $btnOK = New-Object System.Windows.Forms.Button
    $btnOK.Text = '确定'
    $btnOK.SetBounds(414, 398, 90, 28)
    $btnOK.DialogResult = [System.Windows.Forms.DialogResult]::None

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = '取消'
    $btnCancel.SetBounds(512, 398, 90, 28)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.AcceptButton = $btnOK
    $form.CancelButton = $btnCancel

    function Set-KcPickPath([string]$p) {
        $p = "$p".Trim() -replace '/', '\'
        $p = $p.Trim('\')
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
            $p = ($tbPath.Text.Trim() -replace '/', '\').Trim('\')
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

# ---------------------------------------------------------------- 按标题搜索 Pub / Map
# 先 Like 再 Equal；Like 同时试 *kw* 与 %kw%，兼容不同服务端通配符。
function Find-KcTitleRows($ish, [string]$kind, [string]$keyword) {
    $kw = "$keyword".Trim()
    if (-not $kw) { throw '请输入标题关键词' }
    $lastErr = $null
    foreach ($v in @("*$kw*", "%$kw%")) {
        try {
            $flt = @(Set-IshMetadataFilterField -IshSession $ish -Name FTITLE -Level Logical -FilterOperator Like -Value $v)
            if ($kind -eq 'Pub') {
                $rows = @(Find-IshPublicationOutput -IshSession $ish -MetadataFilter $flt -ErrorAction Stop)
            } else {
                $req = @(Set-IshRequestedMetadataField -IshSession $ish -Name FTITLE -Level Logical)
                $rows = @(Find-IshDocumentObj -IshSession $ish -IshType 'ISHMasterDoc' -MetadataFilter $flt -RequestedMetadata $req -ErrorAction Stop)
            }
            if ($rows.Count -gt 0) { return @($rows) }
        } catch {
            $lastErr = $_
        }
    }
    try {
        $flt = @(Set-IshMetadataFilterField -IshSession $ish -Name FTITLE -Level Logical -FilterOperator Equal -Value $kw)
        if ($kind -eq 'Pub') {
            return @(Find-IshPublicationOutput -IshSession $ish -MetadataFilter $flt -ErrorAction Stop)
        }
        $req = @(Set-IshRequestedMetadataField -IshSession $ish -Name FTITLE -Level Logical)
        return @(Find-IshDocumentObj -IshSession $ish -IshType 'ISHMasterDoc' -MetadataFilter $flt -RequestedMetadata $req -ErrorAction Stop)
    } catch {
        $lastErr = $_
    }
    throw $lastErr
}

function Show-KcObjectPicker {
    param($ish, [ValidateSet('Pub', 'Map')] [string]$Kind, [string]$InitialTitle = '')

    $state = @{ Results = @() }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $(if ($Kind -eq 'Pub') { '选择 Publication' } else { '选择 Map' })
    $form.ClientSize = New-Object System.Drawing.Size(700, 470)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $lbKw = New-Object System.Windows.Forms.Label
    $lbKw.Text = '标题关键词'
    $lbKw.SetBounds(16, 17, 80, 22)

    $tbKw = New-Object System.Windows.Forms.TextBox
    $tbKw.SetBounds(102, 14, 470, 24)
    $tbKw.Text = $InitialTitle

    $btnSearch = New-Object System.Windows.Forms.Button
    $btnSearch.Text = '搜索'
    $btnSearch.SetBounds(584, 13, 100, 26)

    $lblStatus = New-Object System.Windows.Forms.Label
    $lblStatus.Text = '输入关键词后按「搜索」。'
    $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
    $lblStatus.SetBounds(16, 46, 668, 20)

    $lst = New-Object System.Windows.Forms.ListBox
    $lst.SetBounds(16, 70, 668, 330)
    $lst.IntegralHeight = $false
    $lst.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $lblHint = New-Object System.Windows.Forms.Label
    $lblHint.Text = '双击结果直接选中；只显示前 200 条。'
    $lblHint.ForeColor = [System.Drawing.Color]::Gray
    $lblHint.SetBounds(16, 406, 460, 20)

    $btnOK = New-Object System.Windows.Forms.Button
    $btnOK.Text = '确定'
    $btnOK.SetBounds(490, 428, 90, 28)
    $btnOK.DialogResult = [System.Windows.Forms.DialogResult]::None

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = '取消'
    $btnCancel.SetBounds(594, 428, 90, 28)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.AcceptButton = $btnOK
    $form.CancelButton = $btnCancel

    function Do-KcTitleSearch {
        $kw = $tbKw.Text.Trim()
        if (-not $kw) {
            [System.Windows.Forms.MessageBox]::Show('请输入标题关键词。', '提示', 'OK', 'Warning') | Out-Null
            return
        }
        $lst.Items.Clear()
        $state.Results = @()
        $lblStatus.Text = '查询中…'
        $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
        [System.Windows.Forms.Application]::DoEvents()
        try {
            $rows = @(Find-KcTitleRows $ish $Kind $kw)
            $seen = @{}
            $items = @()
            foreach ($r in $rows) {
                $ref = "$(Get-Prop $r @('IshRef'))"
                if (-not $ref -or $seen.ContainsKey($ref)) { continue }
                $seen[$ref] = $true
                $title = "$(Get-Prop $r @('ftitle_logical_value', 'ftitle'))"
                $extra = ''
                if ($Kind -eq 'Pub') {
                    $extra = "$(Get-Prop $r @('fishpublngcombination'))"
                } else {
                    $extra = "$(Get-Prop $r @('doclanguage_lng_value', 'doclanguage'))"
                    $co = "$(Get-Prop $r @('checkedout', 'checkedoutby'))"
                    if ($co.Trim()) { $extra += '  检出:' + $co }
                }
                $items += [pscustomobject]@{
                    IshRef  = $ref
                    Title   = $title
                    Row     = $r
                    Display = ('{0}  [{1}]  {2}' -f $title, $ref, $extra)
                }
                if ($items.Count -ge 200) { break }
            }
            $state.Results = @($items)
            foreach ($it in $state.Results) { [void]$lst.Items.Add($it.Display) }
            if ($state.Results.Count -eq 0) {
                $lblStatus.Text = '没有找到匹配项。'
            } elseif ($rows.Count -gt $state.Results.Count) {
                $lblStatus.Text = ('命中 {0} 条，显示前 {1} 条。' -f $rows.Count, $state.Results.Count)
            } else {
                $lblStatus.Text = ('命中 {0} 条。' -f $state.Results.Count)
            }
        } catch {
            $lblStatus.Text = '搜索失败：' + $_.Exception.Message
        } finally {
            $form.Cursor = [System.Windows.Forms.Cursors]::Default
            [System.Windows.Forms.Application]::DoEvents()
        }
    }

    $btnSearch.Add_Click({ Do-KcTitleSearch })
    $tbKw.Add_KeyDown({
            if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
                $_.SuppressKeyPress = $true
                Do-KcTitleSearch
            }
        })
    $btnOK.Add_Click({
            $i = $lst.SelectedIndex
            if ($i -lt 0 -or $i -ge $state.Results.Count) {
                [System.Windows.Forms.MessageBox]::Show('请先搜索并选中一条。', '提示', 'OK', 'Warning') | Out-Null
                return
            }
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
        })
    $lst.Add_DoubleClick({
            $i = $lst.SelectedIndex
            if ($i -lt 0 -or $i -ge $state.Results.Count) { return }
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
        })

    $form.Controls.AddRange(@($lbKw, $tbKw, $btnSearch, $lblStatus, $lst, $lblHint, $btnOK, $btnCancel))

    if ($InitialTitle) {
        $form.Add_Shown({ try { Do-KcTitleSearch } catch { } })
    }

    $res = $form.ShowDialog()
    $out = $null
    if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
        $i = $lst.SelectedIndex
        if ($i -ge 0 -and $i -lt $state.Results.Count) { $out = $state.Results[$i] }
    }
    $form.Dispose()
    return $out
}

# ---------------------------------------------------------------- 登录辅助
# 证书回调必须是编译好的 .NET 委托：scriptblock 在异步 HTTP 的线程池线程上
# 会报“此线程中没有可用于运行脚本的运行空间”。
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

function Get-KcCertDiag {
    $h = 'kc-prod.hikvision.com'
    try { if ($script:wsUrl) { $h = ([uri]$script:wsUrl).Host } } catch { }
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
    try {
        if ('KcTlsBypass' -as [type]) {
            [void]$sb.AppendLine("  登录时回调记录 : $([KcTlsBypass]::Report())")
        }
    } catch { }
    return $sb.ToString().TrimEnd()
}

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
    return [bool]($txt -match 'AuthenticationException|SslStream|SSL/TLS|TLS|secure channel|基础连接已经关闭|证书|信任关系|trust relationship')
}

function Test-KcAuthError($err) {
    $txt = Get-KcErrText $err
    if (-not $txt) { return $false }
    return [bool]($txt -match '401|Unauthorized|unauthorized|未授权|凭据|凭证|密码|password|credential|logon|登录失败|Logon failure|Access is denied|拒绝访问')
}

# ---------------------------------------------------------------- STEP 1 登录
function Invoke-KcLogin {
$cred = $null
if ($IshUser -and $IshPassword) {
    $sec = ConvertTo-SecureString $IshPassword -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($IshUser, $sec)
} else {
    $cred = Get-Credential -Message '请输入 KC 账号和密码'
    if (-not $cred) { exit 0 }
}

Head 'STEP 1  登录 KC'

$script:wsUrl = 'https://kc-prod.hikvision.com/ISHWS/'
$ish = $null
$lastErr = $null
$win = $null
$authFailed = $false
$tried = New-Object System.Collections.ArrayList
$unknownTries = 0

$ladder = @(
    @{ Label = '第 1 级 标准校验登录';                      Loose = $false; Flag = $false },
    @{ Label = '第 2 级 自己放行证书校验重连';              Loose = $true;  Flag = $false },
    @{ Label = '第 3 级 自己放行 + ISHRemote 证书开关重连'; Loose = $true;  Flag = $true }
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
            $ish = New-IshSession -WsBaseUrl $script:wsUrl -PSCredential $cred -IgnoreSslPolicyErrors -ErrorAction Stop
        } else {
            $ish = New-IshSession -WsBaseUrl $script:wsUrl -PSCredential $cred -ErrorAction Stop
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

    if (-not (Test-KcTlsError $caught)) {
        # 账号类错误立刻停（每多试一次就多提交一次错误凭据）；
        # 说不清的错只再给一次机会，别因为一条被包装过的报错把降级路径全丢掉。
        if (Test-KcAuthError $caught) {
            $authFailed = $true
            Log '[..] 判定：账号或密码不正确 —— 停止降级重试（不再重复提交凭据）'
            break
        }
        if ($unknownTries -ge 1) {
            Log '[..] 判定：既不像证书问题也不像账号问题，已多试过一次，停止'
            break
        }
        $unknownTries++
        Log '[..] 判定：错误说不清，再换一种连法试一次'
        continue
    }
    Log '[..] 判定：证书/TLS 校验没谈拢，继续降级'
}

if ($ish) {
    $script:kcIsh = $ish
    $script:ish = $ish
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
    $diagTxt = ''
    if (Test-KcTlsError $lastErr) {
        $diagTxt = Get-KcCertDiag
        Log $diagTxt
    } else {
        Log '[..] 不是证书/TLS 问题，跳过证书诊断'
    }
    if (-not $script:headless) {
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

# 作者 / Publisher 由登录账号推导
$uRaw = "$($cred.UserName)".Trim()
if ($uRaw -match '\\') {
    $uName = ($uRaw -split '\\')[-1]
} elseif ($uRaw -match '@') {
    $uName = ($uRaw -split '@')[0]
} else {
    $uName = $uRaw
}
$acct = ($uName -replace '[^A-Za-z0-9]', '').ToUpper()
if (-not $acct) {
    Log '[X] 登录账号里没有可用的字母数字，无法推导 FAUTHOR / FISHPUBLISHER'
    exit 1
}
$script:authorElem = 'VUSER' + $acct
$script:publisherElem = 'VUSER' + $acct
Log ("[..] 推导 FAUTHOR = {0}；FISHPUBLISHER = {1}" -f $script:authorElem, $script:publisherElem)
}

# ---------------------------------------------------------------- 文本读取
# 内网 CSV 常见 GBK，UTF-8 也可能带/不带 BOM。先按 BOM / 严格 UTF-8，失败退回系统 ANSI。
function Read-KcTextFile([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    }
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
        return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
    }
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
        return [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2)
    }
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    try { return $utf8.GetString($bytes) } catch { return [Text.Encoding]::Default.GetString($bytes) }
}

# ---------------------------------------------------------------- 新建对象弹窗
function Show-KcCreateForm {
    param($ish, [string[]]$outputFormats, $masterTypes, [string]$defaultFolder)

    $parseLabels = @('自动（按文件扩展名）', '每行一个', 'CSV 第一列', 'Markdown 标题')
    $parseValues = @('Auto', 'Lines', 'Csv', 'Markdown')
    $topicItems = @(
        [pscustomobject]@{ Label = 'Concept（概念）'; Value = 'VMODULETYPECONCEPT' },
        [pscustomobject]@{ Label = 'Task（任务）'; Value = 'VMODULETYPETASK' },
        [pscustomobject]@{ Label = 'Reference（参考）'; Value = 'VMODULETYPEREFERENCE' }
    )
    $masterItems = @($masterTypes)
    if ($masterItems.Count -eq 0) {
        $masterItems = @(
            [pscustomobject]@{ Label = 'User Manual Map'; Value = 'VMASTERTYPEUSERMANUALMAP' },
            [pscustomobject]@{ Label = 'Specification Map'; Value = 'VMASTERTYPESPECIFICATIONMAP' }
        )
    }
    if (-not $outputFormats -or $outputFormats.Count -eq 0) { $outputFormats = @('VOUTPUTFORMATPDF1-MANUAL-A4') }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'KC 新建对象'
    $form.ClientSize = New-Object System.Drawing.Size(800, 686)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

    $tabMain = New-Object System.Windows.Forms.TabControl
    $tabMain.SetBounds(14, 14, 772, 492)

    # ---------------- Topic ----------------
    $tabTopic = New-Object System.Windows.Forms.TabPage
    $tabTopic.Text = '新建 Topic'
    $tabTopic.Padding = New-Object System.Windows.Forms.Padding(3)

    $grpTopicSrc = New-Object System.Windows.Forms.GroupBox
    $grpTopicSrc.Text = '来源'
    $grpTopicSrc.SetBounds(12, 12, 736, 322)

    $rbXml = New-Object System.Windows.Forms.RadioButton
    $rbXml.Text = '① 导入本地目录中的 XML 文件（递归；标题取 XML 的 <title>）'
    $rbXml.SetBounds(14, 24, 700, 22)
    $rbXml.Checked = $true

    $pnlXml = New-Object System.Windows.Forms.Panel
    $pnlXml.SetBounds(14, 50, 708, 100)

    $lbXmlDir = New-Object System.Windows.Forms.Label
    $lbXmlDir.Text = 'XML 目录'
    $lbXmlDir.SetBounds(0, 8, 70, 22)

    $tbXmlDir = New-Object System.Windows.Forms.TextBox
    $tbXmlDir.SetBounds(76, 4, 510, 24)

    $btnXmlDir = New-Object System.Windows.Forms.Button
    $btnXmlDir.Text = '浏览…'
    $btnXmlDir.SetBounds(594, 3, 100, 26)

    $lblXmlCount = New-Object System.Windows.Forms.Label
    $lblXmlCount.Text = '未选择目录'
    $lblXmlCount.ForeColor = [System.Drawing.Color]::DimGray
    $lblXmlCount.SetBounds(0, 36, 700, 20)

    $lblXmlHint = New-Object System.Windows.Forms.Label
    $lblXmlHint.Text = '递归子目录；KC 侧按本地子目录镜像建同名文件夹；类型按根元素 concept / task / reference 判断。'
    $lblXmlHint.ForeColor = [System.Drawing.Color]::Gray
    $lblXmlHint.SetBounds(0, 58, 700, 36)

    $pnlXml.Controls.AddRange(@($lbXmlDir, $tbXmlDir, $btnXmlDir, $lblXmlCount, $lblXmlHint))

    $rbTitles = New-Object System.Windows.Forms.RadioButton
    $rbTitles.Text = '② 从标题创建空 topic（Text / CSV / Markdown）'
    $rbTitles.SetBounds(14, 158, 700, 22)

    $pnlTitles = New-Object System.Windows.Forms.Panel
    $pnlTitles.SetBounds(14, 184, 708, 130)

    $tbTitles = New-Object System.Windows.Forms.TextBox
    $tbTitles.SetBounds(0, 0, 510, 100)
    $tbTitles.Multiline = $true
    $tbTitles.ScrollBars = 'Vertical'
    $tbTitles.AcceptsReturn = $true

    $btnReadTitles = New-Object System.Windows.Forms.Button
    $btnReadTitles.Text = '读取文件…'
    $btnReadTitles.SetBounds(520, 0, 110, 26)

    $btnClearTitles = New-Object System.Windows.Forms.Button
    $btnClearTitles.Text = '清空'
    $btnClearTitles.SetBounds(520, 32, 110, 26)

    $lblParse = New-Object System.Windows.Forms.Label
    $lblParse.Text = '解析方式'
    $lblParse.SetBounds(520, 64, 110, 18)

    $cbParse = New-Object System.Windows.Forms.ComboBox
    $cbParse.SetBounds(520, 84, 180, 22)
    $cbParse.DropDownStyle = 'DropDownList'
    [void]$cbParse.Items.AddRange([object[]]$parseLabels)
    $cbParse.SelectedIndex = 0

    $lblTopicType = New-Object System.Windows.Forms.Label
    $lblTopicType.Text = '空 topic 类型'
    $lblTopicType.SetBounds(0, 106, 90, 20)

    $cbTopicType = New-Object System.Windows.Forms.ComboBox
    $cbTopicType.SetBounds(96, 104, 180, 22)
    $cbTopicType.DropDownStyle = 'DropDownList'
    $cbTopicType.DisplayMember = 'Label'
    $cbTopicType.ValueMember = 'Value'
    [void]$cbTopicType.Items.AddRange([object[]]$topicItems)
    $cbTopicType.SelectedIndex = 0

    $lblTitlesHint = New-Object System.Windows.Forms.Label
    $lblTitlesHint.Text = 'CSV 取 Title / 标题 列；Markdown 取 # / ## / ### 标题行。'
    $lblTitlesHint.ForeColor = [System.Drawing.Color]::Gray
    $lblTitlesHint.SetBounds(286, 106, 410, 20)

    $pnlTitles.Controls.AddRange(@($tbTitles, $btnReadTitles, $btnClearTitles, $lblParse, $cbParse, $lblTopicType, $cbTopicType, $lblTitlesHint))

    $grpTopicSrc.Controls.AddRange(@($rbXml, $pnlXml, $rbTitles, $pnlTitles))

    $grpAttachMap = New-Object System.Windows.Forms.GroupBox
    $grpAttachMap.Text = '挂接（可选）'
    $grpAttachMap.SetBounds(12, 340, 736, 108)

    $chkAttachMap = New-Object System.Windows.Forms.CheckBox
    $chkAttachMap.Text = '创建后把新建的 topic 挂到指定 Map'
    $chkAttachMap.SetBounds(14, 22, 340, 22)

    $tbAttachMap = New-Object System.Windows.Forms.TextBox
    $tbAttachMap.SetBounds(14, 50, 560, 24)
    $tbAttachMap.Enabled = $false

    $btnAttachMap = New-Object System.Windows.Forms.Button
    $btnAttachMap.Text = '搜索…'
    $btnAttachMap.SetBounds(582, 49, 100, 26)
    $btnAttachMap.Enabled = $false

    $lblAttachMapTitle = New-Object System.Windows.Forms.Label
    $lblAttachMapTitle.Text = '需要 scripts\templates\ 下有一份带 <topicref> 的 map XML 样例，否则只预检不写。'
    $lblAttachMapTitle.ForeColor = [System.Drawing.Color]::DimGray
    $lblAttachMapTitle.SetBounds(14, 78, 700, 20)

    $grpAttachMap.Controls.AddRange(@($chkAttachMap, $tbAttachMap, $btnAttachMap, $lblAttachMapTitle))

    $tabTopic.Controls.AddRange(@($grpTopicSrc, $grpAttachMap))

    # ---------------- Map ----------------
    $tabMap = New-Object System.Windows.Forms.TabPage
    $tabMap.Text = '新建 Map'
    $tabMap.Padding = New-Object System.Windows.Forms.Padding(3)

    $grpMapSrc = New-Object System.Windows.Forms.GroupBox
    $grpMapSrc.Text = '来源'
    $grpMapSrc.SetBounds(12, 12, 736, 330)

    $rbMapTitles = New-Object System.Windows.Forms.RadioButton
    $rbMapTitles.Text = '① 从标题创建空 map（Text / CSV / Markdown）'
    $rbMapTitles.SetBounds(14, 24, 700, 22)
    $rbMapTitles.Checked = $true

    $pnlMapTitles = New-Object System.Windows.Forms.Panel
    $pnlMapTitles.SetBounds(14, 50, 708, 160)

    $tbMapTitles = New-Object System.Windows.Forms.TextBox
    $tbMapTitles.SetBounds(0, 0, 510, 110)
    $tbMapTitles.Multiline = $true
    $tbMapTitles.ScrollBars = 'Vertical'
    $tbMapTitles.AcceptsReturn = $true

    $btnReadMapTitles = New-Object System.Windows.Forms.Button
    $btnReadMapTitles.Text = '读取文件…'
    $btnReadMapTitles.SetBounds(520, 0, 110, 26)

    $btnClearMapTitles = New-Object System.Windows.Forms.Button
    $btnClearMapTitles.Text = '清空'
    $btnClearMapTitles.SetBounds(520, 32, 110, 26)

    $lblMasterType = New-Object System.Windows.Forms.Label
    $lblMasterType.Text = 'Map 类型'
    $lblMasterType.SetBounds(0, 116, 90, 20)

    $cbMasterType = New-Object System.Windows.Forms.ComboBox
    $cbMasterType.SetBounds(96, 114, 240, 22)
    $cbMasterType.DropDownStyle = 'DropDownList'
    $cbMasterType.DisplayMember = 'Label'
    $cbMasterType.ValueMember = 'Value'
    [void]$cbMasterType.Items.AddRange([object[]]$masterItems)
    $defMasterIdx = 0
    for ($i = 0; $i -lt $masterItems.Count; $i++) {
        if ("$($masterItems[$i].Value)" -eq 'VMASTERTYPEUSERMANUALMAP') { $defMasterIdx = $i; break }
    }
    $cbMasterType.SelectedIndex = $defMasterIdx

    $lblMapParse = New-Object System.Windows.Forms.Label
    $lblMapParse.Text = '解析'
    $lblMapParse.SetBounds(346, 116, 60, 20)

    $cbMapParse = New-Object System.Windows.Forms.ComboBox
    $cbMapParse.SetBounds(410, 114, 180, 22)
    $cbMapParse.DropDownStyle = 'DropDownList'
    [void]$cbMapParse.Items.AddRange([object[]]$parseLabels)
    $cbMapParse.SelectedIndex = 0

    $lblMapTitlesHint = New-Object System.Windows.Forms.Label
    $lblMapTitlesHint.Text = 'CSV 取 Title / 标题 列；Markdown 取 # / ## / ### 标题行；每行一个标题也可以。'
    $lblMapTitlesHint.ForeColor = [System.Drawing.Color]::Gray
    $lblMapTitlesHint.SetBounds(0, 138, 700, 20)

    $pnlMapTitles.Controls.AddRange(@($tbMapTitles, $btnReadMapTitles, $btnClearMapTitles, $lblMasterType, $cbMasterType, $lblMapParse, $cbMapParse, $lblMapTitlesHint))

    $rbMapXml = New-Object System.Windows.Forms.RadioButton
    $rbMapXml.Text = '② 上传本地 map XML（标题取 XML 的 <title>）'
    $rbMapXml.SetBounds(14, 212, 700, 22)

    $pnlMapXml = New-Object System.Windows.Forms.Panel
    $pnlMapXml.SetBounds(14, 238, 708, 64)
    $pnlMapXml.Visible = $false

    $lbMapXml = New-Object System.Windows.Forms.Label
    $lbMapXml.Text = 'map XML'
    $lbMapXml.SetBounds(0, 8, 70, 22)

    $tbMapXml = New-Object System.Windows.Forms.TextBox
    $tbMapXml.SetBounds(76, 4, 510, 24)

    $btnMapXml = New-Object System.Windows.Forms.Button
    $btnMapXml.Text = '浏览…'
    $btnMapXml.SetBounds(594, 3, 100, 26)

    $lblMapXmlTitle = New-Object System.Windows.Forms.Label
    $lblMapXmlTitle.Text = '未选择文件'
    $lblMapXmlTitle.ForeColor = [System.Drawing.Color]::DimGray
    $lblMapXmlTitle.SetBounds(0, 36, 700, 20)

    $pnlMapXml.Controls.AddRange(@($lbMapXml, $tbMapXml, $btnMapXml, $lblMapXmlTitle))

    $grpMapSrc.Controls.AddRange(@($rbMapTitles, $pnlMapTitles, $rbMapXml, $pnlMapXml))

    $grpAttachPub = New-Object System.Windows.Forms.GroupBox
    $grpAttachPub.Text = '挂接（可选，仅单条 Map）'
    $grpAttachPub.SetBounds(12, 350, 736, 110)

    $chkAttachPub = New-Object System.Windows.Forms.CheckBox
    $chkAttachPub.Text = '创建后把新建的 map 挂到指定 Pub'
    $chkAttachPub.SetBounds(14, 18, 340, 22)

    $tbAttachPub = New-Object System.Windows.Forms.TextBox
    $tbAttachPub.SetBounds(14, 44, 560, 24)
    $tbAttachPub.Enabled = $false

    $btnAttachPub = New-Object System.Windows.Forms.Button
    $btnAttachPub.Text = '搜索…'
    $btnAttachPub.SetBounds(582, 43, 100, 26)
    $btnAttachPub.Enabled = $false

    $lblAttachPubTitle = New-Object System.Windows.Forms.Label
    $lblAttachPubTitle.Text = '批量 Map 不挂 Pub；pub 已挂 master 时会跳过。'
    $lblAttachPubTitle.ForeColor = [System.Drawing.Color]::DimGray
    $lblAttachPubTitle.SetBounds(14, 72, 700, 18)

    $lblAttachPubHint = New-Object System.Windows.Forms.Label
    $lblAttachPubHint.Text = '写 FISHMASTERREF（需求书 R-09b，API 尚未实测）。'
    $lblAttachPubHint.ForeColor = [System.Drawing.Color]::Gray
    $lblAttachPubHint.SetBounds(14, 90, 700, 18)

    $grpAttachPub.Controls.AddRange(@($chkAttachPub, $tbAttachPub, $btnAttachPub, $lblAttachPubTitle, $lblAttachPubHint))

    $tabMap.Controls.AddRange(@($grpMapSrc, $grpAttachPub))

    # ---------------- Pub ----------------
    $tabPub = New-Object System.Windows.Forms.TabPage
    $tabPub.Text = '新建 Pub'
    $tabPub.Padding = New-Object System.Windows.Forms.Padding(3)

    $grpPub = New-Object System.Windows.Forms.GroupBox
    $grpPub.Text = 'Publication'
    $grpPub.SetBounds(12, 12, 736, 330)

    $lbPubTitle = New-Object System.Windows.Forms.Label
    $lbPubTitle.Text = '标题'
    $lbPubTitle.SetBounds(18, 30, 100, 22)

    $tbPubTitle = New-Object System.Windows.Forms.TextBox
    $tbPubTitle.SetBounds(124, 26, 560, 24)

    $lbPubFormat = New-Object System.Windows.Forms.Label
    $lbPubFormat.Text = 'OutputFormat'
    $lbPubFormat.SetBounds(18, 70, 100, 22)

    $cbPubFormat = New-Object System.Windows.Forms.ComboBox
    $cbPubFormat.SetBounds(124, 66, 560, 24)
    $cbPubFormat.DropDownStyle = 'DropDownList'
    [void]$cbPubFormat.Items.AddRange([object[]]$outputFormats)
    $defIdx = 0
    for ($i = 0; $i -lt $outputFormats.Count; $i++) {
        if ($outputFormats[$i] -eq 'VOUTPUTFORMATPDF1-MANUAL-A4') { $defIdx = $i; break }
    }
    $cbPubFormat.SelectedIndex = $defIdx

    $lbPubLang = New-Object System.Windows.Forms.Label
    $lbPubLang.Text = '语言组合'
    $lbPubLang.SetBounds(18, 110, 100, 22)

    $tbPubLang = New-Object System.Windows.Forms.TextBox
    $tbPubLang.SetBounds(124, 106, 200, 24)
    $tbPubLang.ReadOnly = $true
    $tbPubLang.Text = $LanguageCombination

    $lbPubType = New-Object System.Windows.Forms.Label
    $lbPubType.Text = 'Publication 类型'
    $lbPubType.SetBounds(18, 150, 100, 22)

    $tbPubType = New-Object System.Windows.Forms.TextBox
    $tbPubType.SetBounds(124, 146, 560, 24)
    $tbPubType.ReadOnly = $true

    $lbPubPublisher = New-Object System.Windows.Forms.Label
    $lbPubPublisher.Text = 'Publisher'
    $lbPubPublisher.SetBounds(18, 190, 100, 22)

    $tbPubPublisher = New-Object System.Windows.Forms.TextBox
    $tbPubPublisher.SetBounds(124, 186, 300, 24)
    $tbPubPublisher.ReadOnly = $true
    $tbPubPublisher.Text = $script:publisherElem

    $lblPubHint = New-Object System.Windows.Forms.Label
    $lblPubHint.Text = "建的是空 pub（不挂 master）；baseline 由服务端生成。`r`nOutputFormat 决定 Publication 类型；Publisher 由登录账号推导。"
    $lblPubHint.ForeColor = [System.Drawing.Color]::Gray
    $lblPubHint.SetBounds(18, 230, 700, 60)

    $grpPub.Controls.AddRange(@($lbPubTitle, $tbPubTitle, $lbPubFormat, $cbPubFormat, $lbPubLang, $tbPubLang, $lbPubType, $tbPubType, $lbPubPublisher, $tbPubPublisher, $lblPubHint))

    $tabPub.Controls.AddRange(@($grpPub))

    [void]$tabMain.TabPages.Add($tabTopic)
    [void]$tabMain.TabPages.Add($tabMap)
    [void]$tabMain.TabPages.Add($tabPub)

    # ---------------- 共用目标目录 ----------------
    $grpFolder = New-Object System.Windows.Forms.GroupBox
    $grpFolder.Text = 'KC 目标目录'
    $grpFolder.SetBounds(14, 512, 772, 92)

    $lbFolder = New-Object System.Windows.Forms.Label
    $lbFolder.Text = 'KC 目标目录'
    $lbFolder.SetBounds(14, 24, 90, 22)

    $tbFolder = New-Object System.Windows.Forms.TextBox
    $tbFolder.SetBounds(110, 20, 520, 24)
    $tbFolder.Text = $defaultFolder

    $btnFolder = New-Object System.Windows.Forms.Button
    $btnFolder.Text = '浏览…'
    $btnFolder.SetBounds(636, 19, 110, 26)

    $chkCreate = New-Object System.Windows.Forms.CheckBox
    $chkCreate.Text = '缺失的目录自动创建'
    $chkCreate.SetBounds(110, 52, 200, 22)
    $chkCreate.Checked = $true

    $lblFolderHint = New-Object System.Windows.Forms.Label
    $lblFolderHint.Text = '反斜杠分隔，不带前导符号；可直接粘贴。/General/... 也可以。'
    $lblFolderHint.ForeColor = [System.Drawing.Color]::Gray
    $lblFolderHint.SetBounds(316, 54, 430, 20)

    $grpFolder.Controls.AddRange(@($lbFolder, $tbFolder, $btnFolder, $chkCreate, $lblFolderHint))

    $lblStatus = New-Object System.Windows.Forms.Label
    $lblStatus.Text = '选择类型、填参数，然后点「预检并继续」。预检不会写入任何内容。'
    $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
    $lblStatus.SetBounds(18, 610, 600, 20)

    $btnOK = New-Object System.Windows.Forms.Button
    $btnOK.Text = '预检并继续'
    $btnOK.SetBounds(600, 638, 120, 34)
    $btnOK.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = '取消'
    $btnCancel.SetBounds(728, 638, 58, 34)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.AcceptButton = $btnOK
    $form.CancelButton = $btnCancel
    $form.Controls.AddRange(@($tabMain, $grpFolder, $lblStatus, $btnOK, $btnCancel))

    # ---------------- 事件 ----------------
    $rbXml.Add_CheckedChanged({
            $pnlXml.Visible = $rbXml.Checked
            $pnlTitles.Visible = -not $rbXml.Checked
        })
    $rbMapTitles.Add_CheckedChanged({
            $pnlMapTitles.Visible = $rbMapTitles.Checked
            $pnlMapXml.Visible = -not $rbMapTitles.Checked
        })
    $chkAttachMap.Add_CheckedChanged({
            $tbAttachMap.Enabled = $chkAttachMap.Checked
            $btnAttachMap.Enabled = $chkAttachMap.Checked
        })
    $chkAttachPub.Add_CheckedChanged({
            $tbAttachPub.Enabled = $chkAttachPub.Checked
            $btnAttachPub.Enabled = $chkAttachPub.Checked
        })

    $cbPubFormat.Add_SelectedIndexChanged({
            $v = "$($cbPubFormat.SelectedItem)"
            if ($v -match '^VOUTPUTFORMAT(.+)$') {
                $tbPubType.Text = 'VPUBLICATIONTYPE' + $Matches[1]
            } else {
                $tbPubType.Text = '（无法由 OutputFormat 推导）'
            }
        })

    $btnFolder.Add_Click({
            $sel = Show-KcFolderPicker $ish $tbFolder.Text
            if ($sel) { $tbFolder.Text = $sel }
        })

    function Update-KcXmlCount {
        if ($form.IsDisposed -or $tbXmlDir.IsDisposed) { return }
        $p = $tbXmlDir.Text.Trim()
        if (-not $p -or -not (Test-Path -LiteralPath $p)) {
            $lblXmlCount.Text = '未选择目录 / 目录不存在'
            return
        }
        try {
            $n = @(Get-ChildItem -LiteralPath $p -File -Recurse -Filter '*.xml' -ErrorAction SilentlyContinue).Count
            $lblXmlCount.Text = "已找到 $n 个 XML（递归）"
        } catch {
            $lblXmlCount.Text = '读取目录失败'
        }
    }

    $btnXmlDir.Add_Click({
            $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
            $dlg.Description = '选择本地 XML 目录'
            if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $tbXmlDir.Text = $dlg.SelectedPath
                Update-KcXmlCount
            }
        })
    $tbXmlDir.Add_Leave({ Update-KcXmlCount })

    $btnReadTitles.Add_Click({
            $dlg = New-Object System.Windows.Forms.OpenFileDialog
            $dlg.Filter = '标题文件|*.txt;*.csv;*.md;*.markdown|文本|*.txt|CSV|*.csv|Markdown|*.md;*.markdown|所有文件|*.*'
            if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                try {
                    $tbTitles.Text = Read-KcTextFile $dlg.FileName
                    $tbTitles.Tag = $dlg.FileName
                    $ext = [IO.Path]::GetExtension($dlg.FileName).ToLowerInvariant()
                    if ($ext -eq '.csv') { $cbParse.SelectedIndex = 2 }
                    elseif ($ext -eq '.md' -or $ext -eq '.markdown') { $cbParse.SelectedIndex = 3 }
                    else { $cbParse.SelectedIndex = 1 }
                } catch {
                    [System.Windows.Forms.MessageBox]::Show(("读取失败：`r`n" + $_.Exception.Message), '提示', 'OK', 'Warning') | Out-Null
                }
            }
        })
    $btnClearTitles.Add_Click({
            $tbTitles.Text = ''
            $tbTitles.Tag = ''
        })

    $btnReadMapTitles.Add_Click({
            $dlg = New-Object System.Windows.Forms.OpenFileDialog
            $dlg.Filter = '标题文件|*.txt;*.csv;*.md;*.markdown|文本|*.txt|CSV|*.csv|Markdown|*.md;*.markdown|所有文件|*.*'
            if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                try {
                    $tbMapTitles.Text = Read-KcTextFile $dlg.FileName
                    $tbMapTitles.Tag = $dlg.FileName
                    $ext = [IO.Path]::GetExtension($dlg.FileName).ToLowerInvariant()
                    if ($ext -eq '.csv') { $cbMapParse.SelectedIndex = 2 }
                    elseif ($ext -eq '.md' -or $ext -eq '.markdown') { $cbMapParse.SelectedIndex = 3 }
                    else { $cbMapParse.SelectedIndex = 1 }
                } catch {
                    [System.Windows.Forms.MessageBox]::Show(("读取失败：`r`n" + $_.Exception.Message), '提示', 'OK', 'Warning') | Out-Null
                }
            }
        })
    $btnClearMapTitles.Add_Click({
            $tbMapTitles.Text = ''
            $tbMapTitles.Tag = ''
        })

    $btnMapXml.Add_Click({
            $dlg = New-Object System.Windows.Forms.OpenFileDialog
            $dlg.Filter = 'map XML|*.xml|所有文件|*.*'
            if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $tbMapXml.Text = $dlg.FileName
                $info = Get-KcXmlInfo $dlg.FileName
                if ($info.Title) {
                    $lblMapXmlTitle.Text = "标题：$($info.Title)（根元素 $($info.Root)）"
                } else {
                    $lblMapXmlTitle.Text = "读不到 <title>：$($info.Error)"
                }
            }
        })

    $btnAttachMap.Add_Click({
            $init = $tbAttachMap.Text.Trim()
            if ($init -match '^GUID-') { $init = '' }
            $sel = Show-KcObjectPicker $ish 'Map' $init
            if ($sel) {
                $tbAttachMap.Text = $sel.IshRef
                $lblAttachMapTitle.Text = "已选：$($sel.Title)（挂接需要 scripts\templates\ 下的 topicref 样例）"
            }
        })
    $btnAttachPub.Add_Click({
            $init = $tbAttachPub.Text.Trim()
            if ($init -match '^GUID-') { $init = '' }
            $sel = Show-KcObjectPicker $ish 'Pub' $init
            if ($sel) {
                $tbAttachPub.Text = $sel.IshRef
                $lblAttachPubTitle.Text = "已选：$($sel.Title)（pub 已挂 master 时会跳过）"
            }
        })

    if ($defaultFolder) { $lblStatus.Text = '已带默认目录，可直接修改。预检不会写入任何内容。' }
    $cbPubFormat.SelectedIndex = $defIdx
    $v0 = "$($cbPubFormat.SelectedItem)"
    if ($v0 -match '^VOUTPUTFORMAT(.+)$') { $tbPubType.Text = 'VPUBLICATIONTYPE' + $Matches[1] }

    function Get-KcFormResult {
        $type = if ($tabMain.SelectedTab -eq $tabTopic) { 'Topic' } elseif ($tabMain.SelectedTab -eq $tabMap) { 'Map' } else { 'Pub' }
        $folder = Normalize-KcPath $tbFolder.Text
        if (-not $folder) { throw 'KC 目标目录不能为空。' }

        $xmlDir = ''
        $mapXml = ''
        $titlesText = ''
        $titlesFile = ''
        $parseMode = 'Auto'
        $topicType = $topicItems[0].Value
        $masterType = $masterItems[0].Value
        $pubTitle = ''
        $pubFormat = ''
        $titleCount = 0
        $mode = ''

        if ($type -eq 'Topic') {
            $topicType = "$($cbTopicType.SelectedItem.Value)"
            if ($rbXml.Checked) {
                $mode = 'Xml'
                $xmlDir = "$($tbXmlDir.Text)".Trim()
                if (-not $xmlDir -or -not (Test-Path -LiteralPath $xmlDir)) { throw 'XML 目录不存在，请重新选择。' }
                $titleCount = @(Get-ChildItem -LiteralPath $xmlDir -File -Recurse -Filter '*.xml' -ErrorAction Stop).Count
                if ($titleCount -eq 0) { throw 'XML 目录里没有 .xml 文件。' }
            } else {
                $mode = 'Titles'
                $titlesText = $tbTitles.Text
                $titlesFile = "$($tbTitles.Tag)"
                $parseMode = $parseValues[$cbParse.SelectedIndex]
                try { $titleCount = @(Get-KcTitleList $titlesText $parseMode $titlesFile).Count }
                catch { throw ('标题解析失败：' + $_.Exception.Message) }
                if ($titleCount -eq 0) { throw '没有解析出任何标题。' }
            }
        } elseif ($type -eq 'Map') {
            $masterType = "$($cbMasterType.SelectedItem.Value)"
            if ($rbMapTitles.Checked) {
                $mode = 'Titles'
                $titlesText = $tbMapTitles.Text
                $titlesFile = "$($tbMapTitles.Tag)"
                $parseMode = $parseValues[$cbMapParse.SelectedIndex]
                try { $titleCount = @(Get-KcTitleList $titlesText $parseMode $titlesFile).Count }
                catch { throw ('标题解析失败：' + $_.Exception.Message) }
                if ($titleCount -eq 0) { throw '没有解析出任何标题。' }
            } else {
                $mode = 'MapXml'
                $mapXml = "$($tbMapXml.Text)".Trim()
                if (-not $mapXml -or -not (Test-Path -LiteralPath $mapXml)) { throw 'map XML 文件不存在，请重新选择。' }
                $info = Get-KcXmlInfo $mapXml
                if (-not $info.Title) { throw ("读不到 map XML 的 <title>：`r`n" + $info.Error) }
                $titleCount = 1
            }
        } else {
            $mode = 'Pub'
            $pubTitle = "$($tbPubTitle.Text)".Trim()
            if (-not $pubTitle) { throw 'Pub 标题不能为空。' }
            $pubFormat = "$($cbPubFormat.SelectedItem)"
            if (-not $pubFormat) { throw '请选择 OutputFormat。' }
            $titleCount = 1
        }

        $attachMap = ''
        $attachPub = ''
        if ($type -eq 'Topic' -and $chkAttachMap.Checked) {
            $attachMap = "$($tbAttachMap.Text)".Trim()
            if (-not $attachMap) { throw '勾了挂到 Map，但没有选择目标 Map。' }
        }
        if ($type -eq 'Map' -and $chkAttachPub.Checked) {
            $attachPub = "$($tbAttachPub.Text)".Trim()
            if (-not $attachPub) { throw '勾了挂到 Pub，但没有选择目标 Pub。' }
            if ($titleCount -gt 1) { throw '批量 Map 不支持挂 Pub；请只留一个标题，或取消挂接。' }
        }

        return @{
            Type         = $type
            Mode         = $mode
            FolderPath   = $folder
            CreateFolder = [bool]$chkCreate.Checked
            XmlDir       = $xmlDir
            MapXmlFile   = $mapXml
            TitlesText   = $titlesText
            TitlesFile   = $titlesFile
            ParseMode    = $parseMode
            TopicType    = $topicType
            MasterType   = $masterType
            Title        = $pubTitle
            OutputFormat = $pubFormat
            AttachMap    = $attachMap
            AttachPub    = $attachPub
            TitleCount   = $titleCount
            LanguageCombination = $LanguageCombination
            LanguageElement     = $LanguageElement
        }
    }

    $rbXml.Checked = $true
    $pnlXml.Visible = $true
    $pnlTitles.Visible = $false
    $rbMapTitles.Checked = $true
    $pnlMapTitles.Visible = $true
    $pnlMapXml.Visible = $false

    while ($true) {
        $form.DialogResult = [System.Windows.Forms.DialogResult]::None
        $r = $form.ShowDialog()
        if ($r -ne [System.Windows.Forms.DialogResult]::OK) {
            $form.Dispose()
            return $null
        }
        try {
            $res = Get-KcFormResult
            $form.Dispose()
            return $res
        } catch {
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '提示', 'OK', 'Warning') | Out-Null
        }
    }
}

# ---------------------------------------------------------------- 对象清单
function Get-KcTopicTypeElement([string]$v) {
    if ($v -match '^VMODULETYPE') { return $v }
    switch ("$v".ToLowerInvariant()) {
        'concept' { return 'VMODULETYPECONCEPT' }
        'task' { return 'VMODULETYPETASK' }
        'reference' { return 'VMODULETYPEREFERENCE' }
        default { return 'VMODULETYPECONCEPT' }
    }
}

function Get-KcMasterTypeElement([string]$v) {
    if ($v -match '^VMASTERTYPE') { return $v }
    switch ("$v".ToLowerInvariant()) {
        'user manual map' { return 'VMASTERTYPEUSERMANUALMAP' }
        'specification map' { return 'VMASTERTYPESPECIFICATIONMAP' }
        'usermanual' { return 'VMASTERTYPEUSERMANUALMAP' }
        'specification' { return 'VMASTERTYPESPECIFICATIONMAP' }
        default { return $v }
    }
}

# ---------------------------------------------------------------- 文件夹类型闸门
# KC 的对象只能落进「类型匹配」的文件夹，否则服务端直接拒绝：
#   Add-IshDocumentObj -> [-129] InvalidDocTypeforFolder
#   实测对照（scripts\logs\kc-probe-folders-20261026-110824.txt 第 126-129 行）：
#     map(1893032)=ISHMasterDoc / topic(1893031)=ISHModule
#     发布物(1893033)=ISHPublication / 图片(1893030)=ISHIllustration
# 注意：FolderType 为 ISHNone 的普通容器**什么对象都装不了**，只能再往下建容器。
# 空串 / $null 视为「服务端没给证据」，不拦（避免误伤）。
function Get-KcFolderTypeFor([string]$kind) {
    switch ("$kind") {
        'Topic' { return 'ISHModule' }
        'Map' { return 'ISHMasterDoc' }
        'Pub' { return 'ISHPublication' }
        default { return '' }
    }
}

# 类型不匹配时要自动建的子文件夹名（库惯例：Maps\ / Publications\ 与手册目录并列）
function Get-KcContainerNameFor([string]$kind, $cfg) {
    $custom = ''
    if ($cfg) {
        if ($cfg -is [hashtable] -or $cfg -is [System.Collections.IDictionary]) {
            if ($cfg.Contains('ContainerName')) { $custom = "$($cfg['ContainerName'])" }
        } elseif ($cfg.PSObject.Properties['ContainerName']) {
            $custom = "$($cfg.ContainerName)"
        }
    }
    if ("$custom".Trim()) { return "$custom".Trim() }
    switch ("$kind") {
        'Topic' { return 'Topics' }
        'Map' { return 'Maps' }
        'Pub' { return 'Publications' }
        default { return '' }
    }
}

# 文件夹能不能装这种对象：返回 $null = 放行；返回字符串 = 拦下原因
function Get-KcFolderTypeGate([string]$folderType, [string]$kind) {
    $want = Get-KcFolderTypeFor $kind
    if (-not $want) { return $null }
    $ft = "$folderType".Trim()
    if (-not $ft) { return $null }
    if ($ft -eq $want) { return $null }
    return ('文件夹类型是 {0}，装不了 {1}（需要 {2}）' -f $ft, $kind, $want)
}

function New-KcPlanItem([string]$kind, [string]$mode, [string]$title, [string]$typeElement, [string]$sourcePath, [string]$relDir, [string]$baseFolder) {
    $target = $baseFolder
    if ($relDir) { $target = $baseFolder.TrimEnd('\') + '\' + $relDir.Trim('\') }
    return [pscustomobject]@{
        Kind            = $kind
        Mode            = $mode
        Title           = $title
        TypeElement     = $typeElement
        SourcePath      = $sourcePath
        RelDir          = $relDir
        TargetPath      = $target
        State           = 'TOCREATE'
        Note            = ''
        IshRef          = ''
        ObjectRef       = ''
        Version         = ''
        Lng             = ''
        FolderId        = 0
        FolderType      = ''
        MissingSegments = @()
        MissingBase     = $false
        Created         = $false
        PublicationType = ''
        OutputFormat    = ''
        Exec            = $false
    }
}

function Build-KcPlan($cfg) {
    $plan = New-Object System.Collections.ArrayList
    $base = Normalize-KcPath $cfg.FolderPath
    if (-not $base) { throw 'KC 目标目录不能为空。' }
    $kind = $cfg.Type

    if ($kind -eq 'Pub') {
        if (-not "$($cfg.Title)".Trim()) { throw 'Pub 标题不能为空。' }
        $item = New-KcPlanItem 'Pub' 'Pub' $cfg.Title '' '' '' $base
        $item.OutputFormat = $cfg.OutputFormat
        [void]$plan.Add($item)
    } elseif ($kind -eq 'Topic' -and $cfg.Mode -eq 'Xml') {
        if (-not $cfg.XmlDir -or -not (Test-Path -LiteralPath $cfg.XmlDir)) { throw 'XML 目录不存在。' }
        $root = (Resolve-Path -LiteralPath $cfg.XmlDir -ErrorAction Stop).Path.TrimEnd('\', '/')
        $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Filter '*.xml' -ErrorAction Stop | Sort-Object FullName)
        if ($files.Count -eq 0) { throw 'XML 目录里没有 .xml 文件。' }
        foreach ($f in $files) {
            $rel = ''
            try {
                $dirFull = [IO.Path]::GetFullPath($f.DirectoryName).TrimEnd('\', '/')
                if ($dirFull.Length -gt $root.Length) { $rel = $dirFull.Substring($root.Length).TrimStart('\', '/') }
            } catch { }
            $info = Get-KcXmlInfo $f.FullName
            $rootName = "$($info.Root)".ToLowerInvariant()
            $typeElem = ''
            if ($rootName -eq 'concept') { $typeElem = 'VMODULETYPECONCEPT' }
            elseif ($rootName -eq 'task') { $typeElem = 'VMODULETYPETASK' }
            elseif ($rootName -eq 'reference') { $typeElem = 'VMODULETYPEREFERENCE' }
            $item = New-KcPlanItem 'Topic' 'Xml' $info.Title $typeElem $f.FullName $rel $base
            if (-not $info.Title) {
                $item.State = 'FAILED'
                $item.Note = 'XML 里没有 <title>'
            } elseif (-not $typeElem) {
                $item.State = 'FAILED'
                $item.Note = ('根元素 "{0}" 不是 concept / task / reference' -f $info.Root)
            }
            [void]$plan.Add($item)
        }
    } elseif ($kind -eq 'Map' -and $cfg.Mode -eq 'MapXml') {
        if (-not $cfg.MapXmlFile -or -not (Test-Path -LiteralPath $cfg.MapXmlFile)) { throw 'map XML 文件不存在。' }
        $info = Get-KcXmlInfo $cfg.MapXmlFile
        $item = New-KcPlanItem 'Map' 'MapXml' $info.Title (Get-KcMasterTypeElement $cfg.MasterType) $cfg.MapXmlFile '' $base
        if (-not $info.Title) {
            $item.State = 'FAILED'
            $item.Note = 'map XML 里没有 <title>'
        } elseif ("$($info.Root)" -notmatch '^(?i)(map|bookmap)$') {
            $item.State = 'FAILED'
            $item.Note = ('根元素 "{0}" 不是 map / bookmap' -f $info.Root)
        }
        [void]$plan.Add($item)
    } else {
        $titles = @()
        try { $titles = @(Get-KcTitleList $cfg.TitlesText $cfg.ParseMode $cfg.TitlesFile) }
        catch { throw ('标题解析失败：' + $_.Exception.Message) }
        if ($titles.Count -eq 0) { throw '没有解析出任何标题。' }
        $topicElem = Get-KcTopicTypeElement $cfg.TopicType
        $masterElem = Get-KcMasterTypeElement $cfg.MasterType
        foreach ($t in $titles) {
            if ($kind -eq 'Topic') {
                [void]$plan.Add((New-KcPlanItem 'Topic' 'Titles' $t $topicElem '' '' $base))
            } else {
                [void]$plan.Add((New-KcPlanItem 'Map' 'Titles' $t $masterElem '' '' $base))
            }
        }
    }

    # 批次内重名（同一目标目录 + 同一标题键）
    $seen = @{}
    foreach ($x in $plan) {
        if (-not $x.Title) { continue }
        $key = $x.RelDir + '|' + (Get-TitleKey $x.Title)
        if ($seen.ContainsKey($key)) {
            if ($x.State -eq 'TOCREATE') {
                $x.State = 'FAILED'
                $x.Note = '批次内重名（同一目标目录）'
            }
        } else {
            $seen[$key] = $true
        }
    }
    return @($plan)
}

# ---------------------------------------------------------------- 目录与预检
function Initialize-KcPlanFolders($cfg) {
    $basePath = Normalize-KcPath $cfg.FolderPath
    $r = Resolve-KcFolderPath $script:ish $basePath
    if (-not $r.Folder) { throw ("KC 目标路径无法解析（第一层就找不到）：`r`n" + $basePath) }
    $baseMissing = @()
    if ($r.Found -lt $r.Segments.Count) {
        $baseMissing = @($r.Segments[$r.Found..($r.Segments.Count - 1)])
    }
    Log ("[OK] 目标目录最深已存在：{0}（{1}/{2} 层）FolderId={3} type={4}" -f $r.Leaf, $r.Found, $r.Segments.Count, $r.Folder.IshFolderRef, $r.Folder.IshFolderType)
    if ($baseMissing.Count -gt 0) {
        Log ("[!] 缺失 {0} 层：{1}" -f $baseMissing.Count, ($baseMissing -join ' > '))
    }
    $script:baseFolderInfo = @{ Path = $basePath; Folder = $r.Folder; Missing = $baseMissing; Found = $r.Found }
    $baseId = [int64]$r.Folder.IshFolderRef
    $baseType = "$($r.Folder.IshFolderType)"
    $script:containerCache = @{}

    foreach ($x in $script:plan) {
        if ($x.Kind -eq 'Pub') {
            $x.FolderId = $baseId
            $x.FolderType = $baseType
            $x.MissingSegments = $baseMissing
            $x.MissingBase = ($baseMissing.Count -gt 0)
            if ($x.MissingSegments.Count -gt 0 -and -not $cfg.CreateFolder) {
                $x.State = 'BLOCKED'
                $x.Note = '目标目录不存在，且未勾选自动创建'
            } elseif ($x.MissingSegments.Count -gt 0) {
                $x.Note = ('将新建目录 {0} 层' -f $x.MissingSegments.Count)
            } else {
                $x.Note = '目录已存在'
            }
            Resolve-KcItemContainer $x $cfg
            continue
        }

        $relSegs = @($x.RelDir -split '\\' | Where-Object { $_ })
        if ($baseMissing.Count -gt 0) {
            $x.MissingSegments = @($baseMissing + $relSegs)
            $x.MissingBase = $true
            $x.FolderId = 0
        } else {
            $curId = $baseId
            $curType = $baseType
            $missing = @()
            foreach ($seg in $relSegs) {
                if ($missing.Count -gt 0) { $missing += $seg; continue }
                $kids = @(Get-KcChildFolders $script:ish $curId)
                $hit = @($kids | Where-Object { $_.Name -eq $seg }) | Select-Object -First 1
                if ($hit) { $curId = [int64]$hit.Id; $curType = "$($hit.Type)" } else { $missing += $seg }
            }
            $x.MissingSegments = $missing
            if ($missing.Count -eq 0) {
                $x.FolderId = $curId
                $x.FolderType = $curType
                $x.Note = '目录已存在'
            } else {
                $x.FolderId = 0
                $x.Note = ('将新建目录 {0} 层' -f $missing.Count)
            }
        }
        if ($x.MissingSegments.Count -gt 0 -and -not $cfg.CreateFolder -and $x.State -eq 'TOCREATE') {
            $x.State = 'BLOCKED'
            $x.Note = '目标目录不存在，且未勾选自动创建'
        }
        Resolve-KcItemContainer $x $cfg
    }
}

# 落点文件夹类型不匹配时，改用一个同类型的子文件夹（已有就复用，没有就建）。
# 只有「目标目录已存在」时才做；目录本身要新建的，由 Ensure-KcFolderPath 按类型建。
function Resolve-KcItemContainer($x, $cfg) {
    if ($x.State -ne 'TOCREATE') { return }
    if ($x.MissingSegments.Count -gt 0) { return }
    if (-not $x.FolderId) { return }

    $want = Get-KcFolderTypeFor $x.Kind
    if (-not $want) { return }

    # 已经对了：什么都不用做
    if ("$($x.FolderType)" -eq $want) { return }

    $leafName = Get-KcContainerNameFor $x.Kind $cfg
    if (-not $leafName) { return }

    $parentId = [int64]$x.FolderId
    $parentPath = $x.TargetPath
    $cacheKey = ('{0}|{1}|{2}' -f $parentId, $want, $leafName)
    if ($script:containerCache.ContainsKey($cacheKey)) {
        $cached = $script:containerCache[$cacheKey]
        $x.FolderId = [int64]$cached.Id
        $x.FolderType = "$($cached.Type)"
        $x.TargetPath = "$($cached.Path)"
        $x.Note = "$($cached.Note)"
        return
    }

    $kids = @(Get-KcChildFolders $script:ish $parentId)
    $hit = @($kids | Where-Object { $_.Name -eq $leafName }) | Select-Object -First 1
    $origType = "$($x.FolderType)"
    if ($hit) {
        if ("$($hit.Type)" -eq $want) {
            $info = @{ Id = [int64]$hit.Id; Type = "$($hit.Type)"; Path = ($parentPath.TrimEnd('\') + '\' + $leafName); Note = ('复用已有子文件夹 {0}（{1}）' -f $leafName, $want) }
            $script:containerCache[$cacheKey] = $info
            $x.FolderId = $info.Id
            $x.FolderType = $info.Type
            $x.TargetPath = $info.Path
            $x.Note = $info.Note
            Log ("    [USE] {0}：目标类型 {1} 装不了，改用已有子文件夹 {2}（FolderId={3}, type={4}）" -f $x.Kind, $origType, $leafName, $info.Id, $info.Type)
            return
        }
        # 同名但类型也不对：换一个名字，避免又落进坏文件夹
        $leafName = $leafName + '-' + $want
    }

    # 需要新建
    if (-not $cfg.CreateFolder) {
        $x.State = 'BLOCKED'
        $x.Note = ('目标文件夹类型是 {0}，需要 {1} 类型的子文件夹「{2}」，但未勾选自动创建' -f $origType, $want, $leafName)
        return
    }
    $info2 = @{ Id = 0; Type = $want; Path = ($parentPath.TrimEnd('\') + '\' + $leafName); Note = ('将新建子文件夹 {0}（{1}）' -f $leafName, $want) }
    $script:containerCache[$cacheKey] = $info2
    $x.FolderId = 0
    $x.FolderType = $want
    $x.TargetPath = $info2.Path
    $x.Note = $info2.Note
    Log ("    [NEW?] {0}：目标类型 {1} 装不了，将在其下新建 {2}（{3}）" -f $x.Kind, $origType, $leafName, $want)
}

# 目标文件夹现有对象索引（按 ObjectRef 去重）
function Get-KcFolderIndex([int64]$folderId) {
    $key = [string]$folderId
    if ($script:contentIndex.ContainsKey($key)) { return $script:contentIndex[$key] }
    $rows = @(Get-IshFolderContent -IshSession $script:ish -FolderId $folderId -ErrorAction Stop)
    $uniq = @(Get-KcUniqueRows $rows)
    $idx = @{}
    $anyType = $false
    foreach ($g in $uniq) {
        $row = $g.Row
        $t = "$(Get-Prop $row @('ftitle_logical_value', 'ftitle'))"
        $k = Get-TitleKey $t
        if (-not $k) { continue }
        $ty = "$(Get-Prop $row @('IshType', 'ishtype', 'objtype'))"
        $kk = 'Other'
        if ($ty -eq 'ISHModule') { $kk = 'Topic' }
        elseif ($ty -eq 'ISHMasterDoc') { $kk = 'Map' }
        elseif ($ty -eq 'ISHPublication') { $kk = 'Pub' }
        if (-not $ty) { $anyType = $true }
        $o = [pscustomobject]@{
            Title      = $t
            Key        = $k
            IshRef     = "$(Get-Prop $row @('IshRef'))"
            ObjectRef  = $g.ObjectRef
            IshType    = $ty
            Version    = "$(Get-Prop $row @('version_version_value', 'version'))"
            Lng        = "$(Get-Prop $row @('doclanguage_lng_value', 'doclanguage'))"
            CheckedOut = "$(Get-Prop $row @('checkedout', 'checkedoutby'))"
            Status     = "$(Get-Prop $row @('fstatus_lng_value', 'fstatus'))"
        }
        if (-not $idx.ContainsKey("$kk|$k")) { $idx["$kk|$k"] = $o }
        if (-not $idx.ContainsKey("Any|$k")) { $idx["Any|$k"] = $o }
    }
    $res = @{ Index = $idx; AnyType = $anyType; Count = $uniq.Count; Raw = $rows.Count }
    $script:contentIndex[$key] = $res
    Log ("[OK] 目标文件夹 {0} 现有 {1} 个对象（按 ObjectRef 去重；原始 {2} 行）" -f $folderId, $uniq.Count, $rows.Count)
    return $res
}

function Find-KcPubDuplicates([string]$title, [string]$lang) {
    $lastErr = $null
    try {
        $flt = @(Set-IshMetadataFilterField -IshSession $script:ish -Name FTITLE -Level Logical -FilterOperator Equal -Value $title)
        $found = @(Find-IshPublicationOutput -IshSession $script:ish -MetadataFilter $flt -ErrorAction Stop)
        $seen = @{}
        $hits = @()
        foreach ($p in $found) {
            $ref = "$(Get-Prop $p @('IshRef'))"
            if ($ref -and $seen.ContainsKey($ref)) { continue }
            if ($ref) { $seen[$ref] = $true }
            if ("$(Get-Prop $p @('fishpublngcombination'))" -eq $lang) { $hits += $p }
        }
        Log ("[INFO] 同标题 pub {0} 个，其中同语言组合 {1} 个" -f $found.Count, $hits.Count)
        return @($hits)
    } catch {
        $lastErr = $_
        Log ("[WARN] 服务端过滤查重失败（{0}），退化为全量扫描…" -f $_.Exception.Message)
    }
    try {
        $all = @(Find-IshPublicationOutput -IshSession $script:ish -ErrorAction Stop)
        $hits = @($all | Where-Object {
                "$(Get-Prop $_ @('ftitle_logical_value', 'ftitle'))" -eq $title -and
                "$(Get-Prop $_ @('fishpublngcombination'))" -eq $lang
            })
        Log ("[INFO] 全量扫描 {0} 个，同标题同语言 {1} 个" -f $all.Count, $hits.Count)
        return @($hits)
    } catch {
        throw ('查重失败：' + $lastErr.Exception.Message)
    }
}

# ---------------------------------------------------------------- 挂接目标
function Get-KcTopicRefTemplate {
    $dir = Join-Path $scriptDir 'templates'
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $files = @(Get-ChildItem -LiteralPath $dir -File -Filter '*.xml' -ErrorAction SilentlyContinue | Sort-Object Name)
    foreach ($f in $files) {
        $reader = $null
        try {
            $settings = New-Object System.Xml.XmlReaderSettings
            $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
            $settings.XmlResolver = $null
            $reader = [System.Xml.XmlReader]::Create($f.FullName, $settings)
            $doc = New-Object System.Xml.XmlDocument
            $doc.XmlResolver = $null
            $doc.Load($reader)
            $nodes = @($doc.SelectNodes("//*[local-name()='topicref']"))
            foreach ($node in $nodes) {
                $href = $node.GetAttribute('href')
                if (-not $href) { continue }
                # 跳过挂子 map 的样例；要的是挂 topic 的那一种
                if ("$($node.GetAttribute('format'))" -eq 'ditamap') { continue }
                return [pscustomobject]@{ Path = $f.FullName; OuterXml = $node.OuterXml; Href = $href }
            }
        } catch { } finally {
            if ($reader) { try { $reader.Dispose() } catch { } }
        }
    }
    return $null
}

function Get-KcTopicRefXml($tpl, [string]$ishRef, [string]$title) {
    $href = "$($tpl.Href)"
    $newHref = $ishRef
    if ($href -match 'GUID-[0-9A-Fa-f-]{36}') {
        $newHref = $href -replace 'GUID-[0-9A-Fa-f-]{36}', $ishRef
    }
    $tag = "$($tpl.OuterXml)"
    $tag = [regex]::Replace($tag, '(\bhref\s*=\s*")[^"]*(")', { param($m) $m.Groups[1].Value + $newHref + $m.Groups[2].Value }.GetNewClosure())
    $escTitle = [System.Security.SecurityElement]::Escape($title)
    $tag = [regex]::Replace($tag, '(\bnavtitle\s*=\s*")[^"]*(")', { param($m) $m.Groups[1].Value + $escTitle + $m.Groups[2].Value }.GetNewClosure())
    # 两种 navtitle 形态都覆盖：属性和 <topicmeta><navtitle> 元素
    $tag = [regex]::Replace($tag, '(?is)(<navtitle[^>]*>).*?(</navtitle>)', { param($m) $m.Groups[1].Value + $escTitle + $m.Groups[2].Value }.GetNewClosure())
    # id / keys / copy-to 照抄会重复定义，去掉
    $tag = $tag -replace '\s+id\s*=\s*"[^"]*"', ''
    $tag = $tag -replace '\s+(keys|copy-to)\s*=\s*"[^"]*"', ''
    return $tag
}

function Get-KcMapDocRow([string]$ishRef) {
    $req = @(
        Set-IshRequestedMetadataField -IshSession $script:ish -Name FTITLE -Level Logical
        Set-IshRequestedMetadataField -IshSession $script:ish -Name VERSION -Level Version
        Set-IshRequestedMetadataField -IshSession $script:ish -Name DOC-LANGUAGE -Level Lng
    )
    $rows = @(Get-IshDocumentObj -IshSession $script:ish -LogicalId $ishRef -RequestedMetadata $req -ErrorAction Stop)
    if ($rows.Count -eq 0) { throw "找不到 map：$ishRef" }
    $pick = @($rows | Where-Object { "$(Get-Prop $_ @('doclanguage_lng_value', 'doclanguage'))" -match 'zh[-_]?CN' }) | Select-Object -First 1
    if (-not $pick) { $pick = $rows[0] }
    return $pick
}

function Get-KcDocObjFile($row, [string]$tagName) {
    $dir = Join-Path $script:tmpRoot ('dl_' + $tagName + '_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $null = Get-IshDocumentObjData -IshSession $script:ish -IshObject $row -FolderPath $dir -ErrorAction Stop
    $f = Get-ChildItem -LiteralPath $dir -File | Select-Object -First 1
    if (-not $f) { throw '下载内容为空' }
    return $f
}

function Get-KcTopicRefCount([string]$text) {
    if (-not $text) { return 0 }
    return ([regex]::Matches($text, '(?i)<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?topicref\b')).Count
}

function Initialize-KcAttach($cfg) {
    $script:attachMapInfo = @{ Requested = $false; Ready = $false; Reason = ''; IshRef = ''; Title = ''; Version = ''; Lng = ''; CountBefore = 0; Sample = $null }
    $script:attachPubInfo = @{ Requested = $false; Ready = $false; Reason = ''; IshRef = ''; Title = ''; Version = ''; OutputFormat = ''; LanguageCombination = ''; MasterRef = '' }

    if ($cfg.Type -eq 'Topic' -and $cfg.AttachMap) {
        $script:attachMapInfo.Requested = $true
        $tpl = Get-KcTopicRefTemplate
        if (-not $tpl) {
            $script:attachMapInfo.Reason = '缺少 topicref 样例：请把一份带「指向 topic 的 <topicref>」的 map XML 放到 scripts\templates\'
        } else {
            try {
                if ($tpl.OuterXml -match 'format\s*=\s*"ditamap"') {
                    Log '[!] 注意：样例 topicref 带 format="ditamap"，通常是挂子 map 用的；挂 topic 可能不对。'
                }
                $row = Get-KcMapDocRow $cfg.AttachMap
                $co = "$(Get-Prop $row @('checkedout', 'checkedoutby'))"
                if ($co.Trim()) {
                    $script:attachMapInfo.Reason = "目标 map 已被检出：$co"
                } else {
                    $f = Get-KcDocObjFile $row 'map_pre'
                    $text = Read-KcTextFile $f.FullName
                    $script:attachMapInfo.Sample = $tpl
                    $script:attachMapInfo.IshRef = $cfg.AttachMap
                    $script:attachMapInfo.Title = "$(Get-Prop $row @('ftitle_logical_value', 'ftitle'))"
                    $script:attachMapInfo.Version = "$(Get-Prop $row @('version_version_value', 'version'))"
                    $script:attachMapInfo.Lng = "$(Get-Prop $row @('doclanguage_lng_value', 'doclanguage'))"
                    $script:attachMapInfo.CountBefore = Get-KcTopicRefCount $text
                    $script:attachMapInfo.Ready = $true
                    Log ("[OK] 挂接目标 map：{0}（{1}，现有 topicref {2} 个，样例 {3}）" -f $script:attachMapInfo.Title, $script:attachMapInfo.IshRef, $script:attachMapInfo.CountBefore, $tpl.Path)
                }
            } catch {
                $script:attachMapInfo.Reason = ('目标 map 解析失败：' + $_.Exception.Message)
            }
        }
        if (-not $script:attachMapInfo.Ready) { Log ('[!] Topic → Map 挂接不可用：' + $script:attachMapInfo.Reason) }
    }

    if ($cfg.Type -eq 'Map' -and $cfg.AttachPub) {
        $script:attachPubInfo.Requested = $true
        $mapCount = @($script:plan | Where-Object { $_.Kind -eq 'Map' }).Count
        if ($mapCount -gt 1) {
            $script:attachPubInfo.Reason = '批量 Map 不挂 Pub'
        } else {
            try {
                $req = @(
                    Set-IshRequestedMetadataField -IshSession $script:ish -Name FTITLE -Level Logical
                    Set-IshRequestedMetadataField -IshSession $script:ish -Name VERSION -Level Version
                    Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHOUTPUTFORMATREF -Level Lng
                    Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHPUBLNGCOMBINATION -Level Lng
                    Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHMASTERREF -Level Version
                )
                $pubs = @(Get-IshPublicationOutput -IshSession $script:ish -LogicalId $cfg.AttachPub -RequestedMetadata $req -ErrorAction Stop)
                if ($pubs.Count -eq 0) { throw "找不到 pub：$($cfg.AttachPub)" }
                $p = @($pubs | Where-Object { "$(Get-Prop $_ @('fishpublngcombination'))" -eq $LanguageCombination }) | Select-Object -First 1
                if (-not $p) { $p = $pubs[0] }
                $master = "$(Get-Prop $p @('fishmasterref_version_element', 'fishmasterref'))"
                if ($master.Trim()) {
                    $script:attachPubInfo.Reason = "pub 已挂 master（$master），为避免覆盖，本次跳过挂接"
                } else {
                    $script:attachPubInfo.IshRef = $cfg.AttachPub
                    $script:attachPubInfo.Title = "$(Get-Prop $p @('ftitle_logical_value', 'ftitle'))"
                    $script:attachPubInfo.Version = "$(Get-Prop $p @('version_version_value', 'version'))"
                    $script:attachPubInfo.OutputFormat = "$(Get-Prop $p @('fishoutputformatref_lng_element', 'fishoutputformatref'))"
                    $script:attachPubInfo.LanguageCombination = "$(Get-Prop $p @('fishpublngcombination'))"
                    $script:attachPubInfo.Ready = $true
                    Log ("[OK] 挂接目标 pub：{0}（{1}，OutputFormat={2}，Lang={3}）" -f $script:attachPubInfo.Title, $script:attachPubInfo.IshRef, $script:attachPubInfo.OutputFormat, $script:attachPubInfo.LanguageCombination)
                }
            } catch {
                $script:attachPubInfo.Reason = ('目标 pub 解析失败：' + $_.Exception.Message)
            }
        }
        if (-not $script:attachPubInfo.Ready) { Log ('[!] Map → Pub 挂接不可用：' + $script:attachPubInfo.Reason) }
    }
}

function Invoke-KcPrecheck($cfg) {
    Head 'STEP 4  预检（只读）'
    Initialize-KcPlanFolders $cfg

    foreach ($x in $script:plan) {
        if ($x.State -ne 'TOCREATE') { continue }

        if ($x.Kind -eq 'Pub') {
            $x.OutputFormat = $cfg.OutputFormat
            if (-not $script:outputFormatsFromServer) {
                $x.State = 'BLOCKED'
                $x.Note = '未能从 KC 读取 OutputFormat 列表，无法确认格式存在（请重试）'
                continue
            }
            if ($script:outputFormats -notcontains $x.OutputFormat) {
                $x.State = 'BLOCKED'
                $x.Note = "OutputFormat 不在库中：$($x.OutputFormat)"
                continue
            }
            if ($x.OutputFormat -match '^VOUTPUTFORMAT(.+)$') {
                $x.PublicationType = 'VPUBLICATIONTYPE' + $Matches[1]
            } else {
                $x.State = 'BLOCKED'
                $x.Note = 'OutputFormat 不是 VOUTPUTFORMAT* 形式，无法推导 Publication 类型'
                continue
            }
            try {
                $hits = @(Find-KcPubDuplicates $x.Title $cfg.LanguageCombination)
                if ($hits.Count -gt 0) {
                    $x.State = 'SKIPPED'
                    $x.Note = '已存在同标题同语言组合的 pub'
                } elseif ("$($x.Note)" -notmatch '子文件夹') {
                    $x.Note = '可创建'
                }
            } catch {
                $x.State = 'BLOCKED'
                $x.Note = $_.Exception.Message
            }
            continue
        }

        if ($x.FolderId -and $x.MissingSegments.Count -eq 0) {
            try {
                $fi = Get-KcFolderIndex ([int64]$x.FolderId)
                $k = Get-TitleKey $x.Title
                $hit = $null
                if ($fi.Index.ContainsKey("$($x.Kind)|$k")) {
                    $hit = $fi.Index["$($x.Kind)|$k"]
                } elseif ($fi.AnyType -and $fi.Index.ContainsKey("Any|$k")) {
                    $hit = $fi.Index["Any|$k"]
                }
                if ($hit) {
                    $x.State = 'SKIPPED'
                    $x.Note = ('目标目录已有同名 {0}：{1}' -f $x.Kind, $hit.IshRef)
                } else {
                    $x.Note = '可创建'
                }
            } catch {
                $x.State = 'BLOCKED'
                $x.Note = ('读取目标文件夹失败：' + $_.Exception.Message)
            }
        } else {
            $x.Note = ('将新建目录 {0} 层' -f $x.MissingSegments.Count)
        }
    }

    Initialize-KcAttach $cfg

    $tc = @($script:plan | Where-Object { $_.State -eq 'TOCREATE' }).Count
    $sk = @($script:plan | Where-Object { $_.State -eq 'SKIPPED' }).Count
    $bl = @($script:plan | Where-Object { $_.State -eq 'BLOCKED' }).Count
    $fa = @($script:plan | Where-Object { $_.State -eq 'FAILED' }).Count
    $script:skipCount = $sk
    $script:blockCount = $bl
    $script:failCount = $fa

    Log ''
    Log ("[预检] 将创建 {0} / 跳过 {1} / 阻塞 {2} / 失败 {3} / 共 {4}" -f $tc, $sk, $bl, $fa, $script:plan.Count)
    foreach ($x in $script:plan) {
        $typeTag = $x.Kind
        if ($x.Kind -eq 'Topic') { $typeTag += ':' + ($x.TypeElement -replace '^VMODULETYPE', '') }
        if ($x.Kind -eq 'Map') { $typeTag += ':' + ($x.TypeElement -replace '^VMASTERTYPE', '') }
        if ($x.Kind -eq 'Pub') { $typeTag += ':' + $x.PublicationType }
        Log ("    {0,-10} {1,-22} {2}  <{3}>  {4}" -f $x.State, $typeTag, $x.Title, $x.TargetPath, $x.Note)
    }
    if ($tc -eq 0) { Log '[..] 没有需要写入的变更' }
    $badType = @($script:plan | Where-Object { $_.State -eq 'TOCREATE' -and $_.FolderId -and "$($_.FolderType)" -and "$($_.FolderType)" -ne (Get-KcFolderTypeFor $_.Kind) })
    if ($badType.Count -gt 0) {
        foreach ($b in $badType) {
            Log ("    [!] 落点类型不符：{0} 是 {1}，需要 {2}" -f $b.TargetPath, $b.FolderType, (Get-KcFolderTypeFor $b.Kind))
        }
    }
    return $tc
}

# ---------------------------------------------------------------- 执行
# 建缺失目录链。$leafFolderType 只作用于**最后一段**（真正装对象的那一层），
# 中间层一律 ISHNone —— 与 KC 惯例一致（Chinese\手册\... 都是 ISHNone 容器）。
# 写死 'ISHNone' 曾经直接导致 [-129]：自动建出来的目录天生装不了对象。
function Ensure-KcFolderPath([string]$path, [string]$leafFolderType = '') {
    $norm = Normalize-KcPath $path
    if (-not $norm) { throw '目标路径为空' }
    $wantType = "$leafFolderType".Trim()
    $cacheKey = $norm.ToLowerInvariant() + '#' + $wantType
    if ($script:folderIdCache.ContainsKey($cacheKey)) { return [int64]$script:folderIdCache[$cacheKey] }

    $r = Resolve-KcFolderPath $script:ish $norm
    if (-not $r.Folder) { throw "路径第一层就解析不到：$norm" }
    $parentId = [int64]$r.Folder.IshFolderRef
    $lastIndex = $r.Segments.Count - 1
    for ($i = $r.Found; $i -lt $r.Segments.Count; $i++) {
        $name = $r.Segments[$i]
        $prefix = (@($r.Segments[0..$i]) -join '\')
        $prefixKey = $prefix.ToLowerInvariant() + '#' + $wantType
        if ($script:folderIdCache.ContainsKey($prefixKey)) {
            $parentId = [int64]$script:folderIdCache[$prefixKey]
            continue
        }
        $existing = $null
        try { $existing = Get-IshFolder -IshSession $script:ish -FolderPath $prefix -ErrorAction Stop } catch { }
        if ($existing) {
            $parentId = [int64]$existing.IshFolderRef
        } else {
            $ft = 'ISHNone'
            if ($wantType -and $i -eq $lastIndex) { $ft = $wantType }
            try {
                $new = Add-IshFolder -IshSession $script:ish -ParentFolderId $parentId -FolderType $ft -FolderName $name -Confirm:$false -ErrorAction Stop
                $newId = "$(Get-Prop $new @('IshFolderRef'))"
                if (-not $newId) {
                    $chk = Get-IshFolder -IshSession $script:ish -FolderPath $prefix -ErrorAction Stop
                    $newId = $chk.IshFolderRef
                }
                $parentId = [int64]$newId
                Log ("    [NEW] {0}  FolderId={1}  type={2}" -f $prefix, $parentId, $ft)
            } catch {
                $again = Get-IshFolder -IshSession $script:ish -FolderPath $prefix -ErrorAction Stop
                $parentId = [int64]$again.IshFolderRef
            }
        }
        $script:folderIdCache[$prefixKey] = $parentId
    }
    $script:folderIdCache[$cacheKey] = $parentId
    return $parentId
}

function Get-KcTopicMetadata($x) {
    return @(
        Set-IshMetadataField -IshSession $script:ish -Name FTITLE -Level Logical -Value $x.Title
        Set-IshMetadataField -IshSession $script:ish -Name DOC-LANGUAGE -Level Lng -ValueType Element -Value $LanguageElement
        Set-IshMetadataField -IshSession $script:ish -Name FSTATUS -Level Lng -ValueType Element -Value 'VSTATUSDRAFT'
        Set-IshMetadataField -IshSession $script:ish -Name FMODULETYPE -Level Logical -ValueType Element -Value $x.TypeElement
        Set-IshMetadataField -IshSession $script:ish -Name FHIKPRODUCTLINE -Level Logical -ValueType Element -Value 'VHIKPRODUCTLINEGENERAL'
        Set-IshMetadataField -IshSession $script:ish -Name FAUTHOR -Level Lng -ValueType Element -Value $script:authorElem
    )
}

function Get-KcMapMetadata($x) {
    return @(
        Set-IshMetadataField -IshSession $script:ish -Name FTITLE -Level Logical -Value $x.Title
        Set-IshMetadataField -IshSession $script:ish -Name FMASTERTYPE -Level Logical -ValueType Element -Value $x.TypeElement
        Set-IshMetadataField -IshSession $script:ish -Name DOC-LANGUAGE -Level Lng -ValueType Element -Value $LanguageElement
        Set-IshMetadataField -IshSession $script:ish -Name FSTATUS -Level Lng -ValueType Element -Value 'VSTATUSDRAFT'
        Set-IshMetadataField -IshSession $script:ish -Name FAUTHOR -Level Lng -ValueType Element -Value $script:authorElem
    )
}

function Get-KcPubMetadata($x) {
    # 海康自定义必填项：7 个 *Switch 字段，词表见 DHIK*SWITCH（只有 DISPLAY / HIDE）
    # 字段名与元素名不是机械对应（FHIKMODELSWITCH -> VMODELSWITCHDISPLAY，中间的 HIK 被省掉），
    # 所以显式列表，别去推导。
    $switches = [ordered]@{
        'FHIKMODELSWITCH'       = @('VMODELSWITCHDISPLAY', 'VMODELSWITCHHIDE')
        'FHIKFUNCTIONSWITCH'    = @('VFUNCTIONSWITCHDISPLAY', 'VFUNCTIONSWITCHHIDE')
        'FHIKAPPLICATIONSWITCH' = @('VAPPLICATIONSWITCHDISPLAY', 'VAPPLICATIONSWITCHHIDE')
        'FHIKSCENESWITCH'       = @('VSCENESWITCHDISPLAY', 'VSCENESWITCHHIDE')
        'FHIKUSERTYPESWITCH'    = @('VUSERTYPESWITCHDISPLAY', 'VUSERTYPESWITCHHIDE')
        'FHIKCLIENTTYPESWITCH'  = @('VCLIENTTYPESWITCHDISPLAY', 'VCLIENTTYPESWITCHHIDE')
        'FHIKPRODUCTTYPESWITCH' = @('VPRODUCTTYPESWITCHDISPLAY', 'VPRODUCTTYPESWITCHHIDE')
        'FHIKUSERJOURNEYSWITCH' = @('VUSERJOURNEYSWITCHDISPLAY', 'VUSERJOURNEYSWITCHHIDE')
    }
    $idx = if ($script:PubSwitchMode -eq 'HIDE') { 1 } else { 0 }

    $fields = @(
        Set-IshMetadataField -IshSession $script:ish -Name 'FTITLE' -Level 'Logical' -Value $x.Title
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHPUBLICATIONTYPE' -Level 'Logical' -ValueType Element -Value $x.PublicationType
        Set-IshMetadataField -IshSession $script:ish -Name 'DOC-LANGUAGE' -Level 'Lng' -ValueType Element -Value $LanguageElement
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHPUBLISHER' -Level 'Lng' -ValueType Element -Value $script:publisherElem
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHPUBSOURCELANGUAGES' -Level 'Version' -ValueType Element -Value $LanguageElement
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHISRELEASED' -Level 'Version' -ValueType Element -Value 'FALSE'
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHREQUIREDRESOLUTIONS' -Level 'Version' -ValueType Element -Value 'VRESLOW'
        Set-IshMetadataField -IshSession $script:ish -Name 'FISHBASELINECOMPLETEMODE' -Level 'Version' -ValueType Element -Value 'VBASELINECOMPLETEMODEFIRSTVERSION'
    )
    foreach ($name in $switches.Keys) {
        $fields += Set-IshMetadataField -IshSession $script:ish -Name $name -Level 'Logical' -ValueType Element -Value $switches[$name][$idx]
    }
    return $fields
}

function Add-KcLedgerRow($x, [string]$action, [string]$note) {
    [void]$script:ledgerRows.Add([pscustomobject]@{
            '时间'      = $stamp
            '类型'      = $x.Kind
            '来源'      = $x.Mode
            '标题'      = $x.Title
            '动作'      = $action
            'IshRef'    = $x.IshRef
            'ObjectRef' = $x.ObjectRef
            '版本'      = $x.Version
            '落点'      = $x.TargetPath
            '备注'      = $note
        })
}

function Write-KcLedger {
    if (-not $script:ledgerRows -or $script:ledgerRows.Count -eq 0) { return 0 }
    $rows = @($script:ledgerRows)
    try {
        $rows | Export-Csv -LiteralPath $script:ledgerPath -NoTypeInformation -Encoding UTF8 -Append -ErrorAction Stop
    } catch {
        Log ('[X] 台账写入失败：' + $_.Exception.Message)
        return 0
    }
    $script:ledgerRows.Clear()
    return $rows.Count
}

function Test-KcCreatedReadback {
    $created = @($script:plan | Where-Object { $_.State -eq 'CREATED' -and $_.FolderId -and $_.Kind -in @('Topic', 'Map') })
    if ($created.Count -eq 0) { return }
    $groups = @($created | Group-Object FolderId)
    foreach ($g in $groups) {
        try {
            $rows = @(Get-IshFolderContent -IshSession $script:ish -FolderId ([int64]$g.Name) -ErrorAction Stop)
            $uniq = @(Get-KcUniqueRows $rows)
            $keys = @{}
            foreach ($u in $uniq) {
                $t = "$(Get-Prop $u.Row @('ftitle_logical_value', 'ftitle'))"
                $k = Get-TitleKey $t
                if ($k) { $keys[$k] = $true }
            }
            $miss = 0
            foreach ($x in @($g.Group)) {
                $k = Get-TitleKey $x.Title
                if (-not $keys.ContainsKey($k)) {
                    $miss++
                    Log ('    [!] 回读未见：' + $x.Title)
                }
            }
            Log ("[OK] 回读 FolderId={0}：本轮 {1} 个，未见 {2} 个" -f $g.Name, @($g.Group).Count, $miss)
            if ($miss -gt 0) { $script:unverifiedCount += $miss }
        } catch {
            Log ("[!] 回读 FolderId={0} 失败：{1}" -f $g.Name, $_.Exception.Message)
        }
    }
}

function Test-KcPubReadback {
    $pubs = @($script:plan | Where-Object { $_.Kind -eq 'Pub' -and $_.State -eq 'CREATED' -and $_.IshRef })
    foreach ($x in $pubs) {
        try {
            $req = @(
                Set-IshRequestedMetadataField -IshSession $script:ish -Name 'FTITLE' -Level Logical
                Set-IshRequestedMetadataField -IshSession $script:ish -Name 'FISHPUBLICATIONTYPE' -Level Logical
                Set-IshRequestedMetadataField -IshSession $script:ish -Name 'FISHOUTPUTFORMATREF' -Level Lng
                Set-IshRequestedMetadataField -IshSession $script:ish -Name 'FISHBASELINE' -Level Version
                Set-IshRequestedMetadataField -IshSession $script:ish -Name 'VERSION' -Level Version
            )
            $back = @(Get-IshPublicationOutput -IshSession $script:ish -LogicalId $x.IshRef -RequestedMetadata $req -ErrorAction Stop) | Select-Object -First 1
            if (-not $back) { throw '回读没有返回对象' }
            Log ("[OK] pub 回读：FTITLE={0} / TYPE={1} / FORMAT={2} / BASELINE={3} / VERSION={4}" -f "$(Get-Prop $back @('ftitle_logical_value', 'ftitle'))", "$(Get-Prop $back @('fishpublicationtype_logical_element', 'fishpublicationtype'))", "$(Get-Prop $back @('fishoutputformatref_lng_element', 'fishoutputformatref'))", "$(Get-Prop $back @('fishbaseline_version_element', 'fishbaseline'))", "$(Get-Prop $back @('version_version_value', 'version'))")
        } catch {
            Log ("[!] pub 回读失败（对象已建，不影响创建）：{0}" -f $_.Exception.Message)
        }
    }
}

function Invoke-KcAttachTopics($cfg, $createdTopics) {
    if (-not $cfg.AttachMap) { return }
    if (-not $script:attachMapInfo -or -not $script:attachMapInfo.Ready) {
        $why = if ($script:attachMapInfo) { $script:attachMapInfo.Reason } else { '未初始化' }
        Log ('[..] Topic → Map 挂接跳过：' + $why)
        return
    }
    $topics = @($createdTopics | Where-Object { $_.State -eq 'CREATED' -and $_.IshRef })
    if ($topics.Count -eq 0) { Log '[..] 没有新建成功的 topic，跳过挂接'; return }

    $bk = ''
    try {
        $row = Get-KcMapDocRow $script:attachMapInfo.IshRef
        $co = "$(Get-Prop $row @('checkedout', 'checkedoutby'))"
        if ($co.Trim()) { throw "目标 map 已被检出：$co" }
        $version = "$(Get-Prop $row @('version_version_value', 'version'))"
        $lng = "$(Get-Prop $row @('doclanguage_lng_value', 'doclanguage'))"
        if (-not $lng) { $lng = 'zh-CN' }

        $f = Get-KcDocObjFile $row 'map_pre2'
        $original = Read-KcTextFile $f.FullName
        $before = Get-KcTopicRefCount $original
        $last = [regex]::Matches($original, '(?is)</(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:map|bookmap)\s*>')
        if ($last.Count -eq 0) { throw 'map XML 里找不到 </map> 结束标签' }
        $close = $last[$last.Count - 1]

        $refs = @()
        foreach ($t in $topics) {
            $refXml = Get-KcTopicRefXml $script:attachMapInfo.Sample $t.IshRef $t.Title
            if ($refXml -notmatch [regex]::Escape($t.IshRef)) {
                throw ('生成的 topicref 不含目标 IshRef，拒绝改 map：{0}' -f $refXml)
            }
            $refs += $refXml
        }
        $insert = ($refs -join "`r`n")
        $newText = $original.Substring(0, $close.Index) + "`r`n" + $insert + "`r`n" + $original.Substring($close.Index)
        if (-not (Test-KcXmlText $newText)) {
            throw '拼接后的 map XML 不是合法 XML，拒绝写入'
        }

        if (-not (Test-Path -LiteralPath $script:backupDir)) {
            New-Item -ItemType Directory -Path $script:backupDir -Force | Out-Null
        }
        $safe = (("$($script:attachMapInfo.Title)") -replace '[\\/:*?"<>|]', '_')
        if (-not $safe) { $safe = 'map' }
        $bk = Join-Path $script:backupDir ($safe + '_' + $stamp + '.xml')
        Copy-Item -LiteralPath $f.FullName -Destination $bk -Force -ErrorAction Stop
        $sha1 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
        $sha2 = (Get-FileHash -LiteralPath $bk -Algorithm SHA256).Hash
        if ($sha1 -ne $sha2) { throw '备份哈希不一致，拒绝改 map' }
        $script:lastMapBackup = $bk
        Log ("    [BK] 已备份 map XML：{0}" -f $bk)

        $newFile = Join-Path $script:tmpRoot ('map_new_' + [guid]::NewGuid().ToString('N') + '.xml')
        [IO.File]::WriteAllText($newFile, $newText, $script:utf8Bom)
        $null = Set-IshDocumentObj -IshSession $script:ish -LogicalId $script:attachMapInfo.IshRef -Version $version -Lng $lng -FilePath $newFile -Confirm:$false -ErrorAction Stop
        Log ("[OK] 已写入 map：{0}（追加 topicref {1} 个）" -f $script:attachMapInfo.IshRef, $topics.Count)

        $row2 = Get-KcMapDocRow $script:attachMapInfo.IshRef
        $f2 = Get-KcDocObjFile $row2 'map_post'
        $text2 = Read-KcTextFile $f2.FullName
        $after = Get-KcTopicRefCount $text2
        $allRefs = $true
        foreach ($t in $topics) {
            if ($text2 -notmatch [regex]::Escape($t.IshRef)) {
                $allRefs = $false
                Log ('    [!] 回读未见 topicref：' + $t.IshRef)
            }
        }
        if ($after -lt ($before + $topics.Count) -or -not $allRefs) {
            throw ('回读校验不通过（before {0} / after {1} / 期望 +{2}）' -f $before, $after, $topics.Count)
        }
        Log ("[OK] 回读校验通过：topicref {0} → {1}" -f $before, $after)
        $script:attachOk += $topics.Count
        $x = [pscustomobject]@{
            Kind = 'Map'; Mode = 'Attach'; Title = $script:attachMapInfo.Title
            IshRef = $script:attachMapInfo.IshRef; ObjectRef = ''; Version = $version
            TargetPath = $script:attachMapInfo.IshRef
        }
        Add-KcLedgerRow $x 'ATTACHED' ('追加 topicref ' + $topics.Count + ' 个；备份 ' + $bk)
    } catch {
        $chain = @()
        $ex = $_.Exception
        while ($ex) { $chain += ($ex.Message -replace "`r?`n", ' '); $ex = $ex.InnerException }
        $script:attachFail++
        $script:topicAttachFail = $true
        Log ('[X] Topic → Map 挂接失败：' + ($chain -join ' <- '))
        $x = [pscustomobject]@{
            Kind = 'Map'; Mode = 'Attach'; Title = $script:attachMapInfo.Title
            IshRef = $script:attachMapInfo.IshRef; ObjectRef = ''; Version = ''
            TargetPath = $script:attachMapInfo.IshRef
        }
        Add-KcLedgerRow $x 'ATTACH_FAILED' (($chain -join ' <- ') + '；备份 ' + $bk)
    }
}

function Invoke-KcAttachPub($cfg) {
    if (-not $cfg.AttachPub) { return }
    if (-not $script:attachPubInfo -or -not $script:attachPubInfo.Ready) {
        $why = if ($script:attachPubInfo) { $script:attachPubInfo.Reason } else { '未初始化' }
        Log ('[..] Map → Pub 挂接跳过：' + $why)
        return
    }
    $map = @($script:plan | Where-Object { $_.Kind -eq 'Map' -and $_.State -eq 'CREATED' -and $_.IshRef }) | Select-Object -First 1
    if (-not $map) { Log '[..] 没有新建成功的 map，跳过 Pub 挂接'; return }

    try {
        $req = @(
            Set-IshRequestedMetadataField -IshSession $script:ish -Name FTITLE -Level Logical
            Set-IshRequestedMetadataField -IshSession $script:ish -Name VERSION -Level Version
            Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHOUTPUTFORMATREF -Level Lng
            Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHPUBLNGCOMBINATION -Level Lng
            Set-IshRequestedMetadataField -IshSession $script:ish -Name FISHMASTERREF -Level Version
        )
        $pubs = @(Get-IshPublicationOutput -IshSession $script:ish -LogicalId $cfg.AttachPub -RequestedMetadata $req -ErrorAction Stop)
        if ($pubs.Count -eq 0) { throw "找不到 pub：$($cfg.AttachPub)" }
        $p = @($pubs | Where-Object { "$(Get-Prop $_ @('fishpublngcombination'))" -eq $LanguageCombination }) | Select-Object -First 1
        if (-not $p) { $p = $pubs[0] }
        $version = "$(Get-Prop $p @('version_version_value', 'version'))"
        $format = "$(Get-Prop $p @('fishoutputformatref_lng_element', 'fishoutputformatref'))"
        $lang = "$(Get-Prop $p @('fishpublngcombination'))"
        if (-not $lang) { $lang = $LanguageCombination }
        if (-not $format) { $format = $script:attachPubInfo.OutputFormat }
        if (-not $format) { throw '取不到 pub 的 OutputFormat，无法调用 Set-IshPublicationOutput' }
        $master = "$(Get-Prop $p @('fishmasterref_version_element', 'fishmasterref'))"
        if ($master.Trim()) {
            if ($master -match [regex]::Escape($map.IshRef)) {
                Log '[..] pub 已指向这个 map，无需重复挂接'
                return
            }
            throw "pub 已挂 master（$master），为避免覆盖，跳过"
        }

        $meta = @(Set-IshMetadataField -IshSession $script:ish -Name 'FISHMASTERREF' -Level 'Version' -ValueType Element -Value $map.IshRef)
        $null = Set-IshPublicationOutput -IshSession $script:ish -LogicalId $cfg.AttachPub -Version $version -OutputFormat $format -LanguageCombination $lang -Metadata $meta -Confirm:$false -ErrorAction Stop
        Log ("[OK] 已写入 pub FISHMASTERREF：{0} → {1}" -f $cfg.AttachPub, $map.IshRef)

        $back = @(Get-IshPublicationOutput -IshSession $script:ish -LogicalId $cfg.AttachPub -RequestedMetadata $req -ErrorAction Stop)
        $b = @($back | Where-Object { "$(Get-Prop $_ @('fishpublngcombination'))" -eq $lang }) | Select-Object -First 1
        if (-not $b) { $b = $back[0] }
        $got = "$(Get-Prop $b @('fishmasterref_version_element', 'fishmasterref'))"
        if ($got -notmatch [regex]::Escape($map.IshRef)) {
            throw ("回读 FISHMASTERREF=$got，期望包含 $($map.IshRef)")
        }
        Log '[OK] 回读 FISHMASTERREF 校验通过'
        $script:attachOk++
        $x = [pscustomobject]@{
            Kind = 'Pub'; Mode = 'Attach'; Title = $script:attachPubInfo.Title
            IshRef = $cfg.AttachPub; ObjectRef = ''; Version = $version
            TargetPath = $cfg.AttachPub
        }
        Add-KcLedgerRow $x 'ATTACHED' ('FISHMASTERREF=' + $map.IshRef)
    } catch {
        $chain = @()
        $ex = $_.Exception
        while ($ex) { $chain += ($ex.Message -replace "`r?`n", ' '); $ex = $ex.InnerException }
        $script:attachFail++
        $script:pubAttachFail = $true
        Log ('[X] Map → Pub 挂接失败：' + ($chain -join ' <- '))
        $x = [pscustomobject]@{
            Kind = 'Pub'; Mode = 'Attach'; Title = $script:attachPubInfo.Title
            IshRef = $cfg.AttachPub; ObjectRef = ''; Version = ''
            TargetPath = $cfg.AttachPub
        }
        Add-KcLedgerRow $x 'ATTACH_FAILED' ($chain -join ' <- ')
    }
}

function Invoke-KcExecute($cfg) {
    Head 'STEP 5  执行'
    $createdTopics = New-Object System.Collections.ArrayList
    $n = @($script:plan | Where-Object { $_.State -eq 'TOCREATE' }).Count
    $i = 0

    Start-Progress 'KC 新建对象'
    try {
        foreach ($x in $script:plan) {
            if ($x.State -ne 'TOCREATE') { continue }
            $i++
            Update-Progress ("[{0}/{1}] {2}" -f $i, $n, $x.Title)
            try {
                $wantFolderType = Get-KcFolderTypeFor $x.Kind
                $folderId = Ensure-KcFolderPath $x.TargetPath $wantFolderType
                $x.FolderId = $folderId

                # 写前终检：预检之后文件夹可能被人改过，落错类型只会换来一句 -129。
                # 拿到类型才判；拿不到（服务端没给）不阻断。
                if ($wantFolderType) {
                    $ftActual = ''
                    try {
                        $ftObj = Get-IshFolder -IshSession $script:ish -FolderId $folderId -ErrorAction Stop
                        $ftActual = "$(Get-Prop $ftObj @('IshFolderType'))"
                    } catch { }
                    $gate = Get-KcFolderTypeGate $ftActual $x.Kind
                    if ($gate) { throw ('落点不可用：' + $gate) }
                }

                $file = ''
                $created = $null

                if ($x.Kind -eq 'Topic') {
                    if ($x.Mode -eq 'Xml') {
                        $file = $x.SourcePath
                    } else {
                        $file = New-KcTempXmlFile (New-KcEmptyTopicXml $x.Title $x.TypeElement $i) ("topic_{0}.xml" -f $i)
                    }
                    $meta = Get-KcTopicMetadata $x
                    $created = Add-IshDocumentObj -IshSession $script:ish -IshType 'ISHModule' -Lng 'zh-CN' -FolderId $folderId -FilePath $file -Metadata $meta -Confirm:$false -ErrorAction Stop
                } elseif ($x.Kind -eq 'Map') {
                    if ($x.Mode -eq 'MapXml') {
                        $file = $x.SourcePath
                    } else {
                        $file = New-KcTempXmlFile (New-KcEmptyMapXml $x.Title $i) ("map_{0}.xml" -f $i)
                    }
                    $meta = Get-KcMapMetadata $x
                    $created = Add-IshDocumentObj -IshSession $script:ish -IshType 'ISHMasterDoc' -Lng 'zh-CN' -FolderId $folderId -FilePath $file -Metadata $meta -Confirm:$false -ErrorAction Stop
                } else {
                    if (-not $x.PublicationType) { throw 'PublicationType 为空' }
                    $meta = Get-KcPubMetadata $x
                    $created = Add-IshPublicationOutput -IshSession $script:ish -OutputFormat $cfg.OutputFormat -LanguageCombination $cfg.LanguageCombination -FolderId $folderId -Metadata $meta -Confirm:$false -ErrorAction Stop
                }

                $created = @($created)[0]
                if (-not $created) { throw '创建命令没有返回对象（可能未真正建成）' }
                $x.IshRef = "$(Get-Prop $created @('IshRef', 'LogicalId'))"
                $x.ObjectRef = "$(Get-Prop $created @('ObjectRef'))"
                $x.Version = "$(Get-Prop $created @('Version', 'version_version_value'))"
                $x.Lng = "$(Get-Prop $created @('Lng', 'doclanguage_lng_value'))"
                $x.State = 'CREATED'
                $x.Created = $true
                $x.Note = ''
                $script:createCount++
                if ($x.Kind -eq 'Topic') { [void]$createdTopics.Add($x) }
                Log ("[{0}/{1}] {2}  —— 建成 ObjectRef={3} IshRef={4}  落点 FolderId={5}" -f $i, $n, $x.Title, $x.ObjectRef, $x.IshRef, $folderId)
                Add-KcLedgerRow $x 'CREATED' ''
            } catch {
                $chain = @()
                $ex = $_.Exception
                while ($ex) { $chain += ($ex.Message -replace "`r?`n", ' '); $ex = $ex.InnerException }
                $x.State = 'FAILED'
                $x.Note = ($chain -join ' <- ')
                if ($x.Kind -eq 'Pub') {
                    $x.Note += '；可能原因：落点 ISHNone / 缺必填字段 / 账号无建 pub 权限'
                }
                $x.Exec = $true
                $script:failCount++
                Log ("[{0}/{1}] {2}  —— 失败：{3}" -f $i, $n, $x.Title, $x.Note)
                Add-KcLedgerRow $x 'FAILED' $x.Note
            }
        }
    } finally {
        Stop-Progress
    }

    Head '回读核对'
    Test-KcCreatedReadback
    Test-KcPubReadback

    Head 'STEP 5b  挂接'
    Invoke-KcAttachTopics $cfg $createdTopics
    Invoke-KcAttachPub $cfg

    Head 'STEP 6  台账'
    $written = Write-KcLedger
    $script:ledgerWritten = $written
    if ($written -gt 0) {
        $total = 1
        try { $total = @(Import-Csv -LiteralPath $script:ledgerPath -Encoding UTF8 -ErrorAction Stop).Count } catch { }
        Log ("[OK] 台账追加 {0} 行，累计 {1} 行：{2}" -f $written, $total, $script:ledgerPath)
    } else {
        Log '[..] 台账未改动（本次没有写入动作）'
    }
}

function Show-KcResult {
    $created = @($script:plan | Where-Object { $_.State -eq 'CREATED' }).Count
    $skipped = @($script:plan | Where-Object { $_.State -eq 'SKIPPED' }).Count
    $blocked = @($script:plan | Where-Object { $_.State -eq 'BLOCKED' }).Count
    $failed = @($script:plan | Where-Object { $_.State -eq 'FAILED' }).Count

    $attachLine = ''
    if ($script:attachMapInfo -and $script:attachMapInfo.Requested) {
        if (-not $script:attachMapInfo.Ready) {
            $attachLine += "`r`nTopic → Map：跳过（$($script:attachMapInfo.Reason)）"
        } elseif ($script:topicAttachFail) {
            $attachLine += "`r`nTopic → Map：失败（见日志）"
        } else {
            $attachLine += "`r`nTopic → Map：已挂接 $($script:attachOk) 个"
        }
    }
    if ($script:attachPubInfo -and $script:attachPubInfo.Requested) {
        if (-not $script:attachPubInfo.Ready) {
            $attachLine += "`r`nMap → Pub：跳过（$($script:attachPubInfo.Reason)）"
        } elseif ($script:pubAttachFail) {
            $attachLine += "`r`nMap → Pub：失败（见日志）"
        } else {
            $attachLine += "`r`nMap → Pub：已挂接"
        }
    }
    $ledgerLine = if ($script:ledgerWritten -gt 0) { $script:ledgerPath } else { '（本次无写入，台账未改动）' }
    $backupLine = if ($script:lastMapBackup) { "`r`nmap 备份：$($script:lastMapBackup)" } else { '' }
    $unverifiedLine = if ($script:unverifiedCount -gt 0) { "`r`n回读未见：$($script:unverifiedCount)（可能索引延迟，请到 PM 核对）" } else { '' }

    $headline = if (-not $script:didExecute) {
        '预检结束，未写入任何东西。'
    } elseif ($created -gt 0) {
        '新建对象结束。'
    } else {
        '执行结束，但没有创建任何对象。'
    }

    $msg = @"
$headline

创建：$created
跳过：$skipped
阻塞：$blocked
失败：$failed$unverifiedLine
合计：$($script:plan.Count)$attachLine

日志：$logPath
台账：$ledgerLine$backupLine

点“是”打开 logs 文件夹。
"@

    if ($script:headless) {
        Log $msg
    } else {
        $icon = if ($failed -gt 0 -or $script:attachFail -gt 0 -or $script:unverifiedCount -gt 0) { 'Warning' } else { 'Information' }
        $ans = [System.Windows.Forms.MessageBox]::Show($msg, 'KC 新建对象', 'YesNo', $icon)
        if ($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
            try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $logPath + '"') } catch { }
        }
    }
    return $failed
}

# ================================================================ MAIN
$script:headless = [bool]($Type -and $FolderPath -and ($Title -or $XmlDir -or $MapXmlFile -or $SourceFile -or $SourceText))

Ensure-KcModule

# ---------------------------------------------------------------- 自审（AST）
$allow = @(
    'New-IshSession', 'Get-IshVersion',
    'Get-IshFolder', 'Add-IshFolder', 'Get-IshFolderContent',
    'Find-IshDocumentObj', 'Get-IshDocumentObj', 'Add-IshDocumentObj', 'Set-IshDocumentObj', 'Get-IshDocumentObjData',
    'Find-IshOutputFormat',
    'Find-IshPublicationOutput', 'Get-IshPublicationOutput', 'Add-IshPublicationOutput', 'Set-IshPublicationOutput',
    'Get-IshLovValue',
    'Set-IshMetadataField', 'Set-IshMetadataFilterField', 'Set-IshRequestedMetadataField'
)
$tok = $null
$parseErr = $null
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
    $msg = 'ABORT: 未授权 cmdlet: ' + ($notAllowed -join ', ') + "`r`n本次实际调用: " + ($called -join ', ')
    Log $msg
    Show-Msg $msg 'Error' | Out-Null
    exit 1
}

Head ("KC 新建对象  @ " + (Get-Date -Format o))
Log ("[OK] 自审通过（AST）：调用 {0} 个 -> {1}" -f $called.Count, ($called -join ', '))

Invoke-KcLogin

# ---------------------------------------------------------------- 只读：OutputFormat / Map 类型
try {
    $fmts = @(Find-IshOutputFormat -IshSession $script:ish -ErrorAction Stop)
    $names = @($fmts | ForEach-Object { "$(Get-Prop $_ @('IshRef', 'Name'))" } | Where-Object { $_ -match '^VOUTPUTFORMAT' } | Sort-Object -Unique)
    if ($names.Count -gt 0) {
        $script:outputFormats = @($names)
        $script:outputFormatsFromServer = $true
    }
    Log ("[OK] OutputFormat {0} 个（只列 VOUTPUTFORMAT*，GUID 形态不能推导 Publication 类型）" -f $script:outputFormats.Count)
} catch {
    Log ("[!] 取 OutputFormat 失败，使用默认值：{0}" -f $_.Exception.Message)
}

$fallbackMaster = @(
    [pscustomobject]@{ Label = 'User Manual Map'; Value = 'VMASTERTYPEUSERMANUALMAP' },
    [pscustomobject]@{ Label = 'Specification Map'; Value = 'VMASTERTYPESPECIFICATIONMAP' }
)
$mts = @()
try {
    $lov = @(Get-IshLovValue -IshSession $script:ish -LovId 'DMASTERTYPE' -ErrorAction Stop)
    foreach ($l in $lov) {
        $v = "$(Get-Prop $l @('IshRef', 'LovValueRef', 'Value'))"
        $lab = "$(Get-Prop $l @('Label', 'Description'))"
        if ($v) {
            $mts += [pscustomobject]@{
                Label = $(if ($lab) { $lab } else { $v })
                Value = $v
            }
        }
    }
} catch {
    Log ("[!] 取 DMASTERTYPE 失败，使用内置两项：{0}" -f $_.Exception.Message)
}
if ($mts.Count -eq 0) { $mts = $fallbackMaster }
$script:masterTypes = @($mts | Sort-Object Value -Unique | Sort-Object Label)
Log ("[OK] Map 类型 {0} 个" -f $script:masterTypes.Count)

# ---------------------------------------------------------------- 参数（弹窗或命令行）
$script:cfg = $null
if ($script:headless) {
    $titlesText = $SourceText
    $titlesFile = ''
    if (-not $titlesText -and $SourceFile) {
        $titlesFile = $SourceFile
        $titlesText = Read-KcTextFile $SourceFile
    }
    if (-not $titlesText -and $Title) { $titlesText = $Title }
    $mode = ''
    if ($Type -eq 'Topic') {
        $mode = if ($XmlDir) { 'Xml' } else { 'Titles' }
    } elseif ($Type -eq 'Map') {
        $mode = if ($MapXmlFile) { 'MapXml' } else { 'Titles' }
    } else {
        $mode = 'Pub'
    }
    $script:cfg = @{
        Type         = $Type
        Mode         = $mode
        FolderPath   = (Normalize-KcPath $FolderPath)
        CreateFolder = (-not $NoCreateFolder)
        XmlDir       = $XmlDir
        MapXmlFile   = $MapXmlFile
        TitlesText   = $titlesText
        TitlesFile   = $titlesFile
        ParseMode    = 'Auto'
        TopicType    = $TopicType
        MasterType   = $MasterType
        Title        = $Title
        OutputFormat = $OutputFormat
        AttachMap    = $AttachMap
        AttachPub    = $AttachPub
        TitleCount   = 0
        LanguageCombination = $LanguageCombination
        LanguageElement     = $LanguageElement
    }
    Log '[..] 命令行参数已给全，跳过弹窗（自动化模式）'
} else {
    $p = Show-KcCreateForm $script:kcIsh $script:outputFormats $script:masterTypes $FolderPath
    if (-not $p) {
        Log '[..] 用户取消，未执行任何写入'
        exit 0
    }
    $script:cfg = $p
}

Log ("[..] 类型：{0} / 来源：{1} / 目标：{2}" -f $script:cfg.Type, $script:cfg.Mode, $script:cfg.FolderPath)
if ($script:cfg.AttachMap) { Log ("[..] 挂接 Map：{0}" -f $script:cfg.AttachMap) }
if ($script:cfg.AttachPub) { Log ("[..] 挂接 Pub：{0}" -f $script:cfg.AttachPub) }

# ---------------------------------------------------------------- STEP 2 清单
Head 'STEP 2  生成对象清单'
try {
    $script:plan = @(Build-KcPlan $script:cfg)
} catch {
    $msg = '生成清单失败：' + $_.Exception.Message
    Log ('[X] ' + $msg)
    Show-Msg $msg 'Error' | Out-Null
    exit 1
}
$topicN = @($script:plan | Where-Object { $_.Kind -eq 'Topic' }).Count
$mapN = @($script:plan | Where-Object { $_.Kind -eq 'Map' }).Count
$pubN = @($script:plan | Where-Object { $_.Kind -eq 'Pub' }).Count
Log ("[OK] 清单 {0} 项（Topic {1} / Map {2} / Pub {3}）" -f $script:plan.Count, $topicN, $mapN, $pubN)

# ---------------------------------------------------------------- STEP 4 预检
try {
    $tc = Invoke-KcPrecheck $script:cfg
} catch {
    $msg = '预检失败：' + $_.Exception.Message
    Log ('[X] ' + $msg)
    Show-Msg $msg 'Error' | Out-Null
    exit 1
}

# ---------------------------------------------------------------- 确认
$proceed = $false
if ($tc -eq 0) {
    Log '[..] 没有需要写入的变更'
} elseif ($Commit -and $script:headless) {
    $proceed = $true
    Log '[..] 命令行给了 -Commit 且为自动化模式，直接执行'
} elseif ($script:headless) {
    Log '[..] 未给 -Commit，只预检，不写入'
} else {
    $sk = @($script:plan | Where-Object { $_.State -eq 'SKIPPED' }).Count
    $bl = @($script:plan | Where-Object { $_.State -eq 'BLOCKED' }).Count
    $fa = @($script:plan | Where-Object { $_.State -eq 'FAILED' }).Count
    $attachNote = ''
    if ($script:attachMapInfo -and $script:attachMapInfo.Requested) {
        $attachNote += "`r`nTopic → Map：" + $(if ($script:attachMapInfo.Ready) { '将挂到 ' + $script:attachMapInfo.Title } else { '跳过（' + $script:attachMapInfo.Reason + '）' })
    }
    if ($script:attachPubInfo -and $script:attachPubInfo.Requested) {
        $attachNote += "`r`nMap → Pub：" + $(if ($script:attachPubInfo.Ready) { '将挂到 ' + $script:attachPubInfo.Title } else { '跳过（' + $script:attachPubInfo.Reason + '）' })
    }
    $q = @"
预检完成，尚未写入任何内容。

将创建：$tc
跳过：$sk
阻塞：$bl
失败：$fa
目标目录：$($script:cfg.FolderPath)$attachNote

开始执行吗？
"@
    $ans = [System.Windows.Forms.MessageBox]::Show($q.Trim(), '确认执行', 'YesNo', 'Question')
    $proceed = ($ans -eq [System.Windows.Forms.DialogResult]::Yes)
    if (-not $proceed) { Log '[..] 用户取消执行，未写入任何东西' }
}

# ---------------------------------------------------------------- STEP 5 执行
$script:didExecute = $proceed
if ($proceed) {
    Invoke-KcExecute $script:cfg
} else {
    Log '[..] 未执行任何写入'
}

# ---------------------------------------------------------------- 结果
Head 'STEP 7  结果'
$failed = Show-KcResult

try {
    if ($script:tmpRoot -and (Test-Path -LiteralPath $script:tmpRoot)) {
        Remove-Item -LiteralPath $script:tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
} catch { }

Clear-OldKcLog $script:logDir $KeepLogs
Log "transcript : $logPath"
Log ("logs dir   : {0}（保留最近 {1} 份 transcript）" -f $script:logDir, $KeepLogs)
$attachSkipped = $false
if ($script:attachMapInfo -and $script:attachMapInfo.Requested -and -not $script:attachMapInfo.Ready) { $attachSkipped = $true }
if ($script:attachPubInfo -and $script:attachPubInfo.Requested -and -not $script:attachPubInfo.Ready) { $attachSkipped = $true }
if ($failed -gt 0 -or $script:attachFail -gt 0 -or ($script:headless -and $attachSkipped)) { exit 1 } else { exit 0 }
