/**
 * 构建脚本：把编辑器打成一个自包含的 ESM 包。
 *
 * 为什么需要打包而不是直接 import：
 * core / editor 内部是全相对路径 import，浏览器本来能直接跑；
 * 但 VSDX 导出依赖 ts-visio（CJS）。浏览器不认 CJS，这一步负责转换。
 *
 * ts-visio 通过动态 import 引入，代码分割会把它拆成独立 chunk，
 * 只在点「VSDX」时才下载 —— 首屏不为它付费。
 *
 * 两个 Node 内建模块用替身顶掉（见 src/shims/）：
 * ts-visio 顶层 require 了 fs/promises 和 node:crypto，但只用在
 * 「按路径读文件」和「图片去重」两条我们不走的路径上。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const shim = (name) => resolve(here, 'src/shims', name);

await build({
  entryPoints: [resolve(here, 'src/app.js')],
  outdir: resolve(here, 'dist'),
  entryNames: 'editor',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  sourcemap: true,
  logLevel: 'info',
  // 浏览器没有 Buffer，而 ts-visio 用它做二进制判定（见 shims/buffer-browser.js）
  inject: [resolve(here, 'src/shims/buffer-browser.js')],
  alias: {
    'fs/promises': shim('fs-browser.js'),
    'node:fs/promises': shim('fs-browser.js'),
    'node:crypto': shim('crypto-browser.js'),
    crypto: shim('crypto-browser.js'),
  },
});
