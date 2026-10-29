/**
 * 浏览器里的 VSDX 导出桥。
 *
 * 为什么单独一个文件：VSDX 依赖 ts-visio（一个 CJS 包，体积不小），
 * 而绝大多数打开画布的人只做 SVG / PNG 导出。把它做成动态 import 的独立
 * chunk，首屏就不用为它付费，点「VSDX」时才去加载。
 *
 * 这里只做两件事：把画布的场景数据翻译成导出器要的形状（它期待的就是
 * core 的 laid 结构），以及把 jszip 注入进去 —— 导出器本身不绑运行环境。
 */
import { buildVsdx as rawBuildVsdx, patchVsdx as rawPatchVsdx } from '../../../tools/vsdx-export/src/index.js';
import { jszipImpl } from '../../../tools/vsdx-export/src/zip.js';
import JSZip from 'jszip';

const zip = jszipImpl(JSZip);

/** 生成 vsdx 字节（已打上 dual-write 补丁，draw.io 与 Visio 都能正确读）。 */
export async function buildVsdx(diagram, theme) {
  const bytes = await rawBuildVsdx(diagram, theme, zip);
  return rawPatchVsdx(bytes, zip);
}
