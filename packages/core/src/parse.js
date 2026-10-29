import { DIAGRAM_VERSION } from './ir.js';

/**
 * Markdown → 图数据（IR）解析器。
 *
 * 语法只有五条，一条都不多：
 *
 *   1. 有序列表 `1. xxx`（顶格）= 顺序步骤，自动连到上一步
 *   2. 缩进子项 `- 标签 → 目标` = 从上一个判断节点分出分支；目标自动成为节点
 *   3. 节点文本以 `判断：` 开头，或以 `？` / `?` 结尾 = 菱形判断框
 *   4. `A => B` = 汇合（把 A 接到已有节点 B）
 *   5. `@名字` = 引用已存在的节点，而不是新建
 *
 * 另有三种节点类型标记，与 `判断：` 同构：
 *   `开始：xxx` 或整句就是 `开始` → 椭圆起点
 *   `结束：xxx` 或整句就是 `结束` → 椭圆终点
 *
 * 设计取舍：
 *   - `→` 右边的目标**必须建节点**。原型最大的洞就是只在左边画了线，
 *     右边悬空，图是断的。
 *   - `@` 是「新建 vs 接回」的唯一区分手段。没有它，「回零」出现两次就会
 *     被误当成两个节点。
 *   - 前向引用合法（先写 `@待机`，后面才定义 `待机`），解析结束再统一校验。
 */

const ARROW = /→|->/;
const MERGE = /=>/;

// 类型前缀：与 `判断：` 同构
const TYPE_PREFIXES = [
  { re: /^判断\s*[：:]\s*/, type: 'decision' },
  { re: /^开始\s*[：:]\s*/, type: 'start' },
  { re: /^结束\s*[：:]\s*/, type: 'end' },
];

const TERMINAL_WORDS = new Map([
  ['开始', 'start'],
  ['start', 'start'],
  ['结束', 'end'],
  ['end', 'end'],
  ['完成', 'end'],
]);

/**
 * 从一段文本里提取「引用键」。
 * `回零：调用 MC_Home` → `回零`；`已建立位置参考？` → `已建立位置参考`
 */
export function refKey(raw) {
  let s = String(raw).trim();
  s = s.replace(/^@/, '');
  const colon = s.search(/[：:]/);
  if (colon > 0) s = s.slice(0, colon);
  s = s.replace(/[？?。，,！!]+$/, '');
  return s.trim();
}

/**
 * 解析 Markdown 为图数据。永不抛异常 —— 所有问题都进 diagnostics，
 * 让上层能「标到具体某一行」。
 *
 * @param {string} src
 * @returns {import('./ir.js').Diagram}
 */
