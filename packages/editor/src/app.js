/**
 * 画布编辑器主程序。
 *
 * 分层原则：所有几何判断都在 hit.js / scene.js / viewport.js 里（纯函数、有单测），
 * 这个文件只负责「把 DOM 事件翻译成对这些纯函数的调用」。
 * 所以这里读起来应该全是胶水，一旦出现算法就说明放错地方了。
 *
 * 状态就三样：doc（图数据）、view（视口）、selection（选中谁）。
 * 其余全部是派生值，每次从 doc 重算 —— 不维护第二份真相，也就没有
 * 「图和数据不一致」这类 bug。
 */
import {
  emptyDoc,
  addNode,
  addEdge,
  moveNode,
  removeNode,
  removeEdge,
  updateNodeText,
  setNodeType,
  setEdgeLabel,
  setTitle,
  setTemplate,
  applyLayout,
  serializeDoc,
  deserializeDoc,
  docFromDiagram,
  docToDiagram,
} from './doc.js';
import { createHistory } from './history.js';
import {
  newView,
  toScreen,
  toWorld,
  zoomBy,
  panBy,
  fitBox,
} from './viewport.js';
import { buildScene, sceneToLaid, snapToNeighbors } from './scene.js';
import { pickNode, pickEdge, pickLabel, pickPort, pickInRect } from './hit.js';
import { nodeSvg, edgeSvg, labelSvg, rubberSvg, guidesSvg, marqueeSvg } from './canvas.js';
import { resolveSpec, listTemplates } from '../../core/src/templates.js';
import { renderSvg } from '../../core/src/render.js';
import { layout } from '../../core/src/layout.js';
import { parseMarkdown } from '../../core/src/parse.js';
import { orthogonalRoute } from '../../core/src/route.js';
import { snapGrid, titleHeight as calcTitleHeight } from '../../core/src/theme.js';
import { toVsdxInput, toVsdxTheme } from '../../core/src/vsdx-input.js';

const STORAGE_KEY = 'flowchart-elf:doc:v1';
/** 两次按下间隔小于这个值、且落在同一节点上，就算双击。 */
const DOUBLE_CLICK_MS = 350;

const $ = (id) => document.getElementById(id);

const els = {
  stage: $('stage'),
  canvas: $('canvas'),
  root: $('layer-root'),
  defs: $('canvas-defs'),
  edges: $('layer-edges'),
  labels: $('layer-labels'),
  nodes: $('layer-nodes'),
  overlay: $('layer-overlay'),
  textEditor: $('text-editor'),
  emptyHint: $('empty-hint'),
  titleInput: $('doc-title'),
  templateSelect: $('template'),
  direction: $('direction'),
  nodeGap: $('node-gap'),
  rankGap: $('rank-gap'),
  zoomLabel: $('zoom-label'),
  selectionBody: $('selection-body'),
  toast: $('toast'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
};

// ---------------------------------------------------------------- 状态

let doc = emptyDoc();
let view = newView();
let selection = null; // {kind:'node'|'edge', id} | null
let hovered = null; // 节点 id
let spec = resolveSpec('default');

let dragState = null;
// 自建的双击判定（见 onPointerDown 里的说明）：
// lastClick 记录上一次在同一目标上的按下，靠时间 + 距离判定是不是双击。
let lastClick = null;
let editing = null; // 正在进行就地编辑的 {id, kind}
let guides = { x: [], y: [] };
let layoutOpts = { direction: 'TB', nodeGap: 40, rankGap: 56 };
let lastScene = null;

const history = createHistory(doc);

// ---------------------------------------------------------------- 提示

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 1800);
}

// ---------------------------------------------------------------- 绘图

function applyViewBox() {
  const r = els.stage.getBoundingClientRect();
  els.canvas.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  els.root.setAttribute(
    'transform',
    `translate(${view.tx},${view.ty}) scale(${view.scale})`,
  );
  els.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
}

