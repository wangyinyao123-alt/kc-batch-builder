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
  const [q, setQ] = useState('');

  const failedResults = useMemo(
    () => (task?.results || []).filter((r) => r.state === 'FAILED'),
    [task]
  );
  const failedItems = useMemo(
    () => (task?.items || []).filter((it) => it.state === 'FAILED' || it.state === 'BLOCKED'),
    [task]
  );
  const failedCount = Math.max(failedResults.length, failedItems.length);
  const okCount = (task?.results || []).filter((r) =>
    ['SUCCESS', 'CREATED', 'UPDATED', 'UNCHANGED'].includes(r.state)
  ).length;
  const shown = useMemo(() => {
    let out = task?.results || [];
    if (onlyFailed) out = out.filter((r) => r.state === 'FAILED');
    const kw = q.trim().toLowerCase();
    if (kw) {
      out = out.filter(
        (r) =>
          String(r.title || '').toLowerCase().includes(kw) ||
          String(r.objectRef || '').toLowerCase().includes(kw) ||
          String(r.error || '').toLowerCase().includes(kw)
      );
    }
    return out;
  }, [task, onlyFailed, q]);

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
      <div className="p4">
        <div className="p4-crumb">PIXEL WORKSPACE / TASKS / DETAIL</div>

        <div className="p4-head">
          <button className="p4-back" onClick={() => setRoute('tasks')}>
            ← 返回任务
          </button>
          <div className="p4-titlebox">
            <h1 className="p4-title">{task.title}</h1>
            <div className="p4-meta">
              {task.code || task.id} · 创建于 {fmtTime(task.createdAt, true)}
            </div>
          </div>
          <span className="p4-typepill">{meta.name}</span>
          <span className={`p4-statuspill is-${task.status}`}>{st.label}</span>
        </div>

        {task.folderPath && (
          <div className="p4-dir">
            目标目录 <span className="p4-dirpath">{task.folderPath}</span>
          </div>
        )}

        <section className="p4-prog">
          <div className="p4-prog-state">{running ? currentStepLabel(task, true) : statusLine(task)}</div>
          <div className="p4-prog-num">
            {finished} <span className="p4-prog-slash">/</span> {total || '—'}
          </div>
          <div className="p4-prog-unit">已处理</div>
          <div className="p4-prog-pct">{pct}%</div>
          <div className="p4-prog-track">
            <div className={`p4-prog-fill ${running ? 'is-running' : ''}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="p4-prog-note">{progNote(task, total, failedCount)}</div>
          <div className="p4-prog-note2">{progNote2(task, c)}</div>
        </section>

        <div className="p4-tabbar">
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
                className={`p4-tab ${tab === t.key ? 'is-on' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {n > 0 && <span className="p4-tabn">{n}</span>}
              </button>
            );
          })}
        </div>

        {task.error && <div className="p4-errbar">✕ {task.error}</div>}

        <section className="p4-card">
          {tab === 'results' && (
            <>
              <div className="p4-cardhead">
                <div className="p4-cardtitle">
                  结果清单 · {task.results?.length || 0} 项
                </div>
                <label className="p4-search">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索对象或路径"
                  />
                  <span className="p4-searchic">⌕</span>
                </label>
              </div>

              <div className="p4-chips">
                {[
                  { k: 'all', label: '全部' },
                  { k: 'ok', label: '成功' },
                  { k: 'bad', label: '失败' },
                ].map((it) => {
                  const n =
                    it.k === 'ok'
                      ? okCount
                      : it.k === 'bad'
                      ? failedCount
                      : task.results?.length || 0;
                  return (
                    <button
                      key={it.k}
                      className={`p4-chip is-${it.k} ${onlyFailed === (it.k === 'bad') && (it.k !== 'all' || !onlyFailed) ? 'is-on' : ''}`}
                      onClick={() => setOnlyFailed(it.k === 'bad')}
                    >
                      {it.label} {n}
                    </button>
                  );
                })}
              </div>

              <div className="p4-list">
                {shown.length === 0 && <div className="p4-empty">没有匹配的结果。</div>}
                {shown.map((r, i) => {
                  const good = r.state === 'SUCCESS' || r.state === 'CREATED' || r.state === 'UPDATED' || r.state === 'UNCHANGED';
                  const s = STATE_UI[r.state] || { label: r.state, cls: 'tag-gray' };
                  return (
                    <div className="p4-row" key={i}>
                      <span className={`p4-rowic ${good ? 'is-ok' : 'is-bad'}`}>
                        {good ? '✓' : '✕'}
                      </span>
                      <span className="p4-rowtitle" title={r.title}>
                        {r.title}
                      </span>
                      <span className="p4-rowpath" title={r.objectRef || ''}>
                        {r.objectRef || '—'}
                      </span>
                      <span className={`p4-rowerr ${good ? 'is-ok' : 'is-bad'}`} title={r.error || ''}>
                        {good ? s.label : r.error || '未成功'}
                      </span>
                      <button
                        className="p4-rowact"
                        disabled={!r.objectRef}
                        onClick={() => r.objectRef && flash('对象定位需要在 KC 客户端打开')}
                      >
                        查看
                      </button>
                    </div>
                  );
                })}
              </div>

              {failedCount > 0 && (
                <aside className="p4-side">
                  <div className="p4-side-t">需要处理</div>
                  <div className="p4-side-d">{failedCount} 个失败项等待处理</div>
                  <div className="p4-side-line" />
                  <div className="p4-side-k">重试范围</div>
                  <div className="p4-side-v">仅包含失败项</div>
                  <div className="p4-side-h">已成功项不会重复创建</div>
                  <div className="p4-side-tip">可查看原因后再重试</div>
                </aside>
              )}
            </>
          )}

          {tab === 'precheck' && (
            <div className="p4-pad">
              <PrecheckPanel task={task} />
            </div>
          )}
          {tab === 'log' && (
            <div className="p4-pad">
              <LogPanel task={task} />
            </div>
          )}
        </section>

        <div className="p4-divider" />

        <div className="p4-foot">
          <div className="p4-foot-note">
            {task.folderPath ? `输出已保存至  ${task.folderPath}` : '任务尚未产生输出目录'}
          </div>
          <div className="p4-foot-btns">
            <button
              className="p4-b"
              disabled={!running}
              onClick={() => flash('中止需要脚本侧支持；请在新任务页执行时使用「中止」')}
            >
              暂停
            </button>
            <button
              className="p4-b"
              disabled={!running}
              onClick={() => flash('取消需要脚本侧支持；请在新任务页执行时使用「中止」')}
            >
              取消
            </button>
            <button className="p4-b is-primary" disabled={failedCount === 0} onClick={retryFailed}>
              只重试失败项 ({failedCount})
            </button>
            <button className="p4-b" onClick={exportResults} disabled={!task.results?.length}>
              导出结果
            </button>
            <button
              className="p4-b"
              disabled={!task.folderPath}
              onClick={() => window.kc.reveal(task.folderPath)}
            >
              打开落点
            </button>
          </div>
        </div>

        {toast && <div className="p4-toast">{toast}</div>}
      </div>
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

function statusLine(task) {
  if (task.status === 'done') return '全部完成';
  if (task.status === 'partial') return '执行已结束';
  if (task.status === 'failed') return '执行失败';
  if (task.status === 'running') return '执行中';
  return '未开始';
}

function progNote(task, total, failed) {
  if (task.status === 'running') return `正在处理第 ${total} 项`;
  if (failed > 0) return `已汇总结果，${failed} 项需处理`;
  if (task.status === 'done') return `已汇总结果，全部成功`;
  if (task.status === 'canceled') return '已取消，结果已保存';
  return '等待执行';
}

function progNote2(task, c) {
  const parts = [];
  const started = task.startedAt || task.createdAt;
  const ended = task.endedAt;
  if (started && ended && ended > started) {
    const sec = Math.round((ended - started) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    parts.push(`耗时 ${m}:${ss}`);
  }
  const ok = (c.created || 0) + (c.updated || 0) + (c.unchanged || 0) + (c.skipped || 0);
  if (ok) parts.push(`成功 ${ok} 项`);
  if (c.failed) parts.push(`失败 ${c.failed} 项`);
  return parts.join('  ·  ');
}
