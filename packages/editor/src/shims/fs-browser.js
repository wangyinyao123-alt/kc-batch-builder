/**
 * 浏览器侧替身：`fs/promises`。
 *
 * ts-visio 只在 `VisioDocument.load(path)` 用 fs —— 而我们永远不会用它
 * （本工具的输入是自己的图数据对象，不是现成 vsdx 文件）。
 * 与其为了一个用不到的代码路径引入 polyfill，不如给个明确报错的替身：
 * 万一将来有人误用，会看到一句人话，而不是「fs is not defined」。
 */
export async function readFile() {
  throw new Error('浏览器里不能按路径读文件；请直接传入 vsdx 的字节（Uint8Array）');
}

export async function writeFile() {
  throw new Error('浏览器里不能按路径写文件；请用下载方式保存');
}

export default { readFile, writeFile };
