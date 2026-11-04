; ---------------------------------------------------------------------------
; KC 批量建库工具 —— 安装向导品牌化
;
; 背景：electron-builder 的 assisted 安装向导走 NSIS MUI2。MUI2 的底色、
; 控件位置、字体都编译进它自己的资源里，配置项只能换图、换文案，**不能换配色**。
; 所以这里的策略是「图片承担全部视觉」：
;   - 侧栏 164×314（欢迎页/完成页左边那块）→ 设计稿渐变 + 猫咪贴纸
;   - 页眉 150×57（内页右上角）→ 粉色渐变 + 品牌字
;   - 页眉图标 32×32 → 应用图标
;   - 其余页面文案全部改写，去掉 MUI 默认的英文腔和"下一步"啰嗦句式
;
; 图片路径在 package.json 的 build.nsis 里配置：
;   installerSidebar / uninstallerSidebar / installerHeader / installerHeaderIcon
;
; 注意：这个文件被 !include 到 installer.nsi 的**最前面**（common.nsh 之前），
; 所以只能放 !define 和宏定义，不能放 Function 或 Section——那些会在
; 模板之后重复定义而编译失败。
; ---------------------------------------------------------------------------

; ---- 欢迎页 ----
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 KC 批量建库工具"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "这个向导会把「KC 批量建库工具」安装到你的电脑。$\r$\n$\r$\n它用来把本地图片、Topic、Map、Pub 批量推进 KC 仓库，全部操作先预检、后执行，不删不改已有内容。$\r$\n$\r$\n点「下一步」继续。"

; ---- 目录页 ----
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。装好后程序目录里会带上两个 PowerShell 脚本（kc-import-images-ui.ps1、kc-create-objects-ui.ps1），它们是真正干活的部分，请勿删除。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装到"

; ---- 完成页 ----
!define MUI_FINISHPAGE_TITLE "KC 批量建库工具 已安装"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "装好了。桌面和开始菜单都有快捷方式。$\r$\n$\r$\n首次启动请先到「设置」页确认三件事：$\r$\n    ·  PowerShell 7 可用$\r$\n    ·  ISHRemote 模块已安装（没有会提示，可一键装）$\r$\n    ·  KC 服务器地址填对$\r$\n$\r$\n三项都绿了再建任务，否则执行会停在登录那一步。"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 KC 批量建库工具"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; ---- 卸载页 ----
!define MUI_UNWELCOMEPAGE_TITLE "卸载 KC 批量建库工具"
!define MUI_UNWELCOMEPAGE_TITLE_3LINES
!define MUI_UNWELCOMEPAGE_TEXT "将从这台电脑移除「KC 批量建库工具」。$\r$\n$\r$\n只删除程序目录与快捷方式。你的任务记录、日志、已填的 KC 账号都保留在用户数据目录里，下次装回来还在。$\r$\n$\r$\n点「卸载」继续。"

; ---- 错误/中止页 ----
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "安装还没完成，现在退出会留下不完整的程序目录。确定要退出吗？"
!define MUI_UNABORTWARNING
!define MUI_UNABORTWARNING_TEXT "卸载还没完成，现在退出会留下残留文件。确定要退出吗？"

; 页眉位图（MUI_HEADERIMAGE / MUI_HEADERIMAGE_BITMAP）由 electron-builder 依据
; package.json 的 nsis.installerHeader 自动注入，此处不要重复 !define，否则报
; "MUI_HEADERIMAGE already defined" 并中止编译。
