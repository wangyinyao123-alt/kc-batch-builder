/**
 * 浏览器侧替身：`node:crypto`。
 *
 * ts-visio 的 MediaManager 用 sha1 做图片去重（`MediaManager.indexMedia`）。
 * 我们的图里没有图片，这条路走不到；但它是顶层 require，
 * 打包时必须能解析，否则整个 chunk 构建失败。
 *
 * 真被调用时用 Web Crypto 的 subtle.digest —— 但那是异步的，
 * 而这里签名是同步的。所以宁可明确报错，也不做「看起来能跑但结果是错的」的假实现。
 */
export function createHash(algorithm) {
  throw new Error(
    `浏览器里没有同步的 ${algorithm} 哈希；VSDX 图片去重路径不可用（本工具的图不含图片）`,
  );
}

export default { createHash };
