import React, { useMemo, useState } from 'react';
import { useApp } from '../main';
import { TASK_STATUS_UI, TASK_TYPES, STATE_UI } from '../store';

/**
 * P4 任务详情（独立页，取代原弹窗）。
 * 设计稿：顶部返回 + 任务名 + 类型/状态标签；进度区；三标签页（预检报告 / 执行日志 / 结果清单）；
 * 底部操作：暂停、取消、只重试失败项、导出结果、打开落点。
 *
 * 数据来源：store.tasks 里的一条记录（由 NewTaskPage.saveTask 写入）。
 * 「重试失败项」不改脚本协议，而是把失败项作为标题清单回填到新建表单（-SourceText），
 * 因为脚本本身没有 --OnlyFailed 参数（见 backend/kc-create-contract.md 参数表）。
 */

const TABS = [
  { key: 'precheck', label: '预检报告' },
  { key: 'log', label: '执行日志' },
  { key: 'results', label: '结果清单' },
];

export default function TaskDetailPage() {
  const { tasks, setTasks, setRoute, activeTaskId } = useApp();
  const task = tasks.find((t) => t.id === activeTaskId) || null;
  const [tab, setTab] = useState('results');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [toast, setToast] = useState('');

  const failedResults = useMemo(
    () => (task?.results || []).filter((r) => r.state === 'FAILED'),
    [task]
  );
  const failedItems = useMemo(
    () => (task?.items || []).filter((it) => it.state === 'FAILED' || it.state === 'BLOCKED'),
    [task]
  );
  const failedCount = Math.max(failedResults.length, failedItems.length);

  if (!task) {
    return (
      <div className="page-scroll">
        <div className="empty">
          <div className="empty-icon">◷</div>
          <div className="empty-title">任务不存在</div>
          <div className="empty-desc">这条记录可能已被清空。</div>
          <button className="btn btn-primary mt16" onClick={() => setRoute('tasks')}>
            回到任务中心
          </button>
        </div>
      </div>
    );
  }

  const st = TASK_STATUS_UI[task.status] || { label: task.status, cls: 'tag-gray' };
  const meta = TASK_TYPES[task.type] || { name: task.typeName || task.type, icon: '·' };
  const c = task.counts || {};
  const total = c.total || task.results?.length || task.items?.length || 0;
  const finished =
    (c.created || 0) + (c.updated || 0) + (c.skipped || 0) + (c.unchanged || 0);
  const pct = total > 0 ? Math.round((finished / total) * 100) : task.status === 'done' ? 100 : 0;
  const running = task.status === 'running';

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  /** 导出结果：CSV / JSON 由保存框的扩展名决定 */
  const exportResults = async () => {
    const rows = task.results || [];
    const csv = [
      '序号,状态,标题,错误,ObjectRef',
      ...rows.map((r) =>
        [r.i, r.state, r.title, r.error || '', r.objectRef || '']
          .map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\r\n');
    const res = await window.kc.saveText({
      text: csv,
      defaultName: `${safeName(task.title)}-结果.csv`,
    });
    if (res.ok) flash(`已导出到 ${res.path}`);
    else if (!res.canceled) flash(`导出失败：${res.error}`);
  };

  /** 只重试失败项：把失败标题回填到新建页，走同一套脚本 */
  const retryFailed = () => {
    const titles = (failedResults.length ? failedResults : failedItems)
      .map((r) => r.title)
      .filter(Boolean);
    if (titles.length === 0) {
      flash('没有可重试的失败项');
      return;
    }
    setRoute('retry', { titles, from: task });
  };

  return (
    <div className="page-scroll">
      <div className="topbar" style={{ margin: '-24px -32px 0', paddingLeft: 32, borderBottom: 'none' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setRoute('tasks')} style={{ marginRight: 8 }}>
          ← 返回
        </button>
        <h1 style={{ fontSize: 'var(--fs-h2)' }}>{task.title}</h1>
        <span className={`tag ${st.cls}`}>{st.label}</span>
        <span className="tag tag-gray">{meta.name}</span>
        <div className="topbar-actions">
          <span className="micro muted">{fmtTime(task.createdAt, true)}</span>
        </div>
      </div>

      {toast && (
        <div className="banner banner-info" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 进度区 */}
      <section className="card card-pad mb16">
        <div className="flex between center" style={{ marginBottom: 10 }}>
          <div className="row gap10 center">
            <span style={{ fontSize: 20 }}>{meta.icon}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-h3)' }}>
                {finished} / {total || '—'}
                <span className="micro muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                  已完成
                </span>
              </div>
              <div className="micro muted">{currentStepLabel(task, running)}</div>
            </div>
          </div>
          <div className="micro muted">{pct}%</div>
        </div>
        <div className="progress-track" style={{ height: 8 }}>
          <div
            className={`progress-fill ${running ? 'running' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="metric-grid" style={{ marginTop: 16, marginBottom: 0 }}>
          {[
            { k: 'created', label: '新建', cls: 'create' },
            { k: 'updated', label: '更新', cls: 'create' },
            { k: 'unchanged', label: '无变化', cls: 'skip' },
            { k: 'skipped', label: '跳过', cls: 'skip' },
            { k: 'blocked', label: '阻塞', cls: 'block' },
            { k: 'failed', label: '失败', cls: 'fail' },
          ].map((cell) => (
            <div
              key={cell.k}
              className={`metric ${cell.cls}`}
              style={cell.k === 'failed' && Number(c[cell.k]) > 0 ? { outline: '2px solid var(--c-danger)' } : undefined}
            >
              <div className="metric-num">{c[cell.k] ?? 0}</div>
              <div className="metric-label">{cell.label}</div>
            </div>
          ))}
        </div>
      </section>

      {task.error && (
        <div className="banner banner-error">
          <span>⚠</span>
          <span>{task.error}</span>
        </div>
      )}
      {task.warns && task.warns.length > 0 && (
        <div className="banner banner-warn">
          <span>⚠</span>
          <span>{task.warns[task.warns.length - 1]}</span>
        </div>
      )}
      {failedCount > 0 && (
        <div className="banner banner-error" style={{ alignItems: 'center' }}>
          <span>✕</span>
          <span className="grow">
            {failedCount} 项未成功 ·{' '}
            {failedResults[0]?.error || failedItems[0]?.note || '查看下方清单了解原因'}
          </span>
          <button className="btn btn-sm" onClick={retryFailed}>
            只重试这些
          </button>
        </div>
      )}

      {/* 三标签页 */}
      <section className="card card-pad">
        <div className="flex between center" style={{ marginBottom: 12 }}>
          <div className="filters" style={{ marginBottom: 0 }}>
            {TABS.map((t) => {
              const n =
                t.key === 'precheck'
                  ? task.items?.length || 0
                  : t.key === 'log'
                  ? task.events?.length || 0
                  : task.results?.length || 0;
              return (
                <button
                  key={t.key}
                  className={`filter-chip ${tab === t.key ? 'active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label} {n > 0 ? n : ''}
                </button>
              );
            })}
          </div>
          {tab === 'results' && failedCount > 0 && (
            <label className="row gap6 center micro muted" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={onlyFailed}
                onChange={(e) => setOnlyFailed(e.target.checked)}
              />
              只看失败
            </label>
          )}
        </div>

        {tab === 'precheck' && <PrecheckPanel task={task} />}
        {tab === 'log' && <LogPanel task={task} />}
        {tab === 'results' && (
          <ResultsPanel task={task} onlyFailed={onlyFailed} onReveal={() => setRoute('tasks')} />
        )}
      </section>

      {/* 底部操作 */}
      <div className="flex between center mt16" style={{ paddingBottom: 24 }}>
        <div className="row gap8">
          <button
            className="btn btn-sm"
            disabled={!running}
            title={running ? '中止当前执行' : '任务不在运行中'}
            onClick={() => flash('中止需要脚本侧支持；当前版本请在新任务页执行时使用「中止」')}
          >
            暂停
          </button>
          <button
            className="btn btn-sm btn-danger"
            disabled={!running}
            onClick={() => flash('取消需要脚本侧支持；当前版本请在新任务页执行时使用「中止」')}
          >
            取消
          </button>
          <button className="btn btn-sm" disabled={failedCount === 0} onClick={retryFailed}>
            只重试失败项（{failedCount}）
          </button>
        </div>
        <div className="row gap8">
          <button className="btn btn-sm" onClick={exportResults} disabled={!task.results?.length}>
            导出结果
          </button>
          <button
            className="btn btn-sm"
            disabled={!task.folderPath}
            title={task.folderPath || '没有记录落点'}
            onClick={() => window.kc.reveal(task.folderPath)}
          >
            打开落点
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => removeTask(task.id, setTasks, setRoute)}>
            删除记录
          </button>
        </div>
      </div>

      {task.params && (
        <details style={{ paddingBottom: 24 }}>
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
              maxHeight: 240,
            }}
          >
            {JSON.stringify(redact(task.params), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 三个标签页 */

function PrecheckPanel({ task }) {
  const items = task.items || [];
  if (items.length === 0) {
    return <p className="micro muted">这次任务没有留下预检明细（可能未跑预检就执行了）。</p>;
  }
  const groups = groupByState(items);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {groups.map(([state, list]) => {
        const s = STATE_UI[state] || { label: state, cls: 'tag-gray' };
        return (
          <div key={state}>
            <div className="label" style={{ marginBottom: 6 }}>
              {s.label}（{list.length}）
            </div>
            <div className="item-list">
              {list.map((it, i) => (
                <div className="item-row" key={i}>
                  <span className="item-title grow">{it.title}</span>
                  {it.tag && <span className="tag tag-gray">{it.tag}</span>}
                  {it.note && (
                    <span className="item-note" title={it.note}>
                      {it.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ task }) {
  const events = task.events || [];
  const [filter, setFilter] = useState('all');
  const [onlyProblems, setOnlyProblems] = useState(false);

  const lines = useMemo(() => {
    let out = events;
    if (onlyProblems) {
      out = out.filter(
        (e) => e.type === 'error' || e.type === 'warn' || e.type === 'stderr'
      );
    }
    if (filter !== 'all') {
      out = out.filter((e) => e.type === filter);
    }
    return out;
  }, [events, filter, onlyProblems]);

  if (events.length === 0) {
    return <p className="micro muted">这次任务没有留下日志。</p>;
  }

  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="flex between center">
        <div className="filters" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            全部 {events.length}
          </button>
          {['error', 'warn', 'step', 'progress', 'log'].map((k) =>
            counts[k] ? (
              <button key={k} className={`filter-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                {TYPE_LABEL[k] || k} {counts[k]}
              </button>
            ) : null
          )}
        </div>
        <label className="row gap6 center micro muted" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          只看问题
        </label>
      </div>

      <div className="log-view">
        {lines.map((e, i) => (
          <div className={`log-line ${logCls(e)}`} key={i}>
            <span className="log-time">{fmtClock(e.at || task.createdAt)}</span>
            <span className="log-text">{logText(e)}</span>
          </div>
        ))}
        {lines.length === 0 && <div className="micro muted">没有匹配的行。</div>}
      </div>
    </div>
  );
}

function ResultsPanel({ task, onlyFailed }) {
  const all = task.results || [];
  const list = onlyFailed ? all.filter((r) => r.state === 'FAILED') : all;

  // 没有 progress 事件（比如脚本提前失败）时退回预检清单
  if (all.length === 0) {
    const items = task.items || [];
    if (items.length === 0) return <p className="micro muted">没有结果明细。</p>;
    return (
      <>
        <p className="micro muted" style={{ marginTop: 0 }}>
          这次没有逐条执行记录，下面是预检清单。
        </p>
        <div className="item-list">
          {items.map((it, i) => {
            const s = STATE_UI[it.state] || { label: it.state, cls: 'tag-gray' };
            return (
              <div className="item-row" key={i}>
                <span className={`tag ${s.cls}`}>{s.label}</span>
                <span className="item-title grow">{it.title}</span>
                {it.note && <span className="item-note">{it.note}</span>}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {task.artifacts && task.artifacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {task.artifacts.map((a, i) => (
            <div key={i} className="row" style={{ fontSize: 'var(--fs-micro)' }}>
              <span className="tag tag-green">{a.kind}</span>
              <span className="item-path grow" title={a.path}>
                {a.path}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => window.kc.reveal(a.path)}>
                定位
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="item-list" style={{ maxHeight: 360 }}>
        {list.map((r, i) => {
          const s = STATE_UI[r.state] || { label: r.state, cls: 'tag-gray' };
          return (
            <div className="item-row" key={i}>
              <span className="micro muted" style={{ width: 40, textAlign: 'right' }}>
                {r.i}
              </span>
              <span className={`tag ${s.cls}`}>{s.label}</span>
              <span className="item-title grow">{r.title}</span>
              {r.error && (
                <span className="item-note" style={{ color: 'var(--c-danger)' }} title={r.error}>
                  {r.error}
                </span>
              )}
              {r.objectRef && (
                <span className="item-path mono" style={{ maxWidth: 160 }} title={r.objectRef}>
                  {r.objectRef}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 工具 */

const TYPE_LABEL = {
  step: '步骤',
  log: '原文',
  warn: '警告',
  error: '错误',
  stderr: 'stderr',
  progress: '进度',
  item: '清单',
  summary: '汇总',
  artifact: '产物',
};

function logCls(e) {
  if (e.type === 'error' || e.type === 'stderr') return 'is-error';
  if (e.type === 'warn') return 'is-warn';
  if (e.type === 'step') return 'is-step';
  return '';
}

function logText(e) {
  switch (e.type) {
    case 'step':
      return `STEP ${e.n} ${e.label || ''}`.trim();
    case 'log':
      return e.text;
    case 'warn':
      return `[!] ${e.text}`;
    case 'error':
      return `[X] ${e.text || e.message || ''}`;
    case 'stderr':
      return `[stderr] ${e.text}`;
    case 'progress':
      return `[${e.i}/${e.n}] ${e.title} — ${e.state}${e.error ? `：${e.error}` : ''}`;
    case 'item':
      return `${e.state} ${e.title}`;
    case 'summary':
      return `[汇总:${e.phase}] ${Object.entries(e.counts || {}).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    case 'artifact':
      return `[产物:${e.kind}] ${e.path}`;
    case 'login':
      return e.ok ? `[OK] 登录成功：${e.version} / ${e.user}` : `[X] 登录失败：${e.error}`;
    case 'started':
      return '(脚本已启动)';
    case 'exit':
      return `(退出码 ${e.code})`;
    default:
      return JSON.stringify(e);
  }
}

function groupByState(items) {
  const order = ['FAILED', 'BLOCKED', 'TOCREATE', 'TOUPDATE', 'UNCHANGED', 'SKIPPED', 'CREATED', 'UPDATED'];
  const map = new Map();
  for (const it of items) {
    const k = it.state || 'UNKNOWN';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function currentStepLabel(task, running) {
  if (!running) {
    if (task.status === 'partial' || task.status === 'failed') return '执行结束，有项目未成功';
    if (task.status === 'done') return '全部完成';
    return '未开始';
  }
  const last = (task.events || []).filter((e) => e.type === 'step').pop();
  return last ? `当前步骤：STEP ${last.n} ${last.label || ''}`.trim() : '执行中';
}

function removeTask(id, setTasks, setRoute) {
  setTasks((prev) => prev.filter((t) => t.id !== id));
  setRoute('tasks');
}

function redact(params) {
  const p = { ...params };
  if (p.password) p.password = '••••••';
  return p;
}

function safeName(s) {
  return String(s || 'result').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

function fmtClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtTime(ts, full = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return full ? `${d.getFullYear()}/${base}:${p(d.getSeconds())}` : base;
}