function render() {
  const scene = buildScene(doc, spec);
  lastScene = scene;

  els.defs.innerHTML = buildDefs();
  els.edges.innerHTML = scene.edges
    .map((e) => edgeSvg(e, spec, selection?.kind === 'edge' && selection.id === e.id))
    .join('');
  els.labels.innerHTML = scene.labels
    .map((l) => labelSvg(l, spec, selection?.kind === 'edge' && selection.id === l.edgeId))
    .join('');
  els.nodes.innerHTML = scene.nodes
    .map((n) =>
      nodeSvg(n, spec, {
        selected: selection?.kind === 'node' && selection.id === n.id,
        hovered: hovered === n.id,
      }),
    )
    .join('');

  els.emptyHint.hidden = doc.nodes.length > 0;

  // 选中态变化需要重画端口，所以 overlay 也一起重画
  els.overlay.innerHTML = '';
  drawRubber();

  // 视口外的内容不需要吃指针事件，交给命中函数算
  els.titleInput.value = doc.title;
  els.templateSelect.value = doc.template;
  syncSelectionPanel();
  syncHistoryButtons();
}

function buildDefs() {
  // 直接复用导出用的箭头定义，保证屏上的箭头和导出的一模一样
  const probe = renderSvg(
    { nodes: [], edges: [], labels: [], width: 0, height: 0 },
    spec,
    { title: '' },
  );
  const m = /<defs>([\s\S]*?)<\/defs>/.exec(probe);
  return m ? m[1] : '';
}

function drawRubber() {
  if (!dragState || dragState.mode !== 'connect') return;
  const from = lastScene.nodes.find((n) => n.id === dragState.fromId);
  if (!from) return;
  els.overlay.insertAdjacentHTML(
    'beforeend',
    rubberSvg(from, dragState.pointer, dragState.side),
  );
}

function drawOverlay() {
  els.overlay.innerHTML = '';
  if (dragState?.mode === 'connect') {
    drawRubber();
    return;
  }
  if (dragState?.mode === 'marquee') {
    els.overlay.insertAdjacentHTML('beforeend', marqueeSvg(dragState.rect));
  }
  if (guides.x.length || guides.y.length) {
    const b = lastScene ? lastScene.bounds : { x: 0, y: 0, w: 0, h: 0 };
    els.overlay.insertAdjacentHTML('beforeend', guidesSvg(guides, b));
  }
}

function syncHistoryButtons() {
  els.btnUndo.disabled = !history.canUndo;
  els.btnRedo.disabled = !history.canRedo;
}

// ---------------------------------------------------------------- 提交

/**
 * 所有改文档的地方都走这里：一次调用 = 一个撤销点。
 * tag 用于合并高频操作（拖动 50 帧只留一个撤销点）。
 */
function commit(nextDoc, tag = null) {
  if (!nextDoc) return;
  doc = nextDoc;
  history.push(doc, tag);
  render();
  // 立刻落盘（带防抖）。只靠 3 秒定时器 + beforeunload 的话，
  // 标签页被杀 / 崩溃会丢掉最后几秒的编辑，刷新后回到旧文档。
  schedulePersist();
}

let persistTimer = 0;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 250);
}

function reselect(kind, id) {
  selection = kind ? { kind, id } : null;
  render();
}

// ---------------------------------------------------------------- 坐标

