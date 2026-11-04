import React, { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeKcPath } from '../store';
import { useApp } from '../main';

const FOLDER_TYPE_LABEL = {
  ISHIllustration: '插图',
  ISHModule: 'Topic',
  ISHMasterDoc: 'Map',
  ISHPublication: 'Pub',
  ISHNone: '普通',
};

/**
 * KC 目录选择器：文本框手贴 + 下拉浏览（走脚本 -ListFolders）。
 * props: { value, onChange, requiredType, hint }
 */
export default function FolderPicker({ value, onChange, requiredType, disabled, bare }) {
  const { creds, settings } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [node, setNode] = useState(null); // { path, resolved, missing, folderType, children }
  const [err, setErr] = useState('');
  const wrapRef = useRef(null);
  const unsubRef = useRef(null);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => () => unsubRef.current && unsubRef.current(), []);

  const browse = useCallback(
    async (path) => {
      if (!creds) return;
      setLoading(true);
      setErr('');
      const id = `ls-${Date.now().toString(36)}`;
      unsubRef.current && unsubRef.current();

      let got = null;
      unsubRef.current = window.kc.onRunEvent(id, (evt) => {
        if (evt.type === 'folder') {
          got = evt.data;
          setNode(evt.data);
        } else if (evt.type === 'login' && !evt.ok) {
          setErr(evt.error || '登录失败');
        } else if (evt.type === 'error') {
          setErr(String(evt.text).replace(/^\[X\]\s*/, ''));
        } else if (evt.type === 'exit') {
          setLoading(false);
          if (!got) setErr((p) => p || '读取目录失败');
          unsubRef.current && unsubRef.current();
          unsubRef.current = null;
        }
      });

      const res = await window.kc.startRun({
        id,
        taskType: 'topic', // 脚本侧只读分支，类型无关
        mode: 'listFolders',
        params: {
          user: creds.user,
          password: creds.password,
          wsBaseUrl: settings.wsBaseUrl,
          ignoreSsl: settings.ignoreSsl,
          folderPath: path,
        },
      });
      if (!res.ok) {
        setLoading(false);
        setErr(res.error || '启动失败');
      }
    },
    [creds, settings]
  );

  const openPicker = () => {
    setOpen(true);
    browse(normalizeKcPath(value) || 'General');
  };

  const navTo = (p) => browse(p);

  const typeMismatch =
    node && node.resolved && requiredType && node.folderType && node.folderType !== requiredType;

  const crumbs = node ? node.path.split(/\\/).filter(Boolean) : [];

  if (bare) {
    return (
      <div className="folder-picker bare" ref={wrapRef}>
        <button
          type="button"
          className="p3-browse"
          onClick={openPicker}
          disabled={disabled || !creds}
          title="浏览 KC 目录"
        >
          浏览仓库
        </button>
        {open && (
          <div className="folder-dropdown">
            <div className="folder-path-bar">
              {crumbs.map((c, i) => (
                <span key={i} className="folder-crumb" onClick={() => navTo(crumbs.slice(0, i + 1).join('\\'))}>
                  {c}
                  {i < crumbs.length - 1 ? ' \\' : ''}
                </span>
              ))}
            </div>
            {loading && <div className="folder-empty">读取中…</div>}
            {!loading && err && <div className="folder-empty" style={{ color: 'var(--c-danger)' }}>{err}</div>}
            {!loading && !err && node && (
              <>
                {node.children && node.children.length > 0 ? (
                  node.children.map((c) => (
                    <div key={c.id || c.name} className="folder-option" onClick={() => navTo(`${node.path}\\${c.name}`)}>
                      <span>📁</span>
                      <span>{c.name}</span>
                      <span className="ftype">{FOLDER_TYPE_LABEL[c.type] || c.type || '—'}</span>
                    </div>
                  ))
                ) : (
                  <div className="folder-empty">这层没有子目录</div>
                )}
                <div
                  className="folder-option"
                  style={{ borderTop: '1px solid rgba(240,176,200,.4)', marginTop: 4, color: 'var(--c-accent-dark)' }}
                  onClick={() => { onChange(node.path); setOpen(false); }}
                >
                  <span>✓</span>
                  <span>使用当前路径：{node.path}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="folder-picker" ref={wrapRef}>
      <div className="row">
        <input
          className="input grow mono"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(normalizeKcPath(value))}
          placeholder="General\\...\\image"
        />
        <button
          type="button"
          className="btn"
          onClick={openPicker}
          disabled={disabled || !creds}
          title="浏览 KC 目录"
        >
          浏览
        </button>
      </div>

      {typeMismatch && (
        <div className="banner banner-warn" style={{ marginTop: 8, marginBottom: 0 }}>
          <span>⚠</span>
          <span>
            这层是「{FOLDER_TYPE_LABEL[node.folderType] || node.folderType}」目录，不是
            「{FOLDER_TYPE_LABEL[requiredType] || requiredType}」目录。
            {node.folderType === 'ISHNone'
              ? '普通目录什么对象都放不进去，请再下一层。'
              : '脚本会自动建子容器，但建议手动选对层。'}
          </span>
        </div>
      )}

      {open && (
        <div className="folder-dropdown">
          <div className="folder-path-bar">
            {crumbs.map((c, i) => (
              <span
                key={i}
                className="folder-crumb"
                onClick={() => navTo(crumbs.slice(0, i + 1).join('\\'))}
              >
                {c}
                {i < crumbs.length - 1 ? ' \\' : ''}
              </span>
            ))}
            {node && node.missing && node.missing.length > 0 && (
              <span className="tag tag-amber" style={{ marginLeft: 'auto' }}>
                将新建 {node.missing.length} 层
              </span>
            )}
          </div>

          {loading && <div className="folder-empty">读取中…</div>}
          {!loading && err && <div className="folder-empty" style={{ color: 'var(--c-danger)' }}>{err}</div>}
          {!loading && !err && node && (
            <>
              {node.children && node.children.length > 0 ? (
                node.children.map((c) => (
                  <div
                    key={c.id || c.name}
                    className="folder-option"
                    onClick={() => navTo(`${node.path}\\${c.name}`)}
                  >
                    <span>📁</span>
                    <span>{c.name}</span>
                    <span className="ftype">
                      {FOLDER_TYPE_LABEL[c.type] || c.type || '—'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="folder-empty">这层没有子目录</div>
              )}
              <div
                className="folder-option"
                style={{ borderTop: '1px solid rgba(240,176,200,.4)', marginTop: 4, color: 'var(--c-accent-dark)' }}
                onClick={() => {
                  onChange(node.path);
                  setOpen(false);
                }}
              >
                <span>✓</span>
                <span>使用当前路径：{node.path}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