export function parseMarkdown(src) {
  const text = String(src ?? '');
  const nodes = new Map();      // id → node
  const order = [];             // 节点出现顺序，保证输出稳定
  const edges = [];
  const diagnostics = [];
  const declared = new Set();   // 真正被定义过的 id
  const referenced = new Map(); // id → 首次引用位置（用于「引用了未定义节点」）
  // 汇合目标自成一个节点：`A => 财务打款` 把 财务打款 引入图里，
  // 即使它没有独立的列表项，也不该被判成「引用了不存在的节点」。
  const mergeTargets = new Set();

  let title = '';
  let edgeSeq = 0;

  const pushDiag = (level, code, message, line, col) =>
    diagnostics.push({ level, code, message, line, col });

  /** 登记一次引用（不创建节点）。 */
  const noteRef = (id, line, col) => {
    if (!referenced.has(id)) referenced.set(id, { line, col });
  };

  /**
   * 取或建节点。
   * `define: true` 表示这是「定义」而非「引用」，只有定义与定义相撞才算重复。
   */
  const ensureNode = (id, { type, text: display, line, col, define = false }) => {
    const existing = nodes.get(id);
    if (existing) {
      // 已经存在：只补齐类型信息（先引用后定义时，定义处更权威）
      if (type && existing.type === 'process') existing.type = type;
      // 定义处比引用处权威：引用只给了个名字，定义才有完整说明
      if (define && display) existing.text = display;
      if (define && declared.has(id)) {
        pushDiag(
          'warn',
          'node-duplicate',
          `节点「${id}」被定义了两次（另一处在第 ${existing.sourceLine} 行），以第一次为准`,
          line,
          col,
        );
      }
      return existing;
    }
    const node = {
      id,
      type: type || 'process',
      text: display || id,
      sourceLine: line,
      sourceCol: col,
    };
    nodes.set(id, node);
    order.push(id);
    return node;
  };

  const addEdge = (from, to, label, kind, line, col) => {
    // 同一条边出现两次（比如先分支指向 @X，后面又用 => @X 汇合）只保留一条
    const dup = edges.find(
      (e) => e.from === from && e.to === to && e.label === (label || '') && e.kind === (kind || 'flow'),
    );
    if (dup) return dup;
    const edge = {
      id: `e${++edgeSeq}`,
      from,
      to,
      label: label || '',
      kind: kind || 'flow',
      sourceLine: line,
      sourceCol: col,
    };
    edges.push(edge);
    return edge;
  };

  /** 按行扫描，先收集原始条目。 */
  const items = [];
  const rawLines = text.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (trimmed === '') continue;
    if (trimmed.startsWith('<!--')) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      if (!title && /^#\s/.test(trimmed)) title = trimmed.replace(/^#\s*/, '').trim();
      continue;
    }
    if (/^```/.test(trimmed)) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) continue; // 分隔线

    const m = raw.match(/^([ \t]*)(\d+[.)]|[-*+])\s+(.*)$/);
    if (!m) {
      // 不是列表项，但可能是纯文本行 —— 当作独立注释忽略，不静默吞掉生成节点
      pushDiag(
        'warn',
        'line-not-list',
        `这一行不是列表项，已忽略：${trimmed.slice(0, 24)}`,
        lineNo,
        1,
      );
      continue;
    }

    const indentRaw = m[1].replace(/\t/g, '    ');
    items.push({
      indent: indentRaw.length,
      ordered: /^\d/.test(m[2]),
      body: m[3].trim(),
      line: lineNo,
      col: indentRaw.length + 1,
    });
  }

  // 顶层顺序链的游标
  let prevTop = null;
  const stack = []; // { indent, id, type }

  for (const item of items) {
    while (stack.length && stack[stack.length - 1].indent >= item.indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    const body = item.body;
    const { line, col } = item;

    // ---- 规则 4：汇合 ----
    const mergeMatch = body.match(/^(.+?)\s*=>\s*(.+)$/);
    if (mergeMatch) {
      const fromId = refKey(mergeMatch[1]);
      const toId = refKey(mergeMatch[2]);
      if (!fromId || !toId) {
        pushDiag('error', 'merge-malformed', `汇合写法不完整：${body}`, line, col);
        continue;
      }
      noteRef(fromId, line, col);
      const from = ensureNode(fromId, { line, col });
      const to = ensureNode(toId, { line, col });
      mergeTargets.add(toId);
      addEdge(from.id, to.id, '', 'merge', line, col);
      stack.push({ indent: item.indent, id: to.id, type: to.type });
      if (item.indent === 0) prevTop = to.id;
      continue;
    }

    // ---- 规则 2：分支 ----
    if (ARROW.test(body)) {
      const am = body.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
      if (!am) {
        pushDiag('error', 'branch-malformed', `分支写法不完整：${body}`, line, col);
        continue;
      }
      const label = am[1].trim();
      const targetRaw = am[2].trim();
      const isRef = targetRaw.startsWith('@');
      // id 必须从「去掉类型前缀之后」的文本里取，否则 `判断：xxx` 的 id 会变成
      // 字面量「判断」，多个判断节点会互相撞名。
      const targetDisplay = stripPrefix(targetRaw);
      const toId = refKey(targetDisplay);

      if (!parent) {
        pushDiag(
          'error',
          'branch-without-parent',
          `分支「${body}」没有上级判断节点，请缩进到判断节点下面`,
          line,
          col,
        );
        continue;
      }
      if (parent.type !== 'decision') {
        pushDiag(
          'warn',
          'branch-under-non-decision',
          `「${label} → ${toId}」挂在非判断节点「${parent.id}」下，已按普通分支处理`,
          line,
          col,
        );
      }

      let target;
      if (isRef) {
        noteRef(toId, line, col);
        target = ensureNode(toId, { line, col });
      } else {
        // 非 @：新建。显示文本保留冒号后的说明，但 id 取冒号前的短名。
        const type = detectType(targetRaw, line, col);
        target = ensureNode(toId, { type, text: targetDisplay, line, col, define: true });
        declared.add(toId);
      }

      addEdge(parent.id, target.id, label, 'flow', line, col);
      stack.push({ indent: item.indent, id: target.id, type: target.type });
      if (item.indent === 0) prevTop = target.id;
      continue;
    }

    // ---- 规则 1 / 3：节点 ----
    const type = detectType(body, line, col);
    const display = stripPrefix(body);
    const id = refKey(display);

    if (!id) {
      pushDiag('error', 'node-empty', `列表项内容为空：${body}`, line, col);
      continue;
    }

    const node = ensureNode(id, { type, text: display, line, col, define: true });
    declared.add(id);

    if (parent) {
      if (parent.type === 'decision') {
        pushDiag(
          'warn',
          'decision-implicit-branch',
          `判断节点「${parent.id}」下直接跟了步骤「${node.id}」，已自动连线但缺分支标签`,
          line,
          col,
        );
      }
      addEdge(parent.id, node.id, '', 'flow', line, col);
    } else if (item.indent === 0 && prevTop && prevTop !== node.id) {
      const prevNode = nodes.get(prevTop);
      if (prevNode && prevNode.type === 'decision') {
        pushDiag(
          'warn',
          'missing-merge',
          `判断节点「${prevTop}」之后直接跟了「${node.id}」，缺少汇合；如需接上请写「${prevTop} => ${node.id}」`,
          line,
          col,
        );
      } else {
        addEdge(prevTop, node.id, '', 'flow', line, col);
      }
    }

    stack.push({ indent: item.indent, id: node.id, type: node.type });
    if (item.indent === 0) prevTop = node.id;
  }

  // ---- 后置校验 ----
  for (const [id, pos] of referenced) {
    if (!declared.has(id) && !mergeTargets.has(id)) {
      pushDiag(
        'error',
        'ref-undefined',
        `引用了不存在的节点「${id}」，请用 @${id} 之前先定义它`,
        pos.line,
        pos.col,
      );
    }
  }

  // 自连边
  for (const e of edges) {
    if (e.from === e.to) {
      pushDiag('warn', 'self-loop', `节点「${e.from}」连到了自己`, e.sourceLine, e.sourceCol);
    }
  }

  // 判断节点出口数（PRD：菱形 ≤ 3 个出口）
  const outDegree = new Map();
  for (const e of edges) outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
  for (const id of order) {
    const n = nodes.get(id);
    if (n.type === 'decision' && (outDegree.get(id) || 0) > 3) {
      pushDiag(
        'warn',
        'too-many-exits',
        `判断节点「${id}」有 ${outDegree.get(id)} 个出口，建议拆成两层判断`,
        n.sourceLine,
        n.sourceCol,
      );
    }
  }

  // 没有任何出口也没有入口的孤立节点（除唯一节点外）
  if (order.length > 1) {
    const hasIn = new Set(edges.map((e) => e.to));
    const hasOut = new Set(edges.map((e) => e.from));
    for (const id of order) {
      if (!hasIn.has(id) && !hasOut.has(id)) {
        const n = nodes.get(id);
        pushDiag('warn', 'isolated-node', `节点「${id}」没有任何连线`, n.sourceLine, n.sourceCol);
      }
    }
  }

  return {
    version: DIAGRAM_VERSION,
    title,
    nodes: order.map((id) => nodes.get(id)),
    edges,
    diagnostics,
  };

  // ---- 内部工具 ----

  function detectType(raw, line, col) {
    for (const p of TYPE_PREFIXES) {
      if (p.re.test(raw)) return p.type;
    }
    const core = raw.trim();
    const terminal = TERMINAL_WORDS.get(core.toLowerCase()) || TERMINAL_WORDS.get(core);
    if (terminal) return terminal;
    if (/[？?]$/.test(core)) return 'decision';
    void line;
    void col;
    return 'process';
  }
}

/** 去掉类型前缀，得到用于显示的文本。 */
export function stripPrefix(raw) {
  let s = String(raw).trim();
  for (const p of TYPE_PREFIXES) s = s.replace(p.re, '');
  return s.trim();
}
