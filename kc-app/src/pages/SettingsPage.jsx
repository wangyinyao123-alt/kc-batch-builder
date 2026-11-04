import React, { useState } from 'react';
import { useApp } from '../main';
import { Hint } from '../components/Hint';
import Modal from '../components/Modal';

const DEFAULT_WS = 'https://kc-prod.hikvision.com/ISHWS/';
const APP_VERSION = 'v1.6.0';

/**
 * P5 设置（按 KC-App-Design/dsl/P5-settings.json 重写）。
 * 布局：左栏 550 宽三张卡（服务器连接 174 / 本机安全 118 / 日志 128），
 *      右栏 570 宽两张卡（白名单 328 / 关于 106），底部隔线 + 右对齐两按钮。
 */
export default function SettingsPage() {
  const { creds, settings, setSettings, logout } = useApp();
  const [draft, setDraft] = useState(settings);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [toast, setToast] = useState('');
  const [testing, setTesting] = useState(false);
  const [whitelist, setWhitelist] = useState(
    settings.whitelist || ['/KC/Products', '/KC/Shared/Publication', '/KC/Archive']
  );
  const [newPath, setNewPath] = useState('');

  const dirty = JSON.stringify({ ...draft, whitelist }) !== JSON.stringify({ ...settings, whitelist: settings.whitelist || ['/KC/Products', '/KC/Shared/Publication', '/KC/Archive'] });

  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(''), 2400);
  };
  const patch = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    setSettings({ ...draft, whitelist });
    flash('设置已保存，下一次新建任务生效');
  };

  const reset = () => {
    setDraft({
      wsBaseUrl: DEFAULT_WS,
      ignoreSsl: false,
      keepLogs: 20,
      maxTasks: 200,
    });
    setWhitelist(['/KC/Products', '/KC/Shared/Publication', '/KC/Archive']);
    flash('已恢复默认值，记得点保存设置');
  };

  const testConn = async () => {
    setTesting(true);
    try {
      if (!window.kc?.ping) {
        flash('当前环境不支持连通性测试（仅在桌面客户端可用）');
        return;
      }
      const r = await window.kc.ping(draft.wsBaseUrl, draft.ignoreSsl);
      if (r?.ok) {
        flash(`连接正常：${r.note || draft.wsBaseUrl}${r.ms ? `，${r.ms}ms` : ''}`);
      } else {
        // 把具体错误码和原因带出来，别让用户对着「请检查网络」瞎猜
        flash(`连接失败（${r?.code || 'E_UNKNOWN'}）：${r?.error || '原因未知'}`);
      }
    } catch (e) {
      flash(`连接失败：${String(e?.message || e)}`);
    } finally {
      setTesting(false);
    }
  };

  const addPath = () => {
    const p = newPath.trim();
    if (!p) return;
    if (whitelist.includes(p)) {
      flash('该路径已在白名单中');
      return;
    }
    setWhitelist([...whitelist, p]);
    setNewPath('');
  };

  return (
    <div className="page-scroll">
      <div className="p5">
        <div className="p5-crumb">PIXEL WORKSPACE / SETTINGS</div>

        <div className="p5-head">
          <h1 className="p5-title">设置</h1>
          <div className="p5-sub">管理连接、本机安全与默认落点</div>
          <div className="p5-tip">保存后在下一次任务中生效</div>
        </div>

        <div className="p5-cols">
          {/* ---------------- 左栏 550 ---------------- */}
          <div className="p5-col">
            <section className="p5-card h174">
              <div className="p5-ct">服务器连接</div>
              <div className="p5-cd">编辑服务器地址后，可先测试连接</div>
              <div className="p5-l">KC 服务器地址</div>
              <input
                className="p5-input"
                value={draft.wsBaseUrl}
                onChange={(e) => patch('wsBaseUrl', e.target.value)}
                placeholder={DEFAULT_WS}
              />
              <button className="p5-test" onClick={testConn} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <div className="p5-note">当前连接：测试环境</div>
              <img className="p5-st-netcat" src="./img/stickers/p5-net-cat.png" alt="" />
            </section>

            <section className="p5-card h118">
              <div className="p5-ct">本机安全</div>
              <div className="p5-cd">凭据只在此设备上加密保存</div>
              <div className="p5-rowlabel">记住密码</div>
              <button
                className={`p5-switch ${draft.savePass ? 'is-on' : ''}`}
                onClick={() => patch('savePass', !draft.savePass)}
                aria-pressed={Boolean(draft.savePass)}
              >
                <span className="p5-knob" />
              </button>
              <div className="p5-rowexp">保持登录状态，随时可在这里关闭</div>
            </section>

            <section className="p5-card h128">
              <div className="p5-ct">日志</div>
              <div className="p5-cd">到期后自动清除本地日志</div>
              <div className="p5-rowlabel">日志保留天数</div>
              <select
                className="p5-select"
                value={draft.keepLogs ?? 30}
                onChange={(e) => patch('keepLogs', Number(e.target.value))}
              >
                {[7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} 天
                  </option>
                ))}
              </select>
              <div className="p5-rowexp">默认值适合日常排查</div>
              <img className="p5-st-notes" src="./img/stickers/p5-notes.png" alt="" />
            </section>
          </div>

          {/* ---------------- 右栏 570 ---------------- */}
          <div className="p5-col">
            <section className="p5-card h328">
              <div className="p5-ct">默认落点白名单</div>
              <div className="p5-cd">任务只能写入以下 KC 路径</div>
              <div className="p5-wlcount">{whitelist.length} 个允许目录</div>
              <div className="p5-wl">
                {whitelist.map((p, i) => (
                  <div className="p5-wlrow" key={i}>
                    <span className="p5-wlpath">{p}</span>
                    <button
                      className="p5-wlrm"
                      onClick={() => setWhitelist(whitelist.filter((_, j) => j !== i))}
                    >
                      移除
                    </button>
                  </div>
                ))}
                {whitelist.length === 0 && <div className="p5-wlempty">还没有允许目录</div>}
              </div>
              <div className="p5-wlexp">限制写入范围，有助于避免误建</div>
              <div className="p5-addrow">
                <button className="p5-addbtn" onClick={addPath}>
                  + 添加路径
                </button>
                <input
                  className="p5-addinput"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPath()}
                  placeholder="/KC/新目录，回车加入"
                />
              </div>
              <img className="p5-st-folder" src="./img/stickers/p2-pixel-folder-cat-sticker.png" alt="" />
            </section>

            <section className="p5-card h106">
              <div className="p5-ct">关于应用</div>
              <div className="p5-about">KC 批量建库工具 · {APP_VERSION}</div>
              <div className="p5-about2">已是最新版本</div>
              <button className="p5-update" onClick={() => flash('已是最新版本')}>
                检查更新
              </button>
              <img className="p5-st-plant" src="./img/stickers/p2-cat-plant.png" alt="" />
            </section>
          </div>
        </div>

        <div className="p5-divider" />

        <div className="p5-foot">
          <div className="p5-footnote">更改会在下一次新建任务中生效</div>
          <div className="p5-footbtns">
            <button className="p5-b-ghost" onClick={() => setConfirmLogout(true)}>
              退出登录
            </button>
            <button className="p5-b-ghost" onClick={reset}>
              恢复默认
            </button>
            <button className="p5-b-primary" onClick={save} disabled={!dirty}>
              {dirty ? '保存设置' : '已保存'}
            </button>
          </div>
        </div>

        {toast && <div className="p5-toast">{toast}</div>}
      </div>

      {confirmLogout && (
        <Modal
          title="退出并清除凭据"
          body="将删除本机保存的账号密码。已创建的任务记录会保留。下次使用需要重新登录。"
          confirmText="退出并清除"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false);
            logout();
          }}
        />
      )}
    </div>
  );
}
