import React, { useState } from 'react';
import { useApp } from '../main';
import { Field, Hint } from '../components/Hint';
import Modal from '../components/Modal';

const DEFAULT_WS = 'https://kc-prod.hikvision.com/ISHWS/';

export default function SettingsPage() {
  const { creds, settings, setSettings, logout } = useApp();
  const [draft, setDraft] = useState(settings);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const patch = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const save = () => {
    setSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="page-scroll">
      <div className="topbar" style={{ margin: '-24px -32px 24px', paddingLeft: 32, borderBottom: 'none' }}>
        <h1>设置</h1>
        <span className="crumb">凭据、服务地址与本地存储</span>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>
            {saved ? '已保存' : dirty ? '保存修改' : '无改动'}
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="card card-pad">
            <h2 className="card-title">连接</h2>
            <p className="card-desc">
              KC 服务地址与证书策略。改动只影响本机下一次脚本调用。
            </p>

            <Field
              label="WS 服务地址"
              hint={`KC 的 ISHWS 端点。默认 ${DEFAULT_WS}\n测试环境或代理环境改成实际地址。必须以 / 结尾或省略，脚本会自动补。`}
            >
              <input
                className="input mono"
                value={draft.wsBaseUrl}
                onChange={(e) => patch('wsBaseUrl', e.target.value)}
                placeholder={DEFAULT_WS}
              />
            </Field>

            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(draft.ignoreSsl)}
                onChange={(e) => patch('ignoreSsl', e.target.checked)}
              />
              <span>忽略证书校验</span>
              <Hint text="本机未装 KC 根证书时勾选。仅限内网使用 —— 勾选后传输不再防中间人。" />
            </label>

            <div className="flex gap10 mt16">
              <button className="btn btn-sm" onClick={() => patch('wsBaseUrl', DEFAULT_WS)}>
                恢复默认地址
              </button>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="card-title">本地存储</h2>
            <p className="card-desc">
              所有数据只存在这台机器上，不上传任何服务器。
            </p>

            <Field label="保留任务记录条数" hint="超出后自动丢弃最旧的记录。0 表示不限制。">
              <input
                className="input"
                type="number"
                min={0}
                max={2000}
                value={draft.maxTasks ?? 200}
                onChange={(e) => patch('maxTasks', Number(e.target.value) || 0)}
              />
            </Field>

            <Field label="保留日志份数" hint="脚本每次运行会写一份 transcript 到 logs\\ 目录，这里控制保留最近几份。">
              <input
                className="input"
                type="number"
                min={1}
                max={500}
                value={draft.keepLogs ?? 20}
                onChange={(e) => patch('keepLogs', Number(e.target.value) || 20)}
              />
            </Field>
          </section>
        </div>

        <div className="stack">
          <section className="card card-pad">
            <h2 className="card-title">当前账号</h2>
            {creds ? (
              <>
                <div className="row gap10" style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: 'var(--c-accent)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {(creds.user || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-body-bold)' }}>{creds.user}</div>
                    <div className="micro muted">凭据保存在本机</div>
                  </div>
                </div>
                <button className="btn btn-danger wfull" onClick={() => setConfirmLogout(true)}>
                  退出并清除凭据
                </button>
              </>
            ) : (
              <p className="micro muted" style={{ margin: 0 }}>
                未登录
              </p>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="card-title">关于</h2>
            <div className="stack" style={{ gap: 8, fontSize: 'var(--fs-caption)' }}>
              <Row k="版本" v="v0.1.0" />
              <Row k="驱动" v="ISHRemote 9.0" />
              <Row k="脚本" v="kc-import-images / kc-create-objects" />
              <Row k="运行平台" v={navigator.platform || '—'} />
            </div>
            <p className="micro muted mt16" style={{ marginBottom: 0, lineHeight: 1.6 }}>
              本工具只在本机调用 PowerShell 脚本，凭据与任务记录不上传。执行前建议先在测试目录跑一次预检。
            </p>
          </section>
        </div>
      </div>

      {confirmLogout && (
        <Modal
          title="退出并清除凭据"
          body="将删除本机保存的账号密码。已创建的任务记录会保留。下次使用需要重新登录。"
          confirmText="退出"
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

function Row({ k, v }) {
  return (
    <div className="flex between center">
      <span className="muted">{k}</span>
      <span className="mono" style={{ fontSize: 'var(--fs-micro)' }}>
        {v}
      </span>
    </div>
  );
}
