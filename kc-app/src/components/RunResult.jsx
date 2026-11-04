import React, { useState } from 'react';
import { STATE_UI } from '../store';

/**
 * 运行结果面板：预检明细 / 执行进度 / 产物 / 挂接 / 原始日志。
 * props: { run }  ← useRun() 的返回值
 */
export default function RunResult({ run }) {
  const [tab, setTab] = useState('items');
  const { items, results, artifacts, attach, events } = run;

  // items 是预检快照（状态停在 TOCREATE/UNCHANGED），results 是执行结果。
  // 执行完还照原样渲染 items 会出现"上方计数说 3 已创建、下面每行仍写待创建"的矛盾，
  // 所以有执行结果时用执行结果覆盖同名的条目状态。
  const execState = new Map((results || []).map((r) => [r.title, r.state]));
  const rows = items.map((it) => {
    const st = execState.get(it.title);
    return st ? { ...it, state: st } : it;
  });

  const hasItems = rows.length > 0;
  const hasLog = events.length > 0;

  return (
    <section className="card card-pad">
      <div className="flex between center" style={{ marginBottom: 12 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          运行明细
        </h2>
        <div className="filters" style={{ marginBottom: 0 }}>
          <button
            className={`filter-chip ${tab === 'items' ? 'active' : ''}`}
            onClick={() => setTab('items')}
          >
            清单 {hasItems ? `(${rows.length})` : ''}
          </button>
          <button
            className={`filter-chip ${tab === 'log' ? 'active' : ''}`}
            onClick={() => setTab('log')}
            disabled={!hasLog}
          >
            日志 {hasLog ? `(${events.length})` : ''}
          </button>
        </div>
      </div>

      {tab === 'items' && (
        <>
          {artifacts.length > 0 && (
            <div className="mb16" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {artifacts.map((a, i) => (
                <div key={i} className="row" style={{ fontSize: 'var(--fs-micro)' }}>
                  <span className="tag tag-green">产物</span>
                  <span className="item-path grow" title={a.path}>
                    {a.path}
                  </span>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => window.kc.reveal(a.path)}
                    title="在文件管理器中显示"
                  >
                    定位
                  </button>
                </div>
              ))}
            </div>
          )}

          {attach.length > 0 && (
            <div className="mb16" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {attach.map((a, i) => (
                <div key={i} className="row" style={{ fontSize: 'var(--fs-micro)' }}>
                  <span className={`tag ${a.skipped ? 'tag-gray' : a.ok ? 'tag-green' : 'tag-red'}`}>
                    {a.skipped ? '跳过' : a.ok ? '挂接' : '失败'}
                  </span>
                  <span className="grow">{a.kind}</span>
                  <span className="muted">{a.note}</span>
                </div>
              ))}
            </div>
          )}

          {!hasItems && artifacts.length === 0 && (
            <p className="micro muted" style={{ margin: 0 }}>
              还没有明细。预检完成后这里会列出每一项的判定结果。
            </p>
          )}

          {hasItems && (
            <div className="item-list">
              {rows.map((it, i) => {
                const st = STATE_UI[it.state] || { label: it.state, cls: 'tag-gray' };
                return (
                  <div className="item-row" key={i}>
                    <span className={`tag ${st.cls}`}>{st.label}</span>
                    <span className="item-title grow" title={it.title}>
                      {it.title}
                    </span>
                    {it.path && (
                      <span className="item-path" style={{ maxWidth: 220 }} title={it.path}>
                        {it.path}
                      </span>
                    )}
                    {it.note && <span className="item-note">{it.note}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'log' && (
        <div className="log-box">
          {events.map((e, i) => (
            <div key={i} className={logCls(e)}>
              {logText(e)}
            </div>
          ))}
          {!hasLog && <div className="l-warn">还没有输出</div>}
        </div>
      )}
    </section>
  );
}

function logCls(e) {
  if (e.type === 'step') return 'l-step';
  if (e.type === 'error' || (e.type === 'login' && !e.ok)) return 'l-err';
  if (e.type === 'warn' || e.type === 'stderr') return 'l-warn';
  if (e.type === 'summary' || e.type === 'artifact') return 'l-ok';
  return '';
}

function logText(e) {
  switch (e.type) {
    case 'step':
      return `STEP ${e.n}  ${e.label || ''}`;
    case 'login':
      return e.ok ? `[OK] 登录成功：${e.version} / 账号 ${e.user}` : `[X] 登录失败：${e.error}`;
    case 'summary':
      return `[${e.phase === 'precheck' ? '预检' : '结果'}] ${Object.entries(e.counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' / ')}`;
    case 'progress':
      return `[${e.i}/${e.n}] ${e.title} —— ${e.state}${e.error ? `：${e.error}` : ''}`;
    case 'item':
      return `    ${e.state}  ${e.title}  <${e.path}>`;
    case 'artifact':
      return `[OK] 产物：${e.path}`;
    case 'attach':
      return `[${e.ok ? 'OK' : 'X'}] ${e.kind}：${e.note}`;
    case 'warn':
      return `[!] ${e.text}`;
    case 'error':
      return e.text;
    case 'stderr':
      return `[stderr] ${e.text}`;
    case 'folder':
      return `KCJSON ${JSON.stringify(e.data)}`;
    case 'exit':
      return `—— 进程退出 code=${e.code}`;
    case 'started':
      return `—— 开始运行 ${e.payload?.taskType} / ${e.payload?.mode}`;
    default:
      return e.text || JSON.stringify(e);
  }
}