function stagePoint(ev) {
  const r = els.stage.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function worldPoint(ev) {
  return toWorld(view, stagePoint(ev));
}

// ---------------------------------------------------------------- 选择面板

const TYPE_LABEL = {
  start: '开始',
  end: '结束',
  process: '步骤',
  decision: '判断',
  note: '注释',
};

function syncSelectionPanel() {
  const body = els.selectionBody;
  if (!selection) {
    body.className = 'empty';
    body.textContent = '没有选中任何东西';
    return;
  }
  body.className = '';

  if (selection.kind === 'node') {
    const n = doc.nodes.find((x) => x.id === selection.id);
    if (!n) return;
    body.innerHTML = `
      <div class="sel-head">
        <span>节点</span><span class="sel-tag">${TYPE_LABEL[n.type] || n.type}</span>
      </div>
      <div class="field">
        <label>文字（换行会被自动折行）</label>
        <textarea id="insp-text" rows="3"></textarea>
      </div>
      <div class="field">
        <label>形状</label>
        <div class="type-row">
          ${['start', 'process', 'decision', 'end']
            .map(
              (t) =>
                `<button class="type-btn${n.type === t ? ' on' : ''}" data-type="${t}">${TYPE_LABEL[t]}</button>`,
            )
            .join('')}
        </div>
      </div>
      <button class="btn danger" id="btn-del-node">删除节点</button>
    `;
    const ta = $('insp-text');
    ta.value = n.text;
    ta.addEventListener('input', () => {
      const r = updateNodeText(doc, n.id, ta.value);
      if (r.changed) commit(r.doc, `text:${n.id}`);
    });
    for (const btn of body.querySelectorAll('.type-btn')) {
      btn.addEventListener('click', () => {
        const r = setNodeType(doc, n.id, btn.dataset.type);
        if (r.changed) commit(r.doc);
      });
    }
    $('btn-del-node').addEventListener('click', () => deleteSelection());
    return;
  }

  const e = doc.edges.find((x) => x.id === selection.id);
  if (!e) return;
  const from = doc.nodes.find((n) => n.id === e.from);
  const to = doc.nodes.find((n) => n.id === e.to);
  body.innerHTML = `
    <div class="sel-head"><span>连线</span><span class="sel-tag">${e.kind === 'merge' ? '汇合' : '流向'}</span></div>
    <div class="field">
      <label>连接</label>
      <div class="note">${escapeHtml(short(from?.text))} → ${escapeHtml(short(to?.text))}</div>
    </div>
    <div class="field">
      <label>标签（如「是」「否」）</label>
      <input id="insp-edge-label" type="text" />
    </div>
    <button class="btn danger" id="btn-del-edge">删除连线</button>
  `;
  const input = $('insp-edge-label');
  input.value = e.label;
  input.addEventListener('input', () => {
    const r = setEdgeLabel(doc, e.id, input.value);
    if (r.changed) commit(r.doc, `label:${e.id}`);
  });
  $('btn-del-edge').addEventListener('click', () => deleteSelection());
}

const short = (s) => (s && s.length > 14 ? `${s.slice(0, 14)}…` : s || '');
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------- 删除

function deleteSelection() {
  if (!selection) return;
  if (selection.kind === 'node') {
    const r = removeNode(doc, selection.id);
    if (r.changed) {
      selection = null;
      commit(r.doc);
    }
  } else {
    const r = removeEdge(doc, selection.id);
    if (r.changed) {
      selection = null;
      commit(r.doc);
    }
  }
}

// ---------------------------------------------------------------- 就地改字

function beginEdit(nodeId, sceneNode) {
  const n = doc.nodes.find((x) => x.id === nodeId);
  if (!n) return;
  editing = { kind: 'node', id: nodeId };

  const tl = toScreen(view, { x: sceneNode.x, y: sceneNode.y });
  const br = toScreen(view, { x: sceneNode.x + sceneNode.w, y: sceneNode.y + sceneNode.h });
  const w = Math.max(90, br.x - tl.x);
  const h = Math.max(30, br.y - tl.y);

  const ta = els.textEditor;
  ta.hidden = false;
  ta.value = n.text;

  ta.style.left = `${tl.x}px`;
  ta.style.top = `${tl.y}px`;
  ta.style.width = `${w}px`;
  ta.style.height = `${h}px`;
  ta.style.fontSize = `${Math.max(11, spec.nodeName.size * view.scale)}px`;
  ta.style.fontWeight = String(spec.nodeName.weight);
  ta.focus();
  ta.select();
}

function beginEdgeLabelEdit(edgeId) {
  const e = doc.edges.find((x) => x.id === edgeId);
  if (!e) return;
  editing = { kind: 'edge', id: edgeId };
  reselect('edge', edgeId);
  const input = $('insp-edge-label');
  if (input) {
    input.focus();
    input.select();
  }
}

function endEdit(commitIt) {
  if (!editing) return;
  // 顺序很重要：先摘下状态，再隐藏输入框。
  // 隐藏一个带焦点的 textarea 会同步触发 blur，而 blur 处理器又会调 endEdit；
  // 如果先隐藏、后清 editing，重入的这次会把 editing 清成 null，
  // 外层再读 target.kind 就炸（真实踩到过：Cannot read properties of null）。
  const target = editing;
  editing = null;
  const ta = els.textEditor;
  const value = ta.value;
  ta.hidden = true;

  if (!commitIt) {
    render();
    return;
  }
  if (target.kind === 'node') {
    const text = value.trim();
    if (text === '') {
      toast('文字不能为空');
      render();
      return;
    }
    const r = updateNodeText(doc, target.id, text);
    if (r.changed) commit(r.doc);
    else render();
  }
}

// ---------------------------------------------------------------- 指针交互

function onPointerDown(ev) {
  if (ev.button === 2) return; // 右键交给 contextmenu
  els.stage.focus();
  if (editing) endEdit(true);

  const sp = stagePoint(ev);
  const wp = toWorld(view, sp);

  // 空格 / 中键 = 平移
  if (spaceDown || ev.button === 1) {
    dragState = { mode: 'pan', startScreen: sp, startView: view };
    els.stage.classList.add('panning');
    els.stage.setPointerCapture(ev.pointerId);
    return;
  }

  // 端口优先：端口画在框边上，用户想拉线时不该被「拖节点」抢走
  if (lastScene) {
    for (const n of [...lastScene.nodes].reverse()) {
      const port = pickPort(wp, n, 8 / view.scale);
      if (port) {
        dragState = {
          mode: 'connect',
          fromId: n.id,
          side: port.side,
          pointer: wp,
          moved: false,
        };
        els.stage.setPointerCapture(ev.pointerId);
        drawRubber();
        return;
      }
    }
  }

  const node = lastScene ? pickNode(lastScene.nodes, wp, 2 / view.scale) : null;
  if (node) {
    if (consumeDoubleClick('node', node.id, wp)) {
      dragState = null;
      // 不能在这里直接 beginEdit。
      // pointerdown 之后浏览器还会派发兼容的 mousedown，它的默认动作是
      // 「把焦点移到事件目标最近的焦点祖先」——目标是 <g>/<text> 都不能聚焦，
      // 焦点于是落到 #stage，刚 focus() 的 textarea 立刻 blur，
      // blur 处理器调 endEdit(true)，输入框还没显示就 hidden 了。
      // （在 pointerdown 上 preventDefault 不足以拦掉这条兼容链。）
      // 推迟到当前这串鼠标事件派发完再开编辑，焦点才稳。
      ev.preventDefault();
      setTimeout(() => beginEdit(node.id, node), 0);
      return;
    }
    reselect('node', node.id);
    dragState = {
      mode: 'node',
      id: node.id,
      startWorld: wp,
      startPos: { x: node.x, y: node.y },
      moved: false,
    };
    els.stage.setPointerCapture(ev.pointerId);
    return;
  }

  const label = lastScene ? pickLabel(lastScene.labels, wp, 0) : null;
  if (label) {
    if (consumeDoubleClick('label', label.edgeId, wp)) {
      dragState = null;
      beginEdgeLabelEdit(label.edgeId);
      return;
    }
    reselect('edge', label.edgeId);
    dragState = null;
    return;
  }

  const edge = lastScene ? pickEdge(lastScene.edges, wp, 6 / view.scale) : null;
  if (edge) {
    if (consumeDoubleClick('edge', edge.id, wp)) {
      dragState = null;
      beginEdgeLabelEdit(edge.id);
      return;
    }
    reselect('edge', edge.id);
    dragState = null;
    return;
  }

  // 空白：双击新建，单击开始框选
  if (consumeDoubleClick('blank', '', wp)) {
    dragState = null;
    createNodeAt(wp);
    return;
  }

  selection = null;
  dragState = { mode: 'marquee', startWorld: wp, rect: { x: wp.x, y: wp.y, w: 0, h: 0 } };
  els.stage.setPointerCapture(ev.pointerId);
  render();
}

/**
 * 自己判定双击，返回这次按下是不是「第二下」。
 *
 * 为什么不用原生 dblclick：单击会 reselect() → render() → 把 #layer-nodes 的
 * innerHTML 整个换掉。第一下点的那个 <g> 已经从文档里消失，浏览器凑不出
 * 「同一个元素被连点两次」，dblclick 就永远不触发（实测空白处能触发、
 * 节点上不能 —— 差别只在目标元素有没有被重画）。
 *
 * 所以改成记「上一次按在哪个对象上」：同 kind、同 id、间隔 < DOUBLE_CLICK_MS
 * 就算双击；判定成立时把记录清空，避免三连击被当成两次双击。
 */
function consumeDoubleClick(kind, id, wp) {
  const now = performance.now();
  const hitSame =
    lastClick &&
    lastClick.kind === kind &&
    lastClick.id === id &&
    now - lastClick.t <= DOUBLE_CLICK_MS &&
    // 位置也要靠得住，防止拖完一段再点回来被误判
    Math.hypot(wp.x - lastClick.x, wp.y - lastClick.y) < 12 / view.scale;
  if (hitSame) {
    lastClick = null;
    return true;
  }
  lastClick = { kind, id, t: now, x: wp.x, y: wp.y };
  return false;
}

/** 空白处新建一个节点并直接进入编辑。 */
function createNodeAt(wp) {
  const at = { x: snapGrid(wp.x - 60), y: snapGrid(wp.y - 22) };
  const r = addNode(doc, { type: 'process', text: '新步骤', x: at.x, y: at.y });
  if (!r.id) return;
  commit(r.doc);
  const created = lastScene?.nodes.find((n) => n.id === r.id);
  if (created) beginEdit(r.id, created);
}

function onPointerMove(ev) {
  if (!dragState) {
    // 悬停高亮：只换端口可见性，不重排，所以便宜
    if (lastScene) {
      const wp = worldPoint(ev);
      const n = pickNode(lastScene.nodes, wp, 0);
      const id = n?.id ?? null;
      if (id !== hovered) {
        hovered = id;
        render();
      }
    }
    return;
  }

  const sp = stagePoint(ev);
  const wp = toWorld(view, sp);

  if (dragState.mode === 'pan') {
    view = panBy(
      dragState.startView,
      sp.x - dragState.startScreen.x,
      sp.y - dragState.startScreen.y,
    );
    applyViewBox();
    return;
  }

  if (dragState.mode === 'node') {
    const dx = wp.x - dragState.startWorld.x;
    const dy = wp.y - dragState.startWorld.y;
    if (!dragState.moved && Math.hypot(dx, dy) * view.scale < 3) return; // 抖动阈值
    dragState.moved = true;

    let nx = snapGrid(dragState.startPos.x + dx);
    let ny = snapGrid(dragState.startPos.y + dy);

    if (lastScene) {
      const self = lastScene.nodes.find((n) => n.id === dragState.id);
      if (self) {
        const probe = { ...self, x: nx, y: ny, cx: nx + self.w / 2, cy: ny + self.h / 2 };
        const snap = snapToNeighbors(probe, lastScene.nodes, 6 / view.scale);
        if (snap.x !== null) nx = snap.x;
        if (snap.y !== null) ny = snap.y;
        guides = snap.guides;
      }
    }

    const r = moveNode(doc, dragState.id, nx, ny);
    if (r.changed) {
      doc = r.doc;
      history.push(doc, `drag:${dragState.id}`);
      render();
      drawOverlay();
    }
    return;
  }

  if (dragState.mode === 'connect') {
    dragState.pointer = wp;
    const target = lastScene ? pickNode(lastScene.nodes, wp, 0) : null;
    if (target && target.id !== dragState.fromId) {
      hovered = target.id;
    }
    // 只重画 overlay：拉线过程中不该重画整张图
    els.overlay.innerHTML = '';
    drawRubber();
    return;
  }

  if (dragState.mode === 'marquee') {
    dragState.rect = {
      x: dragState.startWorld.x,
      y: dragState.startWorld.y,
      w: wp.x - dragState.startWorld.x,
      h: wp.y - dragState.startWorld.y,
    };
    els.overlay.innerHTML = '';
    els.overlay.insertAdjacentHTML('beforeend', marqueeSvg(dragState.rect));
    return;
  }
}

function onPointerUp(ev) {
  if (!dragState) return;
  const mode = dragState.mode;

  if (mode === 'pan') {
    els.stage.classList.remove('panning');
    dragState = null;
    return;
  }

  if (mode === 'node') {
    const moved = dragState.moved;
    guides = { x: [], y: [] };
    dragState = null;
    render();
    drawOverlay();
    return;
  }

  if (mode === 'connect') {
    const wp = worldPoint(ev);
    const target = lastScene ? pickNode(lastScene.nodes, wp, 0) : null;
    const fromId = dragState.fromId;
    dragState = null;
    els.overlay.innerHTML = '';
    if (target) {
      const r = addEdge(doc, fromId, target.id);
      if (r.changed) {
        // 新建连线后，如果起点是判断节点且这条边还没有标签，提示一下
        commit(r.doc);
        const from = doc.nodes.find((n) => n.id === fromId);
        const outDegree = doc.edges.filter((e) => e.from === fromId).length;
        if (from?.type === 'decision' && outDegree >= 2) {
          toast('判断节点有多个出口，记得给连线加「是 / 否」标签');
        }
      } else {
        toast('这条连线已经存在');
        render();
      }
    } else {
      render();
    }
    return;
  }

  if (mode === 'marquee') {
    const rect = dragState.rect;
    dragState = null;
    els.overlay.innerHTML = '';
    if (Math.abs(rect.w) > 4 && Math.abs(rect.h) > 4 && lastScene) {
      const picked = pickInRect(lastScene.nodes, rect);
      if (picked.length === 1) {
        reselect('node', picked[0].id);
      } else if (picked.length > 1) {
        toast(`框选了 ${picked.length} 个节点（批量操作暂未支持）`);
        render();
      } else {
        render();
      }
    } else {
      render();
    }
    return;
  }
}

// ---------------------------------------------------------------- 缩放

function onWheel(ev) {
  const sp = stagePoint(ev);
  if (ev.ctrlKey || ev.metaKey) {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.002);
    view = zoomBy(view, sp, factor);
    applyViewBox();
    return;
  }
  // 普通滚轮 = 平移（和大部分画布工具一致）
  ev.preventDefault();
  view = panBy(view, -ev.deltaX, -ev.deltaY);
  applyViewBox();
}

