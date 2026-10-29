/**
 * 浏览器里的 Buffer 替身。
 *
 * 为什么必须补：ts-visio 的 VisioPackage.getFileText() 第一行就是
 * `if (Buffer.isBuffer(content)) throw new Error('File is binary: ' + path)`，
 * 而 PageManager.load() 把整个读取包在 try/catch 里静默返回 []。
 * 浏览器没有 Buffer → 抛 ReferenceError → 被当成「读不到页面」→
 * doc.pages 变成空数组 → doc.pages[0] 为 undefined →
 * 报 `Cannot read properties of undefined (reading 'setSize')`。
 * 这个错和真正的页面问题长得一模一样，极难排查，所以宁可补一个真 Buffer。
 *
 * 用 npm 的 buffer 包（feross/buffer），它对 Uint8Array 完全兼容，
 * 且 jszip 在检测到 Buffer 后会走 nodebuffer 分支 —— 但我们统一用
 * uint8array 输出，不受影响。
 */
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

export { Buffer };
export default Buffer;
