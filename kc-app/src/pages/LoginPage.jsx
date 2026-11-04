import React, { useState } from 'react';
import { ErrorDialog } from '../components/KcDialog';

/**
 * P1 登录（按 KC-App-Design/dsl/P1-login.json 重写）。
 * 画板 1280×800：顶部 36 高标题栏 + 居中登录卡 520×610（x380,y95）。
 * 卡片内：品牌条 56 → 首次提示 34 → 标题/副标题 → 服务器地址/账号/密码三输入 → 记住密码 → 登录按钮 48。
 * 四角贴纸由 .p1-st* 绝对定位（坐标取自 DSL）。
 */

const STICKERS = [
  { cls: 'p1-st-wincat', src: './img/stickers/login-window-cat-sticker.png', x: 115, y: 14, w: 286, h: 235 },
  { cls: 'p1-st-planet', src: './img/stickers/login-planet-sticker.png', x: 610, y: 41, w: 152, h: 135 },
  { cls: 'p1-st-bubble', src: './img/stickers/p1-message-bubble.png', x: 894, y: 358, w: 365, h: 181 },
  { cls: 'p1-st-star', src: './img/stickers/login-shooting-star-sticker.png', x: 750, y: 226, w: 135, h: 102 },
  { cls: 'p1-st-laptop', src: './img/stickers/login-laptop-sticker.png', x: 835, y: 645, w: 166, h: 120 },
];

// 与设置页 DEFAULT_WS 保持一致：首次进登录页必须带真实服务器地址，
// 否则用户直接点登录会一路失败，却误以为是自己的网络问题。
const DEFAULT_WS = 'https://kc-prod.hikvision.com/ISHWS/';

export default function LoginPage({ onLogin }) {
  const [ws, setWs] = useState(DEFAULT_WS);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fatal, setFatal] = useState(null); // {title, reason, code, path}
  const [netState, setNetState] = useState(null); // {ok, text}

  /** 不登录也能先确认服务器地址是否可达——避免把「地址填错」误当成网络故障 */
  const testNet = async () => {
    const target = ws.trim();
    if (!/^https?:\/\//i.test(target)) {
      setNetState({ ok: false, text: '地址必须以 http:// 或 https:// 开头' });
      return;
    }
    if (!window.kc?.ping) {
      setNetState({ ok: false, text: '当前环境不支持连通性测试' });
      return;
    }
    setNetState({ ok: null, text: '正在连接…' });
    try {
      const r = await window.kc.ping(target, false);
      setNetState(
        r?.ok
          ? { ok: true, text: `${r.note || '连接正常'}${r.ms ? `，${r.ms}ms` : ''}` }
          : { ok: false, text: `${r?.code || 'E_UNKNOWN'}：${r?.error || '连接失败'}` }
      );
    } catch (e) {
      setNetState({ ok: false, text: String(e?.message || e) });
    }
  };

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!user.trim() || !password) {
      setErr('请填写用户名和密码');
      return;
    }
    if (!/^https?:\/\//i.test(ws.trim())) {
      setFatal({
        title: '服务器地址无效',
        reason: '地址必须以 http:// 或 https:// 开头，并以 /ISHWS/ 结尾。改好后可以直接重试。',
        codeLabel: 'E101 · 地址格式错误',
        path: ws.trim() || '（空）',
      });
      return;
    }
    setBusy(true);
    // 凭据在首次脚本调用时才真正校验；这里只做本地校验并保存
    setTimeout(() => {
      setBusy(false);
      onLogin({ user: user.trim(), password, remember, wsBaseUrl: ws.trim() });
    }, 260);
  };

  return (
    <div className="p1">
      <div className="p1-bg" />
      <div className="p1-veil" />
      <div className="p1-titlebar" />

      {STICKERS.map((s) => (
        <img key={s.cls} className={`p1-st ${s.cls}`} src={s.src} alt="" />
      ))}

      <form className="p1-card" onSubmit={submit}>
        <div className="p1-brandbar">
          <span className="p1-mark">KC</span>
          <span className="p1-brandname">KC 批量建库工具</span>
        </div>

        <div className="p1-firstuse">本机首次使用，请先登录</div>

        <h1 className="p1-title">登录</h1>
        <p className="p1-sub">连接 KC 仓库后开始批量建库</p>

        {err && <div className="p1-err">{err}</div>}

        <label className="p1-label l1">服务器地址</label>
        {/* 测试按钮塞进输入框右端，不改动绝对定位的 448×44 几何 */}
        <input
          className="p1-input i1 p1-input-hasbtn"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
          placeholder="https://kc-prod.hikvision.com/ISHWS/"
          spellCheck={false}
        />
        <button type="button" className="p1-nettest" onClick={testNet}>
          {netState?.ok === null ? '连接中…' : '测试连接'}
        </button>
        {netState && (
          <div className={`p1-netmsg ${netState.ok === true ? 'ok' : netState.ok === false ? 'bad' : ''}`}>
            {netState.text}
          </div>
        )}

        <label className="p1-label l2">用户名</label>
        <input
          className="p1-input i2"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="请输入 KC 账号"
          autoComplete="username"
        />

        <label className="p1-label l3">密码</label>
        <input
          className="p1-input i3"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
        />

        <label className="p1-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>记住密码</span>
        </label>

        <button className="p1-submit" type="submit" disabled={busy}>
          {busy ? '正在连接…' : '登录'}
        </button>

        <div className="p1-foot">KC 批量建库工具 · 测试环境</div>
      </form>

      <div className="p1-versionbar" />
      {fatal && (
        <ErrorDialog
          title={fatal.title}
          reason={fatal.reason}
          codeLabel={fatal.codeLabel}
          path={fatal.path}
          onCopy={() => {
            navigator.clipboard?.writeText(`${fatal.codeLabel} | ${fatal.reason} | ${fatal.path}`);
            setFatal(null);
          }}
          onClose={() => setFatal(null)}
        />
      )}
    </div>
  );
}