function zoomToFit() {
  if (!lastScene) return;
  const r = els.stage.getBoundingClientRect();
  const b = lastScene.bounds;
  if (b.w <= 0 || b.h <= 0) {
    view = newView();
    view = panBy(view, 80, 80);
  } else {
    view = fitBox({ x: b.x, y: b.y, w: b.w, h: b.h }, { width: r.width, height: r.height }, 64);
  }
  applyViewBox();
}

function zoomStep(factor) {
  const r = els.stage.getBoundingClientRect();
  view = zoomBy(view, { x: r.width / 2, y: r.height / 2 }, factor);
  applyViewBox();
}

// ---------------------------------------------------------------- 键盘

let spaceDown = false;

function onKeyDown(ev) {
  const inField =
    ev.target instanceof HTMLInputElement ||
    ev.target instanceof HTMLTextAreaElement ||
    ev.target instanceof HTMLSelectElement;

  if (ev.code === 'Space' && !inField) {
    spaceDown = true;
    return;
  }

  const mod = ev.metaKey || ev.ctrlKey;

  if (mod && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    const next = ev.shiftKey ? history.redo() : history.undo();
    if (next) {
      doc = next;
      if (selection && !doc.nodes.some((n) => n.id === selection.id) && !doc.edges.some((e) => e.id === selection.id)) {
        selection = null;
      }
      render();
    }
    return;
  }

  if (mod && ev.key.toLowerCase() === 's') {
    ev.preventDefault();
    saveDocFile();
    return;
  }

  if (inField) return;

  if (ev.key === 'Backspace' || ev.key === 'Delete') {
    ev.preventDefault();
    deleteSelection();
    return;
  }

  if (ev.key === 'Escape') {
    selection = null;
    render();
    return;
  }

  if (ev.key.toLowerCase() === 'f' && !mod) {
    zoomToFit();
    return;
  }

  if (ev.key.toLowerCase() === 'l' && !mod) {
    runLayout();
    return;
  }

  if (ev.key.toLowerCase() === 'n' && !mod) {
    addNodeAtCenter();
    return;
  }

  // 方向键微调选中的节点
  if (selection?.kind === 'node' && ev.key.startsWith('Arrow')) {
    const n = doc.nodes.find((x) => x.id === selection.id);
    if (!n) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 16 : 4;
    const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
    const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
    const r = moveNode(doc, n.id, n.x + dx, n.y + dy);
    if (r.changed) commit(r.doc, `nudge:${n.id}`);
  }
}

