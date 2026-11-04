<#
.SYNOPSIS
    kc-import-images-ui.ps1 的三个补丁（①WsBaseUrl ②ListFolders ③headless 拦进度窗）
    本文件不是可独立运行的脚本，是"按位插入"的补丁素材。

.DESCRIPTION
    为什么是补丁片段而不是整脚本：
    kc-import-images-ui.ps1 的 canonical 版本在用户手里，本仓库从未存过副本
    （2026-10-29 用户提供后只做了契约拆解，见 backend/kc-import-contract.md）。
    没有原文就没有"逐字修改"的前提，因此这里给出可直接粘贴的实现片段，
    用户按下面的"插入位置"接到自己的脚本里，行为与 kc-create-objects-ui.ps1 完全一致。

    三个补丁的写法全部照抄 kc-create-objects-ui.ps1（同作者、同风格、已实测）：
      ① 见 kc-create-objects-ui.ps1:82 / 1159
      ② 见 kc-create-objects-ui.ps1:81 / 3084 / 3121-3155
      ③ 见 kc-create-objects-ui.ps1:532 / 2919

.NOTES
    适用脚本：kc-import-images-ui.ps1（10-29 版）
    目标机：Windows PowerShell 5.1
    落盘：2026-11-04
#>


# ================================================================
# 补丁 ①  -WsBaseUrl   让 P5「服务器地址」可配置
# ================================================================
<#
插入位置 1：param 块内，找到现有的 [string]$IshUser 一行，在它下面加：

    [string]$WsBaseUrl = '',

插入位置 2：找到脚本里写死服务器地址的那一行（形如）
    $wsUrl = 'https://kc-prod.hikvision.com/ISHWS/'
换成：
    $script:wsUrl = if ($WsBaseUrl) { $WsBaseUrl } else { 'https://kc-prod.hikvision.com/ISHWS/' }

注意：原脚本若用的是 $wsUrl 而非 $script:wsUrl，后续所有引用要同步改；
      用 $script: 作用域是为了让函数内部也能读到。

插入位置 3（可选，增强日志）：找到 $wsUrl 赋值之后、第一次登录之前，
插入下面这段——它把"当前连的是哪个域"打到日志里，便于排错：

    try { if ($script:wsUrl) { $h = ([uri]$script:wsUrl).Host } } catch { }
    Log ("[信息] 服务器：{0}" -f $h)

行为变化：不传 -WsBaseUrl 时仍连 kc-prod，完全向后兼容。
#>


# ================================================================
# 补丁 ②  -ListFolders   给 P3「浏览目录」按钮用（只读，列子目录后 exit 0）
# ================================================================
<#
插入位置 1：param 块内加一个开关：

    [switch]$ListFolders,

插入位置 2：找到脚本计算 $headless 的那一行（形如）
    $script:headless = [bool](...)
把 $ListFolders 并进判定，保证列目录模式不弹任何窗体：

    $script:headless = [bool]($ListFolders -or $script:headless)

插入位置 3：在"登录成功之后、正式流程之前"插入下面整个分支。
建议直接放在 $script:ish 构造完成、STEP 1 日志打完的位置后面。
下面用到的 Get-Prop / Normalize-KcPath / Resolve-KcFolderPath / Get-KcChildFolders
都是导入脚本里本来就有的同名函数（两个脚本同源，函数名一致）；
若你的导入脚本里函数名不同，按名字替换即可，逻辑不用动。
#>

if ($ListFolders) {
    $probePath = Normalize-KcPath $FolderPath
    Head ("KC 列目录  @ " + $probePath)
    $r = Resolve-KcFolderPath $script:ish $probePath
    $segs = @($probePath -split '[\\/]' | Where-Object { $_ })
    $missing = if ($r.Found -lt $segs.Count) { @($segs[$r.Found..($segs.Count - 1)]) } else { @() }
    $kids = @()
    $ftype = ''
    $fid = ''
    if ($r.Folder) {
        $tmp = "$(Get-Prop $r.Folder @('IshFolderRef', 'IshRef'))"
        if ($tmp) { $fid = $tmp }
        $ftype = "$(Get-Prop $r.Folder @('IshFolderType'))"
        $kids = @(Get-KcChildFolders $script:ish $fid)
    }
    $payload = [pscustomobject]@{
        path       = $probePath
        resolved   = [bool]$r.Folder
        leaf       = $r.Leaf
        missing    = @($missing)
        folderType = $ftype
        folderId   = $fid
        children   = @($kids | ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.Id; type = $_.Type } })
    }
    Log ('KCJSON ' + ($payload | ConvertTo-Json -Compress -Depth 5))
    exit 0
}

<#
输出协议（Electron 解析器认这一行）：
    KCJSON {"path":"General\\x","resolved":true,"leaf":"x","missing":[],
            "folderType":"ISHIllustration","folderId":"12345",
            "children":[{"name":"image","id":"…","type":"ISHIllustration"}]}

要点：
- 必须整行单行 JSON，前缀固定 'KCJSON '（含一个空格）。
- folderType 不是 ISHIllustration 时，UI 会立刻提示「这层不能放插图，改到 \image 层」。
- missing 非空表示路径还没建全，正是 P3「新建目录」的候选。
- 浏览器树逐层调本模式（一次只列一层），脚本内 $kcChildCache 是进程级缓存，
  跨调用不保留，缓存由 Electron 前端自己做。
#>


# ================================================================
# 补丁 ③  headless 时拦掉 Start-Progress（否则 Electron 里会多一个原生进度窗）
# ================================================================
<#
原理：Update-Progress / Stop-Progress 对未初始化的进度窗本来就不报错，
      只有 Start-Progress 会真的弹窗，所以只拦 Start 一处就够。

插入位置：在脚本正文里搜 "Start-Progress"，把每一处形如
    Start-Progress 'KC 批量导入图片'
改成
    if (-not $script:headless) { Start-Progress 'KC 批量导入图片' }

如果脚本里还有第二处（比如"开始写入"阶段再弹一次），同样处理。
#>


# ================================================================
# 三步验证（改完在 Windows 上跑）
# ================================================================
<#
1) 语法检查（不执行，只解析，最快发现括号/引号错）：
   powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('.\kc-import-images-ui.ps1',[ref]$null,[ref]$e); if($e){$e|%{$_.Message}}else{'OK'}"

2) 补丁 ② 单独验证（只读，不写 KC）：
   powershell -NoProfile -ExecutionPolicy Bypass -File .\kc-import-images-ui.ps1 `
     -IshUser <账号> -IshPassword <密码> -ListFolders "General"
   期望：最后一行以 "KCJSON {" 开头；没有弹出任何窗体。

3) 补丁 ③ 验证（预检模式，零写入）：
   powershell -NoProfile -ExecutionPolicy Bypass -File .\kc-import-images-ui.ps1 `
     -IshUser <账号> -IshPassword <密码> `
     -ImageDir "<某个图片目录>" -KcFolder "General\...\image"
   期望：控制台持续输出，全程无独立进度窗；结尾有 [预检] 汇总行。
#>


# ================================================================
# 附：补丁在 Electron 侧对应的 UI 行为（无需再改脚本）
# ================================================================
<#
① -WsBaseUrl     → P5 设置页「服务器地址」输入框，落 kc:settings 的 wsBaseUrl
② -ListFolders   → P3 目标路径右侧「浏览」按钮，弹出目录树
③ headless       → 无 UI 变化，只是把原生进度窗消掉；
                   进度完全由 Electron 解析 stdout 的 [i/N] 行自己画
#>
