import React from 'react';
import { createPortal } from 'react-dom';

/**
 * 通用弹窗。
 * <Modal title body confirmText danger wide onCancel onConfirm>  —— 确认式
 * <Modal title wide onCancel>{children}</Modal>                  —— 自定义内容
 */
export default function Modal({
  title,
  body,
  children,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  wide = false,
  onCancel,
  onConfirm,
}) {
  const custom = children != null;

  return createPortal(
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className="modal" style={wide ? { width: 620, maxHeight: '82vh', overflowY: 'auto' } : undefined}>
        <h3 className="modal-title">{title}</h3>

        {custom ? (
          children
        ) : (
          <>
            <div className="modal-body">{body}</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onCancel}>
                {cancelText}
              </button>
              <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
                {confirmText}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