function onKeyUp(ev) {
  if (ev.code === 'Space') spaceDown = false;
}

// ---------------------------------------------------------------- 命令

function addNodeAtCenter() {
  const r = els.stage.getBoundingClientRect();
  const c = toWorld(view, { x: r.width / 2, y: r.height / 2 });
  const res = addNode(doc, {
    type: 'process',
    text: '新步骤',
    x: snapGrid(c.x - 60),
    y: snapGrid(c.y - 22),
  });
  commit(res.doc);
  const created = lastScene.nodes.find((n) => n.id === res.id);
  if (created) {
    beginEdit(res.id, created);
  }
}

function runLayout() {
  if (doc.nodes.length === 0) {
    toast('画布是空的');
    return;
  }
  const diagram = docToDiagram(doc);
  const laid = layout(diagram, spec, layoutOpts);
  commit(applyLayout(doc, laid));
  zoomToFit();
  toast('已重新排版（⌘Z 可撤销）');
}

function saveDocFile() {
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const name = `${(doc.title || 'flowchart').replace(/[\\/:*?"<>|]/g, '-')}.json`;
  downloadBlob(blob, name);
  toast('已保存 JSON（可再次打开继续编辑）');
}

function openDocFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = deserializeDoc(text);
    if (!parsed) {
      toast('这个文件不是有效的图数据');
      return;
    }
    doc = parsed;
    history.reset(doc);
    selection = null;
    spec = resolveSpec(doc.template || 'default');
    render();
    zoomToFit();
    toast('已打开');
  });
  input.click();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = () => (doc.title || 'flowchart').replace(/[\\/:*?"<>|]/g, '-');

function exportSvg() {
  const svg = renderExportSvg();
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName()}.svg`);
  toast('已导出 SVG');
}

/** 用当前文档内容生成「和画布一模一样」的 SVG（走 core 的 renderSvg）。 */
function renderExportSvg() {
  // 平移逻辑统一在 sceneToLaid 里（VSDX 导出也走它）
  return renderSvg(sceneToLaid(buildScene(doc, spec)), spec, { title: doc.title });
}

async function exportPng() {
  const svg = renderExportSvg();
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  if (!m) {
    toast('导出失败');
    return;
  }
  const scale = 2; // 2 倍图，贴进文档不糊
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG 解码失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Number(m[1]) * scale;
    canvas.height = Number(m[2]) * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!pngBlob) throw new Error('PNG 编码失败');
    downloadBlob(pngBlob, `${safeName()}@2x.png`);
    toast('已导出 PNG（2 倍图）');
  } catch (err) {
    toast(`PNG 导出失败：${err.message}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportVsdx() {
  toast('正在生成 VSDX…');
  try {
    // 动态引入：ts-visio + jszip 体积不小，只点 VSDX 时才加载
    const { buildVsdx } = await import('./vsdx-bridge.js');
    // 交给 core 的 toVsdxInput 转换，而不是在这里手拼 payload。
    // 手拼的版本只给了全局一个颜色，模板里「起止反白、判断淡底」全部丢失，
    // 导出结果是一片 #f5f5f5 —— 与屏上、与 SVG 导出都不一致。
    const payload = toVsdxInput(sceneToLaid(buildScene(doc, spec)), spec, {
      padding: spec.padding,
      titleHeight: calcTitleHeight(spec, doc.title !== ''),
    });
    const bytes = await buildVsdx(payload, toVsdxTheme(spec));
    downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), `${safeName()}.vsdx`);
    toast('已导出 VSDX');
  } catch (err) {
    toast(`VSDX 导出失败：${err.message}`);
  }
}

