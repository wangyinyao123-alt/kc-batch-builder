# Windows 打包说明

## 产物

| 文件 | 大小 | 用途 |
|---|---|---|
| `release/KC-BatchBuilder-0.1.0-win-x64.exe` | 87 MB | NSIS 安装包：可选安装目录、建桌面/开始菜单快捷方式、可卸载 |
| `release/KC-BatchBuilder-0.1.0-win-x64-portable.zip` | ~110 MB | 免安装绿色版：解压后双击 `KC 批量建库工具.exe` |
| `release/win-unpacked/` | 301 MB | 绿色版未压缩目录（zip 的源） |

## 构建命令

```bash
cd kc-app
npm ci
npm run dist:win        # 只出安装包
npm run dist:win:dir    # 只出 win-unpacked 目录
```

在 macOS 上构建需要三个环境变量（Windows 上不需要）：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
export HOME="$PWD/.home-pack"   # 沙箱里 ~/Library/Caches 不可写时
```

macOS（Apple Silicon）还需要 Rosetta 2，否则 `makensis` 和 `wine` 都跑不起来：

```bash
/usr/sbin/softwareupdate --install-rosetta --agree-to-license
```

## 打包会带上什么

- `dist/` —— Vite 构建的前端（含 fonts/ 两款 Noto Sans TC、img/bg/ 两张背景、img/stickers/ 28 张素材）
- `electron/` —— 主进程、preload、runner、日志解析器
- `node_modules/` —— 只打了 react / react-dom 及其依赖（88 项），devDependencies 不进包
- `../backend/scripts/` → `resources/scripts/` —— PowerShell 脚本

Windows 上安装后的实际路径：

```
C:\Users\<你>\AppData\Local\Programs\kc-app\resources\scripts\kc-create-objects-ui.ps1
```

`electron/runner/index.js` 的 `resolveScriptDir()` 优先找 `process.resourcesPath/scripts`，
所以打包版能直接命中，不需要配 `KC_SCRIPTS_DIR`。

## 已知缺口

**「导入图片」任务在打包版里会报「找不到脚本」。**
`psRunner.js` 的 `SCRIPTS.import` 指向 `kc-import-images-ui.ps1`，
但仓库里只有 `kc-create-objects-ui.ps1`（负责 Topic/Map/Pub 三类）。
补上导入脚本到 `backend/scripts/` 后重新打包即可，无需改代码。

## 代码签名

当前未签名。Windows 首次运行会弹 SmartScreen「未知发布者」，
点「更多信息 → 仍要运行」即可。正式分发需要代码签名证书，
在 `package.json` 的 `build.win` 里加 `certificateFile` 与 `signingHashAlgorithms`。
