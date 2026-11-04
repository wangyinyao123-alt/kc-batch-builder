import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * 悬浮提示：替代原先堆在表单里的说明文字。
 * <Hint text="..."> 返回一个「?」小圆点，悬浮/聚焦时浮层显示说明。
 */
export function Hint({ text, width = 260 }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const timer = useRef(null);

  const place = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const gap = 8;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + gap;
    // 下方空间不足则翻到上方
    if (top + 120 > window.innerHeight) top = Math.max(8, r.top - gap - 8 - 100);
    setPos({ top, left });
  }, [width]);

  const enter = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      place();
      setShow(true);
    }, 220);
  };
  const leave = () => {
    clearTimeout(timer.current);
    setShow(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        type="button"
        ref={ref}
        className="hint-trigger"
        aria-label="说明"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
      {show &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width,
              zIndex: 999,
              background: 'var(--c-accent-darkest)',
              color: '#fff',
              fontSize: 11,
              lineHeight: 1.65,
              padding: '8px 11px',
              borderRadius: 7,
              boxShadow: '0 8px 24px rgba(87,55,71,.28)',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

/** 带 Hint 的表单字段容器 */
export function Field({ label, hint, required, children, style }) {
  return (
    <div className="field" style={style}>
      <div className="label">
        {label}
        {required && <span className="req">*</span>}
        {hint && <Hint text={hint} />}
      </div>
      {children}
    </div>
  );
}