// ---------------------------------------------------------------- MD 导入

function importMarkdown(text) {
  const diagram = parseMarkdown(text);
  const errors = diagram.diagnostics.filter((d) => d.level === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    toast(`解析有问题：${first.message}（第 ${first.line} 行）`);
    return false;
  }
  const next = docFromDiagram(diagram);
  if (next.nodes.length === 0) {
    toast('没解析出任何节点');
    return false;
  }
  const laid = layout(docToDiagram(next), spec, layoutOpts);
  doc = applyLayout(next, laid);
  history.reset(doc);
  selection = null;
  render();
  zoomToFit();
  const warns = diagram.diagnostics.filter((d) => d.level === 'warn');
  toast(warns.length ? `已导入 ${doc.nodes.length} 个节点（${warns.length} 条提醒）` : `已导入 ${doc.nodes.length} 个节点`);
  return true;
}

// ---------------------------------------------------------------- 事件绑定

function bindUI() {
  els.stage.addEventListener('pointerdown', onPointerDown);
  els.stage.addEventListener('pointermove', onPointerMove);
  els.stage.addEventListener('pointerup', onPointerUp);
  els.stage.addEventListener('pointercancel', onPointerUp);
  els.stage.addEventListener('wheel', onWheel, { passive: false });
  els.stage.addEventListener('contextmenu', (e) => e.preventDefault());

  els.stage.addEventListener('pointerleave', () => {
    if (hovered !== null && !dragState) {
      hovered = null;
      render();
    }
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', applyViewBox);

  // 就地编辑：失焦或 ⌘Enter 结束；Esc 取消
  els.textEditor.addEventListener('blur', () => endEdit(true));
  els.textEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endEdit(false);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      endEdit(true);
    }
  });

  els.titleInput.addEventListener('input', () => {
    const r = setTitle(doc, els.titleInput.value);
    if (r.changed) commit(r.doc, 'title');
  });

  els.templateSelect.addEventListener('change', () => {
    const r = setTemplate(doc, els.templateSelect.value);
    if (r.changed) {
      // 必须从新文档取 template：此刻 doc 还是旧的，
      // 用 doc.template 会让 spec 停留在上一个模板（屏幕上换模板但颜色不变）。
      spec = resolveSpec(r.doc.template);
      commit(r.doc);
      zoomToFit();
    }
  });

  els.direction.addEventListener('change', () => {
    layoutOpts = { ...layoutOpts, direction: els.direction.value };
  });
  els.nodeGap.addEventListener('change', () => {
    layoutOpts = { ...layoutOpts, nodeGap: Number(els.nodeGap.value) || 0 };
  });
  els.rankGap.addEventListener('change', () => {
    layoutOpts = { ...layoutOpts, rankGap: Number(els.rankGap.value) || 0 };
  });

  $('btn-add').addEventListener('click', addNodeAtCenter);
  $('btn-layout').addEventListener('click', runLayout);
  els.btnUndo.addEventListener('click', () => {
    const next = history.undo();
    if (next) {
      doc = next;
      render();
    }
  });
  els.btnRedo.addEventListener('click', () => {
    const next = history.redo();
    if (next) {
      doc = next;
      render();
    }
  });
  $('btn-zoom-in').addEventListener('click', () => zoomStep(1.2));
  $('btn-zoom-out').addEventListener('click', () => zoomStep(1 / 1.2));
  $('btn-zoom-fit').addEventListener('click', zoomToFit);
  $('btn-open').addEventListener('click', openDocFile);
  $('btn-save').addEventListener('click', saveDocFile);
  $('btn-export-svg').addEventListener('click', exportSvg);
  $('btn-export-png').addEventListener('click', exportPng);
  $('btn-export-vsdx').addEventListener('click', exportVsdx);

  // 粘贴 Markdown 直接生成图
  window.addEventListener('paste', (ev) => {
    if (editing || ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    const text = ev.clipboardData?.getData('text/plain');
    if (!text) return;
    // 只有看起来像流程图语法的才当作导入，避免误粘一段话就清空画布
    if (/^\s*\d+[.)]\s+/m.test(text) || /→/.test(text) || /=>/.test(text)) {
      ev.preventDefault();
      importMarkdown(text);
    }
  });
}

