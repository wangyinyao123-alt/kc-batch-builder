import React, { useMemo, useState } from 'react';
import { useApp } from '../main';
import { TASK_STATUS_UI, TASK_TYPES } from '../store';
import Modal from '../components/Modal';

// 状态 → 设计稿贴纸（DSL 里每个 status 都配了 20×20 小贴纸）
const STATUS_STICKER = {
  running: './img/stickers/p2-pixel-star-sticker.png',
  done: './img/stickers/p2-pixel-floppy-cat-sticker.png',
  queued: './img/stickers/p2-pixel-cloud-sticker.png',
  failed: './img/stickers/p2-pixel-folder-cat-sticker.png',
  partial: './img/stickers/p2-pixel-folder-cat-sticker.png',
};

const STAT_CARDS = [
  { key: 'all', label: '全部任务', note: '本次建库队列', tone: 'pink' },
  { key: 'running', label: '执行中', note: '同一时刻仅一个任务', tone: 'mint' },
  { key: 'done', label: '已完成', note: '已产出内容', tone: 'gold' },
  { key: 'failed', label: '有问题', note: '失败或部分失败', tone: 'red' },
];

const COLS = [
  { key: 'name', label: '任务名', w: 356 },
  { key: 'kind', label: '类型', w: 184 },
  { key: 'state', label: '状态', w: 195 },
  { key: 'progress', label: '进度', w: 264 },
  { key: 'actions', label: '操作', w: 149 },
];

export default function TaskCenterPage() {
  const { tasks, setTasks, setRoute, setActiveTaskId } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);

  const counts = useMemo(() => {
    const running = tasks.filter((t) => t.status === 'running').length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'partial').length;
    return { all: tasks.length, running, done, failed };
  }, [tasks]);

  const activeTask = tasks.find((t) => t.status === 'running');
  // 任务真实日志在 t.events（父会话 store 结构），不是 t.logs
  const recentLogs = useMemo(() => {
    const ev = activeTask?.events || [];
    return ev.slice(-3).map((e) => ({
      time: e.at ? fmtClock(e.at) : '--:--:--',
      text:
        e.type === 'step'
          ? `STEP ${e.n} ${e.label || ''}`.trim()
          : e.type === 'error'
          ? `[X] ${e.text || e.message || ''}`
          : e.type === 'warn'
          ? `[!] ${e.text || ''}`
          : e.text || '',
    }));
  }, [activeTask]);

  const open = (t) => {
    setActiveTaskId(t.id);
    setRoute('detail');
  };

  return (
    <div className="page-scroll">
      {/* headrow：标题 + 副标题 + 新建按钮（DSL div.headrow 1150×52） */}
      <div className="headrow">
        <div className="headrow-main">
          <h1 className="headrow-title">任务</h1>
          <div className="headrow-sub">
            {tasks.length > 0
              ? `${tasks.length} 个任务 · ${counts.running} 个执行中 · ${counts.done} 个已完成`
              : '还没有任务，点右上角新建'}
          </div>
        </div>
        <button className="btn-create" onClick={() => setRoute('new')}>
          新建任务 ＋
        </button>
      </div>

      {/* stats：4 张 278.5×62 统计卡，节距 290.5 */}
      <div className="stats">
        {STAT_CARDS.map((c) => (
          <div className={`stat ${c.tone}`} key={c.key}>
            <div className="stat-n">{String(counts[c.key] || 0).padStart(2, '0')}</div>
            <div className="stat-label">
              <span className="stat-note">{c.note}</span>
              <span className="stat-name">{c.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* table：表头 39 + 行高 52 */}
      <div className="table">
        <div className="th">
          {COLS.map((c) => (
            <div className="cell" key={c.key} style={{ width: c.w }}>
              {c.label}
            </div>
          ))}
        </div>

        {tasks.length === 0 ? (
          <div className="table-empty">
            <div className="table-empty-title">还没有任务</div>
            <div className="table-empty-desc">
              新建一个任务，预检通过后执行。记录会保存在本机，重启不丢。
            </div>
            <button className="btn-create mt12" onClick={() => setRoute('new')}>
              新建第一个任务 ＋
            </button>
          </div>
        ) : (
          tasks.map((t) => {
            const st = TASK_STATUS_UI[t.status] || { label: t.status, cls: 'tag-gray' };
            const meta = TASK_TYPES[t.type] || { name: t.typeName || t.type };
            const total = t.counts?.total || t.total || 0;
            const finished =
              t.status === 'done'
                ? total
                : (t.counts?.created || 0) +
                    (t.counts?.updated || 0) +
                    (t.counts?.skipped || 0) +
                    (t.counts?.unchanged || 0) || t.done || 0;
            const pct = total > 0 ? Math.min(100, (finished / total) * 100) : 0;
            return (
              <div className={`tr ${t.status === 'running' ? 'active' : ''}`} key={t.id}>
                <div className="cell" style={{ width: COLS[0].w }} onClick={() => open(t)}>
                  <span className="tr-name">{t.title}</span>
                </div>
                <div className="cell" style={{ width: COLS[1].w }}>
                  <span className="typepill">{meta.name}</span>
                </div>
                <div className="cell" style={{ width: COLS[2].w }}>
                  <span className={`status ${t.status}`}>
                    {STATUS_STICKER[t.status] && <img src={STATUS_STICKER[t.status]} alt="" />}
                    <span className={`sdot ${t.status}`} />
                    <span className="status-text">{st.label}</span>
                  </span>
                </div>
                <div className="cell" style={{ width: COLS[3].w }}>
                  <div className="bar">
                    <div
                      className={`fill ${
                        t.status === 'done'
                          ? 'green'
                          : t.status === 'failed' || t.status === 'partial'
                          ? 'amber'
                          : ''
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="percent">{total > 0 ? `${finished} / ${total}` : '—'}</span>
                </div>
                <div className="cell" style={{ width: COLS[4].w }}>
                  <span className="action" onClick={() => open(t)}>
                    查看
                  </span>
                  <span className="action muted">记录</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 提示行 13px */}
      <div className="table-hint">
        <span>空列表时显示：「还没有任务，点右上角新建」</span>
        <span className="hint-right">单任务执行 · 其余自动排队</span>
      </div>

      {/* 执行日志 */}
      <div className="loghead">
        <span>▣ 执行日志</span>
        <span className="loghead-right">
          {activeTask ? `运行：${activeTask.title}` : '暂无执行中的任务'}
          {tasks.length > 0 && (
            <span className="log-clear" onClick={() => setConfirmClear(true)}>
              清空
            </span>
          )}
        </span>
      </div>
      <div className="logs">
        {recentLogs.length > 0 ? (
          recentLogs.map((l, i) => (
            <div className="logline" key={i}>
              <span className="logtime">{l.time || '--:--:--'}</span>
              <span className="logtext">{l.text}</span>
            </div>
          ))
        ) : (
          <div className="logline">
            <span className="logtime">--:--:--</span>
            <span className="logtext">等待任务开始</span>
          </div>
        )}
      </div>

      {confirmClear && (
        <Modal
          title="清空已完成记录"
          body="将删除已完成的任务记录。执行中的任务不受影响。此操作不可撤销。"
          confirmText="清空"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setTasks((prev) => prev.filter((t) => t.status !== 'done'));
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}

function fmtClock(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
