import React, { useMemo, useState } from 'react';
import { useApp } from '../main';
import { TASK_STATUS_UI, TASK_TYPES } from '../store';
import Modal from '../components/Modal';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '执行中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' },
];

export default function TaskCenterPage() {
  const { tasks, setTasks, setRoute, setActiveTaskId } = useApp();
  const [filter, setFilter] = useState('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const shown = useMemo(() => {
    if (filter === 'all') return tasks;
    if (filter === 'failed') return tasks.filter((t) => t.status === 'failed' || t.status === 'partial');
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const counts = useMemo(() => {
    const running = tasks.filter((t) => t.status === 'running').length;
    const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'partial').length;
    const done = tasks.filter((t) => t.status === 'done').length;
    return { running, failed, done };
  }, [tasks]);

  return (
    <div className="page-scroll">
      <div className="topbar" style={{ margin: '-24px -32px 24px', paddingLeft: 32, borderBottom: 'none' }}>
        <h1>任务中心</h1>
        <span className="crumb">
          {tasks.length > 0
            ? `共 ${tasks.length} 个任务 · 执行中 ${counts.running} · 已完成 ${counts.done} · 有问题 ${counts.failed}`
            : '还没有任务记录'}
        </span>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setRoute('new')}>
            ＋ 新建任务
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">◷</div>
          <div className="empty-title">还没有任务</div>
          <div className="empty-desc">
            新建一个任务，预检通过后执行。记录会保存在本机，重启不丢。
          </div>
          <button className="btn btn-primary mt16" onClick={() => setRoute('new')}>
            新建第一个任务
          </button>
        </div>
      ) : (
        <>
          <div className="filters">
            {FILTERS.map((f) => {
              const n =
                f.key === 'all'
                  ? tasks.length
                  : f.key === 'failed'
                  ? counts.failed
                  : tasks.filter((t) => t.status === f.key).length;
              return (
                <button
                  key={f.key}
                  className={`filter-chip ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} {n > 0 ? n : ''}
                </button>
              );
            })}
          </div>

          <div className="task-list">
            {shown.map((t) => {
              const st = TASK_STATUS_UI[t.status] || { label: t.status, cls: 'tag-gray' };
              const meta = TASK_TYPES[t.type] || { name: t.typeName || t.type, icon: '·' };
              const total = t.counts?.total || 0;
              const finished =
                (t.counts?.created || 0) +
                (t.counts?.updated || 0) +
                (t.counts?.skipped || 0) +
                (t.counts?.unchanged || 0);
              const pct = t.status === 'done' ? 100 : total > 0 ? Math.min(99, (finished / total) * 100) : 0;
              return (
                <div
                  className="task-row"
                  key={t.id}
                  onClick={() => {
                    setActiveTaskId(t.id);
                    setRoute('detail');
                  }}
                >
                  <span style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{meta.icon}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="task-row-title">{t.title}</div>
                    <div className="task-row-meta">
                      <span>{meta.name}</span>
                      <span>·</span>
                      <span>{fmtTime(t.createdAt)}</span>
                      {t.folderPath && (
                        <>
                          <span>·</span>
                          <span className="mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.folderPath}
                          </span>
                        </>
                      )}
                      {t.error && (
                        <>
                          <span>·</span>
                          <span style={{ color: 'var(--c-danger)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.error}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="task-row-right">
                    {total > 0 && (
                      <div className="task-progress-mini">
                        <div className="progress-track" style={{ height: 4 }}>
                          <div
                            className={`progress-fill ${t.status === 'running' ? 'running' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="micro muted" style={{ marginTop: 4, textAlign: 'right' }}>
                          {finished}/{total}
                        </div>
                      </div>
                    )}
                    <span className={`tag ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex between center mt16">
            <span className="micro muted">记录保存在本机浏览器存储，最多保留最近 200 条</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmClear(true)}>
              清空已完成记录
            </button>
          </div>
        </>
      )}

      {confirmClear && (
        <Modal
          title="清空已完成记录"
          body={`将删除 ${counts.done} 条已完成的任务记录。执行中的任务不受影响。此操作不可撤销。`}
          confirmText="清空"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setTasks((prev) => prev.filter((t) => t.status === 'running' || !['done'].includes(t.status)));
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}

function fmtTime(ts, full = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return full ? `${d.getFullYear()}/${base}:${p(d.getSeconds())}` : base;
}
