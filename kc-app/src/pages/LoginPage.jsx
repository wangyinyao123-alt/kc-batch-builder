import React, { useState } from 'react';
import Decor from '../components/Decor';

export default function LoginPage({ onLogin }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!user.trim() || !password) {
      setErr('请填写账号和密码');
      return;
    }
    setBusy(true);
    // 登录态在首次脚本调用时真正确立；这里只做本地校验与保存
    setTimeout(() => {
      setBusy(false);
      onLogin({ user: user.trim(), password, remember });
    }, 260);
  };

  return (
    <div className="login-wrap">
      {/* 贴纸按 P1 设计稿坐标定位（DSL P1-login.json），在卡片下层不遮挡表单 */}
      <Decor scene="p1" />

      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-mark">KC</div>
          <div>
            <div className="brand-name">内容生产助手</div>
            <div className="brand-sub">Hikvision Content Studio</div>
          </div>
        </div>

        <h1 className="login-title">登录 KC</h1>
        <p className="login-sub">使用你的 KC 账号。凭据仅保存在本机，用于调用上传脚本。</p>

        {err && (
          <div className="banner banner-error">
            <span>⚠</span>
            <span>{err}</span>
          </div>
        )}

        <div className="field">
          <label className="label">账号</label>
          <input
            className="input"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="域账号或邮箱前缀"
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label className="label">密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="KC 登录密码"
            autoComplete="current-password"
          />
        </div>

        <label className="check mb16">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>记住本机（加密保存，不上传）</span>
        </label>

        <button className="btn btn-primary wfull" style={{ height: 40 }} disabled={busy}>
          {busy ? '正在连接…' : '登录'}
        </button>

        <p className="micro muted" style={{ marginTop: 16, marginBottom: 0, lineHeight: 1.6 }}>
          首次调用脚本时才会真正验证凭据；密码错误时脚本会主动停止重试，避免锁号。
        </p>
      </form>
    </div>
  );
}
