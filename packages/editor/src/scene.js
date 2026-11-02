/**
 * 场景：把「文档 + 模板」算成「一堆能直接画的东西」。
 *
 * 文档里只有文字的左上角坐标；框多大、线怎么拐、标签放哪，
 * 全部在这一步算出来。它是纯函数，不碰 DOM —— 所以可以在 Node 里断言，
 * 而不用靠肉眼看浏览器。
 *
 * 与 core 的分工：
 *   - 尺寸来自 core 的 measureNode（和导出 SVG 完全同一套度量）
 *   - 连线来自 core 的 orthogonalRoute（用户拖动后按真实位置重布，不是 dagre 的旧路径）
 *   - 标签来自 core 的 placeLabel（和导出 SVG 同一套摆放规则）
 * 这样屏幕上看到的和导出文件里的是同一个东西。
 */
import { measureNode, placeLabel } from '../../core/src/layout.js';
import { orthogonalRoute } from '../../core/src/route.js';
import { DEFAULT_SPEC, snapGrid } from '../../core/src/theme.js';

/**
 * @param {object} doc   doc.js 的文档
 * @param {object} [spec] resolveSpec() 的产物
 * @returns {{nodes: object[], edges: object[], labels: object[], bounds: {x:number,y:number,w:number,h:number}}}
 */
export function buildScene(doc, spec = DEFAULT_SPEC) {
  const nodes = doc.nodes.map((n) => {
    const s = measureNode({ type: n.type, text: n.text }, spec);
    return {
      id: n.id,
      type: n.type,
      text: n.text,
      x: n.x,
      y: n.y,
      w: s.w,
      h: s.h,
      lines: s.lines,
      cx: n.x + s.w / 2,
      cy: n.y + s.h / 2,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges = [];
  const labels = [];
  for (const e of doc.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    // 悬空的边不画：宁可少一条线，也不要画一条指向不存在的框的线
    if (!from || !to) continue;
    // 沿用户指定的端口走。没指定时 orthogonalRoute 内部按相对位置推断，
    // 所以自动排版出来的线行为不变，只有人手动拉的线才「指哪打哪」。
    const points = orthogonalRoute(from, to, {
      ...(e.fromSide ? { fromSide: e.fromSide } : {}),
      ...(e.toSide ? { toSide: e.toSide } : {}),
    });
    if (points.length < 2) continue;
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      kind: e.kind,
      fromSide: e.fromSide || '',
      toSide: e.toSide || '',
      points,
      fromType: from.type,
      toType: to.type,
    });

    if (e.label) {
      const l = placeLabel(e.label, points, spec);
      if (l) labels.push({ ...l, text: e.label, edgeId: e.id });
    }
  }

  return { nodes, edges, labels, bounds: sceneBounds(nodes, edges, labels) };
}

/**
 * 场景 → core 的「排版结果」结构（renderSvg / toVsdxInput 认的那个形状）。
 *
 * 为什么要这一步：画布上的坐标是自由摆放的（用户可能把图拖到负坐标区），
 * 而 renderSvg / toVsdxInput 都假设内容从 (0,0) 起、尺寸放在 width/height 上。
 * 这里统一做一次平移 + 补宽高。
 *
 * 两个导出（SVG、VSDX）都走这个函数 —— 之前各写一遍平移逻辑，
 * 其中 VSDX 那次漏了 width/height，导出页面尺寸变成 NaN。
 */
export function sceneToLaid(scene) {
  const b = scene.bounds;
  // 还没排版过的空文档：给一个最小合法尺寸，别让下游拿到 0 或 NaN
  const dx = Number.isFinite(b.x) ? -b.x : 0;
  const dy = Number.isFinite(b.y) ? -b.y : 0;
  const width = Number.isFinite(b.w) ? b.w : 0;
  const height = Number.isFinite(b.h) ? b.h : 0;
  return {
    nodes: scene.nodes.map((n) => ({
      ...n,
      x: n.x + dx,
      y: n.y + dy,
      cx: n.cx + dx,
      cy: n.cy + dy,
    })),
    edges: scene.edges.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    })),
    labels: scene.labels.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    width,
    height,
  };
}

/**
 * 场景包围盒。给「适应窗口」用。
 * 空文档返回零尺寸而不是 null —— 调用方（fitBox）会把零尺寸当成退化输入处理。
 */
export function sceneBounds(nodes, edges = [], labels = []) {
  if (nodes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of nodes) {
    take(n.x, n.y);
    take(n.x + n.w, n.y + n.h);
  }
  for (const e of edges) for (const p of e.points) take(p.x, p.y);
  for (const l of labels) {
    take(l.x, l.y);
    take(l.x + l.w, l.y + l.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 拖动时的对齐吸附：把被拖的框往邻居的边缘/中线上靠。
 *
 * 只比三种线（左/中/右、上/中/下），不够花哨但覆盖绝大多数对齐意图；
 * 比一圈参考线更不容易让人「抢」错。
 *
 * @param {{x:number,y:number,w:number,h:number,cx:number,cy:number}} moved 被拖的框（当前鼠标位置算出的框）
 * @param {object[]} others 其它框
 * @param {number} [tolerance=6] 世界坐标下的吸附半径
 * @returns {{x:number|null,y:number|null,guides:{x:number[],y:number[]}}}
 *   x/y 为吸附后的左上角坐标（无吸附建议时为 null）；guides 为要画的参考线世界坐标
 */
export function snapToNeighbors(moved, others, tolerance = 6) {
  const mineX = [moved.x, moved.cx, moved.x + moved.w];
  const mineY = [moved.y, moved.cy, moved.y + moved.h];

  let bestX = null;
  let bestY = null;
  let bestDx = Infinity;
  let bestDy = Infinity;

  const guideX = new Set();
  const guideY = new Set();

  for (const o of others) {
    if (o.id && o.id === moved.id) continue;
    const theirX = [o.x, o.cx, o.x + o.w];
    const theirY = [o.y, o.cy, o.y + o.h];

    for (const a of mineX) {
      for (const b of theirX) {
        const d = Math.abs(a - b);
        if (d > tolerance) continue;
        guideX.add(snapGrid(b));
        if (d < bestDx) {
          bestDx = d;
          bestX = moved.x + (b - a);
        }
      }
    }
    for (const a of mineY) {
      for (const b of theirY) {
        const d = Math.abs(a - b);
        if (d > tolerance) continue;
        guideY.add(snapGrid(b));
        if (d < bestDy) {
          bestDy = d;
          bestY = moved.y + (b - a);
        }
      }
    }
  }

  return {
    x: bestX === null ? null : snapGrid(bestX),
    y: bestY === null ? null : snapGrid(bestY),
    guides: { x: [...guideX], y: [...guideY] },
  };
}
