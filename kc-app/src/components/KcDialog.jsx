import React from 'react';
import { createPortal } from 'react-dom';

/**
 * D1 设计稿的两种弹窗，几何取自 KC-App-Design/dsl/D1-dialog.json。
 * 与通用 Modal 不同，这两个是定尺定点的（590×486 / 424×302），
 * 内部元素全部绝对定位对齐设计稿，不随内容伸缩。
 */

/** 危险确认：取消正在执行的任务。590×486 */
export function DangerDialog({
  name = '',
  typeLabel = '',
  statusLabel = '',
  progress = '',
  dir = '',
  items = [], // [{title, desc, tone:'ok'|'warn'|'muted'}]
  counts = { created: 0, running: 0, waiting: 0 },
  onCancel, // 继续执行（什么都不做）
  onConfirm, // 取消任务
}) {
  const rows = items.length
    ? items
    : [
        { title: `${counts.created} 项已创建`, desc: '保留在 KC 仓库，可从结果清单打开。', tone: 'ok' },
        { title: `${counts.running} 项正在处理`, desc: '立即停止，并标记为「未完成」。', tone: 'warn' },
        { title: `${counts.waiting} 项等待执行`, desc: '不会开始执行，可之后仅重试未完成项。', tone: 'muted' },
      ];

  return createPortal(
    <div className="d1-mask">
      <div className="d1-danger" role="dialog" aria-modal="true">
        <img className="d1-sticker-a" src="/img/stickers/login-laptop.png" alt="" />
        <img className="d1-sticker-b" src="/img/stickers/d1-trash.png" alt="" />

        <div className="d1-tag">正在执行</div>
        <h2 className="d1-title">确认取消这个任务？</h2>
        <p className="d1-sub">任务会立即停止，已创建的 KC 对象不会自动回滚。</p>

        <div className="d1-summary">
          <div className="d1-sum-name">{name}</div>
          <div className="d1-sum-meta">
            {[typeLabel, statusLabel, progress].filter(Boolean).join('  ·  ')}
          </div>
          <div className="d1-sum-dir">{dir}</div>
        </div>

        <div className="d1-impact-title">取消后会留下什么</div>

        {rows.slice(0, 3).map((r, i) => (
          <div className={`d1-row r${i + 1}`} key={i}>
            <span className={`d1-dot ${r.tone || 'ok'}`} />
            <span className="d1-row-t">{r.title}</span>
            <span className="d1-row-d">{r.desc}</span>
          </div>
        ))}

        <div className="d1-hint">任务会保留在列表中并显示为「已取消」。</div>

        <button className="d1-btn-keep" onClick={onCancel}>
          继续执行
        </button>
        <button className="d1-btn-kill" onClick={onConfirm}>
          取消任务
        </button>
      </div>
    </div>,
    document.body
  );
}

/** 报错变体：可恢复错误（路径不存在、连接失败等）。424×302 */
export function ErrorDialog({
  title = '出错了',
  reason = '',
  code = '',
  path = '',
  codeLabel = '',
  onClose,
  onCopy,
}) {
  return createPortal(
    <div className="d1-mask">
      <div className="d1-error" role="dialog" aria-modal="true">
        <img className="d1-sticker-c" src="/img/stickers/p1-message-bubble.png" alt="" />

        <div className="d1-err-icon">!</div>
        <div className="d1-err-title">{title}</div>
        <p className="d1-err-reason">{reason}</p>

        <div className="d1-err-detail">
          <div className="d1-err-code">{codeLabel || code}</div>
          <div className="d1-err-path">{path}</div>
        </div>

        <div className="d1-err-aux">错误代码可复制给管理员排查</div>
        <div className="d1-err-line" />

        <button className="d1-err-copy" onClick={onCopy}>
          复制详情
        </button>
        <button className="d1-err-ok" onClick={onClose}>
          确定
        </button>
      </div>
    </div>,
    document.body
  );
}
