'use strict';
/**
 * zip 读写适配器。
 *
 * 为什么单独抽一层：核心导出器（src/index.js）要能在浏览器里跑（离线模式），
 * 而本文档的补丁需要「解开 vsdx → 改 page XML → 重新打包」。Node 与浏览器
 * 的字节类型不同（Buffer vs Uint8Array/ArrayBuffer），这里统一成
 * Map<filename, Uint8Array>，上层不感知运行环境。
 */

/** 基于 jszip（ts-visio 的传递依赖，无需额外安装） */
function jszipImpl(JSZip) {
  return {
    async read(bytes) {
      const zip = await JSZip.loadAsync(bytes);
      const files = new Map();
      for (const name of Object.keys(zip.files)) {
        const f = zip.files[name];
        if (f.dir) continue;
        files.set(name, await f.async('uint8array'));
      }
      return files;
    },
    async write(files) {
      const zip = new JSZip();
      for (const [name, data] of files) zip.file(name, data);
      return zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    },
  };
}

/** Node 环境：自动加载 jszip */
function nodeImpl() {
  return jszipImpl(require('jszip'));
}

module.exports = { jszipImpl, nodeImpl };