// ---------------------------------------------------------------- 启动

function seedIfEmpty() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = deserializeDoc(saved);
    if (parsed && parsed.nodes.length > 0) return parsed;
  }
  return null;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDoc(doc));
  } catch {
    // 隐私模式或超额时静默失败：不能因为存不了而让编辑中断
  }
}

function boot() {
  // 模板下拉
  els.templateSelect.innerHTML = listTemplates()
    .map((t) => `<option value="${t.name}">${t.label}</option>`)
    .join('');

  const restored = seedIfEmpty();
  if (restored) {
    doc = restored;
  } else {
    // 首次打开给一份能看懂结构的样例，比空白画布更有说服力。
    // 这份 MD 同时是语法说明书：顶格有序列表 = 主线，缩进 `-` = 分支，
    // `X => Y` = 汇合。改这里时记得跑一遍 parseMarkdown 确认零诊断，
    // 否则样例本身就是错的（曾经写成顶格分支，打开只看到 2 个节点）。
    doc = docFromDiagram(
      parseMarkdown(`# 订单退款流程

1. 开始
2. 用户提交退款申请
3. 判断：订单是否已发货？
   - 否 → 直接退款
   - 是 → 判断：商品是否影响二次销售？
     - 否 → 人工审核
     - 是 → 驳回申请
4. 直接退款 => 财务打款
5. 人工审核 => 财务打款
6. 判断：打款是否成功？
   - 是 → 通知用户，流程结束
   - 否 → 重试三次
7. 重试三次 => 人工介入
8. 结束
`),
    );
    const laid = layout(docToDiagram(doc), spec, layoutOpts);
    doc = applyLayout(doc, laid);
  }

  history.reset(doc);
  spec = resolveSpec(doc.template || 'default');
  render();
  requestAnimationFrame(() => {
    zoomToFit();
    applyViewBox();
  });

  // 编辑后自动存本地，刷新不丢
  window.addEventListener('beforeunload', persist);
  setInterval(persist, 3000);
}

bindUI();
boot();
