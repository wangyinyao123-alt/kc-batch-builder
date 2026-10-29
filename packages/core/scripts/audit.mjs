// 开发用体检脚本：把样例图排版后，检查连线是否穿过节点框。
// 用法：node scripts/audit.mjs
import { parseMarkdown } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { resolveSpec } from '../src/theme.js';

const CASES = {
  simple: `# 运动控制流程

1. 初始化
2. 判断：已建立位置参考？
   - 否 → 回零：调用 MC_Home
   - 是 → 待机：检查模式和范围
3. 回零 => 待机
`,
  complex: `# 订单退款流程

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
`,
  loopback: `# 带环路

1. 开始
2. 采集
3. 判断：数据够吗？
   - 是 → 计算
   - 否 → 采集
4. 计算 => 输出
5. 结束
`,
};

const spec = resolveSpec('light');

/** 判断点是否落在矩形内（矩形向里缩 2px，容忍贴着边框的端点） */
function inside(px, py, n, inset = 2) {
  return (
    px > n.x + inset &&
    px < n.x + n.w - inset &&
    py > n.y + inset &&
    py < n.y + n.h - inset
  );
}

let total = 0;
let bad = 0;

for (const [name, src] of Object.entries(CASES)) {
  const laid = layout(parseMarkdown(src), spec);
  let hits = 0;

  for (const e of laid.edges) {
    // 沿折线均匀采样 60 个点
    const pts = e.points;
    for (let seg = 0; seg < pts.length - 1; seg++) {
      const a = pts[seg];
      const b = pts[seg + 1];
      for (let k = 0; k <= 60; k++) {
        const t = k / 60;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        for (const n of laid.nodes) {
          if (n.id === e.from || n.id === e.to) continue;
          if (inside(px, py, n)) {
            hits++;
            console.log(`  ✗ ${name}: ${e.from}→${e.to} 穿过 ${n.id} @ (${px.toFixed(1)}, ${py.toFixed(1)})`);
            seg = 1e9;
            k = 1e9;
            break;
          }
        }
      }
    }
  }

  total += laid.nodes.length;
  console.log(`${hits === 0 ? '✓' : '✗'} ${name}: ${laid.nodes.length} 节点 / ${laid.edges.length} 连线，穿框 ${hits === 0 ? 'none' : hits}`);
  bad += hits;
}

console.log(bad === 0 ? `\n全部通过（${total} 个节点）` : `\n发现 ${bad} 处穿框`);
process.exit(bad === 0 ? 0 : 1);
