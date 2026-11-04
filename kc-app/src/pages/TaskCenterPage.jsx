import React, { useMemo, useState } from 'react';
import { useApp } from '../main';
import { TASK_STATUS_UI, TASK_TYPES, STATE_UI } from '../store';
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
  const [openId, setOpenId] = useState(null);
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

  const openTask = tasks.find((t) => t.id === openId) || null;

  const removeTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setOpenId(null);
  };

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
                <div className="task-row" key={t.id} onClick={() => setOpenId(t.id)}>
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

      {openTask && (
        <TaskDetail
          task={openTask}
          onClose={() => setOpenId(null)}
          onDelete={() => removeTask(openTask.id)}
          onReuse={() => {
            setActiveTaskId(openTask.id);
            setOpenId(null);
            setRoute('new');
          }}
        />
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

function TaskDetail({ task, onClose, onDelete, onReuse }) {
  const st = TASK_STATUS_UI[task.status] || { label: task.status, cls: 'tag-gray' };
  const meta = TASK_TYPES[task.type] || { name: task.typeName || task.type };
  const c = task.counts || {};

  return (
    <Modal title={`${meta.name} · ${task.title}`} wide onCancel={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row gap10" style={{ flexWrap: 'wrap' }}>
          <span className={`tag ${st.cls}`}>{st.label}</span>
          <span className="micro muted">{fmtTime(task.createdAt, true)}</span>
          {task.folderPath && <span className="micro mono muted">{task.folderPath}</span>}
        </div>

        {task.error && (
          <div className="banner banner-error" style={{ marginBottom: 0 }}>
            <span>⚠</span>
            <span>{task.error}</span>
          </div>
        )}

        {task.warns && task.warns.length > 0 && (
          <div className="banner banner-warn" style={{ marginBottom: 0 }}>
            <span>⚠</span>
            <span>{task.warns[task.warns.length - 1]}</span>
          </div>
        )}

        <div className="metric-grid">
          {[
            { k: 'created', label: '已创建', cls: 'create' },
            { k: 'updated', label: '已更新', cls: 'create' },
            { k: 'skipped', label: '跳过', cls: 'skip' },
            { k: 'failed', label: '失败', cls: 'fail' },
          ].map((cell) => (
            <div key={cell.k} className={`metric ${cell.cls}`}>
              <div className="metric-num">{c[cell.k] ?? 0}</div>
              <div className="metric-label">{cell.label}</div>
            </div>
          ))}
        </div>

        {task.items && task.items.length > 0 && (
          <div>
            <div className="label">明细（{task.items.length}）</div>
            <div className="item-list" style={{ maxHeight: 220 }}>
              {task.items.map((it, i) => {
                const s = STATE_UI[it.state] || { label: it.state, cls: 'tag-gray' };
                return (
                  <div className="item-row" key={i}>
                    <span className={`tag ${s.cls}`}>{s.label}</span>
                    <span className="item-title grow">{it.title}</span>
                    {it.path && (
                      <span className="item-path" style={{ maxWidth: 200 }}>
                        {it.path}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {task.artifacts && task.artifacts.length > 0 && (
          <div>
            <div className="label">产物文件</div>
            {task.artifacts.map((a, i) => (
              <div key={i} className="row" style={{ fontSize: 'var(--fs-micro)', marginBottom: 6 }}>
                <span className="tag tag-green">{a.kind}</span>
                <span className="item-path grow">{a.path}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => window.kc.reveal(a.path)}>
                  定位
                </button>
              </div>
            ))}
          </div>
        )}

        {task.params && (
          <details>
            <summary className="label" style={{ cursor: 'pointer', marginBottom: 8 }}>
              本次参数
            </summary>
            <pre
              className="mono"
              style={{
                fontSize: 10,
                lineHeight: 1.6,
                background: 'var(--c-surface-muted)',
                border: '1px solid rgba(240,176,200,.5)',
                borderRadius: 6,
                padding: 10,
                margin: 0,
                overflow: 'auto',
                maxHeight: 220,
              }}
            >
              {JSON.stringify(redact(task.params), null, 2)}
            </pre>
          </details>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onDelete}>
            删除记录
          </button>
          <button className="btn" onClick={onReuse}>
            用同样参数再建一次
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}

function redact(params) {
  const p = { ...params };
  if (p.password) p.password = '••••••';
  return p;
}

function fmtTime(ts, full = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return full ? `${d.getFullYear()}/${base}:${p(d.getSeconds())}` : base;
}
