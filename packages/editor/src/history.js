/**
 * 撤销 / 重做。
 *
 * 用「快照栈」而不是「命令反演」：
 * 文档对象本来就很小（几十个节点、几百行 JSON），一次快照几 KB；
 * 而命令反演要为每种操作写一个逆操作，漏一个就是数据损坏。
 * 用不可变文档（doc.js 全是纯函数）换栈，代码少一半，也不会出现
 * 「撤销后图和文档对不上」这种最难查的 bug。
 *
 * 关键设计：**合并窗口**。拖动时每帧都会产生新文档，
 * 如果不合并，拖一次要按 200 次撤销才回到原处。所以同类操作在
 * MERGE_MS 内连发时只保留第一个快照（即「拖动前」的状态）。
 */

export const MERGE_MS = 600;

export function createHistory(initial, opts = {}) {
  const limit = opts.limit ?? 100;
  const mergeMs = opts.mergeMs ?? MERGE_MS;

  let stack = [initial];
  let index = 0;
  let lastTag = null;
  let lastTime = 0;

  return {
    /** 当前文档。 */
    get current() {
      return stack[index];
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < stack.length - 1;
    },
    /** 调试 / 测试用。 */
    get size() {
      return stack.length;
    },
    get index() {
      return index;
    },

    /**
     * 提交一个新文档。
     * @param {object} doc
     * @param {string} [tag] 操作标签；同 tag 且在合并窗口内会被合并
     * @returns {boolean} 是否真的入栈（内容没变或已被合并掉都返回 false）
     */
    push(doc, tag = null) {
      if (doc === this.current) return false;
      const now = Date.now();
      const mergeable =
        tag !== null && tag === lastTag && now - lastTime < mergeMs && index > 0;

      if (mergeable) {
        // 覆盖当前状态，不新增栈帧 —— 撤销一次回到拖动开始前
        stack[index] = doc;
        lastTime = now;
        return true;
      }

      // 丢掉 redo 分支
      if (index < stack.length - 1) stack = stack.slice(0, index + 1);
      stack.push(doc);
      if (stack.length > limit) {
        // 超上限丢最旧的，避免长时间编辑吃光内存
        stack.shift();
      } else {
        index++;
      }
      index = stack.length - 1;
      lastTag = tag;
      lastTime = now;
      return true;
    },

    undo() {
      if (!this.canUndo) return null;
      index--;
      // 撤销后立刻分割合并窗口，否则下一次拖动会被并进上一个操作
      lastTag = null;
      return stack[index];
    },

    redo() {
      if (!this.canRedo) return null;
      index++;
      lastTag = null;
      return stack[index];
    },

    /** 重置到某个文档（如载入文件），清空历史。 */
    reset(doc) {
      stack = [doc];
      index = 0;
      lastTag = null;
      lastTime = 0;
    },
  };
}
